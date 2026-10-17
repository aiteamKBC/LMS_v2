"""Unified card hours with synthetic records and mocked database boundaries."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from .replacement_hours import project_replacement_hours, read_replacement_hours


class ReplacementHoursTests(SimpleTestCase):
    def setUp(self):
        self.modules = [{'id': 'M', 'title': 'Updated course'}, {'id': 'OTHER', 'title': 'Other course'}]
        self.courses = {'current:M': 'legacy:50'}
        self.payload = {'subjects': [{'id': 50}], 'activities': [
            {'group_id': 50, 'record_ids': ['old', 'shared', 'pending']},
            {'group_id': 50, 'record_ids': ['old']},
            {'group_id': 60, 'record_ids': ['foreign']},
        ]}
        self.records = [
            {'id': 'old', 'module_ref': 'RETIRED', 'accepted': True, 'actual_seconds': 3600},
            {'id': 'shared', 'module_ref': 'M', 'accepted': True, 'actual_seconds': 1800},
            {'id': 'native', 'module_ref': 'M', 'accepted': True, 'actual_seconds': 900},
            {'id': 'pending', 'accepted': False, 'completed': True, 'actual_seconds': 7200},
            {'id': 'foreign', 'module_ref': 'OTHER', 'accepted': True, 'actual_seconds': 36000},
            {'id': 'no-time', 'module_ref': 'M', 'accepted': True, 'completed': True,
             'actual_seconds': None, 'expected_otjh': 10},
        ]

    def project(self):
        return project_replacement_hours(self.records, self.payload, self.modules, self.courses)

    def test_union_counts_each_canonical_record_once_without_rewriting_history(self):
        before = copy.deepcopy((self.records, self.payload, self.modules))
        self.assertEqual(self.project(), {'current:M': {'course_ref': 'legacy:50', 'accepted_hours': 1.75}})
        self.assertEqual((self.records, self.payload, self.modules), before)

    def test_only_owned_assigned_unambiguous_successors_receive_hours(self):
        for modules, courses, subjects in [
            ([], self.courses, [{'id': 50}]),
            (self.modules, self.courses, []),
            (self.modules, {}, [{'id': 50}]),
            (self.modules, {'current:M': 'legacy:50', 'current:OTHER': 'legacy:50'}, [{'id': 50}]),
        ]:
            with self.subTest(modules=modules, courses=courses, subjects=subjects):
                self.assertEqual(project_replacement_hours(self.records,
                    {**self.payload, 'subjects': subjects}, modules, courses), {})

    def test_current_title_only_quiz_time_uses_the_existing_unique_assignment_rule(self):
        self.records.append({'id': 'quiz', 'module_title': 'Updated course',
                             'accepted': True, 'actual_seconds': 60})
        self.assertEqual(self.project()['current:M']['accepted_hours'], 1.7667)
        self.modules.append({'id': 'INDEPENDENT', 'title': 'Updated course'})
        # Matching titles alone cannot allocate the unlinked time. Explicit
        # current IDs and verified old-course records remain unaffected.
        self.assertEqual(self.project()['current:M']['accepted_hours'], 1.75)

    def test_excluded_old_activity_time_is_not_reintroduced_by_title_or_completion(self):
        self.payload['activities'] = self.payload['activities'][2:]
        self.assertEqual(self.project()['current:M']['accepted_hours'], 0.75)

    def test_zero_accepted_time_stays_zero_without_planned_or_completion_fallback(self):
        self.records = [{'id': 'old', 'accepted': True, 'actual_seconds': 0, 'completed': True,
                         'expected_otjh': 100}]
        self.assertEqual(self.project()['current:M']['accepted_hours'], 0)

    def test_native_only_and_old_only_time_both_survive(self):
        self.records = self.records[:1]
        self.assertEqual(self.project()['current:M']['accepted_hours'], 1)
        self.records = [{'id': 'current', 'module_ref': 'M', 'accepted': True, 'actual_seconds': 123}]
        self.assertEqual(self.project()['current:M']['accepted_hours'], 0.0342)


class ReplacementHoursReadTests(SimpleTestCase):
    def test_no_verified_successor_avoids_dashboard_scope_read(self):
        with patch('django.db.connections') as connections, \
             patch('learner_api.student_activity._effective_current_subjects', return_value=[{'id': 'M'}]) as assigned, \
             patch('learner_api.subject_origins.read_replacement_courses', return_value={}) as courses, \
             patch('learner_api.training_plan_dashboard.plan_module_ids') as plan:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            self.assertEqual(read_replacement_hours(12, object(), {'id': 30}, [], {}), {})
            assigned.assert_called_once_with(cursor, 12)
            courses.assert_called_once_with(cursor, [{'id': 'M'}], 12)
            plan.assert_not_called()
            cursor.execute.assert_not_called()

    def test_reads_effective_owner_scope_and_full_dashboard_assignments(self):
        source, owner, records, payload = object(), {'id': 30}, [{'id': 'row'}], {'subjects': []}
        with patch('django.db.connections') as connections, \
             patch('learner_api.student_activity._effective_current_subjects', return_value=[{'id': 'M'}]), \
             patch('learner_api.subject_origins.read_replacement_courses', return_value={'current:M': 'legacy:50'}), \
             patch('learner_api.training_plan_dashboard.plan_module_ids', return_value=(['M', 'OTHER'], {})) as plan, \
             patch('learner_api.replacement_hours.project_replacement_hours', return_value={'hours': 'sentinel'}) as project:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('M', 'Course'), ('OTHER', 'Course')]
            self.assertEqual(read_replacement_hours(12, source, owner, records, payload), {'hours': 'sentinel'})
            plan.assert_called_once_with(cursor, source, owner)
            self.assertEqual(cursor.execute.call_args.args[1], [['M', 'OTHER']])
            project.assert_called_once_with(records, payload,
                [{'id': 'M', 'title': 'Course'}, {'id': 'OTHER', 'title': 'Course'}], {'current:M': 'legacy:50'})

    def test_endpoint_reuses_owned_ledger_snapshot_and_keeps_errors_visible(self):
        from .student_activity import student_activity
        view = student_activity
        while hasattr(view, '__wrapped__'):
            view = view.__wrapped__
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), \
                 patch('learner_api.student_activity.SOURCE_MODELS', {kind: MagicMock()}), \
                 patch('learner_api.case_file_sources.source_for_case_file', return_value=SimpleNamespace(id=12)), \
                 patch('learner_api.canonical_learning.profile', return_value={'id': 30}) as owner, \
                 patch('learner_api.canonical_learning.entries_for', return_value=[{'id': 'record'}]) as records, \
                 patch('learner_api.canonical_learning.source_subjects', side_effect=lambda *a, **kw: {'aptem_id': None, 'subjects': []}) as catalogue, \
                 patch('learner_api.replacement_hours.read_replacement_hours', return_value={'current:M': {'course_ref': 'legacy:50', 'accepted_hours': 2}}) as hours:
                request = RequestFactory().get('/?aptem_id=999&module_id=OTHER')
                response = view(request, kind, 12)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content)['replacement_hours']['current:M']['accepted_hours'], 2)
                self.assertEqual(response['Cache-Control'], 'private, no-store')
                owner.assert_called_once_with(12)
                records.assert_called_once_with({'id': 30})
                self.assertEqual(catalogue.call_args.kwargs, {'owner': {'id': 30}, 'records': [{'id': 'record'}]})
                self.assertEqual(hours.call_args.args[:1], (12,))
                self.assertEqual(hours.call_args.args[2:4], ({'id': 30}, [{'id': 'record'}]))
                hours.side_effect = DatabaseError('private connection details')
                failed = view(request, kind, 12)
                self.assertEqual(failed.status_code, 503)
                self.assertNotIn('private connection details', failed.content.decode())
