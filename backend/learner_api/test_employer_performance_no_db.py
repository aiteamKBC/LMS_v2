from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, RequestFactory
from . import employer_learning, employer_performance


class EmployerPerformanceTests(SimpleTestCase):
    def module(self, key, title, activities):
        return {'id': key, 'title': title, '_subject': {'activities': activities}}

    def activity(self, ref, **extra):
        return {'id': ref, 'category': 'assignment', 'completed': False, **extra}

    def read(self, modules, submitted=(), components=()):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [(ref,) for ref in submitted]
        with patch.object(employer_performance, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}):
            result = employer_performance.module_assignments(SimpleNamespace(pk=17), 'commercial', modules,
                                                                components=components)
        return result, cursor

    def test_counts_submissions_without_requiring_accepted_completion(self):
        result, cursor = self.read([self.module('current:A', 'Module A', [
            self.activity('A'), self.activity('B'), self.activity('reading', category='reading')])], ['B'])
        self.assertEqual(result, {'current:A': {'submitted': 1, 'total': 2}})
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['commercial', '17', ['A', 'B']])
        self.assertIn("status <> 'draft'", sql)
        self.assertIn('assignmentAttemptHistory', sql)

    def test_reconciles_native_refs_and_deduplicates_historical_assignments(self):
        first = self.activity('old', nativeRefs=['A', 'B'], dedupe='shared')
        result, _ = self.read([
            self.module('legacy:1', 'A', [first, self.activity('done', completed=True)]),
            self.module('legacy:2', 'B', [first, self.activity('pending')]),
        ], ['B'])
        self.assertEqual(result, {'legacy:1': {'submitted': 2, 'total': 2}, 'legacy:2': {'submitted': 0, 'total': 1}})

    def test_does_not_read_submissions_when_no_assignments_are_assigned(self):
        result, cursor = self.read([self.module('current:A', 'A', [self.activity('read', category='reading')])])
        self.assertEqual(result['current:A'], {'submitted': 0, 'total': 0})
        cursor.execute.assert_not_called()

    def test_imported_catalogue_does_not_hide_authored_assignment_submissions(self):
        module = {**self.module('legacy:1', 'Imported module', [self.activity('read', category='reading')]),
                  'moduleId': 'M1'}
        components = [
            {'moduleId': 'M1', 'componentId': 'A', 'type': 'assignment'},
            {'moduleId': 'M1', 'componentId': 'B', 'type': 'assignment'},
            {'moduleId': 'M1', 'componentId': 'read', 'type': 'reading'},
            {'moduleId': 'other', 'componentId': 'outside', 'type': 'assignment'},
        ]
        result, cursor = self.read([module], ['A'], components)
        self.assertEqual(result[module['id']], {'submitted': 1, 'total': 2})
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['commercial', '17', ['A', 'B']])
        self.assertIn('learning_reflection_submissions', sql)
        self.assertIn("activity_type='assignment'", sql)

    def test_native_assignment_counts_use_saved_submissions_instead_of_imported_completion(self):
        module = {**self.module('legacy:1', 'Imported module', [self.activity('old', completed=True)]),
                  'moduleId': 'M1'}
        result, _ = self.read([module], components=[
            {'moduleId': 'M1', 'componentId': 'A', 'type': 'assignment'}])
        self.assertEqual(result[module['id']], {'submitted': 0, 'total': 1})

    def test_native_assignment_ids_are_not_counted_twice_across_duplicate_module_rows(self):
        modules = [{**self.module(key, title, []), 'moduleId': 'M1'}
                   for key, title in [('legacy:1', 'A'), ('current:M1', 'B')]]
        result, _ = self.read(modules, ['A'], components=[
            {'moduleId': 'M1', 'componentId': 'A', 'type': 'assignment'},
            {'moduleId': 'M1', 'componentId': 'A', 'type': 'assignment'}])
        self.assertEqual(result['legacy:1'], {'submitted': 1, 'total': 1})
        self.assertEqual(result['current:M1'], {'submitted': 0, 'total': 0})

    def test_same_title_does_not_link_another_modules_assignments(self):
        module = {**self.module('legacy:1', 'Shared title', []), 'moduleId': 'M1'}
        result, cursor = self.read([module], components=[
            {'moduleId': 'M2', 'module': 'Shared title', 'componentId': 'A', 'type': 'assignment'}])
        self.assertEqual(result[module['id']], {'submitted': 0, 'total': 0})
        cursor.execute.assert_not_called()

    def test_overview_chart_receives_submissions_when_imported_catalogue_hides_native_activities(self):
        from .test_employer_learning_no_db import EmployerLearningParityTests
        from . import dashboard_tabs, dashboard_overview
        with EmployerLearningParityTests().fixture(planned=100) as (source, *_), \
                patch.object(dashboard_overview, 'saved_attendance_hours', return_value=[]), \
                patch.object(employer_performance, 'module_ksbs', return_value={'legacy:8': None, 'current:M2': None}):
            facts = dashboard_tabs.learning_projection.side_effect

            def imported(*args, **kwargs):
                learning = facts(*args, **kwargs)
                learning['detail']['components'][0]['type'] = 'assignment'
                learning['activity'] = {
                    'progress_basis': 'catalogue_activities',
                    'subjects': [{'id': 8, 'name': 'Imported module', 'module_id': 'M1'}],
                    'activities': [{'group_id': 8, 'activity_id': 'old-reading', 'category': 'reading',
                                    'activity': 'Reading', 'completed': False}],
                    'activity_sources': {},
                }
                return learning

            dashboard_tabs.learning_projection.side_effect = imported
            cursor = MagicMock()
            cursor.__enter__.return_value = cursor
            cursor.fetchall.return_value = [('C1',)]
            request = RequestFactory().get('/employer/', {'performance': '1'})
            with patch.object(employer_performance, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}):
                result = employer_learning.read_dashboard(source, 'commercial', 'overview', request)
        module = next(row for row in result['modules'] if row['id'] == 'legacy:8')
        self.assertEqual(module['assignments'], {'submitted': 1, 'total': 1})

    def test_only_opted_in_employer_overview_requests_get_assignment_counts(self):
        source = SimpleNamespace(pk=17)
        for query, tab, expected in [({}, 'overview', {}), ({'performance': '1'}, 'training', {}),
                                      ({'performance': '1'}, 'overview', {'employer_performance': True})]:
            request = RequestFactory().get('/employer/', query)
            with patch.object(employer_learning.dashboard_tabs, 'read_tab', return_value={}) as read:
                employer_learning.read_dashboard(source, 'commercial', tab, request)
            self.assertEqual(read.call_args.kwargs, expected)

    def test_opted_in_projection_attaches_counts_and_keeps_existing_learning_facts(self):
        from .test_employer_learning_no_db import EmployerLearningParityTests
        from . import dashboard_tabs, dashboard_overview
        from copy import deepcopy
        with EmployerLearningParityTests().fixture(planned=100) as (source, *_), \
                patch.object(dashboard_overview, 'saved_attendance_hours', return_value=[]), \
                patch.object(employer_performance, 'module_ksbs', return_value={
                    'current:M1': {'completed': 0, 'total': 0}, 'current:M2': {'completed': 0, 'total': 0}}):
            facts = dashboard_tabs.learning_projection.side_effect

            def assignments(*args, **kwargs):
                learning = facts(*args, **kwargs)
                learning['detail']['components'][0]['type'] = 'assignment'
                return learning

            dashboard_tabs.learning_projection.side_effect = assignments
            cursor = MagicMock()
            cursor.__enter__.return_value = cursor
            cursor.fetchall.return_value = [('C1',)]
            request = RequestFactory().get('/employer/', {'performance': '1'})
            with patch.object(employer_performance, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}):
                result = employer_learning.read_dashboard(deepcopy(source), 'commercial', 'overview', request)
            baseline = employer_learning.read_dashboard(deepcopy(source), 'commercial', 'overview', RequestFactory().get('/employer/'))
        self.assertEqual(result['modules'][0]['assignments'], {'submitted': 1, 'total': 1})
        self.assertEqual(result['modules'][1]['assignments'], {'submitted': 0, 'total': 0})
        for module in result['modules']:
            module.pop('assignments')
        self.assertEqual(result, baseline)
