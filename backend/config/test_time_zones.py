"""Pure time zone rules, with no settings, database, or network access."""
import unittest
from datetime import datetime, timezone

from config.time_zones import calendar_zone, local_clock_to_utc
from curriculum_api.teams_calendar_checks import calendar_targets, graph_calendar_time


class TimeZoneRulesTests(unittest.TestCase):
    def test_uk_and_egypt_change_on_different_dates(self):
        for day, london, cairo in [('2026-10-24', '08:00', '06:00'),
                                   ('2026-10-28', '09:00', '06:00'),
                                   ('2026-10-30', '09:00', '07:00')]:
            for zone, clock in [('Europe/London', london), ('Africa/Cairo', cairo)]:
                with self.subTest(day=day, zone=zone):
                    self.assertEqual(local_clock_to_utc(datetime.fromisoformat(day + 'T09:00'), zone),
                                     datetime.fromisoformat(day + 'T' + clock).replace(tzinfo=timezone.utc))

    def test_future_rules_and_microsoft_aliases(self):
        self.assertEqual(calendar_zone('Egypt Standard Time').key, 'Africa/Cairo')
        for value, expected in [('2027-03-26T09:00', '2027-03-26T09:00:00+00:00'),
                                ('2027-03-29T09:00', '2027-03-29T08:00:00+00:00')]:
            self.assertEqual(local_clock_to_utc(datetime.fromisoformat(value), 'GMT Standard Time').isoformat(), expected)

    def test_gap_and_repeated_clocks_are_not_guessed(self):
        for value, zone in [('2026-03-29T01:30', 'Europe/London'),
                            ('2026-10-25T01:30', 'Europe/London'),
                            ('2026-04-24T00:30', 'Africa/Cairo'),
                            ('2026-10-29T23:30', 'Africa/Cairo')]:
            with self.subTest(value=value, zone=zone), self.assertRaisesRegex(ValueError, 'clocks'):
                local_clock_to_utc(datetime.fromisoformat(value), zone)
        with self.assertRaisesRegex(ValueError, 'time zone'):
            local_clock_to_utc(datetime(2026, 10, 30, 9), 'Unknown/Zone')

    def test_explicit_instants_preserve_both_repeated_hours(self):
        for offset, expected in [('+01:00', '00:30'), ('+00:00', '01:30')]:
            value = datetime.fromisoformat('2026-10-25T01:30' + offset)
            instant = local_clock_to_utc(value, 'Europe/London')
            self.assertEqual(instant.strftime('%H:%M'), expected)
            self.assertEqual(graph_calendar_time(instant, 'Europe/London', 'GMT Standard Time')['timeZone'], 'UTC')

    def test_weekly_sessions_keep_local_clock_and_elapsed_duration(self):
        for zone, start in [('Europe/London', '2026-10-23T08:00Z'), ('Africa/Cairo', '2026-10-23T06:00Z')]:
            targets = calendar_targets({}, start, 120, 'weekly', 3, zone)
            self.assertEqual([item['start'].astimezone(calendar_zone(zone)).hour for item in targets], [9, 9, 9])
            self.assertTrue(all((item['end'] - item['start']).total_seconds() == 7200 for item in targets))

    def test_generated_recurrence_does_not_silently_shift_a_gap(self):
        with self.assertRaisesRegex(ValueError, 'clocks'):
            calendar_targets({}, '2026-03-22T01:30Z', 60, 'weekly', 2, 'Europe/London')
