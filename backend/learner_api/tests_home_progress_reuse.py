"""Home's request-local reuse must preserve counts, hours and ownership."""
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import canonical_learning as canonical, home_progress, journal_sources, learner_detail, module_progress


class HomeProgressReuseTests(SimpleTestCase):
    def test_metrics_reuses_even_an_empty_ledger_without_changing_planned_or_actual(self):
        owner = {'id': 10, 'enrolment_id': 20, 'programme_planned_hours': 100}
        for records in ([], [{'id': 1, 'accepted': True, 'actual_seconds': 1800, 'ksbs': ['K1']},
                            {'id': 2, 'accepted': False, 'actual_seconds': 7200, 'ksbs': []}]):
            saved = deepcopy(records)
            with journal_sources.learner_journal_reads(), \
                 patch.object(canonical, 'entries_for', return_value=records) as ledger, \
                 patch.object(canonical, 'targets_for', return_value={'2026-10': 12}), \
                 patch('coach_api.migrated_otjh.planned_hours_bulk', return_value={20: 2}):
                original = canonical.metrics(20, owner=owner)
                ledger.reset_mock()
                reused = canonical.metrics(20, owner=owner, records=records)
            ledger.assert_not_called()
            self.assertEqual(reused, original)
            self.assertEqual(reused['otjh']['planned'], 102)
            self.assertEqual(records, saved)

    def read(self, kind, enrolment, *, student=True, frozen=False):
        owner = {'id': enrolment + 100, 'enrolment_id': enrolment}
        source = SimpleNamespace(pk=enrolment, id=enrolment, aptem_id=123, _canonical_profile=owner)
        records = [{'id': 1, 'component_ref': 'LIVE', 'accepted': True, 'actual_seconds': 1800}]
        credits = [{'componentId': 'LIVE', 'moduleId': 'M1', 'hours': 2.5,
                    'submittedAt': '2026-10-05T11:00:00+00:00', 'otjhFrozen': frozen}]
        lectures = [{'module_catalogue_id': 'M1', 'session_date': date(2026, 10, 5),
                     'attendance_status': 'present'}]
        history = {'subjects': [{'id': 9, 'name': 'Previous'}], 'activities': [
            {'group_id': 9, 'activity_id': 'old-1', 'completed': True},
            {'group_id': 9, 'activity_id': 'old-2', 'completed': False}]}
        detail = {'components': [
            {'componentId': cid, 'moduleId': 'M1', 'module': 'Current', 'type': kind_}
            for cid, kind_ in [('READ', 'reading'), ('LIVE', 'live_session'), ('NEW', 'reading')]],
            'quizAttempts': [{'quizId': 8, 'passed': True}],
            'retiredQuizComponents': [{'componentId': 'RETIRED', 'moduleId': 'M1',
                                      'isQuiz': True, 'quizMeta': {'quizId': 8}}]}
        native_progress = [{'component_ref': 'READ', 'kind': 'component', 'passed': None}]
        metrics = {'otjh': {'actual': .5, 'planned': 100}, 'programme': {'status': 'ready'}}
        before = deepcopy((records, lectures, detail, native_progress, metrics))
        token = journal_sources._current.set(student)
        observed = []

        def catalogue(*args, **kwargs):
            observed.append(journal_sources.enabled())
            return history

        try:
            with patch.object(home_progress, 'connections', {'enrolment': MagicMock()}), \
                 patch.object(home_progress, 'rows', return_value=[]), \
                 patch.object(home_progress, '_group_dates', return_value=(date(2026, 9, 1), None, 'learner')), \
                 patch.object(home_progress, 'lecture_register', return_value=lectures) as register, \
                 patch.object(canonical, 'require_profile', return_value=owner), \
                 patch.object(canonical, 'source_subjects', side_effect=catalogue) as subjects, \
                 patch.object(canonical, 'entries_for', side_effect=AssertionError('Duplicate ledger read')), \
                 patch('learner_api.student_activity_access.student_activity_available', return_value=True), \
                 patch.object(module_progress, 'read_native_progress', return_value=(
                     detail, [{'id': 'M1', 'title': 'Current'}], native_progress, {})) as native, \
                 patch('learner_api.live_session_progress.read_live_credits', return_value=credits) as live:
                result = home_progress.read_home_progress(source, kind, [], [], [], [('M1', 'Current')],
                    date(2026, 10, 18), attendance_module_ids=['M1'], canonical_metrics=metrics,
                    canonical_records=records)
            self.assertEqual(journal_sources.enabled(), student)
        finally:
            journal_sources._current.reset(token)
        self.assertEqual(observed, [True])
        self.assertEqual(subjects.call_args.args[0], enrolment)
        self.assertIs(subjects.call_args.kwargs['owner'], owner)
        self.assertIs(subjects.call_args.kwargs['records'], records if student else None)
        self.assertFalse(subjects.call_args.kwargs['include_totals'])
        self.assertFalse(subjects.call_args.kwargs['include_ledger'])
        register.assert_called_once_with(source, module_ids=['M1'], learner_profile_id=owner['id'],
                                         credit_projection=True)
        self.assertEqual(native.call_args.args[1].enrolment_id, enrolment)
        self.assertTrue(native.call_args.kwargs['compact_content'])
        self.assertEqual(live.call_count, 1)
        self.assertTrue(all(call.kwargs['register'] is lectures for call in live.call_args_list))
        self.assertEqual((records, lectures, detail, native_progress, metrics), before)
        return result

    def test_both_learner_kinds_keep_catalogue_retained_quiz_and_live_counts(self):
        for kind, enrolment in [('commercial', 20), ('apprenticeship', 21)]:
            with self.subTest(kind=kind):
                result = self.read(kind, enrolment)
                self.assertEqual(result['activities'], {'completed': 4, 'total': 6})
                self.assertEqual(result['modules'], {'completed': 0, 'total': 2})
                self.assertEqual(result['otjh']['actual'], .5)

    def test_coach_perspective_never_reuses_coach_records_for_student_catalogue(self):
        result = self.read('commercial', 22, student=False)
        self.assertEqual(result['activities'], {'completed': 4, 'total': 6})

    def test_closed_month_hours_stay_frozen_while_completion_counts_stay_visible(self):
        result = self.read('commercial', 23, frozen=True)
        self.assertEqual(result['otjh']['actual'], .5)
        self.assertEqual(result['activities']['completed'], 4)

    def test_empty_preloaded_attendance_does_not_reload_the_register(self):
        source = SimpleNamespace(pk=20)
        profile = SimpleNamespace(pk=10, enrolment_id=20)
        projection = lambda: (None, {'components': [], 'quizAttempts': []}, [], [], {})
        with patch.object(canonical, 'require_profile', return_value={'id': 10}), \
             patch('learner_api.live_session_progress.read_live_credits', return_value=[]) as live:
            result = module_progress.canonical_module_progress(source, profile,
                read_projection=projection, attendance_register=[])
        self.assertEqual(result, [])
        live.assert_called_once_with(source, components=[], register=[])

    def test_new_group_module_does_not_mistake_unread_attendance_for_absence(self):
        source = SimpleNamespace(pk=20)
        profile = SimpleNamespace(pk=10, enrolment_id=20)
        components = [{'componentId': 'INHERITED-LIVE', 'moduleId': 'M2', 'type': 'live_session'}]
        projection = lambda: (None, {'components': components, 'quizAttempts': []}, [], [], {})
        credits = [{'componentId': 'INHERITED-LIVE', 'moduleId': 'M2', 'hours': 2.5,
                    'submittedAt': '2026-10-05T11:00:00+00:00'}]
        with patch.object(canonical, 'require_profile', return_value={'id': 10}), \
             patch('learner_api.live_session_progress.read_live_credits', return_value=credits) as live:
            result = module_progress.canonical_module_progress(source, profile,
                read_projection=projection, attendance_register=[], attendance_module_ids=['M1'])
        live.assert_called_once_with(source, components=components)
        self.assertEqual((result[0]['completed'], result[0]['total']), (1, 1))


class NativeHomeProjectionTests(SimpleTestCase):
    def read(self, compact_content):
        components = [
            ('READ', 'W1', 'M1', 'reading', 'Read', '', {}, None, 0, [], False, None, False),
            ('REMOVED', 'W1', 'M1', 'video', 'Removed video', '', {}, None, 1, [], False, None, False),
            ('VIDEO', 'W2', 'M2', 'video', 'Video', '', {'videoUrl': 'https://example.test/video'},
             None, 0, [], False, None, False),
            ('LIVE', 'W2', 'M2', 'live_session', 'Live', '',
             {'teamsLiveSessionId': 'SERIES', 'teamsSessionNumber': 1, 'sessionDate': '2026-10-05'},
             None, 1, [], False, None, False),
        ]
        cursor = MagicMock()
        selected = []

        def execute(sql, params):
            if 'SELECT id, week_id, module_catalogue_id, type, title,' in sql:
                selected[:] = [row for row in components if row[2] in params[0]]
            elif 'SELECT DISTINCT target.module_id' in sql:
                selected[:] = []
            elif 'FROM curriculum.ksb_mappings' in sql or 'curriculum.quiz_component_links' in sql:
                selected[:] = []
            else:
                raise AssertionError('Unexpected native read: ' + sql[:90])

        cursor.execute.side_effect = execute
        cursor.fetchall.side_effect = lambda: list(selected)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        metadata = {'module_titles': {'M1': 'One', 'M2': 'Two'},
                    'weeks': [('W1', 'M1', 'Week 1', 1, 0), ('W2', 'M2', 'Week 1', 1, 0)]}
        with patch.object(learner_detail, 'connections', {'enrolment': connection}), \
             patch.object(learner_detail.content_cache, 'module_rows', return_value=None), \
             patch('learner_api.shared_live_delivery.read_shared_live_delivery', return_value={}):
            result = learner_detail._resolve_from_master([], [], [],
                assigned_modules=[{'moduleId': 'M1'}, {'moduleId': 'M2'}], compact=True, strict=True,
                resolved_metadata=metadata, compact_content=compact_content)
        reads = [call.args for call in cursor.execute.call_args_list
                 if 'SELECT id, week_id, module_catalogue_id, type, title,' in call.args[0]]
        return result, reads

    def test_home_batches_modules_without_changing_activity_or_live_identity(self):
        detailed, original_reads = self.read(False)
        compact, home_reads = self.read(True)
        self.assertEqual(compact, detailed)
        self.assertEqual([row['componentId'] for row in compact[2]], ['READ', 'VIDEO', 'LIVE'])
        self.assertEqual(len(original_reads), 2)
        self.assertEqual(len(home_reads), 1)
        self.assertEqual(home_reads[0][1], [['M1', 'M2']])
        # Parsing all lesson HTML is not necessary to count the assigned cards.
        self.assertNotIn('regexp_replace', home_reads[0][0].split(' ELSE ', 1)[0])
        self.assertIn('regexp_replace', original_reads[0][0])
