"""Compare real public facades with frozen bodies using synthetic read/write ports.

No application setup, credentials or records are loaded. Existing PostgreSQL
tests separately exercise the real adapters in the disposable environment.
"""
import ast
from curriculum_api.catalogue.tests.parity.current_entry_source import current_entry_tree
from collections import Counter, defaultdict
from contextlib import nullcontext
import copy
from datetime import datetime
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

from curriculum_api.meetings.tests.source_loader import CALENDAR_SNAPSHOT

ROOT = Path(__file__).resolve().parents[2]
TREE = current_entry_tree()
CURRENT = {n.name: n for n in TREE.body if isinstance(n, ast.FunctionDef)}
OFF_CALENDAR = {'cancelled', 'canceled', 'declined', 'deleted', 'removed', 'superseded'}


class Clock(datetime):
    @classmethod
    def utcnow(cls):
        return cls(2026, 11, 22, 12)


class Response(dict):
    def __init__(self, body, status=200):
        super().__init__(body)
        self.status_code = status


def forbidden(*args, **kwargs):
    raise AssertionError('Unreviewed synthetic capability used')


def fixture():
    calls = []
    rows = {
        'series': [{'id': 'LIVE-SYNTHETIC', 'module_catalogue_id': 'MOD-SYNTHETIC',
                    'status': 'active', 'join_url': 'https://example.invalid/join', 'warnings': []}],
        'occurrences': [{'id': 'OCC-SYNTHETIC', 'live_session_id': 'LIVE-SYNTHETIC',
                         'session_number': 1, 'status': 'scheduled',
                         'scheduled_start': '2026-12-01T12:00:00Z', 'scheduled_end': '2026-12-01T13:00:00Z'}],
        'modules': [{'module_catalogue_id': 'MOD-SYNTHETIC', 'cohort_id': 'COHORT-SYNTHETIC'}],
    }

    def fetch(table, *args):
        calls.append(('read', table, copy.deepcopy(args)))
        value = rows[table]
        if isinstance(value, Exception):
            raise value
        return copy.deepcopy(value)

    def attach(*args, **kwargs):
        calls.append(('attach', copy.deepcopy(args), copy.deepcopy(kwargs)))
        return 2, 1

    def cached(key, factory, **kwargs):
        calls.append(('cache', key, kwargs))
        return factory()

    ns = {key: forbidden for entry in CALENDAR_SNAPSHOT['functions'].values() for key in entry['globals']}
    ns.update({
        '__package__': 'curriculum_api', 'csrf_exempt': lambda f: f, 'require_GET': lambda f: f,
        'datetime': Clock, 'Counter': Counter, 'defaultdict': defaultdict,
        'LIVE_SESSIONS_TABLE': 'series', 'LIVE_SESSION_OCCURRENCES_TABLE': 'occurrences',
        'AUTHORING_MODULES_TABLE': 'modules', 'GROUPS_TABLE': 'groups',
        'TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES': OFF_CALENDAR, 'TEAMS_SYNC_REPORTED_DATE_LIMIT': 12,
        'clean_str': lambda value: str(value or '').strip(),
        'parse_int': lambda value, default=0: int(value) if value not in (None, '') else default,
        'parse_json_value': lambda value, default: json.loads(value) if isinstance(value, str) else value or default,
        'parse_graph_datetime': lambda value: datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None,
        'utc_iso_value': lambda value: value or '', 'truthy': lambda value: value in (True, 'true', '1'),
        'JsonResponse': Response, 'json_error': lambda message, status=400, **kw: Response({'error': message, **kw}, status),
        'logger': SimpleNamespace(warning=lambda *a, **k: None, debug=lambda *a, **k: None, exception=lambda *a, **k: None),
        'authoring_fetch_all': fetch, 'ensure_live_session_tracking_tables': lambda: None,
        'ensure_module_authoring_tables': lambda: None, 'authoring_module_exists': lambda key: {'module_catalogue_id': key},
        'resolve_stored_module_catalogue_id': lambda key: 'MOD-SYNTHETIC', 'teams_module_owner_id': lambda key: key,
        'curriculum_in_clause': lambda field, ids: (field + ' in (' + ', '.join(['%s'] * len(ids)) + ')', list(ids)),
        'curriculum_results_response': lambda values, **kw: Response({'results': values}),
        'graph_timezone_iana': lambda settings: 'Europe/London', 'teams_schedule_settings': lambda settings, **kw: settings,
        'teams_series_email_list': lambda value: value or [], 'stored_calendar_series': lambda row: [],
        'microsoft_update_summary': lambda warnings: {'state': 'saved'},
        'live_session_row_to_component_settings': lambda row: {'teamsMeetingUrl': row['join_url']},
        'attach_teams_meeting_to_module_weeks': attach,
        'json_body': lambda request: request.body,
        'get_authoring_structure_payload': lambda key: {'id': key},
        'stamp_revision_after_write': lambda payload, key: {**payload, 'revision': 'after'},
        'structure_payload_with_revision': lambda factory, key: {**factory(), 'revision': 'current'},
        'cached_curriculum_value': cached, 'curriculum_read_scope': lambda **kw: nullcontext(),
        'request_bypasses_curriculum_cache': lambda request: False,
        'teams_calendar_minute_key': lambda value: str(value or '')[:16],
        'module_expected_teams_occurrence_keys': lambda *a: (['2026-12-01T12:00'], {'warnings': []}),
        'cohort_selected_holidays_by_cohort': lambda ids: {'COHORT-SYNTHETIC': []},
        'authoring_session_links_by_catalogue': lambda *a, **kw: {'MOD-SYNTHETIC': []},
    })
    return ns, rows, calls


class CalendarBehaviorParity(unittest.TestCase):
    def compare(self, name, args, change=lambda ns, rows: None, **kwargs):
        outcomes = []
        for original in (True, False):
            ns, rows, calls = fixture()
            # The summary's real verdict path is compared too, including unreadable data.
            for symbol in ('teams_calendar_sync_verdict', 'teams_calendar_sync_verdicts', name):
                node = ast.parse(CALENDAR_SNAPSHOT['functions'][symbol]['source']).body[0] if original else CURRENT[symbol]
                exec(compile(ast.Module(body=[node], type_ignores=[]), '<meeting-parity>', 'exec'), ns)
            change(ns, rows)
            response = ns[name](*copy.deepcopy(args), **copy.deepcopy(kwargs))
            state = {key: (type(value).__name__, str(value)) if isinstance(value, Exception) else value for key, value in rows.items()}
            outcomes.append((copy.deepcopy(response), getattr(response, 'status_code', None), calls, state))
        self.assertEqual(outcomes[0], outcomes[1])
        return outcomes[1]

    def request(self, method='GET', **query):
        return SimpleNamespace(method=method, GET=query, body={})

    def test_summary_counts_and_opt_in_verdict(self):
        result, _, calls, _ = self.compare('curriculum_teams_meeting_summary', [self.request(moduleCatalogueIds='MOD-SYNTHETIC', occurrenceDates='1')])
        row = result['results'][0]
        self.assertEqual((row['occurrenceCount'], row['syncState']), (1, 'in-sync'))
        self.assertEqual(row['occurrenceDates'], ['2026-12-01T12:00:00Z'])
        self.assertEqual([call[1] for call in calls], ['series', 'occurrences', 'modules'])

    def test_summary_newest_series_and_cancelled_occurrences(self):
        def change(ns, rows):
            rows['series'].append({**rows['series'][0], 'id': 'OLDER'})
            rows['occurrences'].append({**rows['occurrences'][0], 'id': 'CANCELLED', 'status': 'cancelled'})
        result, _, _, _ = self.compare('curriculum_teams_meeting_summary', [self.request()], change)
        self.assertEqual(len(result['results']), 1)
        self.assertEqual(result['results'][0]['occurrenceCount'], 1)
        self.assertNotIn('occurrenceDates', result['results'][0])

    def test_unreadable_occurrences_are_unverified(self):
        result, _, _, _ = self.compare('curriculum_teams_meeting_summary', [self.request(occurrence_dates='1')],
                                      lambda ns, rows: rows.update(occurrences=RuntimeError('synthetic outage')))
        self.assertEqual(result['results'][0]['syncReasons'], ['occurrences_unreadable'])

    def test_pending_verification_overrides_matching_dates(self):
        result, _, _, _ = self.compare('curriculum_teams_meeting_summary', [self.request(occurrence_dates='1')],
                                      lambda ns, rows: rows['series'][0].update(warnings=[{'code': 'pending'}]))
        self.assertEqual(result['results'][0]['syncState'], 'unverified')

    def test_existing_series_read_error_response_is_preserved(self):
        result, _, _, _ = self.compare('curriculum_teams_meeting_summary', [self.request()],
                                      lambda ns, rows: rows.update(series=RuntimeError('synthetic outage')))
        self.assertEqual(result, {'results': []})

    def test_occurrences_without_ids_do_not_read(self):
        result, _, calls, _ = self.compare('curriculum_live_session_occurrences', [self.request()])
        self.assertEqual(result, {'series': [], 'occurrences': []})
        self.assertEqual(calls, [])

    def test_occurrences_keep_filters_order_and_stored_status(self):
        result, _, calls, _ = self.compare('curriculum_live_session_occurrences', [self.request(moduleCatalogueIds='MOD-SYNTHETIC', liveSessionIds='LIVE-SYNTHETIC')],
                                      lambda ns, rows: rows['occurrences'][0].update(status='cancelled'))
        self.assertEqual(result['occurrences'][0]['status'], 'cancelled')
        self.assertIn(' or ', calls[0][2][0])
        self.assertEqual(calls[1][2][-1], 'live_session_id, session_number')

    def test_restore_get_never_attaches(self):
        result, _, calls, _ = self.compare('curriculum_module_teams_meeting_restore', [self.request(), 'legacy-alias'])
        self.assertFalse(result['restored'])
        self.assertFalse(any(call[0] == 'attach' for call in calls))
        self.assertEqual(result['module']['revision'], 'current')

    def test_restore_get_probe_is_dry_run(self):
        result, _, calls, _ = self.compare('curriculum_module_teams_meeting_restore', [self.request(probe='1'), 'legacy-alias'])
        attachment = next(call for call in calls if call[0] == 'attach')
        self.assertEqual(attachment[2], {'create_missing': True, 'dry_run': True})
        self.assertEqual(result['pendingComponents'], 1)

    def test_restore_post_writes_owner_and_rebuilds_alias(self):
        request = self.request('POST')
        request.body = {'createMissingComponents': True}
        result, _, calls, _ = self.compare('curriculum_module_teams_meeting_restore', [request, 'legacy-alias'],
                                      lambda ns, rows: ns.update(teams_module_owner_id=lambda key: 'SOURCE'))
        attachment = next(call for call in calls if call[0] == 'attach')
        self.assertEqual((attachment[1][0], attachment[2]), ('SOURCE', {'create_missing': True}))
        self.assertEqual(result['module'], {'id': 'MOD-SYNTHETIC', 'revision': 'after'})
        self.assertFalse(any(call[0] == 'cache' for call in calls))

    def test_restore_post_blocks_unverified_calendar(self):
        result, status, calls, _ = self.compare('curriculum_module_teams_meeting_restore', [self.request('POST'), 'MOD-SYNTHETIC'],
                                               lambda ns, rows: rows['series'][0].update(warnings=[{'code': 'pending'}]))
        self.assertEqual(status, 409)
        self.assertFalse(any(call[0] == 'attach' for call in calls))

    def test_restore_external_read_only_warning_allows_local_attachment(self):
        result, status, _, _ = self.compare('curriculum_module_teams_meeting_restore', [self.request('POST'), 'MOD-SYNTHETIC'],
                                            lambda ns, rows: rows['series'][0].update(meeting_type='linked-external', warnings=[{'code': 'external_calendar_read_only'}]))
        self.assertEqual(status, 200)
        self.assertTrue(result['restored'])

    def test_restore_missing_series_stays_404(self):
        _, status, _, _ = self.compare('curriculum_module_teams_meeting_restore', [self.request(), 'MOD-SYNTHETIC'],
                                      lambda ns, rows: rows.update(series=[]))
        self.assertEqual(status, 404)

    def test_multiset_verdict_detects_duplicate_date(self):
        occurrence = {'scheduled_start': '2026-12-01T12:00:00Z', 'status': 'scheduled'}
        result, _, _, _ = self.compare('teams_calendar_sync_verdict', [{'id': 'MOD'}, [occurrence, occurrence]])
        self.assertEqual((result['syncState'], result['differingOccurrences']), ('out-of-sync', 1))

    def test_module_read_failure_cannot_report_in_sync(self):
        result, _, _, _ = self.compare('teams_calendar_sync_verdicts', [['MOD-SYNTHETIC'], {}],
                                      lambda ns, rows: rows.update(modules=RuntimeError('synthetic outage')))
        self.assertEqual(result['MOD-SYNTHETIC']['syncReasons'], ['module_missing'])

    def test_calendar_unavailable_uses_existing_display_reader(self):
        class CalendarUnavailable(ValueError):
            pass
        country, delivery = ModuleType('curriculum_api.country_calendars'), ModuleType('curriculum_api.delivery_calendar')
        country.CalendarUnavailable = CalendarUnavailable
        delivery.display_cohort_holidays = lambda ids: {'COHORT-SYNTHETIC': []}

        def change(ns, rows):
            def fail(ids):
                raise CalendarUnavailable('synthetic unavailable')
            ns['cohort_selected_holidays_by_cohort'] = fail

        with patch.dict(sys.modules, {country.__name__: country, delivery.__name__: delivery,
                                          'curriculum_api.catalogue.infrastructure.country_calendar_reads': country,
                                          'curriculum_api.catalogue.infrastructure.calendar_display': delivery}):
            result, _, _, _ = self.compare('teams_calendar_sync_verdicts', [['MOD-SYNTHETIC'], {}], change)
        self.assertEqual(result['MOD-SYNTHETIC']['syncReasons'], ['no_tracked_occurrences'])

    def test_other_value_errors_do_not_load_the_display_reader(self):
        country, delivery = ModuleType('curriculum_api.country_calendars'), ModuleType('curriculum_api.delivery_calendar')
        country.CalendarUnavailable = type('CalendarUnavailable', (ValueError,), {})
        delivery.__getattr__ = forbidden
        for original in (True, False):
            ns, _, _ = fixture()
            def fail(ids):
                raise ValueError('unrelated validation failure')
            ns['cohort_selected_holidays_by_cohort'] = fail
            name = 'teams_calendar_sync_verdicts'
            node = ast.parse(CALENDAR_SNAPSHOT['functions'][name]['source']).body[0] if original else CURRENT[name]
            exec(compile(ast.Module(body=[node], type_ignores=[]), '<meeting-parity>', 'exec'), ns)
            with patch.dict(sys.modules, {country.__name__: country, delivery.__name__: delivery,
                                          'curriculum_api.catalogue.infrastructure.country_calendar_reads': country,
                                          'curriculum_api.catalogue.infrastructure.calendar_display': delivery}):
                with self.assertRaisesRegex(ValueError, 'unrelated validation failure'):
                    ns[name](['MOD-SYNTHETIC'], {})

    def link_fixture(self, ns, rows):
        rows['components'] = [
            {'id': 'MAIN-1', 'week_id': 'W1', 'type': 'live_session', 'settings_json': {'liveSessionUrl': 'https://example.invalid/old'}},
            {'id': 'MAIN-2', 'week_id': 'W2', 'type': 'live_session', 'settings_json': {'liveSessionUrl': 'https://example.invalid/old'}},
            {'id': 'EXTRA', 'week_id': 'W1', 'type': 'live_session', 'settings_json': {'extraTeamsMeetingUrl': 'https://example.invalid/extra'}},
        ]
        read = ns['authoring_fetch_all']
        def fetch(table, where, params, *args):
            data = read(table, where, params, *args)
            return [row for row in data if row['week_id'] in params[1:]] if 'week_id in' in where else data
        def update(table, where, params, values):
            target = next(row for row in rows[table] if row['id' if table == 'components' else 'module_catalogue_id'] == params[0])
            target.update(copy.deepcopy(values))
        ns.update({
            'AUTHORING_COMPONENTS_TABLE': 'components', 'STRUCTURE_REVISION_UNAVAILABLE': 'unavailable',
            'SchemaNotProvisioned': type('SchemaNotProvisioned', (Exception,), {}),
            'http_url': lambda value: value.startswith('https://'), 'unique': lambda values: list(dict.fromkeys(values)),
            'archived_programme_module_edit_error': lambda *a, **kw: None,
            'transaction': SimpleNamespace(atomic=nullcontext), 'lock_module_structure_row': lambda key: None,
            'module_structure_revision': lambda key: 'r1', 'module_has_active_teams_series': lambda key: False,
            'active_teams_series_for_join_link': lambda *a, **kw: 'SOURCE',
            'active_component_rows': lambda values: values, 'component_builder_settings': lambda row: row['settings_json'],
            'frontend_component_type': lambda value: value.replace('_', '-'), 'authoring_fetch_all': fetch,
            'update_authoring_rows': update, 'as_json_value': lambda value, default: value or default,
            'json_db_value': lambda value: value, 'invalidate_curriculum_cache': lambda: None,
            'strip_shared_teams_delivery_settings': lambda settings: dict(settings),
        })
        return ns

    def links(self, week_ids):
        outcomes = []
        for original in (True, False):
            ns, rows, calls = fixture()
            self.link_fixture(ns, rows)
            for name in ('replaceable_live_session', 'curriculum_module_teams_links_replace'):
                node = ast.parse(CALENDAR_SNAPSHOT['functions'][name]['source']).body[0] if original else CURRENT[name]
                exec(compile(ast.Module(body=[node], type_ignores=[]), '<link-parity>', 'exec'), ns)
            request = self.request('POST')
            request.body = {'link': 'https://example.invalid/new', 'weekIds': week_ids, 'expectedRevision': 'r1'}
            result = ns['curriculum_module_teams_links_replace'](request, 'MOD-SYNTHETIC')
            self.assertEqual(result.status_code, 200)
            outcomes.append((result, rows, calls))
        self.assertEqual(outcomes[0], outcomes[1])
        return outcomes[1]

    def test_partial_link_replacement_does_not_reassign_other_weeks(self):
        result, rows, _ = self.links(['W1'])
        self.assertEqual(result['updatedComponentIds'], ['MAIN-1'])
        self.assertEqual(result['recordingsSourceModuleId'], '')
        self.assertNotIn('teams_shared_source_module_id', rows['modules'][0])
        self.assertEqual(rows['components'][1]['settings_json']['liveSessionUrl'], 'https://example.invalid/old')
        self.assertEqual(rows['components'][2]['settings_json'], {'extraTeamsMeetingUrl': 'https://example.invalid/extra'})

    def test_all_main_links_can_share_source_and_duplicate_selection_is_deduplicated(self):
        result, rows, _ = self.links(['W1', 'W2', 'W1'])
        self.assertEqual(result['updatedComponentIds'], ['MAIN-1', 'MAIN-2'])
        self.assertEqual(rows['modules'][0]['teams_shared_source_module_id'], 'SOURCE')
        self.assertTrue(result['revisionWasCurrent'])


if __name__ == '__main__':
    unittest.main()
