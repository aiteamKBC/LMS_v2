import json
from contextlib import nullcontext
from datetime import date, datetime
from types import SimpleNamespace
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import event_checkin


class EventCheckInWindowTests(SimpleTestCase):
    @override_settings(TIME_ZONE='Europe/London')
    def test_calendar_day_window_uses_business_timezone(self):
        event = SimpleNamespace(type='offline', event_date=date(2026, 10, 25))
        state, opens_at, closes_at = event_checkin.check_in_window(
            event, datetime(2026, 10, 24, 0, 0, tzinfo=ZoneInfo('Europe/London')),
        )
        self.assertEqual(state, 'open')
        self.assertEqual(opens_at.isoformat(), '2026-10-24T00:00:00+01:00')
        self.assertEqual(closes_at.isoformat(), '2026-10-26T00:00:00+00:00')

    def test_online_event_has_no_public_check_in(self):
        state, opens_at, closes_at = event_checkin.check_in_window(
            SimpleNamespace(type='online', event_date=date(2026, 10, 25)),
        )
        self.assertEqual((state, opens_at, closes_at), ('unavailable', None, None))


class EventCheckInSubmissionTests(SimpleTestCase):
    def test_response_does_not_disclose_whether_email_is_a_learner(self):
        event = SimpleNamespace(id=4, pk=4, title='Leadership Day')
        request = RequestFactory().post(
            '/engagement_api/event-check-in/',
            data=json.dumps({'token': 'token', 'name': 'Learner One', 'email': 'learner@example.test'}),
            content_type='application/json',
        )
        count_query = mock.Mock()
        count_query.count.return_value = 1
        event_query = mock.Mock()
        with (
            mock.patch.object(event_checkin, '_event_for_token', return_value=event),
            mock.patch.object(event_checkin, 'check_in_window', return_value=('open', None, None)),
            mock.patch.object(event_checkin, '_learner_id', return_value='125'),
            mock.patch.object(event_checkin.EventAttendance.objects, 'update_or_create') as upsert,
            mock.patch.object(event_checkin.EventAttendance.objects, 'filter', return_value=count_query),
            mock.patch.object(event_checkin.Event.objects, 'filter', return_value=event_query),
            mock.patch.object(event_checkin.transaction, 'atomic', return_value=nullcontext()),
            mock.patch.object(event_checkin, 'grant_points'),
        ):
            response = event_checkin.event_check_in(request)
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body, {'recorded': True, 'message': 'Your attendance has been recorded.'})
        upsert.assert_called_once()
        self.assertEqual(upsert.call_args.kwargs['learner_id'], '125')
        self.assertEqual(upsert.call_args.kwargs['defaults']['attendee_type'], 'learner')
