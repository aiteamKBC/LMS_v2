"""Cohort/Group parity using actual frozen source and synthetic values only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export, bind_test_defaults
from curriculum_api.catalogue.application import placement_records
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import record_snapshots, views

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/placement_records_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_placement_records():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-placement-record>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class PlacementRecordParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.rows = {
            views.COHORT_AUTHORING_DETAILS_TABLE: [],
            views.GROUPS_TABLE: [],
        }
        self.events = []
        def read(table, where='', params=None):
            self.events.append((table, where, deepcopy(params)))
            rows = self.rows[table]
            if where:
                column = 'cohort_id' if table == views.COHORT_AUTHORING_DETAILS_TABLE else 'group_id'
                rows = [row for row in rows if row.get(column) == params[0]]
            return deepcopy(rows)
        self.read = self.stack.enter_context(composition_fixture(views, 'authoring_fetch_all', side_effect=read))

    def compare(self, name, *args):
        before = deepcopy(args)
        self.events.clear()
        with original_placement_records():
            expected = getattr(views, name)(*args)
        events = deepcopy(self.events)
        self.events.clear()
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*args)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(self.events, events)
        self.assertEqual(args, before)
        return actual

    def test_canonical_rows_preserve_unicode_strip_parameter_scope_and_first_row(self):
        for kind, table in [('cohort', views.COHORT_AUTHORING_DETAILS_TABLE), ('group', views.GROUPS_TABLE)]:
            column = kind+'_id'
            self.rows[table] = [{column: 'X', 'status': 'inactive'}, {column: 'X', 'status': 'active'}, {column: 'OTHER'}]
            result = self.compare('fetch_'+kind+'_row', '\u2003 X \u001f')
            self.assertEqual(result['status'], 'inactive')
            self.assertEqual(self.events, [(table, column+' = %s', ['X'])])
            self.assertIsNone(self.compare('fetch_'+kind+'_row', 'MISSING'))

    def test_empty_identifiers_do_not_read(self):
        for name in ('fetch_cohort_row', 'fetch_group_row', 'resolve_cohort_row', 'resolve_group_row'):
            for value in (None, '', '\u2003\t\u001f'):
                self.assertIsNone(self.compare(name, value))
                self.assertEqual(self.events, [])

    def test_read_errors_propagate_instead_of_looking_successfully_empty(self):
        self.read.side_effect = RuntimeError('synthetic reader unavailable')
        for name in ('fetch_cohort_row', 'fetch_group_row', 'resolve_cohort_row', 'resolve_group_row'):
            with original_placement_records(), self.assertRaisesRegex(RuntimeError, 'synthetic reader unavailable'):
                getattr(views, name)('X')
            with self.assertRaisesRegex(RuntimeError, 'synthetic reader unavailable'):
                getattr(views, name)('X')

    def test_resolver_canonical_fast_path_keeps_archived_records_and_skips_name_scans(self):
        for kind, table in [('cohort', views.COHORT_AUTHORING_DETAILS_TABLE), ('group', views.GROUPS_TABLE)]:
            self.rows[table] = [{kind+'_id': 'X', kind+'_name': 'Same', 'status': 'archived'}]
            self.assertEqual(self.compare('resolve_'+kind+'_row', ' X ')[kind+'_id'], 'X')
            self.assertEqual(len(self.events), 1)

    def test_identifier_alias_pass_runs_before_name_matching(self):
        for kind, table in [('cohort', views.COHORT_AUTHORING_DETAILS_TABLE), ('group', views.GROUPS_TABLE)]:
            row = {kind+'_id': 'CANONICAL', kind+'_name': 'Other'}
            self.rows[table] = [row]
            with composition_fixture(views, 'matches_curriculum_identifier', side_effect=lambda value, ident: value == 'CANONICAL' and ident == 'ALIAS') as matches, \
                 bind_test_defaults(placement_records, matches_curriculum_identifier=matches):
                self.assertEqual(self.compare('resolve_'+kind+'_row', 'ALIAS'), row)
                self.assertEqual(len(self.events), 2)
                self.assertEqual(matches.call_count, 2)

    def test_cohort_name_preserves_live_first_match_and_archived_only_fallback(self):
        table = views.COHORT_AUTHORING_DETAILS_TABLE
        self.rows[table] = [
            {'cohort_id': 'OLD', 'cohort_name': 'Same', 'status': 'inactive'},
            {'cohort_id': 'STAMP', 'cohort_name': 'Same', 'deleted_at': '2026-01-01'},
            {'cohort_id': 'C1', 'cohort_name': 'Same', 'status': 'active'},
            {'cohort_id': 'C2', 'cohort_name': 'Same', 'status': 'active'},
        ]
        self.assertEqual(self.compare('resolve_cohort_row', ' same ')['cohort_id'], 'C1')
        self.assertEqual(len(self.events), 3)
        self.rows[table] = self.rows[table][:2]
        self.assertEqual(self.compare('resolve_cohort_row', 'Same')['cohort_id'], 'OLD')

    def test_group_name_refuses_multiple_live_or_archived_matches(self):
        table = views.GROUPS_TABLE
        self.rows[table] = [
            {'group_id': 'OLD', 'group_name': 'Same', 'status': 'archived'},
            {'group_id': 'G1', 'group_name': 'Same', 'status': 'active'},
        ]
        self.assertEqual(self.compare('resolve_group_row', 'same')['group_id'], 'G1')
        self.rows[table].append({'group_id': 'G2', 'group_name': 'Same', 'status': 'active'})
        with patch.object(views.logger, 'warning') as warning:
            self.assertIsNone(self.compare('resolve_group_row', 'Same'))
            self.assertEqual(warning.call_count, 2)
        for row in self.rows[table]:
            row['status'] = 'archived'
        self.assertIsNone(self.compare('resolve_group_row', 'Same'))
        self.rows[table] = self.rows[table][:1]
        self.assertEqual(self.compare('resolve_group_row', 'Same')['group_id'], 'OLD')
        self.assertIsNone(self.compare('resolve_group_row', 'Absent'))

    def test_cohort_epa_missing_zero_month_end_and_manual_override(self):
        # Actual calculate_apprenticeship_end_date treats zero as absent,
        # despite parse_epa_months' comment. Preserve the executed contract.
        for months, override, expected in [(None, None, ''), (0, None, ''), (1, None, '2028-02-29'), (3, '2028-02-10', '2028-02-10'), (-1, None, '')]:
            detail = {'cohort_id': 'C', 'end_date': '2028-01-31', 'epa_months': months,
                      'apprenticeship_end_override': override, 'apprenticeship_end_date': '2099-01-01'}
            result = self.compare('curriculum_cohort_from_authoring_detail', detail)
            self.assertEqual(result['endDate'], '2028-01-31')
            self.assertEqual(result['practicalEndDate'], result['endDate'])
            self.assertEqual(result['apprenticeshipEndDate'], expected)

    def test_cohort_field_precedence_and_explicit_empty_override_and_calendar(self):
        detail = {'cohortId': 'CAMEL', 'id': 'ID', 'cohort_id': 'SNAKE', 'cohortName': 'Name',
                  'programmeId': 'P', 'programme_id': 'OLD', 'endDate': '2028-01-31',
                  'epaMonths': 0, 'epa_months': 5, 'apprenticeshipEndOverride': '',
                  'apprenticeship_end_override': '2099-01-01', 'calendarPolicy': None,
                  'calendar_policy': {'version': 1}, 'holidayIds': [], 'holiday_ids': ['H'],
                  'durationMonths': 0, 'duration_months': 24}
        result = self.compare('curriculum_cohort_from_authoring_detail', detail)
        self.assertEqual((result['id'], result['programmeId'], result['epaMonths']), ('CAMEL', 'P', 0))
        self.assertEqual(result['apprenticeshipEndDate'], '')
        self.assertIsNone(result['calendarPolicy'])
        self.assertEqual((result['holidayIds'], result['durationMonths']), (['H'], 24))
        for calendar in ('{"version":1}', {'version': 1}, 'invalid', None):
            self.compare('curriculum_cohort_from_authoring_detail', {'calendar_policy': calendar})

    def test_empty_projection_defaults_and_input_integrity(self):
        for detail in (None, {}, ''):
            cohort = self.compare('curriculum_cohort_from_authoring_detail', detail)
            group = self.compare('curriculum_group_from_authoring_detail', detail)
            self.assertEqual((cohort['status'], cohort['apprenticeshipEndDate']), ('planned', ''))
            self.assertEqual((group['mode'], group['status'], group['startTime']), ('Live', 'planned', ''))
            self.assertEqual(group['coaches'], [])

    def test_group_coach_deduplication_and_field_precedence(self):
        detail = {'id': 'ID', 'groupId': 'CAMEL', 'group_id': 'SNAKE',
                  'name': 'Name', 'groupName': 'Other', 'cohortId': 'C', 'programmeId': 'P',
                  'coach': 'Display', 'coaches': [' Ada ', 'ada', 'Bea', 'Unassigned', None],
                  'modules': ['M2', 'M1'], 'moduleIds': ['2', '1'], 'status': 'active'}
        result = self.compare('curriculum_group_from_authoring_detail', detail)
        self.assertEqual((result['id'], result['coach'], result['coaches']), ('ID', 'Display', ['Ada', 'Bea']))
        self.assertEqual(result['moduleIds'], ['2', '1'])
        # Raw stored JSON text is also passed through; no new decoding rule.
        result = self.compare('curriculum_group_from_authoring_detail', {'module_ids': '["2","1"]'})
        self.assertEqual(result['moduleIds'], '["2","1"]')
        for value in ('Ada, ada, Bea', ['Ada', 'Bea'], 'Unassigned', None):
            self.compare('curriculum_group_from_authoring_detail', {'coach_names': value})

    def test_group_delivery_columns_win_and_schedule_remains_valid_compatibility(self):
        detail = {'schedule': 'Tuesday 09:30-11:45', 'weekDays': 'Monday', 'week_days': 'Friday',
                  'startTime': '08:00', 'session_start_time': '06:00', 'endTime': '10:00'}
        result = self.compare('curriculum_group_from_authoring_detail', detail)
        self.assertEqual((result['weekDays'], result['startTime'], result['endTime']), ('Monday', '08:00', '10:00'))
        result = self.compare('curriculum_group_from_authoring_detail', {'schedule': detail['schedule']})
        self.assertEqual((result['weekDays'], result['startTime'], result['endTime']), ('Tuesday', '09:30', '11:45'))
        for schedule in ('Friday', 'Wednesday 9:00 AM\u201311:00 AM', '', None):
            self.compare('curriculum_group_from_authoring_detail', {'schedule': schedule})

    def test_malformed_inputs_and_projection_dependency_errors_are_not_hidden(self):
        for name in ('curriculum_cohort_from_authoring_detail', 'curriculum_group_from_authoring_detail'):
            for bad in ([1], 'invalid', 7):
                with original_placement_records(), self.assertRaises(AttributeError):
                    getattr(views, name)(bad)
                with self.assertRaises(AttributeError):
                    getattr(views, name)(bad)
        with composition_fixture(views, 'cohort_epa_dates', side_effect=RuntimeError('synthetic date error')) as dates, \
             bind_test_defaults(placement_records, cohort_epa_dates=dates):
            with original_placement_records(), self.assertRaisesRegex(RuntimeError, 'synthetic date error'):
                views.curriculum_cohort_from_authoring_detail({})
            with self.assertRaisesRegex(RuntimeError, 'synthetic date error'):
                views.curriculum_cohort_from_authoring_detail({})

    def test_snapshot_and_conflict_consumers_keep_serialized_record_contract(self):
        self.rows[views.COHORT_AUTHORING_DETAILS_TABLE] = [{'cohort_id': 'C', 'cohort_name': 'Synthetic', 'holiday_ids': '["H"]', 'epa_months': 0, 'end_date': '2028-01-31'}]
        self.rows[views.GROUPS_TABLE] = [{'group_id': 'G', 'group_name': 'Synthetic', 'schedule': 'Tuesday 09:30-11:45'}]
        factory = RequestFactory()
        with composition_fixture(views, 'curriculum_record_revision', return_value='verified-synthetic'):
            for kind, ident in [('cohort', 'C'), ('group', 'G')]:
                request = factory.get('/curriculum/record-snapshot/', {'kind': kind, 'id': ident})
                with original_placement_records():
                    expected = record_snapshots.curriculum_record_snapshot(request)
                actual = record_snapshots.curriculum_record_snapshot(request)
                self.assertEqual((actual.status_code, actual.content), (expected.status_code, expected.content))
                record = json.loads(actual.content)['record']
                response = views.record_conflict_response('old', 'new', **{kind: record})
                self.assertEqual(response.status_code, 409)
                self.assertEqual(json.loads(response.content)[kind], record)
