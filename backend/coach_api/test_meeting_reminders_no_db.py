"""AST-loaded endpoint/auth tests: no application imports, database or mail I/O.

Run: python -I backend/coach_api/test_meeting_reminders_no_db.py
The session middleware and Django CSRF middleware require owner-run integration
checks; this runner tests the real coach guard with synthetic authenticated users.
"""
import ast
import functools
import hashlib
import json
import unittest
from datetime import datetime, date, time, timezone as utc_timezone
from html import escape
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from zoneinfo import ZoneInfo


class Response:
    def __init__(self, data, status=200):
        self.data, self.status_code = data, status


class Query:
    def __init__(self, rows):
        self.rows = rows

    def annotate(self, **kwargs):
        return self

    def only(self, *args):
        return self

    def filter(self, **kwargs):
        def matches(row):
            for key, value in kwargs.items():
                field = {'owner_key': 'owner_email', 'coach_key': 'coach_email', 'pk': 'id'}.get(key, key)
                if key.endswith('__in'):
                    if getattr(row, key[:-4]) not in value:
                        return False
                elif getattr(row, field) != value:
                    return False
            return True
        return Query([row for row in self.rows if matches(row)])

    def first(self):
        return next(iter(self.rows), None)


class QueryParams(dict):
    def getlist(self, key):
        return [self[key]] if key in self else []


def load_functions(path, namespace, names=None):
    nodes = [node for node in ast.parse(path.read_text(encoding='utf-8-sig')).body
             if isinstance(node, ast.FunctionDef) and (names is None or node.name in names)]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class ReminderTests(unittest.TestCase):
    def setUp(self):
        self.staff = SimpleNamespace(id=1, subject_type='staff', email='coach@example.invalid', access='coach')
        self.learner = SimpleNamespace(id=42, email='learner@example.invalid', full_name='Example <Learner>', coach_email=self.staff.email)
        self.record = SimpleNamespace(id=7, owner_email=self.staff.email, event_key='mcr:42:1', learner_id=42,
            learner_email='stale@example.invalid', event_type='mcr', status='scheduled', scheduled_date=date(2026, 9, 21),
            scheduled_time=time(10, 30), duration_minutes=60, owner_name='Example Coach', meeting_link='https://example.invalid/meeting')
        self.mail = SimpleNamespace(is_configured=Mock(return_value=True), send_mail=Mock(return_value=(True, None)))
        values = {}
        def add(key, value, timeout):
            if key in values:
                return False
            values[key] = value
            return True
        self.cache = SimpleNamespace(add=Mock(side_effect=add), get=values.get,
                                     set=Mock(side_effect=lambda key, value, timeout: values.update({key: value})))
        def require_post(view):
            @functools.wraps(view)
            def wrapped(request, *args):
                return view(request, *args) if request.method == 'POST' else Response({}, 405)
            return wrapped
        def require_access(role):
            def decorate(view):
                @functools.wraps(view)
                def wrapped(request, *args):
                    return view(request, *args) if request.login_account else Response({}, 401)
                return wrapped
            return decorate
        def validate_email(value):
            if '@' not in value or '\n' in value or '\r' in value:
                raise ValueError('invalid')
        self.ns = dict(functools=functools, json=json, hashlib=hashlib, datetime=datetime, escape=escape,
            JsonResponse=Response, DatabaseError=RuntimeError, ValidationError=ValueError, validate_email=validate_email,
            Lower=lambda value: value, Trim=lambda value: value, require_POST=require_post, require_access=require_access,
            ACCESS_COACH='coach', ACCESS_SUPER_ADMIN='super-admin', _SAFE_METHODS={'GET', 'HEAD', 'OPTIONS'},
            _VIEW_AS_KEYS=('viewAsCoach', 'view_as_coach'), _LEGACY_OWNER_KEYS=('owner_email', 'ownerEmail'),
            normalize_email=lambda value: str(value or '').strip().lower(), _staff_access=lambda staff: staff.access,
            StaffUser=SimpleNamespace(objects=Query([self.staff])),
            CoachCalendarEvent=SimpleNamespace(objects=Query([self.record])),
            LearnerProfile=SimpleNamespace(objects=Query([self.learner])),
            cache=self.cache, email_azure=self.mail,
            timezone=SimpleNamespace(get_default_timezone=lambda: ZoneInfo('Europe/London'),
                make_aware=lambda value, zone: value.replace(tzinfo=zone),
                now=lambda: datetime(2026, 9, 18, 12, tzinfo=utc_timezone.utc)))
        root = Path(__file__).parent
        load_functions(root / 'auth.py', self.ns, {'_forbidden', '_json_payload', '_request_values', '_legacy_owner_mismatch', '_legacy_owner_values',
            '_requested_view_as_email', 'coach_access_required', 'authenticated_coach_email'})
        load_functions(root / 'meeting_reminders.py', self.ns)
        self.request = SimpleNamespace(method='POST', login_account=SimpleNamespace(subject_type='staff', subject_id=1),
            content_type='application/json', body=b'{}', GET=QueryParams(), path='/reminder')

    def send(self, key=None):
        return self.ns['coach_meeting_reminder'](self.request, key or self.record.event_key)

    def test_sends_to_current_learner_only_with_business_time_and_escaped_content(self):
        self.request.body = b'{"to":"attacker@example.invalid"}'
        before = vars(self.record).copy()
        self.assertEqual(self.send().status_code, 200)
        sent = self.mail.send_mail.call_args.kwargs
        self.assertEqual(sent['to'], self.learner.email)
        self.assertIn('10:30 BST', sent['text_body'])
        self.assertIn('&lt;Learner&gt;', sent['html_body'])
        self.assertIn(self.record.meeting_link, sent['text_body'])
        self.assertEqual(vars(self.record), before)

    def test_duplicates_are_acknowledged_without_resending(self):
        self.send()
        self.assertTrue(self.send().data['alreadySent'])
        self.mail.send_mail.assert_called_once()

    def test_in_flight_or_uncertain_delivery_blocks_retry(self):
        self.mail.send_mail.return_value = (False, 'secret provider response')
        response = self.send()
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('secret', str(response.data))
        self.assertEqual(self.send().status_code, 429)
        self.mail.send_mail.assert_called_once()

    def test_transport_exception_is_not_success(self):
        self.mail.send_mail.side_effect = RuntimeError('secret')
        self.assertEqual(self.send().status_code, 502)

    def test_no_email_when_unconfigured_or_cache_unavailable(self):
        self.mail.is_configured.return_value = False
        self.assertEqual(self.send().status_code, 503)
        self.mail.is_configured.return_value = True
        self.cache.add.side_effect = RuntimeError('cache secret')
        self.assertEqual(self.send().status_code, 503)
        self.mail.send_mail.assert_not_called()

    def test_other_coach_or_reassigned_learner_is_hidden(self):
        self.record.owner_email = 'other@example.invalid'
        self.assertEqual(self.send().status_code, 404)
        self.record.owner_email = self.staff.email
        self.learner.coach_email = 'other@example.invalid'
        self.assertEqual(self.send().status_code, 404)
        self.mail.send_mail.assert_not_called()

    def test_roles_and_view_as_cannot_send(self):
        for access in ['tutor', 'super-admin']:
            self.staff.access = access
            self.request.GET['viewAsCoach'] = 'coach@example.invalid'
            self.assertEqual(self.send().status_code, 403)
        self.request.login_account.subject_type = 'learner'
        self.assertEqual(self.send().status_code, 403)
        self.request.login_account = None
        self.assertEqual(self.send().status_code, 401)
        self.mail.send_mail.assert_not_called()

    def test_client_cannot_change_coach_identity(self):
        self.request.body = b'{"ownerEmail":"other@example.invalid"}'
        self.assertEqual(self.send().status_code, 403)
        self.mail.send_mail.assert_not_called()

    def test_post_only_and_no_reminder_for_past_cancelled_or_unscheduled_meetings(self):
        self.request.method = 'GET'
        self.assertEqual(self.send().status_code, 405)
        self.request.method = 'POST'
        for status in ['cancelled', 'completed', 'not-scheduled']:
            self.record.status = status
            self.assertEqual(self.send().status_code, 409)
        self.record.status = 'scheduled'
        self.record.scheduled_date = date(2026, 9, 1)
        self.assertEqual(self.send().status_code, 409)
        self.mail.send_mail.assert_not_called()

    def test_future_confirmed_meeting_can_receive_a_reminder(self):
        self.record.status = 'confirmed'
        self.assertEqual(self.send().status_code, 200)
        self.mail.send_mail.assert_called_once()

    def test_unsupported_event_missing_recipient_and_missing_record(self):
        self.assertEqual(self.send('unknown').status_code, 404)
        self.learner.email = ''
        self.assertEqual(self.send().status_code, 409)
        self.record.event_type = 'live-session'
        self.assertEqual(self.send().status_code, 404)
        self.mail.send_mail.assert_not_called()

    def test_commercial_and_apprenticeship_learner_ids_do_not_cross(self):
        for kind in ['commercial', 'apprenticeship']:
            self.learner.learner_type = kind
            self.record.learner_id = self.learner.id + 1
            self.assertEqual(self.send().status_code, 404)
        self.mail.send_mail.assert_not_called()

    def test_winter_timezone_uses_gmt(self):
        self.record.scheduled_date = date(2026, 12, 1)
        self.assertEqual(self.send().status_code, 200)
        self.assertIn('10:30 GMT', self.mail.send_mail.call_args.kwargs['text_body'])


if __name__ == '__main__':
    unittest.main()
