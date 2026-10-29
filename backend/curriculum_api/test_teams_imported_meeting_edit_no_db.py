"""Original-meeting edit regressions; no Django setup, database or network."""
import ast
import copy
from contextlib import nullcontext
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import re
import sys
import types
import unittest
from unittest.mock import Mock, patch
from urllib.parse import quote, urlencode
import uuid
from zoneinfo import ZoneInfo

from test_teams_imported_calendar_update_no_db import fixture_namespace, event, JOIN


class OriginalMeetingEditTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        base = fixture_namespace()
        self.calendar = types.SimpleNamespace(**base)
        self.ns = dict(copy=copy, date=date, datetime=datetime, timedelta=timedelta, timezone=timezone,
                       quote=quote, urlencode=urlencode, uuid=uuid, ZoneInfo=ZoneInfo, calendar=self.calendar,
                       text=base['text'], transaction=types.SimpleNamespace(atomic=nullcontext),
                       signing=types.SimpleNamespace(loads=lambda value, **_: copy.deepcopy(value),
                                                     dumps=lambda value, **_: copy.deepcopy(value)),
                       eligible=lambda row: row['status'] == 'scheduled' and not row.get('participant_count'),
                       join_context_oid=lambda _: 'OWNER', load_module=Mock(return_value={}),
                       persist_move=Mock())
        tree = ast.parse((Path(__file__).parent / 'teams_imported_meeting_edit.py').read_text(encoding='utf-8'))
        tree.body = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.Assign))]
        exec(compile(tree, 'original-meeting-edit', 'exec'), self.ns)
        overrides = ast.parse((Path(__file__).parent / 'session_overrides.py').read_text(encoding='utf-8'))
        function = next(node for node in overrides.body if isinstance(node, ast.FunctionDef) and node.name == 'schedule_override')
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'real-session-override', 'exec'), self.ns)
        actions = ast.parse((Path(__file__).parent / 'teams_calendar_actions.py').read_text(encoding='utf-8'))
        eligible = next(node for node in actions.body if isinstance(node, ast.FunctionDef) and node.name == 'eligible')
        exec(compile(ast.Module(body=[eligible], type_ignores=[]), 'real-calendar-eligibility', 'exec'), self.ns)
        self.series = {'id': 'LIVE', 'meeting_type': 'linked-external', 'status': 'active',
                       'join_url': JOIN, 'online_meeting_id': 'ONLINE'}
        self.master = {**event('2030-10-18', 'MASTER'), 'type': 'seriesMaster', 'isOrganizer': True,
                       '@odata.etag': 'MASTER-1', 'subject': 'Original series', 'iCalUId': 'ICAL',
                       'organizer': {'emailAddress': {'address': 'owner@example.invalid'}},
                       'attendees': [{'emailAddress': {'address': 'old@example.invalid', 'name': 'Old'}, 'type': 'optional'}],
                       'recurrence': {'pattern': {'type': 'weekly'}, 'range': {'type': 'endDate', 'endDate': '2030-11-01'}}}
        self.meeting = {'id': 'ONLINE', 'joinWebUrl': JOIN,
                        'participants': {'organizer': {'identity': {'user': {'id': 'OWNER'}}},
                                         'attendees': [{'upn': 'old@example.invalid', 'role': 'presenter'}]},
                        'allowedPresenters': 'roleIsPresenter', 'recordAutomatically': False,
                        'allowRecording': True, 'allowTranscription': False,
                        'lobbyBypassSettings': {'scope': 'invited', 'isDialInBypassEnabled': True},
                        'meetingSpokenLanguageTag': 'en-GB'}
        self.access = {'mode': 'application', 'actorId': 'APP', 'tenantId': 'TENANT', 'calendarKind': 'user',
                       'scopes': ['Calendars.ReadWrite', 'OnlineMeetings.ReadWrite.All']}
        self.calendar.require_access = Mock()
        self.snapshot = {}
        self.ns['load_edit'] = Mock(side_effect=lambda *_a, **_kw:
                                  (copy.deepcopy(self.series), copy.deepcopy(self.rows), copy.deepcopy(self.snapshot), {}, 'VERSION'))
        self.ns['load_calendar_state'] = Mock(side_effect=lambda *_a, **_kw:
                                             (copy.deepcopy(self.series), [], copy.deepcopy(self.snapshot)))
        self.ns['store_snapshot'] = Mock(side_effect=lambda _id, snapshot: setattr(self, 'snapshot', copy.deepcopy(snapshot)))
        self.events = [event('2030-10-18', 'O-1')]
        self.rows = [{'id': 'OCC-1', 'session_number': 1, 'status': 'scheduled',
                      'scheduled_start': '2030-10-18T11:00:00Z', 'scheduled_end': '2030-10-18T13:00:00Z'}]
        self.calendar.instances = Mock(side_effect=lambda *_: copy.deepcopy(self.events))
        self.calendar.verify_master = Mock()
        self.client = Mock()
        self.client.__enter__ = Mock(return_value=self.client)
        self.client.__exit__ = Mock(return_value=False)
        self.calendar.CalendarClient = Mock(return_value=self.client)
        self.objects = {'users/OWNER/events/MASTER': copy.deepcopy(self.master),
                        'users/OWNER/onlineMeetings/ONLINE': copy.deepcopy(self.meeting)}
        self.client.read.side_effect = lambda path: copy.deepcopy(self.objects[path.split('?')[0]])
        self.writes = []

        def graph_patch(path, *, json, headers):
            self.writes.append((path, copy.deepcopy(json), copy.deepcopy(headers)))
            current = self.objects[path]
            if 'participants' in json:
                current['participants'] = {**current['participants'], **json['participants']}
            current.update({key: value for key, value in json.items() if key != 'participants'})
            return types.SimpleNamespace(status_code=200)
        self.client.client.patch.side_effect = graph_patch
        self.v = types.ModuleType('curriculum_api.views')
        self.v.invalidate_curriculum_cache = Mock()
        self.v.json_db_value = lambda value: copy.deepcopy(value)
        self.v.update_authoring_rows = Mock()
        self.v.LIVE_SESSIONS_TABLE = 'curriculum.live_sessions'
        self.v.teams_attendee_emails = self.email_parser
        self.v.module_cohort_selected_holidays = Mock(return_value=[])
        self.v.parse_json_value = lambda value, default: value or default
        self.v.holiday_date_set = lambda _: set()
        package = types.ModuleType('curriculum_api')
        package.views = self.v
        module_patch = patch.dict(sys.modules, {'curriculum_api': package, 'curriculum_api.views': self.v})
        module_patch.start()
        self.addCleanup(module_patch.stop)
        self.ns['__package__'] = 'curriculum_api'

    @staticmethod
    def email_parser(values):
        result = []
        for value in values:
            if not isinstance(value, str) or not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value):
                raise ValueError('Invalid email')
            if value.lower() not in result:
                result.append(value.lower())
        return result

    def source(self):
        return {'online': copy.deepcopy(self.meeting), 'onlinePath': 'users/OWNER/onlineMeetings/ONLINE'}

    def operation(self, online=False):
        before = copy.deepcopy(self.meeting if online else self.master)
        change = {'meetingSpokenLanguageTag': 'ar-EG'} if online else {'attendees': []}
        command = {'type': 'online' if online else 'event',
                   'path': 'users/OWNER/onlineMeetings/ONLINE' if online else 'users/OWNER/events/MASTER',
                   'before': before, 'after': {**before, **change}, 'patch': change, 'attempted': False}
        operation = {'kind': 'meeting-edit', 'id': 'OP', 'liveId': 'LIVE', 'actor': 'STAFF',
                     'version': 'VERSION', 'accessMode': 'application', 'accessActor': 'APP',
                     'calendarKind': 'user', 'tenantId': 'TENANT', 'status': 'processing',
                     'leaseUntil': '2000-01-01T00:00:00Z', 'path': 'users/OWNER/events/MASTER',
                     'joinUrl': JOIN, 'through': '2030-11-01', 'notify': False,
                     'beforeInstances': self.calendar.instance_snapshot(self.events), 'commands': [command]}
        self.snapshot = {'importedExtension': operation}
        return operation

    def execute(self, send=True):
        return self.ns['execute_edit']('LIVE', 'OP', 'STAFF', self.access, send=send)

    def test_people_edit_preserves_dates_identity_recurrence_and_optional_invites(self):
        changed = copy.deepcopy(self.master)
        changed['attendees'].append({'emailAddress': {'address': 'new@example.invalid'}, 'type': 'required'})
        self.assertNotEqual(self.ns['event_state'](changed), self.ns['event_state'](self.master))
        for key in ('recurrence', 'isCancelled', 'seriesMasterId', 'subject'):
            changed = copy.deepcopy(self.master)
            changed[key] = 'changed'
            self.assertNotEqual(self.ns['event_state'](changed), self.ns['event_state'](self.master))

    def test_unreadable_people_are_not_inferred_as_empty(self):
        for value in (None, {}, [{'emailAddress': {}, 'type': 'required'}]):
            with self.assertRaises(self.calendar.Blocked):
                self.ns['people']({'attendees': value})

    def test_lobby_edit_preserves_dial_in_and_unrelated_options(self):
        result = self.ns['options_patch'](self.source(), {'lobby': 'everyone'})
        self.assertEqual(result, {'lobbyBypassSettings': {'scope': 'everyone', 'isDialInBypassEnabled': True}})

    def test_recording_omission_does_not_reset_it(self):
        self.assertEqual(self.ns['options_patch'](self.source(), {'language': 'ar-EG'}), {'meetingSpokenLanguageTag': 'ar-EG'})
        self.assertEqual(self.ns['options_patch'](self.source(), {}), {})

    def test_empty_presenters_explicitly_remove_the_role_preserving_identity(self):
        result = self.ns['options_patch'](self.source(), {'presenters': []})
        self.assertEqual(result['participants']['attendees'], [{'upn': 'old@example.invalid', 'role': 'attendee'}])
        self.assertEqual(result['allowedPresenters'], 'organizer')

    def test_unreadable_role_identity_cannot_clear_roles(self):
        source = self.source()
        source['online']['participants']['attendees'] = [{'role': 'coorganizer'}]
        with self.assertRaises(self.calendar.Blocked):
            self.ns['options_patch'](source, {'presenters': []})

    def test_unverified_options_do_not_prevent_attendee_only_edit(self):
        self.assertEqual(self.ns['options_patch']({}, {'attendees': []}), {})
        with self.assertRaises(self.calendar.Blocked):
            self.ns['options_patch']({}, {'recording': 'record'})

    def test_online_identity_and_organizer_are_verified(self):
        self.assertEqual(self.ns['read_online'](self.client, self.series, 'users/OWNER/onlineMeetings/ONLINE')['id'], 'ONLINE')
        self.objects['users/OWNER/onlineMeetings/ONLINE']['joinWebUrl'] = 'different'
        with self.assertRaises(self.calendar.Blocked):
            self.ns['read_online'](self.client, self.series, 'users/OWNER/onlineMeetings/ONLINE')

    def test_silent_attendee_save_is_one_conditional_patch_no_dates_or_mail(self):
        self.operation()
        self.assertEqual(self.execute()['status'], 'confirmed')
        self.assertEqual(self.writes, [('users/OWNER/events/MASTER', {'attendees': []},
                                      {'If-Match': 'MASTER-1', 'Prefer': 'outlook.send-invitations="none"'})])
        self.ns['persist_move'].assert_not_called()
        self.assertEqual(self.objects['users/OWNER/events/MASTER']['onlineMeeting'], self.master['onlineMeeting'])
        updates = self.v.update_authoring_rows.call_args.args[3]
        self.assertEqual(updates['attendees'], [])
        self.assertNotIn('recording', updates)
        self.assertNotIn('join_url', updates)
        self.assertNotIn('graph_event_id', updates)
        self.assertEqual(self.execute()['status'], 'confirmed')
        self.assertEqual(len(self.writes), 1)

    def test_notify_choice_is_explicit_and_does_not_send_lms_mail(self):
        self.operation()['notify'] = True
        self.assertEqual(self.execute()['status'], 'confirmed')
        self.assertNotIn('Prefer', self.writes[0][2])
        self.assertEqual(self.writes[0][1], {'attendees': []})

    def test_role_or_options_save_preserves_online_meeting_identity(self):
        self.operation(online=True)
        self.assertEqual(self.execute()['status'], 'confirmed')
        self.assertEqual(self.writes[0][1], {'meetingSpokenLanguageTag': 'ar-EG'})
        self.assertEqual(self.objects['users/OWNER/onlineMeetings/ONLINE']['participants'], self.meeting['participants'])

    def test_timeout_after_acceptance_is_recovered_without_resending(self):
        self.operation()
        normal = self.client.client.patch.side_effect
        def timeout(*args, **kwargs):
            normal(*args, **kwargs)
            raise self.calendar.httpx.HTTPError('timeout')
        self.client.client.patch.side_effect = timeout
        self.assertEqual(self.execute()['status'], 'verification_pending')
        self.assertTrue(self.snapshot['importedExtension']['commands'][0]['attempted'])
        self.assertEqual(self.execute(send=False)['status'], 'confirmed')
        self.assertEqual(len(self.writes), 1)

    def test_timeout_before_acceptance_never_replays_from_status(self):
        self.operation()
        self.client.client.patch.side_effect = self.calendar.httpx.HTTPError('timeout')
        self.assertEqual(self.execute()['status'], 'verification_pending')
        self.assertEqual(self.execute(send=False)['status'], 'verification_pending')
        self.assertEqual(self.client.client.patch.call_count, 1)

    def test_definitive_microsoft_permission_refusal_is_a_visible_failure(self):
        self.operation()
        self.client.client.patch.side_effect = None
        self.client.client.patch.return_value = types.SimpleNamespace(status_code=403)
        result = self.execute()
        self.assertEqual(result['status'], 'blocked')
        self.assertIn('Microsoft refused', result['message'])
        self.assertEqual(self.execute(send=False)['status'], 'blocked')
        self.assertEqual(self.client.client.patch.call_count, 1)

    def test_calendar_drift_before_send_refuses_write(self):
        self.operation()
        self.objects['users/OWNER/events/MASTER']['subject'] = 'Changed externally'
        self.assertEqual(self.execute()['status'], 'blocked')
        self.assertEqual(self.writes, [])

    def test_other_learner_calendar_identity_cannot_check_operation(self):
        self.operation()
        with self.assertRaises(self.calendar.Blocked):
            self.ns['execute_edit']('OTHER', 'OP', 'OTHER-ACTOR', self.access)
        self.assertEqual(self.writes, [])

    def test_existing_occurrence_change_never_rewrites_history(self):
        self.operation()
        self.events[0]['start']['dateTime'] = '2030-10-19T12:00:00Z'
        self.assertEqual(self.execute()['status'], 'verification_pending')
        self.ns['persist_move'].assert_not_called()

    def test_pending_extension_and_calendar_actions_serialize_edits(self):
        for key in ('importedExtension', 'management'):
            self.assertTrue(self.ns['pending']({key: {'status': 'uncertain'}}))

    def test_missing_or_foreign_online_permissions_never_grant_options_write(self):
        self.assertIsNone(self.ns['online_path'](self.series, {'scopes': ['Calendars.ReadWrite']}))

    def moves(self, change, *, status='scheduled', participants=0, event_id='O-1'):
        start, end = self.calendar.event_slot(self.events[0])
        rows = [{'id': 'OCC-1', 'session_number': 1, 'status': status, 'participant_count': participants,
                 'scheduled_start': start, 'scheduled_end': end}]
        source = {'path': 'users/OWNER/events/MASTER', 'events': copy.deepcopy(self.events)}
        source['events'][0]['id'] = event_id
        return self.ns['move_commands'](source, {'sessions': [change]}, rows, {}, 'Europe/London')

    def test_future_move_uses_utc_and_changes_only_the_selected_occurrence(self):
        result = self.moves({'sessionNumber': 1, 'start': '2030-10-18T12:00:00Z', 'durationMinutes': 120})
        self.assertEqual(len(result), 1)
        command = result[0]
        self.assertEqual(command['occurrenceId'], 'OCC-1')
        self.assertEqual(command['eventId'], 'O-1')
        self.assertEqual(command['exception']['startTime'], '13:00')
        self.assertEqual(command['patch'], {'start': {'dateTime': '2030-10-18T12:00:00Z', 'timeZone': 'UTC'},
                                           'end': {'dateTime': '2030-10-18T14:00:00Z', 'timeZone': 'UTC'}})
        self.assertNotIn('attendees', command['patch'])
        self.assertNotIn('recurrence', command['patch'])
        self.assertEqual(self.writes, [])

    def test_cancellation_and_attendance_history_block_a_move(self):
        for status, count in [('cancelled', 0), ('completed', 20), ('scheduled', 1)]:
            with self.assertRaises(ValueError):
                self.moves({'sessionNumber': 1, 'start': '2030-10-18T12:00:00Z', 'durationMinutes': 120}, status=status, participants=count)

    def test_foreign_session_and_past_or_invalid_time_are_refused(self):
        for change in [{'sessionNumber': 2, 'start': '2030-10-18T12:00:00Z', 'durationMinutes': 120},
                       {'sessionNumber': 1, 'start': '2020-10-18T12:00:00Z', 'durationMinutes': 120},
                       {'sessionNumber': 1, 'start': '2030-10-18T12:00:00Z', 'durationMinutes': -1}]:
            with self.assertRaises(ValueError):
                self.moves(change)

    def test_move_into_selected_holiday_is_refused(self):
        self.v.holiday_date_set = lambda _: {date(2030, 10, 18)}
        with self.assertRaises(ValueError):
            self.moves({'sessionNumber': 1, 'start': '2030-10-18T12:00:00Z', 'durationMinutes': 120})

    def test_unchanged_time_generates_no_date_command(self):
        self.assertEqual(self.moves({'sessionNumber': 1, 'start': '2030-10-18T11:00:00Z', 'durationMinutes': 120}), [])

    def test_business_timezone_dst_ambiguous_clock_is_refused(self):
        with self.assertRaises(ValueError):
            self.moves({'sessionNumber': 1, 'start': '2030-10-27T01:30:00Z', 'durationMinutes': 120})

    def test_move_does_not_cross_neighbour_or_change_session_order(self):
        self.events.append(event('2030-10-25', 'O-2'))
        rows = [{'id': f'OCC-{index}', 'session_number': index, 'status': 'scheduled',
                 'scheduled_start': self.calendar.event_slot(item)[0], 'scheduled_end': self.calendar.event_slot(item)[1]}
                for index, item in enumerate(self.events, 1)]
        with self.assertRaises(ValueError):
            self.ns['move_commands']({'path': 'users/OWNER/events/MASTER', 'events': self.events},
                                    {'sessions': [{'sessionNumber': 1, 'start': '2030-10-25T13:00:00Z', 'durationMinutes': 120}]}, rows, {}, 'Europe/London')

    def test_event_clock_format_variation_does_not_invent_drift(self):
        equivalent = copy.deepcopy(self.master)
        equivalent['start'] = {'dateTime': '2030-10-18T11:00:00.0000000', 'timeZone': 'UTC'}
        self.assertEqual(self.ns['event_state'](equivalent), self.ns['event_state'](self.master))

    def test_confirm_requires_owner_and_review_acknowledgement(self):
        operation = self.operation()
        with self.assertRaises(ValueError):
            self.ns['confirm_edit']('LIVE', {'previewToken': operation}, 'STAFF', self.access)
        with self.assertRaises(self.calendar.Blocked):
            self.ns['confirm_edit']('LIVE', {'previewToken': operation, 'acknowledge': True}, 'OTHER', self.access)

    def prepare_edit(self, changes):
        self.ns['verified_context'] = Mock(return_value=('users/OWNER/events/MASTER', copy.deepcopy(self.master), copy.deepcopy(self.events), date(2030, 11, 1)))
        self.calendar.original_master = Mock(return_value=('users/OWNER/events/MASTER', self.master))
        self.series['timezone'] = 'Europe/London'
        data = self.ns['read_edit']('LIVE', 'STAFF', self.access)
        self.assertEqual(data['status'], 'editable')
        self.assertEqual(self.writes, [])
        self.source_token = data['sourceToken']
        return self.ns['review_edit']('LIVE', {'sourceToken': self.source_token, 'changes': changes, 'notify': False}, 'STAFF', self.access)

    def test_read_review_confirm_is_scoped_and_does_not_write_until_confirm(self):
        reviewed = self.prepare_edit({'attendees': ['new@example.invalid']})
        self.assertEqual(reviewed['status'], 'ready')
        self.assertEqual(self.writes, [])
        self.assertNotIn('accessToken', reviewed['previewToken'])
        result = self.ns['confirm_edit']('LIVE', {'previewToken': reviewed['previewToken'], 'acknowledge': True}, 'STAFF', self.access)
        self.assertEqual(result['status'], 'confirmed')
        self.assertEqual(self.objects['users/OWNER/events/MASTER']['attendees'],
                         [{'emailAddress': {'address': 'new@example.invalid'}, 'type': 'required'}])
        self.assertEqual(self.objects['users/OWNER/onlineMeetings/ONLINE']['participants']['attendees'],
                         [{'upn': 'new@example.invalid', 'role': 'attendee'}])
        self.assertEqual(self.objects['users/OWNER/onlineMeetings/ONLINE']['participants']['organizer'], self.meeting['participants']['organizer'])
        repeated = self.ns['confirm_edit']('LIVE', {'previewToken': reviewed['previewToken'], 'acknowledge': True}, 'STAFF', self.access)
        self.assertEqual(repeated['status'], 'confirmed')
        self.assertEqual(len(self.writes), 2)

    def test_partial_update_preserves_other_attendee_invitation_types(self):
        reviewed = self.prepare_edit({'attendees': ['old@example.invalid', 'new@example.invalid']})
        command = next(item for item in reviewed['previewToken']['commands'] if item['type'] == 'event')
        self.assertEqual(command['patch']['attendees'][0], self.master['attendees'][0])
        self.assertEqual(command['patch']['attendees'][0]['type'], 'optional')

    def test_source_owner_and_calendar_version_are_rechecked_for_review(self):
        self.prepare_edit({'language': 'ar-EG'})
        with self.assertRaises(self.calendar.Blocked):
            self.ns['review_edit']('OTHER', {'sourceToken': self.source_token, 'changes': {}}, 'STAFF', self.access)
        self.objects['users/OWNER/events/MASTER']['attendees'] = []
        with self.assertRaises(self.calendar.Blocked):
            self.ns['review_edit']('LIVE', {'sourceToken': self.source_token, 'changes': {'language': 'ar-EG'}}, 'STAFF', self.access)
        self.assertEqual(self.writes, [])

    def test_new_review_cannot_clear_a_pending_attempt(self):
        self.operation()
        self.assertEqual(self.ns['read_edit']('LIVE', 'STAFF', self.access)['status'], 'verification_pending')
        self.assertEqual(self.writes, [])

    def test_future_move_verifies_original_instance_and_persists_the_same_occurrence(self):
        occurrence = {**self.events[0], '@odata.etag': 'INSTANCE-1'}
        self.objects['users/OWNER/events/O-1'] = copy.deepcopy(occurrence)
        self.calendar.instances.side_effect = lambda *_: [copy.deepcopy(self.objects['users/OWNER/events/O-1'])]
        reviewed = self.prepare_edit({'sessions': [{'sessionNumber': 1, 'start': '2030-10-18T12:00:00Z', 'durationMinutes': 120}]})
        result = self.ns['confirm_edit']('LIVE', {'previewToken': reviewed['previewToken'], 'acknowledge': True}, 'STAFF', self.access)
        self.assertEqual(result['status'], 'confirmed')
        self.assertEqual(len(self.writes), 1)
        path, patch_body, headers = self.writes[0]
        self.assertEqual(path, 'users/OWNER/events/O-1')
        self.assertEqual(headers['If-Match'], 'INSTANCE-1')
        self.assertEqual(set(patch_body), {'start', 'end'})
        command = self.ns['persist_move'].call_args.args[3]
        self.assertEqual((command['occurrenceId'], command['eventId']), ('OCC-1', 'O-1'))
        self.assertEqual(command['exception']['startTime'], '13:00')
        self.v.update_authoring_rows.assert_not_called()

    def test_existing_attendance_reference_blocks_future_move(self):
        self.rows[0]['attendance_report_id'] = 'KEEP-HISTORICAL-REPORT'
        source = {'path': 'users/OWNER/events/MASTER', 'events': self.events}
        with self.assertRaises(ValueError):
            self.ns['move_commands'](source, {'sessions': [{'sessionNumber': 1, 'start': '2030-10-18T12:00:00Z', 'durationMinutes': 120}]}, self.rows, {}, 'Europe/London')

    def test_new_routes_share_staff_post_and_csrf_endpoint(self):
        root = Path(__file__).parent
        tree = ast.parse((root / 'teams_imported_calendar_update.py').read_text(encoding='utf-8-sig'))
        endpoint = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'imported_calendar_update')
        decorators = [ast.unparse(node) for node in endpoint.decorator_list]
        self.assertIn("require_role('admin', 'staff')", decorators)
        self.assertIn('require_POST', decorators)
        self.assertNotIn('csrf_exempt', decorators)
        routes = (root / 'urls.py').read_text(encoding='utf-8-sig')
        for action in ('edit-read', 'edit-preview', 'edit-confirm', 'edit-status'):
            self.assertIn(f"imported-calendar/{action}/', imported_calendar_update", routes)


if __name__ == '__main__':
    unittest.main()
