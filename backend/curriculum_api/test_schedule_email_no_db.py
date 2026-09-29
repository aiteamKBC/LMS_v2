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
import threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import quote
import httpx

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
from curriculum_api.teams_schedule_email import meeting_settings, render_change_email, render_schedule_email
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
           'render_schedule_email': render_schedule_email, 'render_change_email': render_change_email, 'meeting_settings': meeting_settings, 'logger': logging.getLogger('email-test'),
           'TABLE': 'curriculum.teams_schedule_emails', 'BATCH_SIZE': 4, 'JsonResponse': Response,
           'ThreadPoolExecutor': ThreadPoolExecutor,
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

    def test_sessions_are_named_after_their_live_session_components(self):
        rows = [session(), session(2, '2026-09-24T11:00:00Z')]
        _, html, text = render_schedule_email('Module', rows, 'Europe/London', session_titles={1: 'Intro to <Risk>'})
        self.assertIn('Intro to &lt;Risk&gt;', html)
        self.assertNotIn('SESSION 01', html)
        self.assertNotIn('<Risk>', html)
        # A session no component names keeps its number.
        self.assertIn('SESSION 02', html)
        self.assertIn('Intro to <Risk>: Thu, 17 Sept 2026', text)
        self.assertIn('Session 2: Thu, 24 Sept 2026', text)
        _, change_html, change_text = render_change_email('Module', rows, [session(), session(2, '2026-09-23T11:00:00Z')],
                                                          'Europe/London', session_titles={2: 'Pricing workshop'})
        self.assertIn('Pricing workshop', change_html)
        self.assertIn('Pricing workshop: was Thu, 24 Sept 2026', change_text)

    def test_no_subject_carries_an_internal_copy_label(self):
        """An organiser's subject reads like anyone else's: the label is internal.

        The organiser copy stays a separate message with its own roster and
        settings; only the subject line stops announcing which copy it is, on
        every path that builds one -- a new schedule, a change, a cancelled
        session and a cancelled calendar.
        """
        rows = [session(), session(2, '2026-09-24T11:00:00Z')]
        roster = [('Learner One', 'one@example.invalid')]
        settings = [('Time zone', 'Europe/London')]
        pairs = [
            (render_schedule_email('Module', rows, 'Europe/London'),
             render_schedule_email('Module', rows, 'Europe/London', roster=roster, settings=settings)),
            (render_change_email('Module', rows, [session(), session(2, '2026-09-25T11:00:00Z')], 'Europe/London'),
             render_change_email('Module', rows, [session(), session(2, '2026-09-25T11:00:00Z')], 'Europe/London', roster=roster)),
            (render_change_email('Module', rows, [session()], 'Europe/London'),
             render_change_email('Module', rows, [session()], 'Europe/London', roster=roster)),
            (render_change_email('Module', rows, [], 'Europe/London'),
             render_change_email('Module', rows, [], 'Europe/London', roster=roster)),
        ]
        for (learner_subject, _lh, _lt), (organiser_subject, organiser_html, _ot) in pairs:
            for label in ('organiser copy', 'organizer copy', 'admin copy', 'internal copy', '('):
                self.assertNotIn(label, organiser_subject.lower())
            self.assertEqual(organiser_subject, learner_subject)
            # The copy itself is unchanged: it still carries the roster.
            self.assertIn('Invited learners', organiser_html)
        self.assertEqual(pairs[0][0][0], 'Module — your session schedule')
        self.assertEqual(pairs[1][0][0], 'Module — your session schedule has changed')
        self.assertEqual(pairs[2][0][0], 'Module — session cancelled')

    def test_session_titles_come_from_the_components_attached_to_this_calendar(self):
        rows = [{**session(), 'id': 'OCC-1'}, {**session(2, '2026-09-24T11:00:00Z'), 'id': 'OCC-2'}]
        components = [
            {'title': ' Kick-off ', 'settings': {'teamsOccurrenceId': 'OCC-1', 'teamsLiveSessionId': 'LIVE-ONE', 'teamsSessionNumber': 1}},
            {'title': 'Other calendar', 'settings': {'teamsLiveSessionId': 'LIVE-TWO', 'teamsSessionNumber': 2}},
            {'title': 'Week two', 'settings': {'teamsLiveSessionId': 'LIVE-ONE', 'teamsSessionNumber': 2}},
        ]
        view = types.SimpleNamespace(
            AUTHORING_COMPONENTS_TABLE='components', active_component_rows=lambda value: value,
            authoring_fetch_all=Mock(return_value=components), component_builder_settings=lambda row: row['settings'],
            parse_int=lambda value, default: int(value) if value else default)
        titles = service['session_titles'](view, 'LIVE-ONE', {'module_catalogue_id': 'MOD-1'}, rows)
        self.assertEqual(titles, {1: 'Kick-off', 2: 'Week two'})
        self.assertFalse(view.authoring_fetch_all.call_args.kwargs['ensure_tables'])
        self.assertEqual(service['session_titles'](view, 'LIVE-ONE', {}, rows), {})
        view.authoring_fetch_all.side_effect = RuntimeError('database unavailable')
        self.assertEqual(service['session_titles'](view, 'LIVE-ONE', {'module_catalogue_id': 'MOD-1'}, rows), {})

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

    def test_added_people_only_narrow_the_stored_recipients(self):
        learners, organisers = service['added_only'](
            ['one@example.invalid', 'two@example.invalid'], ['organizer@example.invalid', 'tutor@example.invalid'],
            [' TWO@example.invalid', 'tutor@example.invalid', 'stranger@example.invalid'])
        # A browser-supplied address the calendar does not invite is never emailed.
        self.assertEqual(learners, ['two@example.invalid'])
        self.assertEqual(organisers, ['tutor@example.invalid'])

    def test_added_people_skip_anyone_this_schedule_already_reached(self):
        self.ledger.rows[('LIVE-ONE', 'one@example.invalid')] = 'accepted'
        learners, organisers = service['added_only'](['one@example.invalid', 'two@example.invalid'], ['tutor@example.invalid'],
                                                     ['one@example.invalid', 'two@example.invalid', 'tutor@example.invalid'])
        status = service['dispatch_by_role']('LIVE-ONE', learners, organisers, 'learner', 'organiser', self.ledger, self.sender)
        self.assertEqual(sorted(call.args for call in self.sender.call_args_list),
                         [('tutor@example.invalid', 'organiser'), ('two@example.invalid', 'learner')])
        self.assertEqual(status['status'], 'complete')

    def test_nobody_added_sends_nothing_and_reports_complete(self):
        status = service['dispatch_by_role']('LIVE-ONE', *service['added_only'](['one@example.invalid'], [], []),
                                             'learner', 'organiser', self.ledger, self.sender)
        self.sender.assert_not_called()
        self.assertEqual((status['total'], status['status']), (0, 'complete'))

    def test_added_people_must_be_a_list_of_addresses_and_never_ride_with_a_change_notice(self):
        for body in ({'addedPeople': 'one@example.invalid'}, {'addedPeople': [1]}, {'addedPeople': ['a@example.invalid'] * 501},
                     {'addedPeople': ['one@example.invalid'], 'changeNotice': 'token'}):
            view = types.SimpleNamespace(json_body=lambda _, body=body: body)
            with patch.dict(sys.modules, {'curriculum_api.views': view}):
                request = types.SimpleNamespace(account=types.SimpleNamespace(role='staff'), method='POST')
                self.assertEqual(service['schedule_email'](request, 'LIVE-ONE').status_code, 400, body)

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
                  graph_timezone_iana=lambda settings: settings.get('_schedule_timezone_iana') or 'Europe/London', json_body=lambda _: {},
                  teams_schedule_settings=lambda settings, series=None: {**settings, '_schedule_timezone_iana': {'Egypt Standard Time': 'Africa/Cairo'}.get((series or {}).get('timezone'))} if (series or {}).get('timezone') else settings)
        graph = Mock()
        transport = types.SimpleNamespace(get_graph_settings=lambda: {}, microsoft_graph_request=graph)
        verify = Mock(return_value={'attendees': [{'emailAddress': {'address': 'one@example.invalid'}}]})
        return rows, series, view, transport, verify

    def test_saved_dates_are_verified_before_rendered_message_is_used(self):
        rows, series, view, transport, verify = self.verified_context()
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport}), patch.dict(service, {'verify_calendar': verify}):
            recipients, organisers, message, _organiser_copy = service['verified_message']('LIVE-ONE')
        self.assertEqual(recipients, ['one@example.invalid'])
        # The presenting tutor gets the organiser copy, never the learner copy.
        self.assertEqual(organisers, ['organizer@example.invalid', 'tutor@example.invalid'])
        self.assertIn('29 Oct 2026', message[1])
        self.assertNotIn('tutor@example.invalid', message[1])
        self.assertEqual(verify.call_args.args[2], 'MASTER')
        self.assertEqual(verify.call_args.args[3][1]['start'], utc_datetime(rows[1]['scheduled_start']))
        for call in view.authoring_fetch_all.call_args_list:
            self.assertFalse(call.kwargs['ensure_tables'])
            self.assertIn('LIVE-ONE', call.args[2])
        transport.microsoft_graph_request.assert_not_called()

    def test_email_prints_times_in_the_calendars_own_zone(self):
        # 29 Oct 2026 06:00 UTC is 09:00 in Cairo (still summer time) but 06:00 in London.
        rows, series, view, transport, verify = self.verified_context()
        rows[:] = [session(start='2026-10-29T06:00:00Z')]
        series['timezone'] = 'Egypt Standard Time'
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport}), patch.dict(service, {'verify_calendar': verify}):
            _recipients, _organisers, message, organiser_copy = service['verified_message']('LIVE-ONE')
        self.assertIn('09:00 AM', message[1])
        self.assertNotIn('06:00 AM', message[1])
        self.assertIn('Africa/Cairo', organiser_copy[1])
        series.pop('timezone')
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport}), patch.dict(service, {'verify_calendar': verify}):
            _recipients, _organisers, message, _copy = service['verified_message']('LIVE-ONE')
        self.assertIn('06:00 AM', message[1])

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
                self.assertEqual(response['accepted'], 3)
        self.assertEqual(self.sender.call_count, 3)

    def create_context(self):
        rows, series, view, transport, verify = self.verified_context()
        # The organiser is also listed as a co-organiser, and a co-organiser is also on the attendee list.
        series.update({'attendees': ['one@example.invalid', 'two@example.invalid', 'tutor@example.invalid', 'co@example.invalid'],
                       'co_organizers': ['co@example.invalid', 'organizer@example.invalid'],
                       'recording': 'record-transcribe', 'lobby_bypass': 'organization'})
        verify.return_value = {'attendees': [{'emailAddress': {'address': a}} for a in ('one@example.invalid', 'two@example.invalid')]}
        return series, view, transport, verify

    def send_create(self, ledger, sender, verify=None, retry=False):
        series, view, transport, default_verify = self.create_context()
        view.json_body = lambda _: {'retryFailed': retry}
        mail = types.SimpleNamespace(is_configured=lambda: True)
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport, 'login': types.SimpleNamespace(email_azure=mail)}), patch.dict(service, {
            'verify_calendar': verify or default_verify, 'connection': object(), 'DeliveryLedger': lambda _: ledger, '_send_message': sender,
            'learner_names': lambda emails: {'one@example.invalid': 'Learner One', 'two@example.invalid': 'Learner Two'},
        }):
            request = types.SimpleNamespace(account=types.SimpleNamespace(role='staff'), method='POST')
            return service['schedule_email'](request, 'LIVE-ONE')

    def test_create_sends_learner_copies_and_organiser_copies_once_each(self):
        response = self.send_create(self.ledger, self.sender)
        self.assertEqual(response.status_code, 200)
        # Five recipients are two batches of at most four; the browser asks again while any are queued.
        self.assertEqual(response['queued'], 1)
        response = self.send_create(self.ledger, self.sender)
        copies = {call.args[0]: call.args[1] for call in self.sender.call_args_list}
        # The presenting tutor gets the organiser copy; the organiser listed twice gets one.
        self.assertEqual(sorted(copies), ['co@example.invalid', 'one@example.invalid', 'organizer@example.invalid', 'tutor@example.invalid', 'two@example.invalid'])
        self.assertEqual(self.sender.call_count, 5)
        self.assertEqual(response['total'], 5)
        for learner, other in (('one@example.invalid', 'two@example.invalid'), ('two@example.invalid', 'one@example.invalid')):
            subject, html, text = copies[learner]
            self.assertNotIn('organiser copy', subject)
            for private in (other, 'Learner One', 'Learner Two', 'co@example.invalid', 'tutor@example.invalid'):
                self.assertNotIn(private, html + text)
            self.assertNotIn('Invited learners', html)
            self.assertNotIn('Meeting settings', html)
            self.assertIn('29 Oct 2026', html)
            self.assertIn('teams.microsoft.com/meet/synthetic', html)
        for organiser in ('organizer@example.invalid', 'co@example.invalid', 'tutor@example.invalid'):
            subject, html, text = copies[organiser]
            # The inbox never shows an internal label: the organiser's subject is the
            # learner's, word for word. Only the content tells the two copies apart.
            self.assertNotIn('organiser copy', subject)
            self.assertEqual(subject, copies['one@example.invalid'][0])
            for learner in ('Learner One', 'one@example.invalid', 'Learner Two', 'two@example.invalid'):
                self.assertIn(learner, html)
                self.assertIn(learner, text)
            self.assertNotIn('tutor@example.invalid', html.split('Invited learners')[1])
            self.assertIn('Record and transcribe', html)
            self.assertIn('People in my organization', html)
            self.assertIn('Europe/London', html)
            self.assertIn('29 Oct 2026', html)
            self.assertIn('teams.microsoft.com/meet/synthetic', html)
            self.assertNotIn('[[', html)

    def test_create_retry_does_not_resend_accepted_emails(self):
        failing = Mock(side_effect=lambda recipient, _m: ('failed', 'mail_rejected_400') if recipient == 'co@example.invalid' else ('accepted', ''))
        first = self.send_create(self.ledger, failing)
        self.assertEqual((first['accepted'], first['failed'], first['queued']), (3, 1, 1))
        again = self.send_create(self.ledger, failing)
        self.assertEqual(failing.call_count, 5)
        self.assertEqual(again['failed'], 1)
        retry = Mock(return_value=('accepted', ''))
        final = self.send_create(self.ledger, retry, retry=True)
        self.assertEqual([call.args[0] for call in retry.call_args_list], ['co@example.invalid'])
        self.assertNotIn('organiser copy', retry.call_args.args[1][0])
        self.assertIn('Invited learners', retry.call_args.args[1][1])
        self.assertEqual(final['status'], 'complete')

    def test_create_failed_verification_sends_no_email_to_anyone(self):
        response = self.send_create(self.ledger, self.sender, verify=Mock(side_effect=ValueError('Date mismatch')))
        self.assertEqual(response.status_code, 409)
        self.sender.assert_not_called()
        self.assertFalse(self.ledger.rows)

    def test_parallel_batches_claim_before_sending_and_never_resend(self):
        self.recipients = [f'learner{i}@example.invalid' for i in range(7)]
        threads = set()
        states_seen = []

        def send(recipient, _message):
            threads.add(threading.get_ident())
            states_seen.append(self.ledger.rows[('LIVE-ONE', recipient)])
            return ('failed', 'mail_rejected_429') if recipient == 'learner2@example.invalid' else ('accepted', '')

        self.sender.side_effect = send
        first = self.dispatch(parallel=True)
        self.assertEqual((first['accepted'], first['failed'], first['queued']), (3, 1, 3))
        second = self.dispatch(parallel=True)
        self.assertEqual((second['accepted'], second['failed'], second['queued']), (6, 1, 0))
        self.dispatch(parallel=True)
        # Every mail went out under a committed claim, once, off the request thread.
        self.assertEqual(states_seen, ['sending'] * 7)
        self.assertEqual(self.sender.call_count, 7)
        self.assertNotIn(threading.get_ident(), threads)

    def test_parallel_send_that_raises_stays_uncertain_and_is_never_repeated(self):
        self.sender.side_effect = TimeoutError()
        self.assertEqual(self.dispatch(parallel=True)['uncertain'], 2)
        self.dispatch(parallel=True, retry_failed=True)
        self.assertEqual(self.sender.call_count, 2)

    def creation_emails(self, sender, verify=None, configured=True):
        series, view, transport, default_verify = self.create_context()
        series['attendees'] = [f'learner{i}@example.invalid' for i in range(9)]
        (verify or default_verify).return_value = {'attendees': [{'emailAddress': {'address': a}} for a in series['attendees']]}
        mail = types.SimpleNamespace(is_configured=lambda: configured)
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport, 'login': types.SimpleNamespace(email_azure=mail)}), patch.dict(service, {
            'verify_calendar': verify or default_verify, 'learner_names': lambda emails: {},
        }):
            return service['send_creation_emails']('LIVE-ONE', ledger=self.ledger, send=sender)

    def test_create_sends_every_schedule_email_in_one_call(self):
        status = self.creation_emails(self.sender)
        # Nine learners plus the organiser, one co-organiser and one presenter: more than two batches.
        self.assertEqual((status['total'], status['accepted'], status['queued'], status['status']), (12, 12, 0, 'complete'))
        self.assertEqual(self.sender.call_count, 12)
        self.assertEqual(len({call.args[0] for call in self.sender.call_args_list}), 12)
        # A browser asking afterwards only reads back what was sent.
        again = self.creation_emails(self.sender)
        self.assertEqual(again['accepted'], 12)
        self.assertEqual(self.sender.call_count, 12)

    def test_create_emails_stop_on_a_batch_without_progress(self):
        self.ledger.claim = Mock(return_value=False)
        status = self.creation_emails(self.sender)
        self.assertEqual(status['queued'], 12)
        self.sender.assert_not_called()

    def test_create_emails_are_reported_not_raised_when_blocked(self):
        blocked = self.creation_emails(self.sender, verify=Mock(side_effect=ValueError('Microsoft has not confirmed every learner invitation yet.')))
        self.assertEqual(blocked['code'], 'schedule_email_blocked')
        self.assertIn('every learner', blocked['error'])
        self.assertEqual(self.creation_emails(self.sender, configured=False)['code'], 'schedule_email_not_configured')
        self.ledger.check = Mock(side_effect=RuntimeError('not provisioned'))
        self.assertEqual(self.creation_emails(self.sender)['code'], 'schedule_email_blocked')
        self.sender.assert_not_called()
        self.assertFalse(self.ledger.rows)

    def test_recipient_roles_come_from_the_stored_calendar(self):
        series, view, _transport, _verify = self.create_context()
        learners = service['learner_recipients'](view, series)
        self.assertEqual(learners, ['one@example.invalid', 'two@example.invalid'])
        self.assertEqual(service['organiser_recipients'](view, series, learners),
                         ['organizer@example.invalid', 'co@example.invalid', 'tutor@example.invalid'])
        # An address that is somehow both never receives the roster copy.
        self.assertEqual(service['organiser_recipients'](view, series, ['organizer@example.invalid', 'tutor@example.invalid']),
                         ['co@example.invalid'])

    def test_meeting_settings_labels_fall_back_to_saved_values(self):
        self.assertEqual(dict(meeting_settings({'organizer_email': 'o@example.invalid'}, 'Europe/London')),
                         {'Time zone': 'Europe/London', 'Organizer': 'o@example.invalid', 'Recording': 'Do not start automatically',
                          'Lobby bypass': 'People invited to this meeting', 'Language': 'English (UK)'})
        self.assertEqual(dict(meeting_settings({'spoken_language': 'de-DE'}, 'UTC'))['Language'], 'de-DE')


class ChangeNoticeTests(unittest.TestCase):
    """Update and cancellation emails: was/now, one copy per audience, no cross-learner data."""

    @classmethod
    def setUpClass(cls):
        from django.conf import settings
        if not settings.configured:
            settings.configure(SECRET_KEY='synthetic-test-key')
        from curriculum_api import teams_schedule_notice
        cls.notices = teams_schedule_notice

    def setUp(self):
        self.network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def snapshot(self, *rows):
        return self.notices.schedule_snapshot(rows)

    def test_learner_copy_says_was_and_now_and_names_nobody(self):
        before = [session(), session(2, '2026-09-24T11:00:00Z')]
        after = [session(), session(2, '2026-09-23T11:00:00Z')]
        subject, html, text = render_change_email('Module', before, after, 'Europe/London')
        self.assertIn('has changed', subject)
        self.assertIn('Was', html)
        self.assertIn('Thu, 24 Sept 2026, 12:00 PM', html)
        self.assertIn('Wed, 23 Sept 2026, 12:00 PM', html)
        self.assertIn('Your updated schedule', html)
        self.assertIn('SESSION 02', html)
        self.assertNotIn('Invited learners', html)
        self.assertNotIn('example.invalid', html)
        self.assertIn('was Thu, 24 Sept 2026', text)
        self.assertNotIn('[[', html)

    def test_a_session_added_in_front_is_one_addition_not_a_run_of_moves(self):
        # Teams held 17 and 24 Sept and 8 Oct as sessions 1-3; 1 Oct is added, so
        # the stored rows are renumbered around it without moving.
        before = [session(1, '2026-09-17T06:00:00Z'), session(2, '2026-09-24T06:00:00Z'), session(3, '2026-10-08T06:00:00Z')]
        after = [session(1, '2026-09-17T06:00:00Z'), session(2, '2026-09-24T06:00:00Z'),
                 session(3, '2026-10-01T06:00:00Z'), session(4, '2026-10-08T06:00:00Z')]
        _subject, html, text = render_change_email('Module', before, after, 'Europe/London')
        self.assertIn('Session 3: new session on Thu, 01 Oct 2026', text)
        self.assertNotIn('was ', text.split('Your updated schedule')[0])
        self.assertNotIn('Was</span>', html)
        self.assertIn('one session has changed', html)

    def test_organiser_copy_lists_the_invited_learners(self):
        before, after = [session()], [session(start='2026-09-18T11:00:00Z')]
        subject, html, text = render_change_email('Module', before, after, 'Europe/London',
                                                  roster=[('Ada <b>', 'one@example.invalid'), ('', 'two@example.invalid')])
        self.assertNotIn('organiser copy', subject)
        self.assertEqual(subject, render_change_email('Module', before, after, 'Europe/London')[0])
        self.assertIn('Invited learners', html)
        self.assertIn('Ada &lt;b&gt;', html)
        self.assertIn('two@example.invalid', html)
        self.assertIn('Ada <b> <one@example.invalid>', text)

    def test_cancelled_session_and_cancelled_calendar(self):
        before = [session(), session(2, '2026-09-24T11:00:00Z')]
        subject, html, _ = render_change_email('Module', before, [session()], 'Europe/London')
        self.assertIn('session cancelled', subject)
        self.assertIn('Cancelled', html)
        self.assertIn('Join your Teams session', html)
        subject, html, _ = render_change_email('Module', before, [], 'Europe/London')
        self.assertIn('sessions cancelled', subject)
        self.assertIn('are cancelled', html)
        self.assertNotIn('Join your Teams session', html)
        self.assertNotIn('Your updated schedule', html)
        self.assertNotIn('[[', html)

    def test_nothing_changed_still_carries_a_notice_to_email_with(self):
        """Ticking "email attendees" is an instruction, even on a save that moved nothing.

        A "was / now" is still refused, because with nothing in either column it
        says nothing -- `verified_change_messages` sends the standing schedule
        instead. What must not happen is the author being handed no token at
        all and told afterwards that nothing was sent.
        """
        with self.assertRaises(ValueError):
            render_change_email('Module', [session()], [session()], 'Europe/London')
        same = self.snapshot(session())
        token = self.notices.issue_change_notice('LIVE-ONE', same, same)
        self.assertTrue(token)
        notice = self.notices.read_change_notice(token, 'LIVE-ONE')
        self.assertEqual(notice['before'], notice['after'])
        # Still nothing to email about when there is no calendar to email about.
        self.assertEqual(self.notices.issue_change_notice('', same, same), '')

    def test_notice_is_signed_and_bound_to_its_calendar(self):
        token = self.notices.issue_change_notice('LIVE-ONE', self.snapshot(session()), self.snapshot(session(start='2026-09-18T11:00:00Z')))
        self.assertEqual(self.notices.read_change_notice(token, 'LIVE-ONE')['liveId'], 'LIVE-ONE')
        with self.assertRaises(ValueError):
            self.notices.read_change_notice(token, 'LIVE-TWO')
        with self.assertRaises(ValueError):
            self.notices.read_change_notice(token[:-2] + 'xx', 'LIVE-ONE')
        stable = self.notices.issue_change_notice('LIVE-ONE', self.snapshot(session()), [], notice_id='OPERATION-1')
        self.assertEqual(self.notices.read_change_notice(stable, 'LIVE-ONE')['id'], 'OPERATION-1')

    def change_context(self, stored_rows, status='active'):
        series = {'id': 'LIVE-ONE', 'status': status, 'warnings': [], 'module_title': 'Saved module',
                  'attendees': ['one@example.invalid', 'two@example.invalid', 'tutor@example.invalid', 'co@example.invalid'],
                  'presenters': ['tutor@example.invalid'], 'co_organizers': ['co@example.invalid'],
                  'organizer_email': 'organizer@example.invalid', 'graph_event_id': 'MASTER',
                  'join_url': session()['join_url'], 'repeat_pattern': 'weekly'}
        fetch = Mock(side_effect=lambda table, *args, **kwargs: [series] if table == 'series' else stored_rows)
        view = types.SimpleNamespace(authoring_fetch_all=fetch, LIVE_SESSIONS_TABLE='series', LIVE_SESSION_OCCURRENCES_TABLE='occurrences',
                  parse_json_value=lambda value, default: value or default,
                  teams_series_email_list=lambda *values: list(dict.fromkeys(item for value in values if value for item in value)),
                  teams_attendee_emails=lambda value: value, stored_calendar_series=lambda _: [],
                  graph_timezone_iana=lambda settings: settings.get('_schedule_timezone_iana') or 'Europe/London', json_body=lambda _: {},
                  teams_schedule_settings=lambda settings, series=None: {**settings, '_schedule_timezone_iana': {'Egypt Standard Time': 'Africa/Cairo'}.get((series or {}).get('timezone'))} if (series or {}).get('timezone') else settings)
        transport = types.SimpleNamespace(get_graph_settings=lambda: {}, microsoft_graph_request=Mock())
        verify = Mock(return_value={'attendees': [{'emailAddress': {'address': a}} for a in ('one@example.invalid', 'two@example.invalid')]})
        return view, transport, verify

    def send_change(self, token, stored_rows, ledger, sender, status='active'):
        view, transport, verify = self.change_context(stored_rows, status)
        names = {'learner_names': lambda emails: {'one@example.invalid': 'Learner One'}}
        with patch.dict(sys.modules, {'curriculum_api.views': view, 'coach_api.views': transport}), \
                patch.dict(service, {'verify_calendar': verify, **names}):
            return service['dispatch_change']('LIVE-ONE', token, ledger, send=sender), verify

    def test_each_learner_gets_their_own_copy_and_organisers_get_the_roster(self):
        before = [session(), session(2, '2026-09-24T11:00:00Z')]
        after = [session(), session(2, '2026-09-23T11:00:00Z')]
        token = self.notices.issue_change_notice('LIVE-ONE', self.snapshot(*before), self.snapshot(*after))
        ledger, sender = MemoryLedger(), Mock(return_value=('accepted', ''))
        # The creation email already reached this learner; the change must still go out.
        ledger.rows[('LIVE-ONE', 'one@example.invalid')] = 'accepted'
        result, _verify = self.send_change(token, after, ledger, sender)
        # Five recipients are two batches of at most four; the browser asks again while any are queued.
        self.assertEqual((result['total'], result['queued']), (5, 1))
        result, verify = self.send_change(token, after, ledger, sender)
        self.assertEqual((result['accepted'], result['queued']), (5, 0))
        verify.assert_called_once()
        copies = {call.args[0]: call.args[1] for call in sender.call_args_list}
        self.assertEqual(set(copies), {'one@example.invalid', 'two@example.invalid', 'organizer@example.invalid', 'co@example.invalid', 'tutor@example.invalid'})
        for learner, other in (('one@example.invalid', 'two@example.invalid'), ('two@example.invalid', 'one@example.invalid')):
            html = copies[learner][1]
            self.assertNotIn(other, html)
            self.assertNotIn('Learner One', html)
            self.assertNotIn('Invited learners', html)
            self.assertIn('Wed, 23 Sept 2026', html)
        for organiser in ('organizer@example.invalid', 'co@example.invalid', 'tutor@example.invalid'):
            html = copies[organiser][1]
            self.assertIn('Learner One', html)
            self.assertIn('two@example.invalid', html)
            self.assertIn('Thu, 24 Sept 2026', html)
        # Asking again about the same change sends nothing twice.
        self.send_change(token, after, ledger, sender)
        self.assertEqual(sender.call_count, 5)

    def test_stale_notice_sends_nothing(self):
        token = self.notices.issue_change_notice('LIVE-ONE', self.snapshot(session()), self.snapshot(session(start='2026-09-18T11:00:00Z')))
        ledger, sender = MemoryLedger(), Mock(return_value=('accepted', ''))
        with self.assertRaisesRegex(ValueError, 'changed again'):
            self.send_change(token, [session(start='2026-09-25T11:00:00Z')], ledger, sender)
        sender.assert_not_called()
        self.assertFalse(ledger.rows)

    def test_cancelled_calendar_is_told_without_a_join_link(self):
        before = [session(), session(2, '2026-09-24T11:00:00Z')]
        token = self.notices.issue_change_notice('LIVE-ONE', self.snapshot(*before), [], notice_id='OP-1')
        ledger, sender = MemoryLedger(), Mock(return_value=('accepted', ''))
        result, verify = self.send_change(token, before, ledger, sender, status='cancelled')
        self.assertEqual(result['accepted'], 4)
        verify.assert_not_called()
        learner_html = next(call.args[1][1] for call in sender.call_args_list if call.args[0] == 'one@example.invalid')
        self.assertIn('are cancelled', learner_html)
        self.assertNotIn('teams.microsoft.com', learner_html)
        self.assertNotIn('two@example.invalid', learner_html)
        for organiser in ('organizer@example.invalid', 'co@example.invalid'):
            subject, html, _text = next(call.args[1] for call in sender.call_args_list if call.args[0] == organiser)
            self.assertNotIn('organiser copy', subject)
            self.assertEqual(subject, next(call.args[1][0] for call in sender.call_args_list if call.args[0] == 'one@example.invalid'))
            self.assertIn('Learner One', html)
            self.assertIn('two@example.invalid', html)
            self.assertIn('Thu, 24 Sept 2026', html)
            self.assertNotIn('teams.microsoft.com', html)
        self.assertTrue(all(key == 'LIVE-ONE#OP-1' for key, _ in ledger.rows))

    def test_cancelled_session_keeps_the_remaining_schedule_and_link(self):
        before = [session(), session(2, '2026-09-24T11:00:00Z')]
        token = self.notices.issue_change_notice('LIVE-ONE', self.snapshot(*before), self.snapshot(session()), notice_id='OP-2')
        ledger, sender = MemoryLedger(), Mock(return_value=('accepted', ''))
        result, verify = self.send_change(token, [session()], ledger, sender)
        self.assertEqual(result['accepted'], 4)
        verify.assert_called_once()
        copies = {call.args[0]: call.args[1] for call in sender.call_args_list}
        subject, html, _text = copies['one@example.invalid']
        self.assertIn('session cancelled', subject)
        self.assertIn('Cancelled', html)
        self.assertIn('Thu, 24 Sept 2026', html)
        self.assertIn('Your updated schedule', html)
        self.assertIn('Join your Teams session', html)
        self.assertNotIn('two@example.invalid', html)
        self.assertNotIn('Invited learners', html)
        subject, html, _text = copies['co@example.invalid']
        self.assertNotIn('organiser copy', subject)
        self.assertEqual(subject, copies['one@example.invalid'][0])
        self.assertIn('Invited learners', html)
        self.assertIn('two@example.invalid', html)
        self.assertIn('Join your Teams session', html)
        # Checking the same action's status again hands out the same notice id: the
        # second batch reaches only the presenter still queued, and nobody twice.
        again = self.notices.issue_change_notice('LIVE-ONE', self.snapshot(*before), self.snapshot(session()), notice_id='OP-2')
        self.send_change(again, [session()], ledger, sender)
        self.send_change(again, [session()], ledger, sender)
        self.assertEqual(sender.call_count, 5)
        self.assertEqual(len({call.args[0] for call in sender.call_args_list}), 5)

    def test_edit_session_action_issues_a_notice_only_once_microsoft_confirmed_it(self):
        before = self.snapshot(session(), session(2, '2026-09-24T11:00:00Z'))
        moved = [session(), session(2, '2026-09-25T11:00:00Z')]
        state = {'status': 'processing', 'id': 'OP-9', 'before': before}
        ns = {'__package__': 'curriculum_api',
              'load_calendar_state': lambda _live: ({'status': 'active'}, moved, {'management': dict(state)})}
        definitions(ROOT / 'teams_calendar_actions.py', ns, {'with_change_notice'})
        # A pending Microsoft action is not a change anyone is told about.
        self.assertNotIn('changeNotice', ns['with_change_notice']('LIVE-ONE', {'status': 'pending'}))
        self.assertNotIn('changeNotice', ns['with_change_notice']('LIVE-ONE', {'status': 'done'}))
        state['status'] = 'done'
        first = ns['with_change_notice']('LIVE-ONE', {'status': 'done'})['changeNotice']
        second = ns['with_change_notice']('LIVE-ONE', {'status': 'done'})['changeNotice']
        notice = self.notices.read_change_notice(first, 'LIVE-ONE')
        self.assertEqual(notice['id'], 'OP-9')
        self.assertEqual(self.notices.read_change_notice(second, 'LIVE-ONE')['id'], 'OP-9')
        # Only session 2 moved; session 1 keeps its date in the notice.
        self.assertEqual([item['start'] for item in notice['after']], [item['start'] for item in self.snapshot(*moved)])
        self.assertEqual(notice['before'][0], notice['after'][0])

    def test_endpoint_accepts_only_a_string_notice(self):
        view = types.SimpleNamespace(json_body=lambda _: {'changeNotice': ['not', 'a', 'token']})
        with patch.dict(sys.modules, {'curriculum_api.views': view}):
            request = types.SimpleNamespace(account=types.SimpleNamespace(role='admin'), method='POST')
            self.assertEqual(service['schedule_email'](request, 'LIVE-ONE').status_code, 400)


class CancelledSessionVerificationTests(unittest.TestCase):
    """A cancellation email must survive the calendar a cancellation leaves behind.

    The rows handed here are the sessions still standing, so a meeting whose
    sessions were all cancelled has none of them. Reading that as a broken
    manifest, and reading a part-cancelled weekly meeting as a single event,
    both blocked the very email the cancellation was supposed to send.
    """

    def setUp(self):
        self.manifest = [{'eventId': 'mon-master', 'joinUrl': 'https://teams.microsoft.com/mon',
                          'sessionNumbers': [1, 3, 5]},
                         {'eventId': 'wed-master', 'joinUrl': 'https://teams.microsoft.com/wed',
                          'sessionNumbers': [2, 4]}]
        self.series = {'organizer_email': 'organizer@example.invalid', 'repeat_pattern': 'weekly'}
        self.checked = []
        self.v = types.SimpleNamespace(stored_calendar_series=lambda _series: self.manifest)
        self.ns = {'quote': quote, 'utc_datetime': utc_datetime, 'verify_calendar': Mock(side_effect=self.verify)}
        definitions(ROOT / 'teams_schedule_delivery.py', self.ns, ['verify_saved_calendar'])
        graph = types.ModuleType('coach_api.views')
        graph.microsoft_graph_request = Mock()
        modules = patch.dict(sys.modules, {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': graph})
        modules.start()
        self.addCleanup(modules.stop)

    def verify(self, _request, _owner, event_id, targets, _link, recurring):
        self.checked.append((event_id, [target['session_number'] for target in targets], recurring))
        return {'attendees': [{'emailAddress': {'address': 'learner@example.invalid'}}]}

    def rows(self, numbers):
        links = {number: item['joinUrl'] for item in self.manifest for number in item['sessionNumbers']}
        return [{'session_number': number, 'join_url': links[number],
                 'scheduled_start': f'2026-10-{5 + number:02}T09:00:00Z',
                 'scheduled_end': f'2026-10-{5 + number:02}T11:00:00Z'} for number in numbers]

    def run_check(self, numbers):
        self.ns['verify_saved_calendar'](self.v, self.series, self.rows(numbers), ['learner@example.invalid'])

    def test_a_whole_meeting_cancelled_is_not_an_inconsistent_manifest(self):
        self.run_check([1, 3, 5])
        self.assertEqual([event for event, *_ in self.checked], ['mon-master'])

    def test_a_part_cancelled_series_is_still_read_as_a_series(self):
        # One Monday session left of three. Read from the survivors, this was
        # verified as a single event and never matched its own master.
        self.run_check([5, 2, 4])
        self.assertEqual(self.checked, [('mon-master', [5], True), ('wed-master', [2, 4], True)])

    def test_a_genuinely_mismatched_link_is_still_refused(self):
        rows = self.rows([1, 3, 5])
        rows[1]['join_url'] = 'https://teams.microsoft.com/wed'
        with self.assertRaisesRegex(ValueError, 'inconsistent'):
            self.ns['verify_saved_calendar'](self.v, self.series, rows, ['learner@example.invalid'])

    def test_an_uninvited_learner_still_blocks_the_email(self):
        with self.assertRaisesRegex(ValueError, 'invitation'):
            self.ns['verify_saved_calendar'](self.v, self.series, self.rows([1, 3, 5]), ['other@example.invalid'])

    def test_a_single_meeting_calendar_keeps_its_repeat_pattern(self):
        self.manifest = []
        self.v.stored_calendar_series = lambda _series: []
        self.series['graph_event_id'], self.series['join_url'] = 'solo', 'https://teams.microsoft.com/solo'
        self.series['repeat_pattern'] = 'none'
        rows = [{'session_number': 1, 'join_url': 'https://teams.microsoft.com/solo',
                 'scheduled_start': '2026-10-06T09:00:00Z', 'scheduled_end': '2026-10-06T11:00:00Z'}]
        self.ns['verify_saved_calendar'](self.v, self.series, rows, ['learner@example.invalid'])
        self.assertEqual(self.checked, [('solo', [1], False)])


if __name__ == '__main__':
    unittest.main()
