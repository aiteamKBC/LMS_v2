from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import home_session_components as links
from . import training_plan_dashboard as plan


def session(occurrence='O2', module='M1', start=None):
    return dict(occurrence_id=occurrence, session_id='S1', module_id=module, module_title='Marketing',
        scheduled_start=start or datetime(2026, 10, 20, 9), start_datetime=datetime(2026, 10, 13, 9),
        scheduled_end=None, duration_minutes=60, repeat_pattern='weekly', join_url=None,
        series_join_url=None, status='scheduled', series_status='scheduled', attended=None)


def component(component_id, module='M1', **settings):
    return (component_id, module, 'W2', 'Live session', 'live_session', settings)


class HomeSessionComponentTests(SimpleTestCase):
    def resolve(self, components, sessions=None, dates=None):
        cursor = MagicMock()
        cursor.fetchall.return_value = components
        with patch.object(links, 'read_builder_activity_dates', return_value=dates or {}) as read_dates:
            result = links.upcoming_session_components(cursor, sessions or [session()])
        self.cursor, self.read_dates = cursor, read_dates
        return result

    def test_occurrence_identity_wins_after_a_session_is_rescheduled(self):
        result = self.resolve([
            component('OLD', teamsOccurrenceId='O1', sessionDate='2026-10-20'),
            component('RIGHT', teamsOccurrenceId='O2', sessionDate='2026-10-13'),
        ])
        self.assertEqual(result, {('M1', 'O2'): 'RIGHT'})
        self.read_dates.assert_not_called()

    def test_legacy_occurrence_identity_is_preserved(self):
        self.assertEqual(self.resolve([component('RIGHT', legacyOccurrenceId='O2')]),
                         {('M1', 'O2'): 'RIGHT'})

    def test_occurrence_stored_in_the_live_session_field_takes_priority_over_old_dates(self):
        self.assertEqual(self.resolve([
            component('RIGHT', teamsLiveSessionId='O2', sessionDate='2026-10-13'),
            component('WRONG', sessionDate='2026-10-20'),
        ]), {('M1', 'O2'): 'RIGHT'})

    def test_repeated_series_uses_the_matching_week_instead_of_the_first_component(self):
        result = self.resolve([
            component('W1', teamsLiveSessionId='S1'), component('W2', teamsLiveSessionId='S1'),
        ], dates={'W1': {'date': '2026-10-13'}, 'W2': {'date': '2026-10-20'}})
        self.assertEqual(result, {('M1', 'O2'): 'W2'})

    def test_exact_instant_distinguishes_two_sessions_on_the_same_day(self):
        result = self.resolve([
            component('LATER', sessionDateTimeUtc='2026-10-20T14:00:00Z'),
            component('RIGHT', sessionDateTimeUtc='2026-10-20T10:00:00+01:00'),
        ])
        self.assertEqual(result, {('M1', 'O2'): 'RIGHT'})
        self.read_dates.assert_not_called()

    def test_date_matching_uses_london_day_across_the_summer_clock_boundary(self):
        result = self.resolve([component('MONDAY')],
            sessions=[session(start=datetime(2026, 10, 18, 23, 30, tzinfo=timezone.utc))],
            dates={'MONDAY': {'date': '2026-10-19'}})
        self.assertEqual(result, {('M1', 'O2'): 'MONDAY'})

    def test_other_module_and_explicitly_foreign_meeting_links_cannot_match_by_date(self):
        result = self.resolve([
            component('OTHER-MODULE', module='M2', teamsOccurrenceId='O2'),
            component('OTHER-OCCURRENCE', teamsOccurrenceId='O1'),
            component('OTHER-SERIES', teamsLiveSessionId='S2'),
        ], dates={key: {'date': '2026-10-20'} for key in ('OTHER-MODULE', 'OTHER-OCCURRENCE', 'OTHER-SERIES')})
        self.assertEqual(result, {})
        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(params, [['M1']])
        self.assertIn(links.visible_child_sql('c'), sql)
        self.assertIn(links.visible_week_sql('w'), sql)

    def test_shared_occurrence_keeps_each_delivery_modules_own_component(self):
        result = self.resolve([
            component('A', teamsOccurrenceId='O2'), component('B', module='M2', teamsOccurrenceId='O2'),
        ], sessions=[session(), session(module='M2')])
        self.assertEqual(result, {('M1', 'O2'): 'A', ('M2', 'O2'): 'B'})
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_ambiguous_or_missing_dates_do_not_guess_a_component(self):
        for dates in ({}, {'A': {'date': '2026-10-20'}, 'B': {'date': '2026-10-20'}},
                      {'A': {'date': '2026-10-20', 'date_needs_review': True}}):
            with self.subTest(dates=dates):
                self.assertEqual(self.resolve([component('A'), component('B')], dates=dates), {})

    def test_duplicate_occurrence_links_do_not_fall_back_to_a_date_guess(self):
        self.assertEqual(self.resolve([
            component('A', teamsOccurrenceId='O2'), component('B', teamsOccurrenceId='O2'),
        ]), {})

    def test_empty_schedule_does_not_query_components(self):
        cursor = MagicMock()
        self.assertEqual(links.upcoming_session_components(cursor, []), {})
        cursor.execute.assert_not_called()

    def test_compact_upcoming_response_carries_the_matched_component_identity(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [component('LIVE-W2', teamsOccurrenceId='O2')]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        source = SimpleNamespace(pk=71, email='learner@example.test', _canonical_profile={'id': 9},
                                 _case_file_profile=SimpleNamespace(id=9))
        with patch.object(plan, 'connections', {'enrolment': connection}), \
             patch.object(plan, 'plan_module_ids', return_value=(['M1'], {})), \
             patch.object(plan, '_plan_session_rows', return_value=[session()]), \
             patch.object(plan, 'plan_reviews', return_value=[]), \
             patch('learner_api.overview_week.upcoming_assignment_deadlines', return_value=[]):
            result = plan.read_upcoming(source, now=datetime(2026, 10, 14, tzinfo=timezone.utc))
        self.assertEqual(result, {'events': [{'id': 'O2', 'type': 'session', 'title': 'Marketing',
            'date': '2026-10-20T09:00:00+00:00', 'componentId': 'LIVE-W2'}]})
