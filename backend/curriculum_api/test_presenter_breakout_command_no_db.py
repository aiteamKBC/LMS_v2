"""Exercise the repair command with synthetic SQL/Graph adapters, no app startup."""
from contextlib import contextmanager
import copy
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from django.core.management.base import CommandError
from curriculum_api.management.commands import enable_presenter_breakout_rooms as command
from curriculum_api.teams_meeting_options_policy import stored_email_list
from curriculum_api import test_teams_presenter_rooms_no_db as room_fixtures


class BreakoutCommandTests(unittest.TestCase):
    def setUp(self):
        fixtures = room_fixtures.ExistingRoomPermissionsTests()
        fixtures.setUp()
        self.meeting, self.event = fixtures.meeting, fixtures.event
        self.series = {'id': 'LIVE-SYNTHETIC', 'status': 'active', 'organizer_email': 'owner@example.invalid',
                       'presenters': ['tutor@example.invalid'], 'co_organizers': ['co@example.invalid'],
                       'graph_event_id': 'event-id', 'online_meeting_id': 'meeting-id',
                       'join_url': fixtures.target['joinUrl'], 'calendar_series': []}
        self.component = {'id': 'CARD-SYNTHETIC', 'settings_json': {
            'teamsLiveSessionId': self.series['id'], 'teamsPresenters': ['tutor@example.invalid'],
            'teamsCoOrganizers': ['co@example.invalid'], 'liveSessionUrl': self.series['join_url'],
            'unrelated': 'preserve me',
        }}
        self.sql, self.graph_calls, self.invalidations = [], [], []
        self.staff_exists = True
        self.patch_effective = True
        test = self

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def execute(self, sql, params=None):
                test.sql.append((sql, params))
                if sql.startswith('SET TRANSACTION READ ONLY'):
                    self.result = None
                elif sql.startswith('SELECT current_database()'):
                    self.result = ('synthetic',)
                elif sql.startswith('SELECT 1 FROM enrolment.'):
                    self.result = (1,) if test.staff_exists else None
                elif sql.startswith('SELECT id FROM') and 'FOR UPDATE NOWAIT' in sql:
                    self.result = (test.series['id'],)
                elif sql.startswith('UPDATE') and 'SET co_organizers' in sql:
                    test.assertEqual(params[2], test.series['id'])
                    test.series['co_organizers'] = json.loads(params[0])
                elif sql.startswith('SELECT co_organizers, presenters'):
                    self.result = (test.series['co_organizers'], test.series['presenters'])
                elif sql.startswith('UPDATE') and 'jsonb_set(settings_json' in sql:
                    test.assertEqual(params[1], test.component['id'])
                    test.assertEqual(params[2:], ['teamsLiveSessionId', test.series['id']])
                    test.component['settings_json']['teamsCoOrganizers'] = json.loads(params[0])
                    self.rowcount = 1
                else:
                    test.fail('Unexpected SQL in the role repair')
            def fetchone(self): return self.result

        self.connection = types.SimpleNamespace(vendor='postgresql', cursor=Cursor,
                                               settings_dict={'HOST': '127.0.0.1', 'NAME': 'synthetic'})
        @contextmanager
        def atomic():
            series, component = copy.deepcopy(self.series), copy.deepcopy(self.component)
            try:
                yield
            except Exception:
                self.series, self.component = series, component
                raise
        self.transactions = types.SimpleNamespace(atomic=atomic)
        def fetch(table, where='', params=None, order='', **kwargs):
            self.assertIs(kwargs.get('ensure_tables'), False)
            if table == 'live_sessions': return [copy.deepcopy(self.series)]
            if table == 'components': return [copy.deepcopy(self.component)]
            if table == 'occurrences': return []
            self.fail('Unexpected table')
        v = types.ModuleType('curriculum_api.views')
        v.LIVE_SESSIONS_TABLE = 'live_sessions'
        v.AUTHORING_COMPONENTS_TABLE = 'components'
        v.LIVE_SESSION_OCCURRENCES_TABLE = 'occurrences'
        v.authoring_fetch_all = fetch
        v.authoring_table_name = lambda table: f'"curriculum"."{table}"'
        v.table_exists = lambda table: True
        v.has_column = lambda *args: True
        v.clean_str = lambda value: str(value or '').strip()
        v.parse_json_value = lambda value, fallback: json.loads(value) if isinstance(value, str) else value or fallback
        v.teams_series_email_list = stored_email_list
        v.invalidate_curriculum_cache = lambda: self.invalidations.append(True)
        transport = types.ModuleType('coach_api.views')
        transport.has_graph_credentials = lambda: True
        def graph(method, path, payload=None, extra_headers=None):
            self.graph_calls.append((method, path, copy.deepcopy(payload)))
            if '/onlineMeetings/' in path:
                if method == 'PATCH':
                    self.assertEqual(set(payload), {'participants'})
                    if self.patch_effective:
                        self.meeting['participants']['attendees'] = copy.deepcopy(payload['participants']['attendees'])
                else:
                    self.assertEqual(method, 'GET')
                return copy.deepcopy(self.meeting)
            self.assertEqual(method, 'GET')
            if '/events/' in path: return copy.deepcopy(self.event)
            owner = 'owner%40example.invalid' in path
            return {'id': 'owner-id' if owner else 'tutor-id', 'userType': 'Member', 'accountEnabled': True,
                    'userPrincipalName': 'owner@example.invalid' if owner else 'tutor@example.invalid'}
        transport.microsoft_graph_request = graph
        self.modules = {'curriculum_api.views': v, 'coach_api.views': transport}
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)

    def run_command(self, apply=False, **changes):
        options = {'apply': apply, 'dry_run': not apply, 'live_session_id': '',
                   'expected_host': '127.0.0.1', 'expected_database': 'synthetic',
                   'backup_file': Path(self.folder.name) / 'roles-backup.jsonl'} | changes
        output = io.StringIO()
        with patch.dict('sys.modules', self.modules), patch.object(command, 'connection', self.connection), \
                patch.object(command, 'transaction', self.transactions):
            command.Command(stdout=output).handle(**options)
        return output.getvalue()

    def test_default_plan_is_read_only_in_both_database_and_microsoft(self):
        result = self.run_command()
        self.assertIn('"eligible": 1', result)
        self.assertIn('"role_changes": 1', result)
        self.assertEqual(self.sql[0][0], 'SET TRANSACTION READ ONLY')
        self.assertFalse(any(sql.startswith('UPDATE') for sql, _ in self.sql))
        self.assertTrue(all(method == 'GET' for method, _, _ in self.graph_calls))
        self.assertFalse(list(Path(self.folder.name).iterdir()))

    def test_apply_updates_both_lms_role_lists_and_card_metadata_without_sending_mail(self):
        self.run_command(apply=True)
        self.assertEqual(self.series['presenters'], ['tutor@example.invalid'])
        self.assertEqual(self.series['co_organizers'], ['co@example.invalid', 'tutor@example.invalid'])
        self.assertEqual(self.component['settings_json']['teamsCoOrganizers'], self.series['co_organizers'])
        self.assertEqual(self.component['settings_json']['liveSessionUrl'], self.series['join_url'])
        self.assertEqual(self.component['settings_json']['unrelated'], 'preserve me')
        self.assertEqual(len(self.invalidations), 1)
        writes = [path for method, path, _ in self.graph_calls if method != 'GET']
        self.assertEqual(writes, ['users/owner-id/onlineMeetings/meeting-id'])

    def test_mismatched_database_target_prevents_every_external_write(self):
        with self.assertRaisesRegex(CommandError, 'configured database does not match'):
            self.run_command(apply=True, expected_host='different-target')
        self.assertEqual(self.graph_calls, [])

    def test_unverified_staff_is_skipped_without_writes(self):
        self.staff_exists = False
        result = self.run_command(apply=True)
        self.assertIn('presenter_account_unconfirmed', result)
        self.assertTrue(all(method == 'GET' for method, _, _ in self.graph_calls))
        self.assertEqual(self.series['co_organizers'], ['co@example.invalid'])

    def test_unconfirmed_patch_stops_and_keeps_the_backup_instead_of_claiming_success(self):
        self.patch_effective = False
        with self.assertRaisesRegex(CommandError, 'update incomplete'):
            self.run_command(apply=True)
        self.assertEqual(self.series['co_organizers'], ['co@example.invalid'])
        self.assertTrue((Path(self.folder.name) / 'roles-backup.jsonl').exists())
        self.assertEqual(self.invalidations, [])


if __name__ == '__main__':
    unittest.main()
