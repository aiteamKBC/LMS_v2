"""Calendar management regressions. AST-only service loading; no Django setup or DB.

Run directly with Python. Every external transport and storage boundary is mocked;
the fixture rejects socket connections, including accidental Graph/DB access.
"""
import copy
import functools
import hashlib
import json
import re
import sys
import types
import uuid
from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch
from urllib.parse import quote, urlencode, unquote
from zoneinfo import ZoneInfo
import unittest

from test_calendar_state_no_db import CalendarFixture, ROOT, Response, functions, package
from curriculum_api.session_overrides import (
    apply_session_overrides, override_clock, schedule_override, session_overrides, validate_exception_plan,
)
from curriculum_api.teams_cancellation_checks import CalendarStateError, cancellation_plan
from curriculum_api.teams_calendar_checks import utc_datetime, event_instant


class Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 9, 16, 12, tzinfo=timezone.utc).astimezone(tz) if tz else datetime(2026, 9, 16, 12)


class TransportError(Exception):
    pass


class ActionNotSent(CalendarStateError):
    pass


class ManagementTests(CalendarFixture):
    def setUp(self):
        super().setUp()
        self.series.update(module_catalogue_id='MODULE-1', module_title='Synthetic module', timezone='GMT Standard Time')
        for item in self.instances:
            item['onlineMeeting'] = self.master['onlineMeeting']
        self.module = {'module_catalogue_id': 'MODULE-1', 'session_overrides': {}, 'sessions_number': 2}
        self.base_plan = {'sessions': [dict(sessionNumber=row['session_number'], date=row['scheduled_start'][:10],
            startTime='09:00', endTime='11:00', durationMinutes=120) for row in self.rows], 'slots': []}
        self.v = types.SimpleNamespace(graph_timezone_iana=lambda _: 'Europe/London',
            module_stored_session_count=lambda m: 2,
            module_session_plan_for_count=lambda m, _: apply_session_overrides(copy.deepcopy(self.base_plan), m),
            module_schedule_view=lambda m: m, find_tutor_schedule_conflicts=Mock(return_value=[]),
            module_cohort_selected_holidays=Mock(return_value=[]), parse_json_value=lambda value, fallback: value or fallback,
            holiday_date_set=lambda items: {datetime.fromisoformat(item).date() for item in items})
        self.previous_views = getattr(package, 'views', None)
        package.views = self.v
        self.addCleanup(lambda: setattr(package, 'views', self.previous_views))
        self.tokens = {}
        def sign(operation, **_):
            token = uuid.uuid4().hex
            self.tokens[token] = copy.deepcopy(operation)
            return token
        self.ns = dict(hashlib=hashlib, json=json, uuid=uuid, datetime=Frozen, timedelta=timedelta, timezone=timezone,
            ZoneInfo=ZoneInfo, quote=quote, CalendarStateError=CalendarStateError, ActionNotSent=ActionNotSent,
            cancellation_plan=cancellation_plan, utc_datetime=utc_datetime, event_instant=event_instant,
            schedule_override=schedule_override, session_overrides=session_overrides, validate_exception_plan=validate_exception_plan,
            signing=types.SimpleNamespace(dumps=sign, loads=lambda token, **_: copy.deepcopy(self.tokens[token])), SALT='test',
            httpx=types.SimpleNamespace(HTTPError=TransportError), transaction=types.SimpleNamespace(atomic=nullcontext),
            __package__='curriculum_api')
        names = ['saved_operation', 'fingerprint', 'eligible', 'action_preview', 'confirm_action', 'continue_action', 'action_result', 'verified_move']
        functions(ROOT / 'teams_calendar_actions.py', names, self.ns)
        @contextmanager
        def reader():
            yield self.read
        def save(_live, snapshot):
            self.saved = copy.deepcopy(snapshot)
        self.ns.update(calendar_reader=reader,
            load_calendar_state=lambda _live, **_: (copy.deepcopy(self.series), copy.deepcopy(self.rows), copy.deepcopy(self.saved)),
            load_module=lambda *_args, **_kwargs: copy.deepcopy(self.module), store_snapshot=Mock(side_effect=save),
            graph_action=Mock(return_value=True), verified_move=Mock(return_value=True),
            persist_move=Mock(side_effect=self.persist), reconcile_calendar=Mock(side_effect=self.reconcile))

    def persist(self, _series, _rows, _module, command, _snapshot):
        self.module['session_overrides'][str(command['sessionNumber'])] = command['exception']
        row = next(row for row in self.rows if row['id'] == command['occurrenceId'])
        row.update(scheduled_start=command['start'], scheduled_end=command['end'], graph_event_id=command['eventId'])

    def reconcile(self, _live):
        commands = self.saved['management']['commands']
        for command in commands:
            if command['state'] == 'attempted':
                if not command.get('occurrenceId'):
                    self.series['status'] = 'cancelled'
                for row in self.rows:
                    if not command.get('occurrenceId') or row['id'] == command['occurrenceId']:
                        row['status'] = 'cancelled'
        return {}

    def review(self, action='cancel', scope='occurrence', **kwargs):
        return self.ns['action_preview']('LIVE-1', dict(action=action, scope=scope, sessionNumber=1, **kwargs), 'ACTOR-1')

    def move(self, **kwargs):
        return self.review('reschedule', changes=[dict(sessionNumber=1, startDateTimeUtc='2026-10-09T11:00:00Z', durationMinutes=120)], **kwargs)

    def confirm(self, review):
        return self.ns['confirm_action']('LIVE-1', {'reviewToken': review['reviewToken'], 'acknowledgeNotifications': True}, 'ACTOR-1')

    def test_review_is_read_only_and_uses_exact_occurrence(self):
        review = self.review()
        command = self.tokens[review['reviewToken']]['commands'][0]
        self.assertEqual(command['eventId'], 'instance-OCC-1')
        self.assertEqual(len(review['sessions']), 1)
        self.assertTrue(review['notificationRequired'])
        self.ns['store_snapshot'].assert_not_called()
        self.ns['graph_action'].assert_not_called()

    def test_series_review_uses_one_master_not_twelve_cancels(self):
        review = self.review(scope='series')
        self.assertEqual(review['calendarRequests'], 1)
        self.assertEqual(self.tokens[review['reviewToken']]['commands'][0]['eventId'], 'master-1')
        self.assertEqual(len(review['sessions']), 2)

    def test_foreign_session_is_rejected(self):
        with self.assertRaises(ValueError):
            self.ns['action_preview']('LIVE-1', {'action': 'cancel', 'scope': 'occurrence', 'sessionNumber': 99}, 'ACTOR-1')

    def test_boolean_session_is_rejected(self):
        with self.assertRaises(ValueError):
            self.ns['action_preview']('LIVE-1', {'action': 'cancel', 'scope': 'occurrence', 'sessionNumber': True}, 'ACTOR-1')

    def test_attendance_prevents_single_session_mutation(self):
        self.rows[0]['participant_count'] = 1
        with self.assertRaisesRegex(ValueError, 'history'):
            self.review()

    def test_saved_clock_requires_storage_prerequisite(self):
        del self.module['session_overrides']
        with self.assertRaisesRegex(CalendarStateError, 'not configured'):
            self.move()

    def test_no_acknowledgement_sends_nothing(self):
        review = self.review()
        with self.assertRaises(ValueError):
            self.ns['confirm_action']('LIVE-1', {'reviewToken': review['reviewToken']}, 'ACTOR-1')
        self.ns['graph_action'].assert_not_called()

    def test_token_is_bound_to_calendar_and_actor(self):
        review = self.review()
        payload = {'reviewToken': review['reviewToken'], 'acknowledgeNotifications': True}
        for live, actor in [('OTHER', 'ACTOR-1'), ('LIVE-1', 'OTHER')]:
            with self.assertRaises(ValueError):
                self.ns['confirm_action'](live, payload, actor)
        self.ns['graph_action'].assert_not_called()

    def test_local_change_after_review_blocks_send(self):
        review = self.review()
        self.module['title'] = 'A later user edit'
        with self.assertRaisesRegex(CalendarStateError, 'changed'):
            self.confirm(review)
        self.ns['graph_action'].assert_not_called()

    def test_single_cancellation_keeps_neighbour(self):
        self.assertEqual(self.confirm(self.review())['status'], 'done')
        self.assertEqual([row['status'] for row in self.rows], ['cancelled', 'scheduled'])
        self.assertEqual(self.series['status'], 'active')
        self.ns['graph_action'].assert_called_once()

    def test_double_confirmation_does_not_send_twice(self):
        review = self.review()
        self.confirm(review)
        self.assertEqual(self.confirm(review)['status'], 'done')
        self.ns['graph_action'].assert_called_once()

    def test_verified_move_updates_only_one_session(self):
        old_second = copy.deepcopy(self.rows[1])
        result = self.confirm(self.move())
        self.assertEqual(result['status'], 'done')
        self.assertEqual(self.module['session_overrides']['1']['startTime'], '12:00')
        self.assertEqual(self.rows[1], old_second)
        self.ns['persist_move'].assert_called_once()

    def test_unverified_move_preserves_plan_until_read_only_recovery(self):
        self.ns['verified_move'].return_value = False
        result = self.confirm(self.move())
        self.assertEqual(result['status'], 'uncertain')
        self.ns['persist_move'].assert_not_called()
        self.ns['verified_move'].return_value = True
        result = self.ns['continue_action']('LIVE-1', self.saved['management']['id'])
        self.assertEqual(result['status'], 'done')
        self.ns['graph_action'].assert_called_once()

    def test_connection_loss_never_auto_retries_write(self):
        self.ns['graph_action'].side_effect = TransportError('connection lost after send')
        result = self.confirm(self.move())
        self.assertEqual(result['status'], 'uncertain')
        result = self.ns['continue_action']('LIVE-1', self.saved['management']['id'])
        self.assertEqual(result['status'], 'done')
        self.ns['graph_action'].assert_called_once()

    def test_definitive_rejection_allows_fresh_review(self):
        self.ns['graph_action'].side_effect = ActionNotSent('Rejected before change')
        self.assertEqual(self.confirm(self.move())['status'], 'failed')
        self.ns['persist_move'].assert_not_called()
        self.assertTrue(self.move()['reviewToken'])

    def test_status_does_not_interfere_with_active_request(self):
        self.ns['continue_action'] = Mock(return_value={'status': 'processing'})
        self.confirm(self.review())
        original = {}
        original.update(self.ns)
        functions(ROOT / 'teams_calendar_actions.py', ['continue_action'], original)
        self.assertEqual(original['continue_action']('LIVE-1', self.saved['management']['id'])['status'], 'processing')
        self.ns['graph_action'].assert_not_called()

    def test_uncertain_action_blocks_new_review(self):
        self.saved['management'] = {'status': 'uncertain'}
        with self.assertRaisesRegex(CalendarStateError, 'status check'):
            self.review()

    def test_holiday_is_rejected(self):
        self.v.module_cohort_selected_holidays.return_value = ['2026-10-09']
        with self.assertRaisesRegex(ValueError, 'holiday'):
            self.move()

    def test_tutor_collision_is_rejected(self):
        self.v.find_tutor_schedule_conflicts.return_value = ['conflict']
        with self.assertRaisesRegex(ValueError, 'tutor'):
            self.move()

    def test_out_of_order_move_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'order'):
            self.review('reschedule', changes=[dict(sessionNumber=1, startDateTimeUtc='2026-10-16T10:00:00Z', durationMinutes=120)])

    def test_duplicate_or_malformed_changes_are_rejected(self):
        for changes in [[{'sessionNumber': []}], [{'sessionNumber': True}], [{'sessionNumber': 1}, {'sessionNumber': 1}]]:
            with self.assertRaises(ValueError):
                self.review('reschedule', changes=changes)

    def test_past_session_move_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'future'):
            self.review('reschedule', changes=[dict(sessionNumber=1, startDateTimeUtc='2026-09-01T10:00:00Z', durationMinutes=120)])

    def test_old_worker_cannot_touch_a_new_action_journal(self):
        self.saved['management'] = {'id': 'new-action', 'status': 'reviewed', 'commands': []}
        with self.assertRaisesRegex(CalendarStateError, 'superseded'):
            self.ns['continue_action']('LIVE-1', 'old-action', send=True)
        self.ns['graph_action'].assert_not_called()
        self.ns['store_snapshot'].assert_not_called()

    def test_saved_learner_plan_reads_new_dates_without_rewriting_membership_or_history(self):
        module = {**self.module, 'end_date': '2026-10-15'}
        cursor = Mock()
        cursor.fetchall.return_value = [(module,)]
        ns = {'copy': copy, '_s': lambda value: str(value or ''),
              'connections': {'default': types.SimpleNamespace(cursor=lambda: nullcontext(cursor))}}
        functions(ROOT.parent / 'learner_api/active_users.py', ['refresh_saved_session_dates'], ns)
        def apply(_module, _group, weeks):
            weeks[0].update(sessionDate='2026-10-09', sessionDay='Friday', sessionStartTime='12:00', sessionDurationMinutes=90, sessionRescheduled=True)
            weeks[0]['components'][0]['settings'].update(sessionRescheduled=True, sessionDate='2026-10-09',
                sessionTime='12:00', sessionDateTimeUtc='2026-10-09T11:00:00Z', durationMinutes=90)
        self.v.apply_module_session_plan_to_weeks = apply
        with patch.dict(sys.modules, {'curriculum_api.views': self.v}):
            plan = [{'moduleId': 'MODULE-1', 'assignmentMode': 'explicit', 'weeks': [
                {'weekId': 'W1', 'sessionDate': '2026-10-08', 'components': [
                    {'componentId': 'C1', 'type': 'live_session', 'completed': True}]}]},
                {'moduleId': 'OTHER', 'weeks': []}]
            result = ns['refresh_saved_session_dates'](plan)
        self.assertEqual(result[0]['weeks'][0]['sessionDate'], '2026-10-09')
        self.assertEqual(result[0]['weeks'][0]['components'][0]['sessionTime'], '12:00')
        self.assertTrue(result[0]['weeks'][0]['components'][0]['completed'])
        self.assertEqual(result[0]['assignmentMode'], 'explicit')
        self.assertEqual(result[1], plan[1])
        self.assertEqual(plan[0]['weeks'][0]['sessionDate'], '2026-10-08')
        cursor.execute.assert_called_once()
        self.assertTrue(cursor.execute.call_args.args[0].strip().startswith('SELECT'))


class PureTests(unittest.TestCase):
    def setUp(self):
        self.socket = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.socket.start()
        self.addCleanup(self.socket.stop)

    def test_london_noon_and_dst_preserve_utc_instants(self):
        for day, utc_hour in [('2026-10-08', '11'), ('2026-11-05', '12')]:
            instant = utc_datetime(f'{day}T{utc_hour}:00:00Z')
            value = schedule_override(instant, 120, ZoneInfo('Europe/London'))
            self.assertEqual(value['startTime'], '12:00')
            self.assertEqual(value['endTime'], '14:00')
            self.assertEqual(utc_datetime(value['startDateTimeUtc']), instant)

    def test_override_does_not_mutate_original_or_other_session(self):
        plan = {'sessions': [{'sessionNumber': 1, 'date': '2026-10-08'}, {'sessionNumber': 2, 'date': '2026-10-15'}],
                'slots': [{'type': 'live-session', 'sessionNumber': 1, 'date': '2026-10-08'}]}
        exception = schedule_override(utc_datetime('2026-10-09T11:00:00Z'), 90, ZoneInfo('Europe/London'))
        module = {'session_overrides': {'1': exception}}
        result = apply_session_overrides(plan, module)
        self.assertEqual(plan['sessions'][0]['date'], '2026-10-08')
        self.assertEqual(result['sessions'][0]['date'], '2026-10-09')
        self.assertEqual(result['slots'][0]['date'], '2026-10-09')
        self.assertEqual(result['sessions'][1], plan['sessions'][1])
        self.assertEqual(override_clock(module, '2026-10-09'), ('12:00', '13:30', 90))
        self.assertIsNone(override_clock(module, '2026-10-15'))

    def test_cross_midnight_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'same local day'):
            schedule_override(utc_datetime('2026-11-05T23:30:00Z'), 120, ZoneInfo('Europe/London'))

    def test_ambiguous_dst_clock_is_rejected_without_losing_the_utc_offset(self):
        with self.assertRaisesRegex(ValueError, 'twice'):
            schedule_override(utc_datetime('2026-10-25T01:30:00Z'), 120, ZoneInfo('Europe/London'))
        with self.assertRaisesRegex(ValueError, 'clock change'):
            schedule_override(utc_datetime('2026-10-24T23:30:00Z'), 180, ZoneInfo('Europe/London'))

    def test_same_date_collision_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'separate date'):
            validate_exception_plan({'sessions': [dict(date='2026-10-08', startTime=time, durationMinutes=60) for time in ['09:00', '12:00']]})

    def test_directory_escapes_query_and_limits_results(self):
        ns = {'re': re, 'urlencode': urlencode}
        functions(ROOT / 'teams_directory.py', ['directory_query', 'directory_people'], ns)
        query = unquote(ns['directory_query']("O'Neil"))
        self.assertIn("O''Neil", query)
        self.assertIn('$top=12', query)
        self.assertIsNone(ns['directory_query']('A'))
        with self.assertRaises(ValueError):
            ns['directory_query']('a' * 81)
        people = ns['directory_people']({'value': [
            {'id': '1', 'displayName': 'Synthetic Person', 'mail': 'one@example.invalid', 'accountEnabled': True, 'userType': 'Member'},
            {'id': '2', 'mail': 'one@example.invalid', 'accountEnabled': True, 'userType': 'Member'},
            {'id': '3', 'mail': 'disabled@example.invalid', 'accountEnabled': False, 'userType': 'Member'},
            {'id': '4', 'mail': 'guest@example.invalid', 'accountEnabled': True, 'userType': 'Guest'},
        ]})
        self.assertEqual(len(people['people']), 1)
        self.assertEqual(people['people'][0]['id'], '1')

    def test_graph_transport_checks_identity_and_updates_only_time_and_privacy(self):
        graph = types.ModuleType('coach_api.views')
        graph.get_graph_settings = lambda: {'base_url': 'https://graph.microsoft.com/v1.0'}
        graph.microsoft_graph_token = lambda: 'synthetic-token'
        event = {'isCancelled': False, '@odata.etag': 'version-1', 'onlineMeeting': {'joinUrl': 'synthetic-link'}}
        client = types.SimpleNamespace(get=Mock(return_value=types.SimpleNamespace(status_code=200, json=lambda: event)),
            post=Mock(return_value=types.SimpleNamespace(status_code=202)), patch=Mock(return_value=types.SimpleNamespace(status_code=200)))
        ns = {'httpx': types.SimpleNamespace(Client=lambda **_: nullcontext(client), HTTPError=TransportError),
              'quote': quote, 'CalendarStateError': CalendarStateError, 'ActionNotSent': ActionNotSent}
        functions(ROOT / 'teams_calendar_actions.py', ['graph_action'], ns)
        series = {'organizer_email': 'owner@example.invalid'}
        command = {'eventId': 'exact/occurrence', 'joinUrl': 'synthetic-link', 'etag': 'version-1',
                   'action': 'reschedule', 'start': '2026-11-01T12:00:00Z', 'end': '2026-11-01T14:00:00Z'}
        with patch.dict(sys.modules, {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': graph}):
            self.assertTrue(ns['graph_action'](series, command, ''))
            path, = client.patch.call_args.args
            self.assertIn('exact%2Foccurrence', path)
            self.assertEqual(set(client.patch.call_args.kwargs['json']), {'start', 'end', 'hideAttendees'})
            client.post.assert_not_called()
            event['@odata.etag'] = 'changed'
            with self.assertRaises(ActionNotSent):
                ns['graph_action'](series, command, '')
            client.patch.assert_called_once()

    def test_new_endpoints_enforce_staff_roles_before_directory_or_actions(self):
        ns = {'functools': functools, 'JsonResponse': Response,
              'authenticate_request': lambda request: request.account, 'session_unreadable': lambda request: False}
        functions(ROOT.parent / 'login/permissions.py', {'_unauthenticated', '_unavailable', '_forbidden', 'require_role'}, ns)
        def method_only(method):
            return lambda fn: lambda request, *args: fn(request, *args) if request.method == method else Response(status=405)
        review = Mock(return_value={'reviewToken': 'synthetic'})
        directory = Mock(return_value={'people': [], 'hasMore': False})
        ns.update(transaction=types.SimpleNamespace(non_atomic_requests=lambda fn: fn), require_POST=method_only('POST'),
            require_GET=method_only('GET'), json=json, action_preview=review, directory_query=lambda _: 'users?synthetic',
            directory_people=directory, signing=types.SimpleNamespace(BadSignature=type('BadSignature', (Exception,), {})),
            CalendarStateError=CalendarStateError, httpx=types.SimpleNamespace(HTTPError=TransportError))
        functions(ROOT / 'teams_calendar_actions.py', ['calendar_action'], ns)
        functions(ROOT / 'teams_directory.py', ['search_teams_directory'], ns)
        graph = types.ModuleType('coach_api.views')
        graph.microsoft_graph_request = Mock(return_value={'value': []})
        with patch.dict(sys.modules, {'coach_api': types.ModuleType('coach_api'), 'coach_api.views': graph}):
            for role, code in [(None, 401), ('learner', 403), ('employer', 403), ('coach', 403), ('staff', 200), ('admin', 200)]:
                account = types.SimpleNamespace(role=role, pk='ACTOR') if role else None
                request = types.SimpleNamespace(account=account, login_account=account, method='POST', body=b'{"stage":"review"}', GET={'q': 'Alex'})
                self.assertEqual(ns['calendar_action'](request, 'LIVE-1').status_code, code)
                request.method = 'GET'
                self.assertEqual(ns['search_teams_directory'](request).status_code, code)
            self.assertEqual(review.call_count, 2)
            self.assertEqual(graph.microsoft_graph_request.call_count, 2)
            self.assertFalse(getattr(ns['calendar_action'], 'csrf_exempt', False))

    def test_readers_apply_rescheduled_component_dates_and_preserve_other_settings(self):
        module = {'sessions_number': 2, 'session_overrides': {'1': schedule_override(utc_datetime('2026-10-09T11:00:00Z'), 90, ZoneInfo('Europe/London'))}}
        plan = apply_session_overrides({'sessions': [dict(sessionNumber=n, date=day, day='Thursday')
                for n, day in [(1, '2026-10-08'), (2, '2026-10-15')]]}, module)
        weeks = [{'components': [{'type': 'live-session', 'settings': {
            'sessionDate': day, 'teamsSessionNumber': n, 'teamsLiveSessionId': 'LIVE-1', 'teamsJoinUrl': 'keep-link', 'custom': 'keep'}}]}
                 for n, day in [(1, '2026-10-08'), (2, '2026-10-15')]]
        ns = {'module_week_delivery_days': lambda *_: 1, 'module_stored_session_count': lambda *_: 2,
            'module_structure_uses_session_rows': lambda *_: False, 'module_structure_live_session_counts': lambda _: [1, 1],
            'module_session_plan_for_count': lambda *_args, **_kwargs: plan,
            'module_session_clock': lambda module, group=None, session_date=None: override_clock(module, session_date) or ('09:00', '11:00', 120),
            'clean_str': lambda v: str(v or '').strip(), 'parse_int': lambda v, default=0: int(v or default),
            'format_date': lambda v: str(v or ''),
            'calendar_clock_to_utc_iso': lambda day, clock: day + 'T' + clock + ':00+01:00'}
        functions(ROOT / 'views.py', ['apply_module_session_plan_to_weeks'], ns)
        ns['apply_module_session_plan_to_weeks'](module, {}, weeks, holidays=[])
        first = weeks[0]['components'][0]['settings']
        self.assertEqual((first['sessionDate'], first['sessionTime']), ('2026-10-09', '12:00'))
        self.assertEqual(first['teamsJoinUrl'], 'keep-link')
        self.assertEqual(first['custom'], 'keep')
        self.assertEqual(weeks[1]['components'][0]['settings']['sessionDate'], '2026-10-15')


if __name__ == '__main__':
    unittest.main(verbosity=2)
