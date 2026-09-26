"""Real attachment functions, in-memory rows only; no Django setup or network."""
import ast
import copy
import unittest
import uuid
from collections import defaultdict
from contextlib import nullcontext
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
            DEFAULT_TEAMS_LOBBY_BYPASS='everyone',
            TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES={'cancelled', 'canceled', 'declined', 'deleted', 'removed'},
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
            resolve_stored_module_catalogue_id=lambda value: value,
            authoring_module_exists=lambda value: value == 'MOD-1', json_body=lambda request: {}, truthy=bool,
            get_authoring_structure_payload=lambda module_id: {'catalogueId': module_id},
            stamp_revision_after_write=lambda payload, module_id: {**payload, 'structureRevision': 'new-revision'},
            structure_payload_with_revision=lambda build, module_id: {**build(), 'structureRevision': 'new-revision'},
            curriculum_read_scope=lambda **kwargs: nullcontext(),
            cached_curriculum_value=lambda _key, factory, **kwargs: factory(),
            request_bypasses_curriculum_cache=lambda _request: False,
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
            self.assertEqual(settings['sessionDate'], f'2026-10-{23 + i * 7}')
            self.assertEqual(settings['sessionDay'], 'Friday')
            self.assertEqual(settings['sessionTime'], '09:00')
            self.assertEqual(settings['sessionPurpose'], 'Keep outline')
            self.assertEqual(settings['recordingUrl'], 'https://example.invalid/saved-recording')

    def test_restore_replaces_a_stale_component_date_with_the_verified_occurrence(self):
        self.components[0]['settings_json'].update(
            sessionDate='2026-12-04', sessionDay='Friday', sessionTime='15:30',
            teamsLiveSessionId='LIVE-1', teamsSessionNumber=1,
        )

        self.restore('POST')

        first = self.writes[0][1]['settings_json']
        self.assertEqual((first['sessionDate'], first['sessionDay'], first['sessionTime']),
                         ('2026-10-23', 'Friday', '09:00'))
        self.assertEqual(first['teamsOccurrenceId'], 'OCC-0')
        self.assertEqual(first['sessionPurpose'], 'Keep outline')

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


class OccurrenceReplacementTests(unittest.TestCase):
    """A repaired date must not move attendance identity to another session."""

    def test_inserting_25_september_keeps_9_october_identity_and_cancels_the_extra(self):
        rows = [
            {'id': 'OCC-SEP18', 'session_number': 1, 'scheduled_start': '2026-09-18T08:00:00Z',
             'scheduled_end': '2026-09-18T10:00:00Z', 'status': 'completed', 'created_at': 'old'},
            {'id': 'OCC-OCT09', 'session_number': 2, 'scheduled_start': '2026-10-09T08:00:00Z',
             'scheduled_end': '2026-10-09T10:00:00Z', 'status': 'scheduled', 'created_at': 'old'},
            {'id': 'OCC-DEC18', 'session_number': 3, 'scheduled_start': '2026-12-18T09:00:00Z',
             'scheduled_end': '2026-12-18T11:00:00Z', 'status': 'scheduled', 'created_at': 'old'},
        ]
        targets = [
            {'session_number': 1, 'start': '2026-09-18T08:00:00Z', 'end': '2026-09-18T10:00:00Z'},
            {'session_number': 2, 'start': '2026-09-25T08:00:00Z', 'end': '2026-09-25T10:00:00Z'},
            {'session_number': 3, 'start': '2026-10-09T08:00:00Z', 'end': '2026-10-09T10:00:00Z'},
        ]

        def update(_table, _where, values, payload):
            row = next(item for item in rows if item['id'] == values[0])
            row.update(copy.deepcopy(payload))

        def upsert(_table, _keys, payload):
            rows.append(copy.deepcopy(payload))

        namespace = {
            'datetime': datetime,
            'uuid': uuid,
            'ensure_live_session_tracking_tables': lambda: None,
            'scheduled_live_session_occurrences': lambda *args: copy.deepcopy(targets),
            'authoring_fetch_all': lambda *args: rows,
            'clean_str': lambda value: str(value or '').strip(),
            'teams_calendar_minute_key': lambda value: str(value or '').replace('.000Z', 'Z'),
            'update_authoring_rows': update,
            'authoring_upsert': upsert,
            'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences',
        }
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        node = next(node for node in tree.body
                    if isinstance(node, ast.FunctionDef) and node.name == 'replace_live_session_occurrences')
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'occurrence-replacement', 'exec'), namespace)

        namespace['replace_live_session_occurrences'](
            'LIVE-1', {}, None, 120, 'weekly', 3,
            event_id='EVENT-SERIES', join_url='https://teams.microsoft.com/meet/series',
        )

        by_id = {row['id']: row for row in rows}
        self.assertEqual((by_id['OCC-SEP18']['session_number'], by_id['OCC-SEP18']['status']), (1, 'completed'))
        self.assertEqual((by_id['OCC-OCT09']['session_number'], by_id['OCC-OCT09']['scheduled_start']),
                         (3, '2026-10-09T08:00:00Z'))
        self.assertEqual(by_id['OCC-DEC18']['status'], 'cancelled')
        added = next(row for row in rows if row['scheduled_start'] == '2026-09-25T08:00:00Z')
        self.assertEqual((added['session_number'], added['status']), (2, 'scheduled'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
