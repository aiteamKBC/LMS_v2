"""Imported-series extension regressions with synthetic storage and transport.

No Django setup, database, or network. Run only when Teams tests are requested.
"""
import ast
import copy
import hashlib
import json
import sys
import types
import unittest
import uuid
from contextlib import nullcontext
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import quote, urlencode
from zoneinfo import ZoneInfo


ROOT = Path(__file__).parent
JOIN = 'https://teams.microsoft.com/l/meetup-join/synthetic-series'


class TransportError(Exception):
    pass


class DatabaseError(Exception):
    pass


def load_functions(path, namespace, names=None):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and (names is None or node.name in names):
            node.decorator_list = []
            nodes.append(node)
        elif names is None and isinstance(node, ast.Assign):
            nodes.append(node)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


def fixture_namespace():
    namespace = dict(copy=copy, hashlib=hashlib, json=json, uuid=uuid, date=date,
        datetime=datetime, timedelta=timedelta, timezone=timezone, ZoneInfo=ZoneInfo,
        quote=quote, urlencode=urlencode, text=lambda value: str(value or '').strip(),
        httpx=types.SimpleNamespace(HTTPError=TransportError), DatabaseError=DatabaseError,
        transaction=types.SimpleNamespace(atomic=nullcontext),
        join_context_oid=lambda _: 'synthetic-owner', join_context=lambda _: {'Tid': 'synthetic-tenant'},
        calendar_collection=lambda read, path: read(path)['value'])
    load_functions(ROOT / 'teams_calendar_checks.py', namespace,
                   {'CalendarMismatch', 'utc_datetime', 'event_instant'})
    load_functions(ROOT / 'teams_imported_calendar_update.py', namespace)
    return namespace


def event(day, identity=None):
    start = datetime.combine(date.fromisoformat(day), time(12), ZoneInfo('Europe/London'))
    return {'id': identity or day, 'type': 'occurrence', 'seriesMasterId': 'MASTER',
            'start': {'dateTime': start.astimezone(timezone.utc).isoformat(), 'timeZone': 'UTC'},
            'end': {'dateTime': (start.astimezone(timezone.utc) + timedelta(hours=2)).isoformat(), 'timeZone': 'UTC'},
            'onlineMeeting': {'joinUrl': JOIN}, 'isCancelled': False}


class ImportedCalendarUpdateTests(unittest.TestCase):
    def setUp(self):
        sockets = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        sockets.start()
        self.addCleanup(sockets.stop)
        self.ns = fixture_namespace()
        self.access = {'mode': 'delegated', 'actorId': 'ACTOR', 'tenantId': 'synthetic-tenant',
                       'calendarKind': 'group', 'scopes': ['Group.ReadWrite.All'], 'accessToken': 'synthetic'}
        self.master = {**event('2026-10-16', 'MASTER'), 'type': 'seriesMaster', 'isOrganizer': True,
            'subject': 'Synthetic module', '@odata.etag': 'version-1', 'iCalUId': 'ICAL',
            'organizer': {'emailAddress': {'address': 'group@example.invalid'}},
            'attendees': [{'emailAddress': {'address': 'learner@example.invalid'}, 'type': 'required'}],
            'recurrence': {'pattern': {'type': 'weekly', 'interval': 1, 'daysOfWeek': ['friday'], 'firstDayOfWeek': 'monday'},
                           'range': {'type': 'endDate', 'startDate': '2026-10-16', 'endDate': '2026-10-23',
                                     'recurrenceTimeZone': 'GMT Standard Time'}}}
        self.events = [event('2026-10-16'), event('2026-10-23')]
        self.targets = [self.target(day) for day in ('2026-10-16', '2026-10-23', '2026-10-30')]
        self.series = {'id': 'LIVE', 'module_title': 'Synthetic module', 'join_url': JOIN,
                       'organizer_email': 'group@example.invalid', 'meeting_type': 'linked-external', 'status': 'active'}

    def target(self, day):
        start, end = self.ns['event_slot'](event(day))
        return {'componentId': 'C-' + day, 'start': start, 'end': end}

    def plan(self, targets=None, events=None):
        return self.ns['extension_plan'](self.master, targets or self.targets,
                                         self.events if events is None else events, 'Europe/London')

    def operation(self):
        after, added, _, _ = self.plan()
        return {'id': 'OP', 'liveId': 'LIVE', 'actor': 'LMS-ACTOR', 'version': 'PLAN',
            'accessMode': 'delegated', 'accessActor': 'ACTOR', 'calendarKind': 'group', 'tenantId': 'synthetic-tenant',
            'path': 'groups/GROUP/events/MASTER', 'etag': 'version-1', 'joinUrl': JOIN,
            'beforeRecurrence': copy.deepcopy(self.master['recurrence']), 'afterRecurrence': after,
            'protected': self.ns['protected_master'](self.master), 'beforeInstances': self.ns['instance_snapshot'](self.events),
            'targets': self.targets, 'through': '2026-10-30', 'zoneName': 'Europe/London',
            'calendarChangeRequired': True, 'addedCount': len(added), 'status': 'processing',
            'attempted': False, 'leaseUntil': '2000-01-01T00:00:00Z'}

    def ledger(self, operation):
        self.snapshot = {'importedExtension': copy.deepcopy(operation)}
        self.ns['load_calendar_state'] = Mock(side_effect=lambda *_a, **_k:
            (copy.deepcopy(self.series), [], copy.deepcopy(self.snapshot)))
        self.ns['store_snapshot'] = Mock(side_effect=lambda _live, value: setattr(self, 'snapshot', copy.deepcopy(value)))
        self.ns['load_local'] = Mock(side_effect=lambda *_a, **_k:
            (copy.deepcopy(self.series), [], copy.deepcopy(self.snapshot), {}, self.targets, 'PLAN', 'Europe/London'))

    def test_extends_original_pattern_across_london_dst(self):
        original = copy.deepcopy(self.master)
        after, added, old, new = self.plan()
        self.assertEqual(after['pattern'], original['recurrence']['pattern'])
        self.assertEqual(after['range']['endDate'], '2026-10-30')
        self.assertEqual(added[0]['start'], '2026-10-30T12:00:00Z')
        self.assertEqual(self.targets[0]['start'], '2026-10-16T11:00:00Z')
        self.assertEqual((old.isoformat(), new.isoformat()), ('2026-10-23', '2026-10-30'))
        self.assertEqual(self.master, original)

    def test_numbered_series_keeps_numbered_range(self):
        self.master['recurrence']['range'].update(type='numbered', numberOfOccurrences=2)
        self.master['recurrence']['range'].pop('endDate')
        after, *_ = self.plan()
        self.assertEqual(after['range']['type'], 'numbered')
        self.assertEqual(after['range']['numberOfOccurrences'], 3)
        self.assertNotIn('endDate', after['range'])

    def test_does_not_generate_unplanned_gap_or_additional_meeting(self):
        with self.assertRaises(self.ns['Blocked']) as caught:
            self.plan(self.targets[:2] + [self.target('2026-11-06')])
        self.assertEqual(caught.exception.code, 'extension_would_add_unplanned_dates')

    def test_cancelled_or_shifted_existing_date_cannot_be_recreated(self):
        cancelled = copy.deepcopy(self.events)
        cancelled[1]['isCancelled'] = True
        with self.assertRaises(self.ns['Blocked']) as caught:
            self.plan(events=cancelled)
        self.assertEqual(caught.exception.code, 'missing_inside_original_range')

    def test_dst_fold_and_gap_require_explicit_calendar_review(self):
        for day in (date(2026, 3, 29), date(2026, 10, 25)):
            with self.assertRaises(self.ns['Blocked']):
                self.ns['local_clock'](day, time(1, 30), ZoneInfo('Europe/London'))

    def test_mutation_is_only_recurrence_with_if_match(self):
        client = self.ns['CalendarClient'].__new__(self.ns['CalendarClient'])
        client.client = Mock()
        client.client.patch.return_value.status_code = 200
        operation = self.operation()
        client.extend(operation)
        client.client.patch.assert_called_once_with(operation['path'], json={'recurrence': operation['afterRecurrence']},
                                                    headers={'If-Match': 'version-1'})
        client.client.post.assert_not_called()

    def test_attendee_copy_is_never_used_for_updates(self):
        copy_event = {**self.master, 'isOrganizer': False}
        client = types.SimpleNamespace(access={**self.access, 'calendarKind': 'user'}, read=Mock(return_value={'value': [copy_event]}))
        with self.assertRaises(self.ns['Blocked']) as caught:
            self.ns['original_master'](self.series, client)
        self.assertEqual(caught.exception.code, 'attendee_copy_only')
        self.assertTrue(caught.exception.connection_required)

    def test_group_discovery_requires_exact_original_series(self):
        def read(path):
            if path.startswith('groups?'):
                return {'value': [{'id': 'GROUP', 'mail': 'group@example.invalid'}]}
            if '/events?' in path:
                return {'value': [self.master]}
            return self.master
        client = types.SimpleNamespace(access=self.access, read=Mock(side_effect=read))
        path, original = self.ns['original_master'](self.series, client)
        self.assertEqual(path, 'groups/GROUP/events/MASTER')
        self.assertEqual(original['onlineMeeting']['joinUrl'], JOIN)
        self.assertTrue(all(not call.args[0].startswith('users/') for call in client.read.call_args_list))

    def test_readback_rejects_unplanned_new_occurrence(self):
        operation = self.operation()
        updated = {**self.master, 'recurrence': operation['afterRecurrence']}
        self.ns['instances'] = Mock(return_value=self.events + [event('2026-10-30'), event('2026-11-06')])
        with self.assertRaises(self.ns['Blocked']) as caught:
            self.ns['verify_readback'](types.SimpleNamespace(read=lambda _: updated), operation)
        self.assertEqual(caught.exception.code, 'unexpected_new_occurrences')

    def test_changed_invitees_fail_readback_but_rsvp_changes_do_not(self):
        original = self.ns['protected_master'](self.master)
        self.master['attendees'][0]['status'] = {'response': 'accepted', 'time': '2026-10-10T12:00:00Z'}
        self.assertEqual(self.ns['protected_master'](self.master), original)
        self.master['attendees'].append({'emailAddress': {'address': 'another@example.invalid'}, 'type': 'required'})
        self.assertNotEqual(self.ns['protected_master'](self.master), original)

    def test_successful_patch_then_denied_readback_remains_pending(self):
        operation = self.operation()
        self.ledger(operation)
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.read.return_value = self.master
        self.ns['CalendarClient'] = Mock(return_value=client)
        self.ns['verify_readback'] = Mock(side_effect=self.ns['GraphRefusal'](403))
        result = self.ns['execute']('LIVE', 'OP', 'LMS-ACTOR', self.access, send=True)
        self.assertEqual(result['status'], 'verification_pending')
        self.assertTrue(result['connectionRequired'])
        self.assertEqual(result['connectionKind'], 'group')
        self.assertTrue(self.snapshot['importedExtension']['attempted'])
        client.extend.assert_called_once()
        self.ns['execute']('LIVE', 'OP', 'LMS-ACTOR', self.access, send=False)
        client.extend.assert_called_once()

    def test_definitive_patch_refusal_allows_fresh_review_with_reconnect(self):
        operation = self.operation()
        self.ledger(operation)
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        client.read.return_value = self.master
        client.extend.side_effect = self.ns['GraphRefusal'](403)
        self.ns['CalendarClient'] = Mock(return_value=client)
        result = self.ns['execute']('LIVE', 'OP', 'LMS-ACTOR', self.access, send=True)
        self.assertEqual(result['status'], 'blocked')
        self.assertTrue(result['connectionRequired'])
        self.assertEqual(self.snapshot['importedExtension']['status'], 'failed')

    def test_done_ledger_cannot_be_downgraded_by_stale_failure(self):
        operation = self.operation()
        operation.update(status='done', importedCount=1)
        self.ledger(operation)
        result = self.ns['set_state']('LIVE', 'OP', status='uncertain', message='Late failure')
        self.assertEqual(result['status'], 'done')
        self.ns['store_snapshot'].assert_not_called()

    def test_stale_unattempted_read_cannot_fail_committed_attempt(self):
        operation = self.operation()
        operation['attempted'] = True
        self.ledger(operation)
        result = self.ns['finish_unattempted']('LIVE', 'OP')
        self.assertEqual(result['status'], 'verification_pending')
        self.ns['store_snapshot'].assert_not_called()

    def test_delayed_sender_cannot_patch_after_not_sent_terminal_state(self):
        operation = self.operation()
        self.ledger(operation)
        client = Mock()
        client.__enter__ = Mock(return_value=client)
        client.__exit__ = Mock(return_value=False)
        def preflight(_):
            self.snapshot['importedExtension'].update(status='failed', code='not_sent', message='No request sent')
            return self.master
        client.read.side_effect = preflight
        self.ns['CalendarClient'] = Mock(return_value=client)
        result = self.ns['execute']('LIVE', 'OP', 'LMS-ACTOR', self.access, send=True)
        self.assertEqual(result['status'], 'blocked')
        client.extend.assert_not_called()

    def test_import_only_preview_lists_missing_date_and_does_not_write(self):
        self.ledger(self.operation())
        self.master['recurrence']['range']['endDate'] = '2026-10-30'
        self.snapshot = {}
        self.ns['load_local'] = Mock(return_value=(self.series, [], {}, {}, self.targets, 'PLAN', 'Europe/London'))
        self.ns['original_master'] = Mock(return_value=('groups/GROUP/events/MASTER', self.master))
        self.ns['instances'] = Mock(return_value=self.events + [event('2026-10-30')])
        self.ns['local_missing'] = Mock(return_value=[self.targets[-1]])
        self.ns['signing'] = types.SimpleNamespace(dumps=Mock(return_value='signed-preview'))
        self.ns['CalendarClient'] = Mock(return_value=nullcontext(None))
        result = self.ns['review']('LIVE', 'LMS-ACTOR', self.access)
        self.assertEqual(result['status'], 'ready')
        self.assertFalse(result['calendarChangeRequired'])
        self.assertEqual(result['addedSessions'], [{key: self.targets[-1][key] for key in ('start', 'end')}])
        self.ns['store_snapshot'].assert_not_called()

    def test_additional_component_keeps_its_own_date_and_link(self):
        weeks = [{'id': 'W1'}, {'id': 'W2'}, {'id': 'W3'}]
        components = [
            {'id': 'C1', 'week_id': 'W1', 'type': 'live-session', 'settings': {'teamsMeetingScope': 'main'}},
            {'id': 'EXTRA', 'week_id': 'W2', 'type': 'live-session',
             'settings': {'teamsMeetingScope': 'additional', 'extraTeamsMeetingUrl': 'https://example.invalid/additional', 'sessionDate': '2026-10-24'}},
            {'id': 'C3', 'week_id': 'W3', 'type': 'live-session', 'settings': {'teamsMeetingScope': 'main'}},
        ]
        original = copy.deepcopy(components)
        package = types.ModuleType('curriculum_api')
        package.__path__ = [str(ROOT)]
        package.views = types.SimpleNamespace(AUTHORING_WEEKS_TABLE='weeks', AUTHORING_COMPONENTS_TABLE='components',
            active_week_rows=lambda rows: rows, active_component_rows=lambda rows: rows,
            authoring_fetch_all=lambda table, *_a, **_k: copy.deepcopy(weeks if table == 'weeks' else components),
            module_week_delivery_slots=lambda *_a: ([[{'date': day}] for day in ('2026-10-16', '2026-10-23', '2026-10-30')], []),
            module_session_clock=lambda *_a: ('12:00', '14:00', 120), GRAPH_WINDOWS_TO_IANA={},
            frontend_component_type=lambda value: value, component_builder_settings=lambda row: row['settings'],
            live_session_meeting_scope=lambda settings, _main: settings['teamsMeetingScope'])
        self.ns['__package__'] = 'curriculum_api'
        self.ns['load_calendar_state'] = Mock(return_value=(self.series, [], {}))
        self.ns['load_module'] = Mock(return_value={'module_catalogue_id': 'MODULE'})
        with patch.dict(sys.modules, {'curriculum_api': package}):
            result = self.ns['load_local']('LIVE')
        self.assertEqual([target['componentId'] for target in result[4]], ['C1', 'C3'])
        self.assertEqual([target['start'] for target in result[4]], [self.targets[0]['start'], self.targets[2]['start']])
        self.assertEqual(components, original)


if __name__ == '__main__':
    unittest.main()
