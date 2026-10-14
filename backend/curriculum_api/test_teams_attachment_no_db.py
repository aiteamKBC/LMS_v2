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
            JsonResponse=lambda data: data, json_error=lambda message, **kwargs: {'error': message, **kwargs},
            LIVE_SESSION_MEETING_SCOPE_KEY='teamsMeetingScope', LIVE_SESSION_MEETING_SCOPES=('main', 'additional'))
        names = {'clean_str', 'parse_int', 'parse_graph_datetime', 'utc_iso_value',
                 'live_session_row_to_component_settings', 'live_occurrence_component_settings',
                 'occurrence_local_start', 'occurrence_local_date',
                 'live_session_booked_on_module_calendar', 'module_has_booked_series', 'live_session_meeting_scope',
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
            return getattr(self, 'weeks', None) or [{'id': f'WEEK-{i}'} for i in range(2)]
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

    def test_each_session_takes_the_meeting_on_its_own_date_across_a_numbering_gap(self):
        """Components pair with bookings by date, not by counting them off.

        The shape here is one seen in production: nine delivery slots, no live
        session in week 7, and a series whose numbering carries a gap -- session
        7 cancelled, the real bookings sitting on 8 and 9. Counting live
        components against those numbers gave week 8's session the cancelled 7
        and handed week 9's the 25 Dec meeting that belongs to week 8, leaving
        the 1 Jan booking attached to nothing. Every screen then reported a
        session that could never be brought back in line, because no update
        could change what it was paired with.
        """
        fridays = ['2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27',
                   '2026-12-04', '2026-12-11', '2026-12-18', '2026-12-25', '2027-01-01']
        self.n['module_week_session_plan'] = lambda *args: [{'date': day} for day in fridays]
        self.weeks = [{'id': f'WEEK-{number}'} for number in range(1, 10)]
        # Week 7 delivers no live session; its slot still exists in the plan.
        live_weeks = [1, 2, 3, 4, 5, 6, 8, 9]
        self.components = [{
            'id': f'COMP-W{week}', 'week_id': f'WEEK-{week}', 'type': 'live_session',
            # Weeks 8 and 9 both hold 25 Dec, which is the broken state on disk.
            'settings_json': {'sessionDate': fridays[week - 1] if week < 8 else '2026-12-25'},
        } for week in live_weeks]
        # What Microsoft actually holds: 7 was cancelled and is never passed in.
        self.occurrences = [{
            'id': f'OCC-{number}', 'session_number': number, 'graph_event_id': f'EVENT-{number}',
            'scheduled_start': f'{fridays[number - 1]}T07:00:00Z',
            'scheduled_end': f'{fridays[number - 1]}T09:00:00Z',
            'join_url': f'https://teams.microsoft.com/meet/{number}', 'status': 'scheduled',
        } for number in [1, 2, 3, 4, 5, 6, 8, 9]]

        self.n['attach_teams_meeting_to_module_weeks'](
            'MOD-1', self.series, {'sessionTimeZone': 'Africa/Cairo'}, self.occurrences,
        )

        dated = {component_id: write['settings_json']['sessionDate'] for component_id, write in self.writes}
        numbered = {component_id: write['settings_json']['teamsSessionNumber'] for component_id, write in self.writes}
        # The week that owns 25 Dec keeps it, and the week planned for 1 Jan
        # takes the booking that is actually on 1 Jan.
        self.assertEqual(dated['COMP-W8'], '2026-12-25')
        self.assertEqual(dated['COMP-W9'], '2027-01-01')
        self.assertEqual(numbered['COMP-W8'], 8)
        self.assertEqual(numbered['COMP-W9'], 9)
        # And nothing earlier was disturbed by the gap.
        for week in [1, 2, 3, 4, 5, 6]:
            self.assertEqual(dated[f'COMP-W{week}'], fridays[week - 1])

    def test_one_booking_is_never_claimed_by_two_sessions(self):
        """Two components stuck on one date cannot both take that meeting."""
        self.n['module_week_session_plan'] = lambda *args: [{'date': '2026-10-23'}, {'date': '2026-10-30'}]
        self.components = [{
            'id': f'COMP-{i}', 'week_id': f'WEEK-{i}', 'type': 'live_session',
            'settings_json': {'sessionDate': '2026-10-23'},
        } for i in range(2)]
        self.n['attach_teams_meeting_to_module_weeks'](
            'MOD-1', self.series, {'sessionTimeZone': 'Africa/Cairo'}, self.occurrences,
        )
        settings = {component_id: write['settings_json'] for component_id, write in self.writes}
        self.assertEqual(settings['COMP-0']['teamsOccurrenceId'], 'OCC-0')
        # The second falls through to the date its own week is planned for.
        self.assertEqual(settings['COMP-1']['teamsOccurrenceId'], 'OCC-1')
        self.assertEqual(settings['COMP-1']['sessionDate'], '2026-10-30')

    def attach(self):
        self.n['attach_teams_meeting_to_module_weeks'](
            'MOD-1', self.series, {'sessionTimeZone': 'Africa/Cairo'}, self.occurrences,
        )
        return {component_id: write['settings_json'] for component_id, write in self.writes}

    def test_a_week_added_after_the_calendar_exists_is_not_booked_until_it_is_chosen(self):
        """The series must not take a week nobody gave it, or an additional meeting there loses its link."""
        self.components[0]['settings_json'].update(teamsOccurrenceId='OCC-0', teamsSessionNumber=1,
                                                   teamsLiveSessionId='LIVE-1')
        settings = self.attach()
        self.assertEqual(settings['COMP-0']['teamsOccurrenceId'], 'OCC-0')
        self.assertNotIn('COMP-1', settings)

    def test_a_week_chosen_for_the_module_calendar_is_booked(self):
        self.components[0]['settings_json'].update(teamsOccurrenceId='OCC-0', teamsSessionNumber=1,
                                                   teamsLiveSessionId='LIVE-1')
        self.components[1]['settings_json']['teamsMeetingScope'] = 'main'
        settings = self.attach()
        self.assertEqual(settings['COMP-1']['teamsOccurrenceId'], 'OCC-1')

    def test_a_week_reserved_for_an_additional_meeting_is_never_handed_the_series(self):
        """Even on the very first Create, before the additional meeting itself is booked."""
        self.components[1]['settings_json']['teamsMeetingScope'] = 'additional'
        settings = self.attach()
        self.assertEqual(settings['COMP-0']['teamsOccurrenceId'], 'OCC-0')
        self.assertNotIn('COMP-1', settings)

    def test_a_held_additional_meeting_keeps_its_own_link(self):
        extra = 'https://teams.microsoft.com/meet/extra'
        self.components[1]['settings_json'].update(extraTeamsMeetingUrl=extra, teamsMeetingScope='additional')
        settings = self.attach()
        self.assertEqual(settings['COMP-1']['liveSessionUrl'], extra)
        self.assertEqual(settings['COMP-1']['teamsMeetingUrl'], extra)
        self.assertNotIn('teamsOccurrenceId', settings['COMP-1'])

    def test_an_additional_in_the_middle_does_not_shift_the_later_main_session(self):
        extra = 'https://teams.microsoft.com/meet/extra-middle'
        self.weeks = [{'id': f'WEEK-{i}'} for i in range(3)]
        self.components = [
            {'id': 'COMP-0', 'week_id': 'WEEK-0', 'type': 'live_session', 'settings_json': {}},
            {'id': 'COMP-1', 'week_id': 'WEEK-1', 'type': 'live_session', 'settings_json': {
                'extraTeamsMeetingUrl': extra, 'teamsMeetingScope': 'additional',
            }},
            {'id': 'COMP-2', 'week_id': 'WEEK-2', 'type': 'live_session', 'settings_json': {
                'sessionDate': '2026-11-06',
            }},
        ]
        dates = ['2026-10-23', '2026-10-30', '2026-11-06']
        self.occurrences = [{
            'id': f'OCC-{i}', 'session_number': i + 1, 'graph_event_id': f'EVENT-{i}',
            'scheduled_start': f'{date}T0{6 + i}:00:00Z',
            'scheduled_end': f'{date}T0{8 + i}:00:00Z',
            'join_url': f'https://teams.microsoft.com/meet/{i}', 'status': 'scheduled',
        } for i, date in enumerate(dates)]

        settings = self.attach()

        self.assertEqual(settings['COMP-0']['teamsOccurrenceId'], 'OCC-0')
        self.assertEqual(settings['COMP-0']['liveSessionUrl'], self.occurrences[0]['join_url'])
        self.assertEqual(settings['COMP-1']['liveSessionUrl'], extra)
        self.assertNotIn('teamsOccurrenceId', settings['COMP-1'])
        self.assertEqual(settings['COMP-2']['teamsOccurrenceId'], 'OCC-2')
        self.assertEqual(settings['COMP-2']['liveSessionUrl'], self.occurrences[2]['join_url'])

    def test_explicit_authoring_link_override_survives_calendar_reattach(self):
        replacement = 'https://teams.microsoft.com/meet/replacement'
        self.components[0]['settings_json']['liveSessionLinkOverride'] = replacement

        settings = self.attach()

        self.assertEqual(settings['COMP-0']['liveSessionUrl'], replacement)
        self.assertEqual(settings['COMP-0']['teamsMeetingUrl'], replacement)
        self.assertEqual(settings['COMP-0']['teamsOccurrenceId'], 'OCC-0')

    def test_moved_occurrence_carries_its_new_date_not_only_its_new_instant(self):
        """A rescheduled session's date follows the occurrence Microsoft holds.

        The schedule endpoint rewrites the occurrence and re-attaches, so the
        component used to take the new instant while keeping the date it was
        first booked on. The two then disagreed for good: every screen comparing
        dates read the old day, and no further update could clear it, because
        each one moved the instant and left the date behind.
        """
        moved = {'id': 'OCC-MOVED', 'session_number': 1, 'graph_event_id': 'EVENT-MOVED',
                 'scheduled_start': '2027-01-01T06:00:00Z', 'scheduled_end': '2027-01-01T08:00:00Z',
                 'join_url': 'https://teams.microsoft.com/meet/moved', 'status': 'scheduled'}
        settings = self.n['live_occurrence_component_settings'](moved, {'sessionTimeZone': 'Africa/Cairo'})
        self.assertEqual(settings['sessionDateTimeUtc'], '2027-01-01T06:00:00Z')
        self.assertEqual(settings['sessionDate'], '2027-01-01')
        self.assertEqual(settings['sessionDay'], 'Friday')

    def test_the_date_is_the_sessions_own_day_not_the_utc_one(self):
        """22:00 UTC is already the next day in Cairo, and that is the day it runs."""
        late = {'id': 'OCC-LATE', 'session_number': 2, 'graph_event_id': 'EVENT-LATE',
                'scheduled_start': '2026-12-31T22:00:00Z', 'scheduled_end': '2026-12-31T23:00:00Z',
                'join_url': 'https://teams.microsoft.com/meet/late', 'status': 'scheduled'}
        settings = self.n['live_occurrence_component_settings'](late, {'sessionTimeZone': 'Africa/Cairo'})
        self.assertEqual(settings['sessionDate'], '2027-01-01')
        self.assertEqual(settings['sessionDay'], 'Friday')


class OccurrenceReplacementTests(unittest.TestCase):
    """A repaired date must not move attendance identity to another session."""

    def test_inserting_25_september_keeps_9_october_identity_and_leaves_the_extra_not_in_plan(self):
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
            'transaction': SimpleNamespace(atomic=nullcontext),
        }
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        names = {'occurrence_session_number', 'pair_planned_occurrences', 'replace_live_session_occurrences'}
        nodes = [node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'occurrence-replacement', 'exec'), namespace)

        namespace['replace_live_session_occurrences'](
            'LIVE-1', {}, None, 120, 'weekly', 3,
            event_id='EVENT-SERIES', join_url='https://teams.microsoft.com/meet/series',
        )

        by_id = {row['id']: row for row in rows}
        self.assertEqual((by_id['OCC-SEP18']['session_number'], by_id['OCC-SEP18']['status']), (1, 'completed'))
        self.assertEqual((by_id['OCC-OCT09']['session_number'], by_id['OCC-OCT09']['scheduled_start']),
                         (3, '2026-10-09T08:00:00Z'))
        # Left out of the plan, never cancelled: nobody pressed Cancel on it.
        self.assertEqual(by_id['OCC-DEC18']['status'], 'superseded')
        added = next(row for row in rows if row['scheduled_start'] == '2026-09-25T08:00:00Z')
        self.assertEqual((added['session_number'], added['status']), (2, 'scheduled'))

    def test_cancelled_positive_number_is_released_before_reusing_it(self):
        rows = [{
            'id': 'OCC-CANCELLED-DEC17', 'session_number': 12,
            'scheduled_start': '2026-12-17T12:00:00Z',
            'scheduled_end': '2026-12-17T14:00:00Z',
            'status': 'cancelled', 'created_at': 'old',
        }]
        targets = [{
            'session_number': 12, 'start': '2026-12-10T12:00:00Z',
            'end': '2026-12-10T14:00:00Z',
        }]

        def update(_table, _where, values, payload):
            row = next(item for item in rows if item['id'] == values[0])
            row.update(copy.deepcopy(payload))

        namespace = {
            'datetime': datetime,
            'uuid': uuid,
            'ensure_live_session_tracking_tables': lambda: None,
            'scheduled_live_session_occurrences': lambda *args: copy.deepcopy(targets),
            'authoring_fetch_all': lambda *args: rows,
            'clean_str': lambda value: str(value or '').strip(),
            'teams_calendar_minute_key': lambda value: str(value or '').replace('.000Z', 'Z'),
            'update_authoring_rows': update,
            'authoring_upsert': lambda _table, _keys, payload: rows.append(copy.deepcopy(payload)),
            'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences',
            'transaction': SimpleNamespace(atomic=nullcontext),
        }
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        names = {'occurrence_session_number', 'pair_planned_occurrences', 'replace_live_session_occurrences'}
        nodes = [node for node in tree.body
                 if isinstance(node, ast.FunctionDef) and node.name in names]
        self.assertEqual(len(nodes), len(names))
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'occurrence-replacement', 'exec'), namespace)

        namespace['replace_live_session_occurrences'](
            'LIVE-1', {}, None, 120, 'weekly', 1,
            event_id='EVENT-SERIES', join_url='https://teams.microsoft.com/meet/series',
        )

        historical = next(row for row in rows if row['id'] == 'OCC-CANCELLED-DEC17')
        active = next(row for row in rows if row['scheduled_start'] == '2026-12-10T12:00:00Z')
        self.assertLess(historical['session_number'], 0)
        self.assertEqual((active['session_number'], active['status']), (12, 'scheduled'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
