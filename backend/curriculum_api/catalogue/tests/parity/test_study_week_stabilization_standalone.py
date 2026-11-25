"""Scheduling read contracts over synthetic values; no Django or database."""
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.meetings.application.invitation_preparation import teams_module_session_limit
from curriculum_api.session_overrides import session_overrides
from curriculum_api.weekly_schedule import module_week_boundary_mode
from learner_api.builder_activity_dates import _merge_study_schedule


class StudyWeekReadContracts(unittest.TestCase):
    def limit(self, row, weeks):
        read = Mock(return_value=weeks)
        result = teams_module_session_limit(
            'SYNTHETIC', authoring_module_exists=lambda _: row,
            module_week_boundary_mode=module_week_boundary_mode,
            module_stored_week_count=module_stored_week_count, authored_week_count=read,
        )
        return result, read

    def test_live_weeks_own_calendar_limit_despite_stale_scalars_and_holiday_gaps(self):
        for stale in (0, 1, 104, None):
            for sessions in (0, 10, 99):
                with self.subTest(stale=stale, sessions=sessions):
                    result, read = self.limit({'week_boundary_mode': 'calendar',
                                              'weeks_number': stale, 'sessions_number': sessions}, 16)
                    self.assertEqual(result, 112)
                    read.assert_called_once_with('SYNTHETIC')

    def test_calendar_limits_remain_bounded(self):
        for weeks, expected in ((1, 52), (104, 728), (500, 728)):
            with self.subTest(weeks=weeks):
                self.assertEqual(self.limit({'week_boundary_mode': 'calendar'}, weeks)[0], expected)

    def test_missing_and_legacy_modules_do_not_read_weeks_or_raise_limit(self):
        for row in (None, {'weeks_number': 104, 'sessions_number': 500}, {'week_boundary_mode': None}):
            with self.subTest(row=row):
                result, read = self.limit(row, 104)
                self.assertEqual(result, 52)
                read.assert_not_called()

    def test_stored_session_compatibility_remains_when_no_authored_weeks_exist(self):
        result, _ = self.limit({'week_boundary_mode': 'calendar', 'sessions_number': 32,
                               'session_week_day': 'Monday, Thursday'}, 0)
        self.assertEqual(result, 112)

    def test_builder_decodes_sql_null_for_both_metadata_shapes(self):
        for schedule in ({'week_boundary_mode': 'calendar'}, '{"week_boundary_mode":"calendar"}'):
            for raw in (None, 'null', ' null ', '{}', {}):
                with self.subTest(schedule=schedule, raw=raw):
                    module = {'study_schedule': schedule, 'session_overrides': raw}
                    _merge_study_schedule(module)
                    self.assertEqual(session_overrides(module), {})
                    self.assertEqual(module['week_boundary_mode'], 'calendar')

    def test_builder_keeps_saved_exceptions(self):
        module = {'session_overrides': '{"2":{"date":"2027-03-02"}}'}
        _merge_study_schedule(module)
        self.assertEqual(session_overrides(module), {'2': {'date': '2027-03-02'}})

    def test_builder_does_not_hide_invalid_non_null_exceptions(self):
        for raw in ('[1]', '{broken'):
            with self.subTest(raw=raw):
                module = {'session_overrides': raw}
                _merge_study_schedule(module)
                with self.assertRaises(ValueError):
                    session_overrides(module)


if __name__ == '__main__':
    unittest.main(verbosity=2)
