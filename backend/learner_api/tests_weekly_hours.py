"""Weekly actual-hours regressions; synthetic records and no database calls."""
from django.test import SimpleTestCase
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from .training_plan_dashboard import _canonical_module_progress, read_dashboard
from .weekly_hours import module_activity_hours, selected_activity_hours


class WeeklyHoursTests(SimpleTestCase):
    modules = [{'id': 'M1', 'title': 'Marketing'}, {'id': 'M2', 'title': 'Strategy'}]

    def test_dashboard_publishes_activity_hours_from_the_same_owner_read_as_overview(self):
        owner = {'id': 101}
        source = SimpleNamespace(pk=201, email='learner@example.test', _canonical_profile=owner,
                                 _case_file_profile=SimpleNamespace(lifecycle_status='active'))
        records = [{'module_ref': 'M1', 'component_ref': 'A', 'accepted': True, 'actual_seconds': 3600}]
        with patch('learner_api.training_plan_dashboard.connections', {'enrolment': MagicMock()}), \
             patch('learner_api.training_plan_dashboard.canonical_learning.targets_for', return_value={}), \
             patch('learner_api.training_plan_dashboard.canonical_learning.entries_for', return_value=records) as entries, \
             patch('learner_api.training_plan_dashboard._canonical_actual_rows', return_value=[]), \
             patch('learner_api.training_plan_dashboard.plan_module_ids', return_value=(['M1'], {})), \
             patch('learner_api.training_plan_dashboard.rows', side_effect=[[self.modules[0]], [], []]), \
             patch('learner_api.training_plan_dashboard.plan_module', side_effect=lambda row: row), \
             patch('learner_api.training_plan_dashboard.attach_curriculum_slots'), \
             patch('learner_api.training_plan_dashboard.current_coach', return_value={'coach_name': 'Coach', 'coach_email': ''}), \
             patch('learner_api.training_plan_dashboard.coach_phone', return_value=None), \
             patch('learner_api.calendar.coaching_events_for_learner', return_value=[]):
            result = read_dashboard(source, section='overview')
        entries.assert_called_once_with(owner)
        self.assertEqual(result['moduleActivityHours']['M1']['components'], {'A': 1})
        self.assertEqual(result['moduleProgress']['M1']['hours']['actual'], 1)

    def test_uses_same_accepted_seconds_as_overview_independently_of_completion(self):
        records = [
            {'module_ref': 'M1', 'component_ref': 'A', 'accepted': True, 'actual_seconds': 3600,
             'expected_otjh': 2, 'completed': True, 'segments': [{'actual_seconds': 99999}]},
            {'module_ref': 'M1', 'component_ref': 'A', 'accepted': False, 'actual_seconds': 7200, 'completed': True},
            {'module_ref': 'M1', 'component_ref': 'B', 'accepted': True, 'actual_seconds': 1800},
            {'module_ref': 'M2', 'component_ref': 'A', 'accepted': True, 'actual_seconds': 14400},
        ]
        actual = module_activity_hours(records, self.modules)
        week_one = selected_activity_hours(actual['M1'], [{'id': 'A'}])
        week_two = selected_activity_hours(actual['M1'], [{'id': 'B'}])
        self.assertEqual(week_one, 1)
        self.assertEqual(week_two, 0.5)
        self.assertEqual(week_one + week_two, _canonical_module_progress(records, self.modules)['M1']['hours']['actual'])
        self.assertEqual(actual['M2']['components']['A'], 4)

    def test_multiple_accepted_rows_sum_once_without_recounting_reporting_segments(self):
        records = [{'module_ref': 'M1', 'component_ref': 'A', 'accepted': True, 'actual_seconds': seconds}
                   for seconds in (1800, 900, None)]
        actual = module_activity_hours(records, self.modules)
        self.assertEqual(selected_activity_hours(actual['M1'], [{'id': 'A'}, {'id': 'A'}]), 0.75)
        self.assertEqual(selected_activity_hours(actual['M1'], [{'id': 'missing'}]), 0)

    def test_quiz_only_rows_and_component_linked_attempts_are_distinct(self):
        records = [
            {'module_ref': 'M1', 'component_ref': 'A', 'quiz_ref': 42, 'accepted': True, 'actual_seconds': 900},
            {'module_ref': 'M1', 'quiz_ref': '42', 'accepted': True, 'actual_seconds': 1800},
            {'module_ref': 'M1', 'quiz_ref': '99', 'accepted': True, 'actual_seconds': 7200},
            {'module_ref': 'M1', 'accepted': True, 'actual_seconds': 7200},
        ]
        actual = module_activity_hours(records, self.modules)
        self.assertEqual(selected_activity_hours(actual['M1'], [{'id': 'A', 'quiz_id': 42}]), 0.75)
        placements = [{'id': 'A', 'quiz_id': 42}, {'id': 'B', 'quiz_id': 42}]
        self.assertEqual(selected_activity_hours(actual['M1'], placements[:1], placements), 0.25)
        self.assertEqual(selected_activity_hours(actual['M1'], placements[1:], placements), 0)

    def test_legacy_module_title_fallback_matches_overview_and_rejects_ambiguity(self):
        records = [{'module_title': ' Marketing ', 'component_ref': 'A', 'accepted': True, 'actual_seconds': 3600}]
        actual = module_activity_hours(records, self.modules)
        self.assertEqual(actual['M1']['components']['A'], 1)
        ambiguous = self.modules + [{'id': 'M3', 'title': 'Marketing'}]
        self.assertTrue(all(not item['components'] for item in module_activity_hours(records, ambiguous).values()))

    def test_separate_owner_reads_never_share_totals(self):
        first = module_activity_hours([{'module_ref': 'M1', 'component_ref': 'A', 'accepted': True, 'actual_seconds': 3600}], self.modules)
        second = module_activity_hours([], self.modules)
        self.assertEqual(first['M1']['components']['A'], 1)
        self.assertEqual(second['M1']['components'], {})
