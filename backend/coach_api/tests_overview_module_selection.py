"""Lazy Overview reads: synthetic inputs, mocked database and no writes."""
import json
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from learner_api import canonical_learning
from learner_api.journal_sources import enabled
from learner_api.training_plan_dashboard import _canonical_module_progress
from old_otjh.service import ServiceError
from .case_file import case_file_section
from .overview_modules import read_overview_module, selected_record_ids, project_overview_index, read_overview_catalogue


class OverviewModuleSelectionTests(SimpleTestCase):
    def setUp(self):
        self.owner = {'id': 101, 'enrolment_id': 201}
        self.context = SimpleNamespace(profile=SimpleNamespace(pk=101, enrolment_id=201),
                                       source=SimpleNamespace(pk=201, aptem_id=None))
        self.modules = [dict(id=mid, title=title, total_otjh=20, sessions_number=4,
                             start_date='2026-01-01', end_date='2026-12-31')
                        for mid, title in [('M1', 'Same'), ('M2', 'Same'), ('M3', 'Unique')]]

    def test_index_contains_only_counts_and_picker_metadata(self):
        progress = [{'id': 'current:M1', 'title': 'Same', 'total': 10000, 'completed': 20, 'percent': .2}]
        result = project_overview_index(progress, {'modules': self.modules, 'moduleLinks': {}})
        self.assertEqual(result['subjects'][0]['total'], 10000)
        self.assertLess(len(json.dumps(result)), 1500)
        for forbidden in ('learning', 'components', 'activities', 'sessions', 'actual', 'moduleProgress'):
            self.assertNotIn(forbidden, result)

    def test_equal_titles_do_not_change_assignment_and_retry_dependencies_are_retained(self):
        records = [
            {'id': 1, 'module_ref': 'M1', 'component_ref': 'C1', 'quiz_ref': 9},
            {'id': 2, 'module_ref': 'M2', 'component_ref': 'C2'},
            {'id': 3, 'module_ref': None, 'module_title': 'Same'},
            {'id': 4, 'module_ref': 'old', 'module_title': ' Unique '},
            {'id': 5, 'module_ref': 'M2', 'quiz_ref': 9},
            {'id': 6, 'module_ref': 'M2', 'original_source_ref': 'progress:1'},
            {'id': 7, 'module_ref': '50'},
        ]
        self.assertEqual(selected_record_ids(records, self.modules, 'M1'), [1, 5, 6])
        self.assertEqual(selected_record_ids(records, self.modules, 'M3'), [4])
        self.assertEqual(selected_record_ids(records, self.modules, None, legacy_id='50'), [7])

    def test_selected_read_matches_shared_measures_and_queries_only_its_evidence(self):
        records = [
            {'id': 1, 'module_ref': 'M1', 'accepted': True, 'actual_seconds': 7200, 'ksbs': ['K1']},
            {'id': 2, 'module_ref': 'M2', 'accepted': True, 'actual_seconds': 3600, 'ksbs': ['K2']},
            {'id': 3, 'module_ref': 'M1', 'kind': 'activity_event', 'feed_kind': 'attendance_confirmation'},
        ]
        catalogue = {'modules': self.modules, 'moduleLinks': {}, 'allowed': {'current:M1', 'current:M2'}}
        def load(owner, *, entry_ids):
            self.assertTrue(enabled())
            self.assertEqual(owner, self.owner)
            self.assertEqual(entry_ids, [1, 3])
            return [row for row in records if row['id'] in entry_ids]
        with patch('coach_api.overview_modules.overview_owner', return_value=self.owner), \
             patch('coach_api.overview_modules.read_overview_catalogue', return_value=catalogue), \
             patch('coach_api.overview_modules.connections', {'enrolment': MagicMock()}), \
             patch('learner_api.training_plan_dashboard.rows', return_value=[{'title': 'Week 1', 'live_session_count': 2}]), \
             patch('coach_api.overview_modules.query', return_value=records), \
             patch.object(canonical_learning, 'entries_for', side_effect=load) as entries, \
             patch('learner_api.learner_detail.build_learner_detail', side_effect=AssertionError('No full detail')), \
             patch('learner_api.training_plan_dashboard.read_dashboard', side_effect=AssertionError('No full dashboard')):
            result = read_overview_module(self.context, 'current:M1')
        entries.assert_called_once()
        self.assertFalse(enabled())
        expected = _canonical_module_progress(records, self.modules)['M1']
        self.assertEqual(result['moduleProgress'], {'M1': expected})
        self.assertEqual(expected['attendance'], {'attended': 1, 'total': 2})
        self.assertEqual(result['id'], 'current:M1')
        self.assertNotIn('learning', result)

    def test_unassigned_module_rejected_before_progress_reads(self):
        with patch('coach_api.overview_modules.overview_owner', return_value=self.owner), \
             patch('coach_api.overview_modules.read_overview_catalogue', return_value={'allowed': {'current:M1'}}), \
             patch('coach_api.overview_modules.query') as query, \
             patch.object(canonical_learning, 'entries_for') as entries:
            for invalid in ('current:M2', '', 'M1', 'legacy:999'):
                with self.assertRaises(LookupError):
                    read_overview_module(self.context, invalid)
        query.assert_not_called()
        entries.assert_not_called()

    def test_wrong_canonical_identity_is_rejected_before_catalogue_or_progress_reads(self):
        with patch.object(canonical_learning, 'require_profile', return_value={'id': 999}), \
             patch('coach_api.overview_modules.query') as query:
            with self.assertRaises(ServiceError):
                read_overview_module(self.context, 'current:M1')
        query.assert_not_called()

    def test_catalogue_is_membership_scoped_and_preserves_historical_links(self):
        courses = [{'source_course_ref': '50', 'source_course_title': 'Historical', 'curriculum_module_ref': 'M1'}]
        connection = MagicMock()
        with patch('coach_api.overview_modules.overview_owner', return_value=self.owner), \
             patch('coach_api.overview_modules.query', return_value=courses) as query, \
             patch('coach_api.overview_modules.connections', {'enrolment': connection}), \
             patch('learner_api.student_activity_access.student_activity_available', return_value=True), \
             patch('learner_api.training_plan_dashboard.plan_module_ids', return_value=(['M1', 'M2'], {})), \
             patch('learner_api.training_plan_dashboard.rows', return_value=self.modules[:2]):
            result = read_overview_catalogue(self.context)
        self.assertEqual(query.call_args.args[1], [101])
        self.assertEqual(connection.cursor.return_value.__enter__.return_value.execute.call_args.args[1], [['M1', 'M2']])
        self.assertEqual(result['allowed'], {'legacy:50', 'current:M2'})
        self.assertEqual(result['moduleLinks']['legacy:50']['id'], 'M1')

    def test_unlinked_history_keeps_recorded_hours_and_does_not_invent_module_measures(self):
        catalogue = {'modules': [], 'moduleLinks': {}, 'allowed': {'legacy:50'}}
        records = [{'id': 1, 'module_ref': '50', 'reporting_month': '2026-01',
                    'accepted': True, 'actual_seconds': 3600, 'ksbs': []},
                   {'id': 2, 'module_ref': '51', 'reporting_month': '2026-01',
                    'accepted': True, 'actual_seconds': 7200, 'ksbs': []}]
        with patch('coach_api.overview_modules.overview_owner', return_value=self.owner), \
             patch('coach_api.overview_modules.read_overview_catalogue', return_value=catalogue), \
             patch('coach_api.overview_modules.query', return_value=records), \
             patch.object(canonical_learning, 'entries_for', return_value=records[:1]) as entries:
            result = read_overview_module(self.context, 'legacy:50')
        entries.assert_called_once_with(self.owner, entry_ids=[1])
        self.assertEqual(result['actual'], [{'month': '2026-01', 'groupId': '50', 'hours': 1, 'count': 1}])
        self.assertEqual(result['moduleProgress'], {})

    def test_empty_module_does_not_load_any_progress_evidence(self):
        catalogue = {'modules': [], 'moduleLinks': {}, 'allowed': {'legacy:50'}}
        with patch('coach_api.overview_modules.overview_owner', return_value=self.owner), \
             patch('coach_api.overview_modules.read_overview_catalogue', return_value=catalogue), \
             patch('coach_api.overview_modules.query', return_value=[]), \
             patch.object(canonical_learning, 'entries_for') as entries:
            result = read_overview_module(self.context, 'legacy:50')
        entries.assert_not_called()
        self.assertEqual(result['actual'], [])
        self.assertTrue(result['actualAvailable'])

    def test_entries_selection_is_parameterized_before_evidence_joins_and_remains_learner_scoped(self):
        with patch.object(canonical_learning, 'query', return_value=[]) as query, \
             patch.object(canonical_learning, 'current_records', return_value=[]):
            self.assertEqual(canonical_learning.entries_for(self.owner, entry_ids=[1, 3]), [])
        sql, params = query.call_args.args
        self.assertIn('progress.learner_id=%s', sql)
        self.assertIn('progress.deleted_at IS NULL AND progress.id=ANY(%s)', sql)
        self.assertEqual(params, [101, [1, 3]])

    def test_module_transport_does_not_reload_programme_and_preserves_coach_gate(self):
        request = RequestFactory().get('/coach_api/coach/case-file/101/overview?moduleId=current:M1')
        request.coach_email = 'coach@example.test'
        context = MagicMock(profile=self.context.profile, source=self.context.source)
        with patch('coach_api.case_file.CaseFileContext', return_value=context), \
             patch('coach_api.case_file.build_overview', side_effect=AssertionError('No programme reload')), \
             patch('coach_api.overview_modules.read_overview_module', return_value={'id': 'current:M1'}) as reader:
            response = unwrap(case_file_section)(request, 101, 'overview')
            self.assertEqual(response.status_code, 200)
            reader.assert_called_once_with(context, 'current:M1')
            reader.reset_mock()
            context.profile = None
            self.assertEqual(unwrap(case_file_section)(request, 101, 'overview').status_code, 404)
            reader.assert_not_called()

    def test_invalid_selection_is_404_and_source_failure_remains_retryable(self):
        request = RequestFactory().get('/coach_api/coach/case-file/101/overview?moduleId=current:M1')
        request.coach_email = 'coach@example.test'
        context = MagicMock(profile=self.context.profile, source=self.context.source)
        for error, status in ((LookupError('Module not found'), 404), (RuntimeError('Unavailable'), 503)):
            with self.subTest(status=status), patch('coach_api.case_file.CaseFileContext', return_value=context), \
                 patch('coach_api.overview_modules.read_overview_module', side_effect=error), \
                 patch('coach_api.case_file.log.exception'):
                self.assertEqual(unwrap(case_file_section)(request, 101, 'overview').status_code, status)
