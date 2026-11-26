"""Narrow Header reads must retain the canonical assignment scheduling rule."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from . import overview_week as week
from .builder_activity_dates import read_builder_activity_dates


class HeaderDeadlineTests(SimpleTestCase):
    def test_preloaded_assignments_keep_full_week_spine_without_component_read(self):
        assignment = ('A1', 'M1', 'W2', 'Assignment', 'assignment', {'dueTiming': 'end of week'})
        def read(components):
            cursor = MagicMock()
            cursor.fetchall.side_effect = [
                [('M1', '2026-10-05', 3, 'Monday', '10:00', '11:00', 'C1')],
                [('W0', 'M1', 'Week 1'), ('W1', 'M1', 'Week 2'), ('W2', 'M1', 'Week 3')],
                [assignment, ('V1', 'M1', 'W1', 'Video', 'video', {}),
                 ('L1', 'M1', 'W2', 'Session', 'live_session', {'teamsSessionNumber': 3})],
            ]
            with patch('curriculum_api.views.cohort_selected_holidays_by_cohort', return_value={'C1': []}):
                result = read_builder_activity_dates(cursor, ['M1'], components=components)
            return result, cursor
        legacy, _ = read(None)
        narrowed, cursor = read([assignment])
        self.assertEqual(narrowed['A1'], legacy['A1'])
        self.assertEqual(narrowed['A1']['week_end'], '2026-10-25')
        self.assertEqual(cursor.execute.call_count, 2)

    def test_header_supplies_only_assignment_scheduling_rows_and_keeps_completion(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        candidate = {'id': 'A1', 'module_id': 'M1', 'week_id': 'W1', 'title': 'Assignment',
            'type': 'assignment', 'section_title': 'Week 1', 'due_timing': ' END OF WEEK\t',
            'schedule_settings': {'dueTiming': ' END OF WEEK\t'}, 'quiz_id': None, 'progress': []}
        dates = {'A1': {'date': '2026-10-19', 'week_end': '2026-10-25', 'date_needs_review': False}}
        with patch.object(week, 'connections', {'enrolment': connection}), \
             patch.object(week, 'rows', return_value=[candidate]), \
             patch.object(week, 'read_builder_activity_dates', return_value=dates) as planner:
            result = week.upcoming_assignment_deadlines(SimpleNamespace(pk=7), SimpleNamespace(id=17),
                                                       date(2026, 10, 17), header_only=True)
        self.assertEqual(result[0]['date'], '2026-10-25')
        self.assertEqual(cursor.execute.call_args.args, (week.HEADER_ASSIGNMENTS_SQL, [17, 7]))
        self.assertEqual(planner.call_args.kwargs['components'],
                         [('A1', 'M1', 'W1', 'Assignment', 'assignment', candidate['schedule_settings'])])

    def test_no_deadline_rule_skips_builder_reads(self):
        with patch.object(week, 'connections', {'enrolment': MagicMock()}), \
             patch.object(week, 'rows', return_value=[]), patch.object(week, 'read_builder_activity_dates') as planner:
            self.assertEqual(week.upcoming_assignment_deadlines(SimpleNamespace(pk=7), None,
                             date(2026, 10, 17), header_only=True), [])
        planner.assert_not_called()
