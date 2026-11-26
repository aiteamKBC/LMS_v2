"""Calendar export metadata only: no database, Microsoft calls, or writes."""
from copy import deepcopy
from datetime import datetime, timezone

from django.test import SimpleTestCase, override_settings

from coach_api.views import build_live_session_calendar_event
from .calendar import _serialize_live_session_event
from .calendar_shared_delivery import apply_shared_calendar_slot


@override_settings(TIME_ZONE='Europe/London')
class CalendarExportMetadataTests(SimpleTestCase):
    def build(self, *, row=None, **changes):
        return build_live_session_calendar_event(
            row if row is not None else {'id': 'SYNTHETIC-M', 'module_name': 'Synthetic module',
                                        'session_start_time': '09:00', 'session_end_time': '10:00'},
            {'date': '2026-11-02', 'sessionNumber': 1},
            programme='Programme', cohort='Cohort', group='Group',
            owner_email='coach@example.test', owner_name='Coach', **changes,
        )

    def test_cairo_series_preserves_exact_occurrence_instants_and_identity(self):
        occurrence = {'id': 'SYNTHETIC-O', 'scheduled_start': datetime(2026, 11, 2, 7, tzinfo=timezone.utc),
                      'scheduled_end': datetime(2026, 11, 2, 8, 30, tzinfo=timezone.utc),
                      'join_url': 'https://teams.example.test/synthetic'}
        series = {'timezone': 'Egypt Standard Time', 'provider': 'Microsoft Teams'}
        original = deepcopy((occurrence, series))
        payload = _serialize_live_session_event(self.build(tracked_occurrence=occurrence, tracked_series=series))
        self.assertEqual(payload['timeZone'], 'Egypt Standard Time')
        self.assertEqual(payload['startsAt'], '2026-11-02T07:00:00+00:00')
        self.assertEqual(payload['endsAt'], '2026-11-02T08:30:00+00:00')
        self.assertEqual(payload['occurrenceId'], 'SYNTHETIC-O')
        self.assertEqual(payload['meetingLink'], occurrence['join_url'])
        self.assertEqual((occurrence, series), original)

    def test_legacy_naive_occurrence_columns_keep_their_utc_storage_contract(self):
        payload = _serialize_live_session_event(self.build(tracked_occurrence={
            'scheduled_start': datetime(2026, 11, 2, 7), 'scheduled_end': datetime(2026, 11, 2, 8)}))
        self.assertEqual(payload['startsAt'], '2026-11-02T07:00:00+00:00')
        self.assertEqual(payload['endsAt'], '2026-11-02T08:00:00+00:00')

    def test_preserves_a_confirmed_occurrence_when_the_module_clock_is_missing(self):
        payload = _serialize_live_session_event(self.build(row={'id': 'SYNTHETIC-M'}, tracked_occurrence={
            'scheduled_start': datetime(2026, 11, 2, 7, tzinfo=timezone.utc),
            'scheduled_end': datetime(2026, 11, 2, 8, tzinfo=timezone.utc)}))
        self.assertTrue(payload['isTimeEstimated'])
        self.assertEqual(payload['startsAt'], '2026-11-02T07:00:00+00:00')

    def test_untracked_authored_clocks_retain_the_configured_business_zone(self):
        payload = _serialize_live_session_event(self.build())
        self.assertEqual(payload['scheduledDate'], '2026-11-02')
        self.assertEqual(payload['scheduledTime'], '09:00')
        self.assertEqual(payload['timeZone'], 'Europe/London')
        self.assertIsNone(payload['startsAt'])
        self.assertFalse(payload['isTimeEstimated'])

    def test_serializer_does_not_guess_a_missing_source_zone(self):
        payload = _serialize_live_session_event({'date': '2027-01-04', 'startHour': 9, 'isTimeEstimated': True})
        self.assertIsNone(payload['timeZone'])
        self.assertTrue(payload['isTimeEstimated'])
        self.assertEqual(payload['scheduledDate'], '2027-01-04')

    def test_shared_delivery_retains_elapsed_duration_across_dst(self):
        event = {'id': 'ASSIGNED', 'eventKey': 'ASSIGNED', 'module': 'Assigned module'}
        delivery = {'teamsOccurrenceId': 'SOURCE-O', 'sessionDateTimeUtc': '2026-10-25T00:30:00+00:00',
                    'durationMinutes': 120, 'liveSessionUrl': 'https://teams.example.test/shared'}
        payload = _serialize_live_session_event(apply_shared_calendar_slot(event, delivery))
        self.assertEqual(payload['startsAt'], '2026-10-25T00:30:00+00:00')
        self.assertEqual(payload['endsAt'], '2026-10-25T02:30:00+00:00')
        self.assertEqual(payload['timeZone'], 'Europe/London')
        self.assertEqual(payload['id'], 'ASSIGNED')
        self.assertEqual(payload['occurrenceId'], 'SOURCE-O')
        self.assertNotIn('startsAt', event)

    def test_one_series_clock_never_changes_another(self):
        cairo = self.build(tracked_series={'timezone': 'Egypt Standard Time'})
        london = self.build(tracked_series={'timezone': 'GMT Standard Time'})
        self.assertEqual(_serialize_live_session_event(cairo)['timeZone'], 'Egypt Standard Time')
        self.assertEqual(_serialize_live_session_event(london)['timeZone'], 'GMT Standard Time')
