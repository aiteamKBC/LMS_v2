"""Explicit future study weeks: no settings, database or provider requests."""
import importlib
import sqlite3
import unittest
from contextlib import closing
from datetime import date, timedelta
from types import SimpleNamespace

from .study_weeks import build_study_week_plan, study_week_end_date
from .weekly_schedule import WEEKDAYS, merged_week_boundary_mode, module_week_boundary_mode


class StudyWeekTests(unittest.TestCase):
    def holiday(self, day):
        return {day: [{'id': 'HOL-SYNTHETIC', 'label': 'Campus holiday', 'startDate': day.isoformat(), 'endDate': day.isoformat()}]}

    def test_partial_opening_week_counts_even_when_no_session_is_left(self):
        plan = build_study_week_plan(date(2026, 11, 19), 3, {0}, {}, 'Monday')
        self.assertEqual([(w['startDate'], w['endDate']) for w in plan['weeks']], [
            ('2026-11-19', '2026-11-22'), ('2026-11-23', '2026-11-29'), ('2026-11-30', '2026-12-06')])
        self.assertEqual([s['weekNumber'] for s in plan['sessions']], [2, 3])
        self.assertEqual(study_week_end_date('2026-11-19', 3, 'Monday'), '2026-12-06')

    def test_wednesday_holiday_pauses_thursday_sessions_in_its_own_week(self):
        plan = build_study_week_plan(date(2026, 11, 16), 3, {0, 3, 6}, self.holiday(date(2026, 11, 18)), 'Monday')
        self.assertEqual([s['weekNumber'] for s in plan['sessions']], [2, 2, 2, 3, 3, 3])
        self.assertTrue(plan['weeks'][0]['holidayWeek'])
        self.assertTrue(all(s['sessionNumber'] is None for s in plan['slots'][:3]))
        self.assertEqual(plan['calendarEndDate'], '2026-12-06')

    def test_all_start_weekdays_and_one_to_seven_live_days_do_not_change_week_count(self):
        for first in WEEKDAYS:
            for count in range(1, 8):
                with self.subTest(first=first, sessions=count):
                    start = date(2026, 11, 16) + timedelta(days=WEEKDAYS.index(first))
                    holiday = start + timedelta(days=9)
                    plan = build_study_week_plan(start, 4, set(range(count)), self.holiday(holiday), first)
                    self.assertEqual(len(plan['weeks']), 4)
                    self.assertEqual(len(plan['sessions']), count * 3)
                    self.assertFalse(any(s['weekNumber'] == 2 for s in plan['sessions']))
                    self.assertEqual([s['sessionNumber'] for s in plan['sessions']], list(range(1, count * 3 + 1)))

    def test_no_holiday_rows_means_no_holiday_weeks_including_weekends(self):
        plan = build_study_week_plan(date(2026, 11, 16), 2, set(range(7)), {}, 'Monday')
        self.assertEqual(len(plan['sessions']), 14)
        self.assertFalse(any(w['holidayWeek'] for w in plan['weeks']))

    def test_every_teaching_day_combination_and_partial_week_matches_an_independent_calendar(self):
        # Walk civil days and start a new bucket at the chosen weekday. This
        # oracle does not use the planner's anchor/end-date calculations.
        cases = 0
        for offset in range(7):
            start = date(2027, 3, 1) + timedelta(days=offset)
            for boundary in range(7):
                for weeks in (1, 2, 16):
                    buckets, current = [[]], start
                    while True:
                        if current > start and current.weekday() == boundary:
                            if len(buckets) == weeks:
                                break
                            buckets.append([])
                        buckets[-1].append(current)
                        current += timedelta(days=1)
                    closed_day = buckets[-1][len(buckets[-1]) // 2]
                    for mask in range(1, 128):
                        days = {day for day in range(7) if mask & (1 << day)}
                        for closed in (False, True):
                            with self.subTest(start=start, boundary=boundary, weeks=weeks, mask=mask, closed=closed):
                                plan = build_study_week_plan(start, weeks, days, self.holiday(closed_day) if closed else {}, WEEKDAYS[boundary])
                                expected = [(number, day.isoformat()) for number, bucket in enumerate(buckets, 1)
                                            for day in bucket if day.weekday() in days and not (closed and number == weeks)]
                                self.assertEqual([(s['weekNumber'], s['date']) for s in plan['sessions']], expected)
                                self.assertEqual([(w['startDate'], w['endDate']) for w in plan['weeks']],
                                                 [(bucket[0].isoformat(), bucket[-1].isoformat()) for bucket in buckets])
                                self.assertEqual([s['sessionNumber'] for s in plan['sessions']], list(range(1, len(expected) + 1)))
                                self.assertEqual(plan['calendarEndDate'], buckets[-1][-1].isoformat())
                                cases += 1
        self.assertEqual(cases, 37338)

    def test_leap_year_year_end_and_the_full_104_week_window_keep_unique_dates(self):
        for start in (date(2027, 12, 30), date(2028, 2, 28), date(2027, 10, 25)):
            for boundary in WEEKDAYS:
                with self.subTest(start=start, boundary=boundary):
                    plan = build_study_week_plan(start, 104, set(range(7)), {}, boundary)
                    dates = [session['date'] for session in plan['sessions']]
                    self.assertEqual(len(plan['weeks']), 104)
                    self.assertEqual(len(dates), len(set(dates)))
                    self.assertEqual(dates[0], start.isoformat())
                    self.assertEqual(dates[-1], plan['calendarEndDate'])
                    self.assertLessEqual(len(dates), 728)

    def test_invalid_counts_and_an_end_before_the_final_week_are_rejected(self):
        for count in (0, -1, 105, 10**9):
            with self.subTest(count=count), self.assertRaisesRegex(ValueError, '1 and 104'):
                build_study_week_plan(date(2026, 11, 16), count, {0}, {}, 'Monday')
        with self.assertRaisesRegex(ValueError, 'final study week'):
            build_study_week_plan(date(2026, 11, 16), 3, {0}, {}, 'Monday', date(2026, 11, 22))

    def test_holiday_before_module_start_and_after_end_is_not_applied(self):
        holidays = {**self.holiday(date(2026, 11, 16)), **self.holiday(date(2026, 11, 23))}
        plan = build_study_week_plan(date(2026, 11, 19), 1, {3}, holidays, 'Monday')
        self.assertEqual([s['date'] for s in plan['sessions']], ['2026-11-19'])
        self.assertEqual(plan['skippedHolidays'], [])

    def test_legacy_first_session_boundaries_never_implicitly_opt_in(self):
        self.assertIsNone(module_week_boundary_mode({'week_starts_on': 'Thursday', 'schedule_mode': 'custom'}))
        self.assertIsNone(merged_week_boundary_mode({'title': 'Renamed'}, {'week_starts_on': 'Thursday'}))
        self.assertEqual(merged_week_boundary_mode({}, {'weekBoundaryMode': 'calendar'}), 'calendar')
        with self.assertRaisesRegex(ValueError, 'fixed when'):
            merged_week_boundary_mode({'weekBoundaryMode': 'calendar'}, {'id': 'MOD-OLD'})
        with self.assertRaisesRegex(ValueError, 'fixed when'):
            merged_week_boundary_mode({'weekBoundaryMode': None}, {'week_boundary_mode': 'calendar'})

    def test_migration_is_repeatable_and_leaves_old_data_null(self):
        migration = importlib.import_module(__package__ + '.migrations.0091_module_week_boundary_mode')
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute('create table modules (id text, week_starts_on text)')
            db.execute("insert into modules values ('MOD-OLD', 'Thursday')")
            editor = SimpleNamespace(connection=SimpleNamespace(vendor='sqlite', cursor=lambda: closing(db.cursor())))
            migration.add_week_boundary_mode(None, editor)
            migration.add_week_boundary_mode(None, editor)
            self.assertEqual(db.execute('select * from modules').fetchall(), [('MOD-OLD', 'Thursday', None)])
