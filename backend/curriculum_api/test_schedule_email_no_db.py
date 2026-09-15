"""Run directly with Python; production functions, mocked storage/mail, no Django setup."""
import ast
import functools
import importlib.util
import logging
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from datetime import datetime, timedelta, timezone
import base64
from urllib.parse import quote
import httpx

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
from curriculum_api.teams_schedule_email import render_schedule_email
from curriculum_api.teams_calendar_checks import utc_datetime


class Response(dict):
    def __init__(self, value, status=200):
        super().__init__(value)
        self.status_code = status


def definitions(path, namespace, names=None):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and (names is None or node.name in names)]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


auth = {'functools': functools, 'JsonResponse': Response, 'session_unreadable': lambda _: False,
        'authenticate_request': lambda request: request.account}
definitions(ROOT.parent / 'login' / 'permissions.py', auth,
            {'require_role', '_unauthenticated', '_unavailable', '_forbidden'})


def require_post(fn):
    return lambda request, *args: fn(request, *args) if request.method == 'POST' else Response({}, 405)


service = {'__package__': 'curriculum_api', '__name__': 'curriculum_api.teams_schedule_delivery', '__file__': str(ROOT / 'teams_schedule_delivery.py'),
           'Path': Path, 'base64': base64, 'quote': quote, 'utc_datetime': utc_datetime,
           'render_schedule_email': render_schedule_email, 'logger': logging.getLogger('email-test'),
           'TABLE': 'curriculum.teams_schedule_emails', 'BATCH_SIZE': 4, 'JsonResponse': Response,
           'transaction': types.SimpleNamespace(non_atomic_requests=lambda fn: fn),
           'require_role': auth['require_role'], 'require_POST': require_post}
definitions(ROOT / 'teams_schedule_delivery.py', service)


class MemoryLedger:
    def __init__(self):
        self.rows = {}
    def check(self):
        pass
    def enqueue(self, live, recipients):
        for recipient in recipients:
            self.rows.setdefault((live, recipient), 'queued')
    def states(self, live):
        return {recipient: state for (key, recipient), state in self.rows.items() if key == live}
    def claim(self, live, recipient, retry):
        if self.rows.get((live, recipient)) != 'queued':
            return False
        self.rows[live, recipient] = 'sending'
        return True
    def finish(self, live, recipient, state, code):
        self.rows[live, recipient] = state
    def retry_failed(self, live, recipients):
        for recipient in recipients:
            if self.rows.get((live, recipient)) == 'failed':
                self.rows[live, recipient] = 'queued'


def session(number=1, start='2026-09-17T11:00:00Z', link='https://teams.microsoft.com/meet/synthetic', minutes=120):
    return {'session_number': number, 'scheduled_start': start,
            'scheduled_end': (utc_datetime(start) + timedelta(minutes=minutes)).isoformat(), 'join_url': link}


class EmailTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.ledger = MemoryLedger()
        self.sender = Mock(return_value=('accepted', ''))
        self.recipients = ['one@example.invalid', 'two@example.invalid']

    def dispatch(self, **kwargs):
        return service['dispatch_batch']('LIVE-ONE', self.recipients, ('subject', 'html', 'text'), self.ledger, self.sender, **kwargs)

    def test_shared_link_complete_schedule_and_escaping(self):
        subject, html, text = render_schedule_email('<img src=x>\nModule', [session(), session(2, '2026-10-29T12:00:00Z')], 'Europe/London')
        self.assertNotIn('\n', subject)
        self.assertNotIn('<img src=x>', html)
        self.assertIn('&lt;img src=x&gt;', html)
        self.assertIn('Use the same link for all 2 sessions', html)
        self.assertIn('12:00 PM', html)
        self.assertIn('29 Oct 2026', html)
        self.assertIn('cid:kbc-schedule-logo', html)
        self.assertNotIn('[[', html)
        self.assertNotIn('Europe/London', html)
        self.assertNotIn('Your own calendar may show', html)
        self.assertNotIn('Europe/London', text)
        self.assertIn('12:00 PM', text)

    def test_multiple_links_stay_with_their_sessions(self):
        _, html, _ = render_schedule_email('Module', [session(), session(2, '2026-09-18T11:00:00Z', 'https://teams.microsoft.com/meet/second')], 'Europe/London')
        self.assertIn('more than one Teams link', html)
        self.assertEqual(html.count('Join this session</a>'), 2)
        self.assertNotIn('Use the same link', html)

    def test_midnight_and_overnight_end_date(self):
        _, html, _ = render_schedule_email('Module', [session(start='2026-09-17T22:00:00Z')], 'Europe/London')
        self.assertIn('11:00 PM', html)
        self.assertIn('01:00 AM', html)
        self.assertIn('Ends Fri, 18 Sept 2026', html)
        self.assertIn('12:00 AM', render_schedule_email('Module', [session(start='2026-09-16T23:00:00Z')], 'Europe/London')[1])

    def test_repeated_autumn_clock_uses_actual_duration(self):
        _, html, _ = render_schedule_email('Module', [session(start='2026-10-25T00:45:00Z', minutes=30)], 'Europe/London')
        self.assertIn('30 min', html)
        self.assertIn('01:45 AM', html)
        self.assertIn('01:15 AM', html)

    def test_invalid_or_overlapping_dates_and_untrusted_links_refused(self):
        for rows in ([], [session(), session()], [session(link='javascript:alert(1)')], [session(minutes=0)]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                render_schedule_email('Module', rows, 'Europe/London')

    def test_fifty_two_sessions_stay_below_email_clipping_size(self):
        rows = [session(i+1, (datetime(2026, 9, 17, 11, tzinfo=timezone.utc) + timedelta(weeks=i)).isoformat()) for i in range(52)]
        html = render_schedule_email('Module', rows, 'Europe/London')[1]
        self.assertIn('SESSION 52', html)
        self.assertLess(len(html.encode()), 100_000)

    def test_repeat_requests_do_not_resend_accepted(self):
        self.assertEqual(self.dispatch()['accepted'], 2)
        self.assertEqual(self.dispatch(retry_failed=True)['accepted'], 2)
        self.assertEqual(self.sender.call_count, 2)

    def test_normalized_recipients_are_sent_individually(self):
        self.recipients = ['ONE@example.invalid', ' one@example.invalid ']
        self.assertEqual(self.dispatch()['total'], 1)
        self.assertEqual(self.sender.call_args.args[0], 'one@example.invalid')

    def test_batches_process_remaining_people_without_resending(self):
        self.recipients = [f'learner{i}@example.invalid' for i in range(7)]
        self.assertEqual(self.dispatch()['queued'], 3)
        self.assertEqual(self.dispatch()['accepted'], 7)
        self.assertEqual(self.sender.call_count, 7)

    def test_failed_mail_waits_for_explicit_retry(self):
        self.sender.return_value = ('failed', 'mail_rejected_403')
        self.assertEqual(self.dispatch()['failed'], 2)
        self.dispatch()
        self.assertEqual(self.sender.call_count, 2)
        self.sender.return_value = ('accepted', '')
        self.assertEqual(self.dispatch(retry_failed=True)['accepted'], 2)

    def test_uncertain_or_inflight_mail_is_never_repeated(self):
        self.sender.side_effect = TimeoutError()
        self.assertEqual(self.dispatch()['uncertain'], 2)
        self.dispatch(retry_failed=True)
        self.assertEqual(self.sender.call_count, 2)

    def test_another_request_claiming_a_recipient_prevents_send(self):
        self.ledger.claim = Mock(return_value=False)
        self.dispatch()
        self.sender.assert_not_called()

    def test_missing_ledger_blocks_send(self):
        self.ledger.check = Mock(side_effect=RuntimeError('not provisioned'))
        with self.assertRaises(RuntimeError):
            self.dispatch()
        self.sender.assert_not_called()

    def test_claim_is_durable_before_mail_and_accepted_write_failure_cannot_duplicate(self):
        self.ledger.finish = Mock(side_effect=RuntimeError('database unavailable'))
        with self.assertRaises(RuntimeError):
            self.dispatch()
        self.assertEqual(self.ledger.rows[('LIVE-ONE', self.recipients[0])], 'sending')
        self.recipients = [self.recipients[0]]
        self.dispatch(retry_failed=True)
        self.assertEqual(self.sender.call_count, 1)

    def test_calendar_and_recipient_scopes_are_independent(self):
        self.dispatch()
        self.recipients = ['new@example.invalid']
        self.assertEqual(self.dispatch()['accepted'], 1)
        self.assertEqual(self.sender.call_count, 3)
        service['dispatch_batch']('LIVE-TWO', self.recipients, ('s', 'h', 't'), self.ledger, self.sender)
        self.assertEqual(self.sender.call_count, 4)

    def test_transport_has_one_to_no_cc_bcc_and_inline_logo(self):
        mail = types.SimpleNamespace(is_configured=lambda: True, _access_token=lambda: 'fake',
                    mail_config=lambda: {'sender': 'sender@example.invalid'}, GRAPH_BASE='https://graph.example.invalid',
                    EmailNotConfigured=type('NotConfigured', (Exception,), {}), EmailSendError=type('SendError', (Exception,), {}))
        with patch.dict(sys.modules, {'login': types.SimpleNamespace(email_azure=mail)}), patch.object(httpx, 'post', return_value=types.SimpleNamespace(status_code=202)) as post:
            self.assertEqual(service['_send_message']('one@example.invalid', ('subject', '<p>html</p>', 'text')), ('accepted', ''))
            body = post.call_args.kwargs['json']['message']
            self.assertEqual(body['toRecipients'], [{'emailAddress': {'address': 'one@example.invalid'}}])
            self.assertNotIn('ccRecipients', body)
            self.assertNotIn('bccRecipients', body)
            self.assertEqual(body['attachments'][0]['contentId'], 'kbc-schedule-logo')
            self.assertTrue(body['attachments'][0]['isInline'])
            post.return_value.status_code = 503
            self.assertEqual(service['_send_message']('one@example.invalid', ('s', 'h', 't'))[0], 'unknown')

    def test_ledger_sql_claim_is_conditional_and_no_schema_provisioning(self):
        cursor = Mock()
        db = types.SimpleNamespace(cursor=lambda: types.SimpleNamespace())
        manager = Mock()
        manager.__enter__ = Mock(return_value=cursor)
        manager.__exit__ = Mock(return_value=False)
        db.cursor = lambda: manager
        cursor.fetchone.return_value = ('one@example.invalid',)
        ledger = service['DeliveryLedger'](db)
        self.assertTrue(ledger.claim('LIVE-ONE', 'one@example.invalid', False))
        sql, args = cursor.execute.call_args.args
        self.assertIn('status = ANY(%s)', sql)
        self.assertEqual(args, ['LIVE-ONE', 'one@example.invalid', ['queued']])
        self.assertNotIn('CREATE TABLE', (ROOT / 'teams_schedule_delivery.py').read_text().upper())

    def test_endpoint_rejects_anonymous_learner_employer_before_io(self):
        for role, status in [(None, 401), ('learner', 403), ('employer', 403)]:
            account = types.SimpleNamespace(role=role) if role else None
            response = service['schedule_email'](types.SimpleNamespace(account=account, method='POST'), 'LIVE-ONE')
            self.assertEqual(response.status_code, status)

    def test_staff_and_admin_cannot_supply_arbitrary_mail_recipients(self):
        view = types.SimpleNamespace(json_body=lambda _: {'to': 'other@example.invalid'})
        with patch.dict(sys.modules, {'curriculum_api.views': view}):
            for role in ('staff', 'admin'):
                request = types.SimpleNamespace(account=types.SimpleNamespace(role=role), method='POST')
                self.assertEqual(service['schedule_email'](request, 'LIVE-ONE').status_code, 400)
                request.method = 'GET'
                self.assertEqual(service['schedule_email'](request, 'LIVE-ONE').status_code, 405)

    def test_new_endpoint_retains_django_csrf_protection(self):
        node = next(node for node in ast.parse((ROOT / 'teams_schedule_delivery.py').read_text()).body if isinstance(node, ast.FunctionDef) and node.name == 'schedule_email')
        self.assertNotIn('csrf_exempt', ' '.join(ast.unparse(item) for item in node.decorator_list))

    def verified_context(self):
        rows = [session(), session(2, '2026-10-29T12:00:00Z')]
        series = {'id': 'LIVE-ONE', 'status': 'active', 'warnings': [], 'module_title': 'Saved module',
                  'attendees': ['one@example.invalid', 'tutor@example.invalid'], 'presenters': ['tutor@example.invalid'],
                  'co_organizers': [], 'organizer_email': 'organizer@example.invalid', 'graph_event_id': 'MASTER',
                  'join_url': rows[0]['join_url'], 'repeat_pattern': 'weekly'}
        fetch = Mock(side_effect=lambda table, *args, **kwargs: [series] if table == 'series' else rows)
        view = types.SimpleNamespace(authoring_fetch_all=fetch, LIVE_SESSIONS_TABLE='series', LIVE_SESSION_OCCURRENCES_TABLE='occurrences',
                  parse_json_value=lambda value, default: value or default,
                  teams_series_email_list=lambda *values: list(dict.fromkeys(item for value in values if value for item in value)),
                  teams_attendee_emails=lambda value: value, stored_calendar_series=lambda _: [],
                  graph_timezone_iana=lambda _: 'Europe/London', json_body=lambda _: {})
        graph = Mock()
        transport = types.SimpleNamespace(get_graph_settings=lambda: {}, microsoft_graph_request=graph)
        verify = Mock(return_value={'attendees': [{'emailAddress': {'address': 'one@example.invalid'}}]})
        return rows, series, view, transport, verify

    def test_saved_dates_are_verified_before_rendered_message_is_used(self):
        rows, series, view, transport, verify = self.verified_context()
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport}), patch.dict(service, {'verify_calendar': verify}):
            recipients, message = service['verified_message']('LIVE-ONE')
        self.assertEqual(recipients, ['one@example.invalid'])
        self.assertIn('29 Oct 2026', message[1])
        self.assertNotIn('tutor@example.invalid', message[1])
        self.assertEqual(verify.call_args.args[2], 'MASTER')
        self.assertEqual(verify.call_args.args[3][1]['start'], utc_datetime(rows[1]['scheduled_start']))
        for call in view.authoring_fetch_all.call_args_list:
            self.assertFalse(call.kwargs['ensure_tables'])
            self.assertIn('LIVE-ONE', call.args[2])
        transport.microsoft_graph_request.assert_not_called()

    def test_unverified_calendar_or_unconfirmed_roster_blocks_summary(self):
        rows, series, view, transport, verify = self.verified_context()
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport}), patch.dict(service, {'verify_calendar': verify}):
            series['warnings'] = ['Calendar mismatch']
            with self.assertRaises(ValueError):
                service['verified_message']('LIVE-ONE')
            verify.assert_not_called()
            series['warnings'] = []
            verify.return_value = {'attendees': []}
            with self.assertRaisesRegex(ValueError, 'every learner'):
                service['verified_message']('LIVE-ONE')

    def test_microsoft_date_mismatch_prevents_any_mail_batch(self):
        rows, series, view, transport, verify = self.verified_context()
        verify.side_effect = RuntimeError('Date mismatch')
        mail = types.SimpleNamespace(is_configured=lambda: True)
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport, 'login': types.SimpleNamespace(email_azure=mail)}), patch.dict(service, {
            'verify_calendar': verify, 'connection': object(), 'DeliveryLedger': lambda _: self.ledger, '_send_message': self.sender,
        }):
            request = types.SimpleNamespace(account=types.SimpleNamespace(role='admin'), method='POST')
            response = service['schedule_email'](request, 'LIVE-ONE')
        self.assertEqual(response.status_code, 409)
        self.sender.assert_not_called()
        self.assertFalse(self.ledger.rows)

    def test_staff_and_admin_can_submit_verified_saved_schedule(self):
        rows, series, view, transport, verify = self.verified_context()
        mail = types.SimpleNamespace(is_configured=lambda: True)
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport, 'login': types.SimpleNamespace(email_azure=mail)}), patch.dict(service, {
            'verify_calendar': verify, 'connection': object(), 'DeliveryLedger': lambda _: self.ledger, '_send_message': self.sender,
        }):
            for role in ('staff', 'admin'):
                request = types.SimpleNamespace(account=types.SimpleNamespace(role=role), method='POST')
                response = service['schedule_email'](request, 'LIVE-ONE')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['accepted'], 1)
        self.assertEqual(self.sender.call_count, 1)


if __name__ == '__main__':
    unittest.main()
