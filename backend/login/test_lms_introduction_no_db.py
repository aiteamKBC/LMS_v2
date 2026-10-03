"""Run directly with Python; no database, network, mail or production settings loaded."""
import json
import sys
import unittest
from datetime import date, time
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from django.conf import settings
if not settings.configured:
    settings.configure(INSTALLED_APPS=['login'], DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}, SECRET_KEY='isolated-test', DEFAULT_CHARSET='utf-8', TIME_ZONE='Europe/London', USE_TZ=True)
import django
django.setup()
from django.test import RequestFactory
from login import email_azure, lms_introduction as intro

ACCOUNT = SimpleNamespace(id=7, email='learner@example.test', display_name='Example Learner', subject_id=132, subject_type='learner')
LEARNER = SimpleNamespace(pk=132, username='Example Learner')
MONDAY = date(2026, 11, 9)


class Conflict(ValueError):
    pass


class SyncInProgress(RuntimeError):
    pass


class Unavailable(Exception):
    pass


def record(status='scheduled', sync_state='synced', **overrides):
    fields = dict(status=status, sync_state=sync_state, scheduled_date=MONDAY, scheduled_time=time(10, 30), notes='',
                  meeting_link='https://teams.example/join', owner_name='Example Coach', owner_email='coach@example.test',
                  learner_name='Example Learner', learner_email='learner@example.test', event_key='lms-introduction:132:1', pk=1)
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TokenTests(unittest.TestCase):
    def accounts(self, found):
        query = MagicMock()
        query.filter.return_value.first.return_value = found
        return patch.object(intro.LoginAccount, 'objects', query), query

    def test_token_round_trip_names_the_active_learner_account(self):
        token = intro.make_token(ACCOUNT)
        manager, query = self.accounts(ACCOUNT)
        with manager:
            self.assertIs(intro.account_for_token(token), ACCOUNT)
        query.filter.assert_called_once_with(pk=7, is_active=True, subject_type='learner')
        self.assertNotIn('learner@example.test', token)

    def test_tampered_expired_or_reassigned_links_are_refused(self):
        token = intro.make_token(ACCOUNT)
        manager, query = self.accounts(ACCOUNT)
        with manager:
            for bad in ('', 'nonsense', token[:-2] + 'xx', None):
                self.assertIsNone(intro.account_for_token(bad))
            query.filter.assert_not_called()
            with patch('django.core.signing.time.time', return_value=4_000_000_000):
                self.assertIsNone(intro.account_for_token(token))
        manager, _ = self.accounts(SimpleNamespace(**{**vars(ACCOUNT), 'email': 'someone-else@example.test'}))
        with manager:
            self.assertIsNone(intro.account_for_token(token))

    def test_booking_link_points_at_the_public_page(self):
        with patch.object(intro, 'make_token', return_value='T'):
            self.assertEqual(intro.booking_link(ACCOUNT, 'https://lms.example.net'), 'https://lms.example.net/lms-introduction?token=T')


class ParseTests(unittest.TestCase):
    def test_only_open_office_hour_slots_are_accepted(self):
        with patch('django.utils.timezone.localdate', return_value=date(2026, 11, 2)):
            self.assertEqual(intro._parse_request({'date': '2026-11-09', 'time': '16:30', 'note': '  hi  '}),
                             (MONDAY, time(16, 30), 'hi'))
            for payload in ({'date': '2026-11-07', 'time': '10:00'},   # Saturday
                            {'date': '2026-11-01', 'time': '10:00'},   # past
                            {'date': 'soon', 'time': '10:00'},
                            {'date': '2026-11-09', 'time': '17:00'},
                            {'date': '2026-11-09', 'time': '10:15'}):
                with self.subTest(payload=payload), self.assertRaises(ValueError):
                    intro._parse_request(payload)
            self.assertEqual(len(intro._parse_request({'date': '2026-11-09', 'time': '09:00', 'note': 'x' * 900})[2]), 500)

    def test_serialized_booking_reports_whether_teams_accepted_it(self):
        self.assertEqual(intro._serialize(record())['inviteSent'], True)
        self.assertEqual(intro._serialize(record(sync_state='failed'))['inviteSent'], False)
        legacy = intro._serialize(record(status='not-scheduled', sync_state='pending'))
        self.assertEqual((legacy['status'], legacy['inviteSent'], legacy['meetingLink']), ('requested', False, ''))


class ViewTests(unittest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        views = ModuleType('coach_api.views')
        views.LearnerCalendarConflict, views.CalendarSyncInProgress = Conflict, SyncInProgress
        package = ModuleType('coach_api')
        package.views = views
        availability = ModuleType('learner_api.coach_availability')
        availability.AvailabilityUnavailable = Unavailable
        self.slot_free = availability.catchup_slot_is_free = Mock(return_value=True)
        learner_package = ModuleType('learner_api')
        learner_package.coach_availability = availability
        for target in (patch.dict(sys.modules, {'coach_api': package, 'coach_api.views': views,
                                                'learner_api': learner_package, 'learner_api.coach_availability': availability}),
                       patch.object(intro, 'account_for_token', return_value=ACCOUNT),
                       patch.object(intro, 'learner_and_owner', return_value=(LEARNER, 'coach@example.test', 'Example Coach')),
                       patch.object(intro, 'open_request', return_value=None),
                       patch.object(intro, '_parse_day', side_effect=lambda value: date.fromisoformat(value)),
                       patch('socket.socket', MagicMock(side_effect=AssertionError('No network allowed')))):
            target.start()
            self.addCleanup(target.stop)
        self.free = patch.object(intro, 'free_times', return_value=['09:00', '10:30']).start()
        self.save = patch.object(intro, '_save', return_value=(record(sync_state='pending'), True)).start()
        self.sync = patch.object(intro, '_sync', side_effect=lambda r: (record(), '')).start()
        self.notify = patch.object(intro, '_notify_owner', return_value=True).start()
        self.addCleanup(patch.stopall)

    def call(self, method='post', body=None, ajax=True, query=None):
        headers = {'HTTP_X_REQUESTED_WITH': 'XMLHttpRequest'} if ajax else {}
        if method == 'get':
            request = self.factory.get('/login_api/public/lms-introduction/', {'token': 'T', **(query or {})}, **headers)
        else:
            data = {'token': 'T', 'date': '2026-11-09', 'time': '10:30', **(body or {})}
            request = self.factory.post('/login_api/public/lms-introduction/', json.dumps(data), content_type='application/json', **headers)
        with patch('django.utils.timezone.localdate', return_value=date(2026, 11, 2)):
            response = intro.public_request(request)
        return response.status_code, json.loads(response.content)

    def test_cross_site_and_bad_links_are_refused_before_any_write(self):
        self.assertEqual(self.call(ajax=False)[0], 403)
        intro.account_for_token.return_value = None
        status, body = self.call()
        self.assertEqual(status, 404)
        self.assertIn('invalid or has expired', body['error'])
        self.save.assert_not_called()

    def test_get_shows_the_case_owner_without_writing(self):
        status, body = self.call('get')
        self.assertEqual(status, 200)
        self.assertEqual((body['caseOwner'], body['request']), ('Example Coach', None))
        self.assertNotIn('coach@example.test', json.dumps(body))
        self.save.assert_not_called()

    def test_free_times_for_a_day_come_from_the_case_owners_calendar(self):
        self.assertEqual(self.call('get', query={'date': '2026-11-09'}), (200, {'date': '2026-11-09', 'times': ['09:00', '10:30']}))
        self.free.assert_called_once_with('coach@example.test', MONDAY)
        self.free.side_effect = Unavailable('calendar down')
        status, body = self.call('get', query={'date': '2026-11-09'})
        self.assertEqual(status, 503)
        self.assertIn('try again', body['error'])

    def test_booking_puts_the_meeting_in_teams_and_tells_the_case_owner(self):
        status, body = self.call(body={'note': 'Mornings please'})
        self.assertEqual(status, 201)
        self.assertEqual((body['request']['status'], body['request']['inviteSent'], body['warning']), ('scheduled', True, ''))
        self.slot_free.assert_called_once_with('coach@example.test', MONDAY, time(10, 30), 30, exclude_event_key='')
        self.save.assert_called_once_with(ACCOUNT, LEARNER, 'coach@example.test', 'Example Coach', MONDAY, time(10, 30), 'Mornings please')
        self.sync.assert_called_once()
        self.notify.assert_called_once()
        self.assertFalse(self.notify.call_args.kwargs['updated'])

    def test_a_time_the_case_owner_is_busy_is_refused_before_any_write(self):
        self.slot_free.return_value = False
        status, body = self.call()
        self.assertEqual(status, 409)
        self.assertIn('not available', body['error'])
        self.save.assert_not_called()
        self.slot_free.side_effect = Unavailable('calendar down')
        self.assertEqual(self.call()[0], 503)
        self.save.assert_not_called()

    def test_teams_failure_is_reported_as_saved_but_not_invited(self):
        self.sync.side_effect = lambda r: (record(sync_state='failed', meeting_link=''), 'Your slot is saved, but no calendar invite or email was sent.')
        status, body = self.call()
        self.assertEqual(status, 201)
        self.assertEqual((body['request']['status'], body['request']['inviteSent']), ('scheduled', False))
        self.assertIn('no calendar invite', body['warning'])
        self.notify.assert_called_once()

    def test_double_submit_replays_without_sending_again(self):
        self.save.return_value = (record(), False)
        self.assertEqual(self.call()[0], 200)
        self.sync.assert_not_called()
        self.notify.assert_not_called()

    def test_a_booked_introduction_cannot_be_moved_from_the_link(self):
        intro.open_request.return_value = record()
        status, body = self.call(body={'time': '15:00'})
        self.assertEqual(status, 409)
        self.assertEqual(body['request']['status'], 'scheduled')
        self.assertIn('already booked', body['error'])
        self.save.assert_not_called()
        self.sync.assert_not_called()

    def test_submitting_again_retries_a_booking_teams_did_not_accept(self):
        failed = record(sync_state='failed', meeting_link='')
        intro.open_request.return_value = failed
        status, body = self.call(body={'time': '15:00'})
        self.assertEqual(status, 200)
        self.sync.assert_called_once_with(failed)
        self.save.assert_not_called()
        self.slot_free.assert_not_called()
        self.assertTrue(body['request']['inviteSent'])

    def test_a_request_saved_before_immediate_booking_is_booked_now(self):
        intro.open_request.return_value = record(status='not-scheduled', sync_state='pending', meeting_link='')
        self.save.return_value = (record(sync_state='pending'), False)
        status, _ = self.call()
        self.assertEqual(status, 200)
        self.slot_free.assert_called_once_with('coach@example.test', MONDAY, time(10, 30), 30, exclude_event_key='lms-introduction:132:1')
        self.sync.assert_called_once()
        self.assertTrue(self.notify.call_args.kwargs['updated'])

    def test_learner_without_a_reachable_case_owner_is_told_to_contact_the_team(self):
        intro.learner_and_owner.return_value = (LEARNER, '', 'Unknown Owner')
        status, body = self.call()
        self.assertEqual(status, 409)
        self.assertIn('programme team', body['error'])
        self.save.assert_not_called()

    def test_calendar_conflicts_and_concurrent_edits_are_reported(self):
        self.save.side_effect = Conflict('That time overlaps another session.')
        self.assertEqual(self.call(), (409, {'error': 'That time overlaps another session.'}))
        self.save.side_effect = ValueError('Idempotency-Key was already used for a different booking.')
        self.assertIn('another window', self.call()[1]['error'])
        self.save.side_effect = SyncInProgress('busy')
        self.assertIn('being sent', self.call()[1]['error'])
        self.notify.assert_not_called()


class OwnerEmailTests(unittest.TestCase):
    def message(self, **overrides):
        kwargs = dict(owner_name='Example Coach', learner_name='<b>Example</b>', learner_email='learner@example.test',
                      when_label='Monday 9 November 2026 at 10:30 (UK time)', note='Mornings',
                      timetable_link='https://lms.example.net/coach/timetable')
        kwargs.update(overrides)
        return email_azure.lms_introduction_request_message(**kwargs)

    def test_owner_email_names_the_learner_and_links_to_the_timetable(self):
        subject, html, text = self.message()
        self.assertIn('LMS introduction booked', subject)
        self.assertNotIn('<b>Example</b>', html)
        for body in (html, text):
            self.assertIn('learner@example.test', body)
            self.assertIn('10:30 (UK time)', body)
            self.assertIn('https://lms.example.net/coach/timetable', body)
            self.assertIn('in your Teams calendar', body)

    def test_owner_email_says_when_teams_did_not_accept_the_invitation(self):
        _, html, text = self.message(invite_sent=False)
        for body in (html, text):
            self.assertIn('did not accept the Teams invitation', body)

    def test_unsent_owner_email_is_logged_not_raised(self):
        with patch.object(email_azure, 'send_mail', return_value=(False, 'not-configured')) as send, \
                patch('login.invitations.frontend_base_url', return_value='https://lms.example.net'), \
                self.assertLogs('login', level='ERROR'):
            self.assertFalse(intro._notify_owner(record(notes='Mornings'), updated=False))
        self.assertEqual(send.call_args.kwargs['to'], 'coach@example.test')
        self.assertTrue(send.call_args.kwargs['html_body'])


if __name__ == '__main__':
    unittest.main()
