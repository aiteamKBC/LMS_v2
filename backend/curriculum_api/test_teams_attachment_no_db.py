"""Real attachment functions, in-memory rows only; no Django setup or network."""
import ast
import copy
import unittest
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo


class AttachmentTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.series = {'id': 'LIVE-1', 'module_catalogue_id': 'MOD-1', 'join_url': 'https://teams.microsoft.com/meet/one',
                       'timezone': 'Egypt Standard Time', 'warnings': [], 'duration_minutes': 120}
        self.components = [{'id': f'COMP-{i}', 'week_id': f'WEEK-{i}', 'type': 'live_session', 'settings_json': {
            'sessionDate': f'2026-10-{23 + i * 7}', 'sessionTime': '12:00', 'sessionPurpose': 'Keep outline',
            'recordingUrl': 'https://example.invalid/saved-recording',
        }} for i in range(2)]
        self.occurrences = [{'id': f'OCC-{i}', 'session_number': i + 1, 'graph_event_id': f'EVENT-{i}',
            'scheduled_start': f'2026-10-{23 + i * 7}T0{6 + i}:00:00Z',
            'scheduled_end': f'2026-10-{23 + i * 7}T0{8 + i}:00:00Z',
            'join_url': f'https://teams.microsoft.com/meet/{i}', 'status': 'scheduled'} for i in range(2)]
        self.writes = []
        self.n = dict(datetime=datetime, timezone=timezone, ZoneInfo=ZoneInfo, defaultdict=defaultdict,
            GRAPH_WINDOWS_TO_IANA={'Egypt Standard Time': 'Africa/Cairo'}, graph_timezone_iana=lambda _: 'Europe/London',
            AUTHORING_MODULES_TABLE='modules', GROUPS_TABLE='groups', AUTHORING_WEEKS_TABLE='weeks',
            AUTHORING_COMPONENTS_TABLE='components', LIVE_SESSIONS_TABLE='series', LIVE_SESSION_OCCURRENCES_TABLE='occurrences',
            as_json_value=lambda value, default: value or default, parse_json_value=lambda value, default: value or default,
            json_db_value=lambda value: value, active_week_rows=lambda rows: rows, active_component_rows=lambda rows: rows,
            component_builder_settings=lambda row: row['settings_json'], frontend_component_type=lambda value: value.replace('_', '-'),
            module_structure_uses_session_rows=lambda *args: False, module_stored_session_count=lambda *args: 2,
            delivery_days_per_week=lambda *args: 1, module_week_session_plan=lambda *args: [],
            module_session_clock=lambda *args: ('09:00', '11:00', 120), stored_calendar_series=lambda row: [],
            format_date=lambda value: value or '', invalidate_curriculum_cache=Mock(),
            authoring_fetch_all=self.fetch, update_authoring_rows=self.update,
            csrf_exempt=lambda fn: fn, ensure_module_authoring_tables=lambda: None,
            ensure_live_session_tracking_tables=lambda: None, resolve_authoring_catalogue_id=lambda value: value,
            authoring_module_exists=lambda value: value == 'MOD-1', json_body=lambda request: {}, truthy=bool,
            get_authoring_structure_payload=lambda module_id: {'catalogueId': module_id},
            structure_payload_with_revision=lambda payload, module_id: {**payload, 'structureRevision': 'new-revision'},
            JsonResponse=lambda data: data, json_error=lambda message, **kwargs: {'error': message, **kwargs})
        names = {'clean_str', 'parse_int', 'parse_graph_datetime', 'utc_iso_value',
                 'live_session_row_to_component_settings', 'live_occurrence_component_settings',
                 'attach_teams_meeting_to_module_weeks', 'curriculum_module_teams_meeting_restore'}
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'attachment-functions', 'exec'), self.n)

    def fetch(self, table, where='', values=(), *args):
        if table in ('series', 'modules', 'weeks', 'components'):
            self.assertEqual(list(values), ['MOD-1'])
        if table == 'series':
            return [self.series]
        if table == 'occurrences':
            self.assertEqual(list(values), ['LIVE-1'])
            return self.occurrences
        if table == 'modules':
            return [{'module_catalogue_id': 'MOD-1'}]
        if table == 'weeks':
            return [{'id': f'WEEK-{i}'} for i in range(2)]
        if table == 'components':
            return self.components
        self.fail('Unexpected storage access')

    def update(self, table, where, values, payload):
        self.assertEqual(table, 'components')
        self.assertEqual(where, 'id = %s')
        self.writes.append((values[0], copy.deepcopy(payload)))

    def restore(self, method):
        return self.n['curriculum_module_teams_meeting_restore'](SimpleNamespace(method=method, GET={}), 'MOD-1')

    def test_restore_writes_each_occurrence_link_into_both_fields_and_keeps_content(self):
        result = self.restore('POST')
        self.assertEqual(result['updatedComponents'], 2)
        self.assertEqual(result['module']['structureRevision'], 'new-revision')
        for i, (component_id, write) in enumerate(self.writes):
            self.assertEqual(component_id, f'COMP-{i}')
            settings = write['settings_json']
            self.assertEqual(settings['teamsMeetingUrl'], self.occurrences[i]['join_url'])
            self.assertEqual(settings['liveSessionUrl'], write['live_sessions_link'])
            self.assertEqual(settings['teamsEventId'], f'EVENT-{i}')
            self.assertEqual(settings['sessionTimeZone'], 'Africa/Cairo')
            self.assertEqual(settings['sessionTime'], '09:00')
            self.assertEqual(settings['sessionPurpose'], 'Keep outline')
            self.assertEqual(settings['recordingUrl'], 'https://example.invalid/saved-recording')

    def test_reading_status_never_attaches_or_changes_rows(self):
        result = self.restore('GET')
        self.assertFalse(result['verificationPending'])
        self.assertEqual(result['meeting']['teamsLiveSessionId'], 'LIVE-1')
        self.assertEqual(result['calendar']['seriesMode'], 'shared')
        self.assertEqual(result['calendar']['occurrences'], [{
            'sessionNumber': i + 1, 'startDateTimeUtc': row['scheduled_start'],
            'durationMinutes': 120, 'joinUrl': row['join_url'], 'eventId': row['graph_event_id'],
        } for i, row in enumerate(self.occurrences)])
        self.assertEqual(self.writes, [])

    def test_incomplete_calendar_cannot_publish_component_links(self):
        self.series['warnings'] = ['Invitations pending calendar verification.']
        self.assertTrue(self.restore('GET')['verificationPending'])
        self.assertEqual(self.restore('POST')['code'], 'teams_calendar_verification_pending')
        self.assertEqual(self.writes, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
