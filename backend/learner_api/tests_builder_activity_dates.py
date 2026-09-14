"""Database-free checks for native My Learning month/week placement."""

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .builder_activity_dates import read_builder_activity_dates


class BuilderActivityDatesTests(SimpleTestCase):
    def read(self, weeks, components, *, start='2026-10-05', sessions=None,
             days='Monday', holidays=None):
        self.cursor = MagicMock()
        self.cursor.fetchall.side_effect = [
            [('MOD-1', start, sessions or len(weeks), days, '10:00', '11:00', 'COHORT-1')],
            [(week_id, 'MOD-1', title) for week_id, title in weeks],
            [(component_id, 'MOD-1', week_id, title, kind, settings)
             for component_id, week_id, title, kind, settings in components],
        ]
        with patch('curriculum_api.views.cohort_selected_holidays_by_cohort',
                   return_value={'COHORT-1': holidays or []}) as read_holidays, \
             patch('curriculum_api.views.ensure_module_authoring_tables') as ensure_tables:
            result = read_builder_activity_dates(self.cursor, ['MOD-1'])
        read_holidays.assert_called_once_with(['COHORT-1'])
        ensure_tables.assert_not_called()
        return result

    def test_all_345_components_follow_the_full_future_plan(self):
        weeks = [(f'W{i}', f'Week {i + 1}') for i in range(23)]
        kinds = ['reading', 'video', 'podcast', 'quiz', 'assignment']
        components = [(f'C{i}-{j}', week_id, f'Activity {j + 1}', kinds[j % 5], {})
                      for i, (week_id, _) in enumerate(weeks) for j in range(15)]
        dates = self.read(weeks, components)
        self.assertEqual(len(dates), 345)
        self.assertEqual(dates['C0-0']['date'], '2026-10-05')
        self.assertEqual(dates['C22-14']['date'], '2027-03-08')
        self.assertEqual({schedule['month'] for schedule in dates.values()},
                         {'2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'})
        self.assertTrue(all(not schedule['date_needs_review'] for schedule in dates.values()))
        for call in self.cursor.execute.call_args_list:
            self.assertNotIn('created_at', call.args[0])
            self.assertEqual(call.args[1], [['MOD-1']])

    def test_content_only_and_empty_weeks_consume_all_delivery_days(self):
        weeks = [(f'W{i}', f'Week {i + 1}') for i in range(10)]
        dates = self.read(weeks, [
            ('LIVE-1', 'W0', 'First session', 'live_session', {}),
            ('LIVE-2', 'W0', 'Second session', 'live_session', {}),
            ('READING', 'W1', 'Reading', 'reading', {}),
            ('QUIZ', 'W9', 'Final quiz', 'quiz', {}),
        ], days='Monday,Friday', sessions=20)
        self.assertEqual(dates['LIVE-1']['date'], '2026-10-05')
        self.assertEqual(dates['LIVE-2']['date'], '2026-10-09')
        self.assertEqual(dates['READING']['date'], '2026-10-12')
        self.assertEqual(dates['QUIZ']['date'], '2026-12-07')

    def test_authored_weeks_beyond_the_stored_session_count_keep_their_dates(self):
        weeks = [(f'W{i}', f'Week {i + 1}') for i in range(32)]
        dates = self.read(weeks, [
            (f'C{i}', week_id, 'Reading', 'reading', {}) for i, (week_id, _) in enumerate(weeks)
        ], sessions=16, days='Thursday')
        self.assertEqual(len(dates), 32)
        self.assertEqual(dates['C0']['date'], '2026-10-08')
        self.assertEqual(dates['C31']['date'], '2027-05-13')

    def test_selected_holidays_move_components_into_the_correct_month(self):
        dates = self.read([('W1', 'Week 1'), ('W2', 'Week 2')], [
            ('READING', 'W1', 'Reading', 'reading', {}),
            ('ASSIGNMENT', 'W2', 'Assignment', 'assignment', {}),
        ], start='2026-10-26', holidays=[{'startDate': '2026-10-26', 'endDate': '2026-10-30'}])
        self.assertEqual(dates['READING']['date'], '2026-11-02')
        self.assertEqual(dates['ASSIGNMENT']['date'], '2026-11-09')
        self.assertEqual(dates['ASSIGNMENT']['week_end'], '2026-11-15')

    def test_explicit_session_dates_win_over_titles_and_week_plan(self):
        dates = self.read([('W1', 'Lecture 05/10/26')], [
            ('LIVE', 'W1', 'Session 05/10/26', 'live_session', {'sessionDate': '2026-12-04'}),
            ('READING', 'W1', 'Reading', 'reading', {}),
        ])
        self.assertEqual(dates['LIVE']['date'], '2026-12-04')
        self.assertEqual(dates['LIVE']['date_source'], 'builder_session')
        self.assertEqual(dates['READING']['date'], '2026-10-05')
        self.assertEqual(dates['READING']['date_source'], 'builder_section_title')

    def test_utc_occurrence_uses_uk_calendar_day_at_month_boundary(self):
        for field in ('sessionDateTimeUtc', 'teamsStartDateTimeUtc'):
            with self.subTest(field=field):
                dates = self.read([('W1', 'Week 1')], [
                    ('LIVE', 'W1', 'Live session', 'live_session',
                     {field: '2026-09-30T23:30:00Z', 'sessionDate': '2026-09-30'}),
                ])
                self.assertEqual(dates['LIVE']['date'], '2026-10-01')
                self.assertEqual(dates['LIVE']['month'], '2026-10')

    def test_intro_dated_titles_and_ambiguous_titles_keep_their_placement(self):
        dates = self.read([('INTRO', 'Introduction'), ('W1', 'Week 1')], [
            ('WELCOME', 'INTRO', 'Welcome', 'reading', {}),
            ('DATED', 'W1', 'Workshop 04/12/26', 'live_session', {}),
            ('AMBIGUOUS', 'W1', 'Workshop 4 December', 'reading', {}),
        ])
        self.assertEqual(dates['WELCOME']['date_source'], 'introduction')
        self.assertIsNone(dates['WELCOME']['date'])
        self.assertEqual(dates['DATED']['date'], '2026-12-04')
        self.assertTrue(dates['AMBIGUOUS']['date_needs_review'])
        self.assertIsNone(dates['AMBIGUOUS']['date'])

    def test_no_schedule_stays_undated_and_deleted_weeks_do_not_reappear(self):
        dates = self.read([('W1', 'Week 1')], [
            ('READING', 'W1', 'Reading', 'reading', {}),
            ('REMOVED', 'DELETED-WEEK', 'Removed reading', 'reading', {}),
            ('MODULE-LIVE', None, 'Live session', 'live_session', {'sessionDate': '2026-12-04'}),
        ], start=None)
        self.assertEqual(dates['READING']['month'], 'undated')
        self.assertNotIn('REMOVED', dates)
        self.assertEqual(dates['MODULE-LIVE']['date'], '2026-12-04')

    def test_no_assigned_modules_does_not_read_curriculum(self):
        cursor = MagicMock()
        self.assertEqual(read_builder_activity_dates(cursor, []), {})
        cursor.execute.assert_not_called()
