"""Safety checks for importing a saved Teams recurrence; no DB or Graph calls."""

import hashlib
import unittest
from datetime import date, datetime, timedelta

from django.core.management.base import CommandError

from curriculum_api.management.commands.link_existing_teams_series import (
    _conflicting_manual_overrides,
    _matching_instance_dates,
    _select_recurring_event,
)


class ExistingTeamsSeriesSelectionTests(unittest.TestCase):
    def test_only_different_manual_links_require_an_explicit_replacement(self):
        rows = [('one', ''), ('two', 'https://teams.example/current'),
                ('three', 'https://teams.example/old')]
        self.assertEqual(
            _conflicting_manual_overrides(rows, 'https://teams.example/current'),
            [('three', 'https://teams.example/old')],
        )

    def test_identical_subjects_require_a_specific_join_url_hash(self):
        first = ('calendar-a', {'onlineMeeting': {'joinUrl': 'https://teams.example/one'}})
        second = ('calendar-b', {'onlineMeeting': {'joinUrl': 'https://teams.example/two'}})
        with self.assertRaises(CommandError):
            _select_recurring_event([first, second])
        digest = hashlib.sha256(b'https://teams.example/one').hexdigest()
        self.assertEqual(_select_recurring_event([first, second], digest), first)

    def test_attendee_copies_of_one_join_are_not_ambiguous(self):
        copies = [
            ('calendar-a', {'onlineMeeting': {'joinUrl': 'https://teams.example/one'}}),
            ('calendar-b', {'onlineMeeting': {'joinUrl': 'https://teams.example/one'}}),
        ]
        self.assertEqual(_select_recurring_event(copies), copies[0])

    def test_unknown_or_incomplete_hash_is_refused(self):
        event = ('calendar-a', {'onlineMeeting': {'joinUrl': 'https://teams.example/one'}})
        for digest in ('abc', '0' * 64):
            with self.subTest(digest=digest), self.assertRaises(CommandError):
                _select_recurring_event([event], digest)


class ExistingTeamsSeriesPlanTests(unittest.TestCase):
    def test_module_end_can_follow_its_last_scheduled_lecture(self):
        first = date(2026, 9, 4)
        dates = [first + timedelta(weeks=index) for index in range(16)]
        module = {'start_date': first, 'end_date': date(2026, 12, 24), 'sessions_number': 16}
        plan = [{'date': value.isoformat()} for value in dates]
        instances = [{'start': datetime.combine(value, datetime.min.time())} for value in dates]
        _matching_instance_dates(instances, module, plan)

    def test_actual_plan_dates_control_a_shifted_lecture(self):
        module = {'start_date': date(2026, 9, 4), 'end_date': date(2026, 9, 25), 'sessions_number': 3}
        dates = [date(2026, 9, 4), date(2026, 9, 11), date(2026, 9, 25)]
        plan = [{'date': value.isoformat()} for value in dates]
        instances = [{'start': datetime.combine(value, datetime.min.time())} for value in dates]
        _matching_instance_dates(instances, module, plan)
        instances[-1]['start'] = datetime(2026, 9, 18)
        with self.assertRaises(CommandError):
            _matching_instance_dates(instances, module, plan)

    def test_incomplete_or_out_of_range_plan_is_refused(self):
        module = {'start_date': date(2026, 9, 4), 'end_date': date(2026, 9, 11), 'sessions_number': 2}
        instances = [{'start': datetime(2026, 9, 4)}, {'start': datetime(2026, 9, 18)}]
        with self.assertRaises(CommandError):
            _matching_instance_dates(instances, module, [{'date': '2026-09-04'}])
        with self.assertRaises(CommandError):
            _matching_instance_dates(instances, module, [{'date': '2026-09-04'}, {'date': '2026-09-18'}])


if __name__ == '__main__':
    unittest.main()
