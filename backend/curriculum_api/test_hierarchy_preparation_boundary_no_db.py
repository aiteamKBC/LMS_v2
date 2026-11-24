"""Synthetic parity against frozen original functions; database access forbidden."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export, bind_test_defaults
from .catalogue.application import hierarchy_queries
from contextlib import ExitStack, contextmanager, nullcontext
from copy import deepcopy
from datetime import datetime, timezone
import importlib
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, MagicMock, patch

from django.test import SimpleTestCase

from . import views, delivery_calendar, learning_storage, legacy_free_course_adoption

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/hierarchy_preparation_snapshot.json').read_text())


@contextmanager
def original_hierarchy_preparation():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<pre-hierarchy-preparation>', 'exec'), namespace)
            old = namespace[name]
            function = FunctionType(old.__code__, vars(views), name, old.__defaults__)
            function.__kwdefaults__ = old.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                function = eval(decorator, vars(views))(function)
            stack.enter_context(composition_fixture(views, name, function))
        yield


class HierarchyPreparationParity(SimpleTestCase):
    def compare(self, name, *args, watched=(), allow_error=False, **kwargs):
        def calls(mock):
            normalized = []
            for call in mock.mock_calls:
                method, arguments, keywords = call
                if method.endswith('__exit__'):
                    kind, error, trace = arguments
                    arguments = (kind, str(error) if error is not None else None, trace is not None)
                normalized.append((method, arguments, keywords))
            return normalized
        def invoke(arguments, keywords):
            try:
                result = getattr(views, name)(*arguments, **keywords)
                if hasattr(result, 'status_code') and hasattr(result, 'content'):
                    result = (result.status_code, result.content)
                return ('return', result)
            except Exception as error:
                return ('raise', type(error), str(error))
        old_args, old_kwargs = deepcopy(args), deepcopy(kwargs)
        new_args, new_kwargs = deepcopy(args), deepcopy(kwargs)
        for mock in watched:
            mock.reset_mock()
        with original_hierarchy_preparation():
            expected = invoke(old_args, old_kwargs)
        expected_calls = [calls(mock) for mock in watched]
        for mock in watched:
            mock.reset_mock()
        owner = importlib.import_module(SNAPSHOT[name]['owner'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = invoke(new_args, new_kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected, name)
        self.assertEqual((new_args, new_kwargs), (old_args, old_kwargs), name)
        self.assertEqual([calls(mock) for mock in watched], expected_calls, name)
        if not allow_error:
            self.assertEqual(actual[0], 'return', (name, actual))
        return actual[1]

    @contextmanager
    def hierarchy(self):
        configs = [{'programme_id': 'PROG-P', 'name': 'Programme', 'status': 'active'}]
        cohort = {'cohort_id': 'C', 'cohort_name': 'Cohort', 'programme_id': 'PROG-P',
                  'epa_months': 3, 'excluded_holiday_ids': ['H-KEEP'],
                  'apprenticeship_end_override': '2028-02-20', 'calendar_policy': None}
        group = {'group_id': 'G', 'group_name': 'Group', 'cohort_id': 'C', 'programme_id': 'PROG-P',
                 'coach_name': 'Coach', 'session_week_day': 'Monday', 'session_start_time': '09:00',
                 'session_end_time': '11:00', 'status': 'active'}
        with ExitStack() as stack:
            mocks = {}
            for name, value in {'get_program_config_rows': configs, 'fetch_cohort_row': cohort,
                                'fetch_group_row': group, 'safe_authoring_module_rows': [],
                                'get_holiday_rows': [], 'holiday_table_name': 'calendar_holidays'}.items():
                mocks[name] = stack.enter_context(composition_fixture(views, name, return_value=deepcopy(value)))
            stack.enter_context(composition_fixture(views, 'with_group_coaches', side_effect=lambda row: row))
            stack.enter_context(composition_fixture(views, 'canonical_staff_assignment_name', side_effect=lambda kind, value: value))
            yield mocks

    def test_cohort_payload_retains_unsent_dates_holidays_and_extra_precedence(self):
        base = {'id': 'C', 'name': 'Cohort', 'programmeId': 'PROG-P',
                'startDate': '2026-09-01', 'endDate': '2027-08-31'}
        with self.hierarchy() as mocks:
            for extra in ({}, {'epaMonths': 0}, {'epaMonths': ''}, {'apprenticeshipEndOverride': ''},
                          {'epaMonths': 5, 'apprenticeshipEndOverride': '2028-03-01'}, {'excludedHolidayIds': []}):
                result = self.compare('cohort_authoring_payload', {**base, **extra},
                                      holiday_rows=[{'id': 'H-KEEP', 'label': 'Synthetic holiday',
                                                     'start_date': '2026-12-25', 'end_date': '2026-12-25'}],
                                      extra={'color': 'override'}, watched=tuple(mocks.values()))
                self.assertEqual(result['color'], 'override')
                if not extra:
                    self.assertNotIn('epa_months', result)
                    self.assertNotIn('apprenticeship_end_override', result)
                    self.assertEqual(json.loads(result['excluded_holiday_ids']), ['H-KEEP'])

    def test_cohort_policy_ports_are_lazy_preserve_order_and_propagate_failures(self):
        events = Mock()
        events.write.return_value = {'calendar_policy': {'synthetic': True}}
        events.holidays.return_value = []
        with self.hierarchy(), composition_fixture(delivery_calendar, 'policy_write', events.write), \
             composition_fixture(delivery_calendar, 'policy_holidays', events.holidays), \
             patch('curriculum_api.calendar_policy.read_policy', events.read):
            events.read.return_value = {'synthetic': True}
            self.compare('cohort_authoring_payload', {'id': 'C', 'programmeId': 'PROG-P',
                         'calendarPolicy': {}, 'startDate': '2026-09-01', 'durationMonths': 12}, watched=(events,))
            self.assertEqual([c[0] for c in events.mock_calls], ['write', 'read', 'holidays'])
            events.write.side_effect = ValueError('synthetic invalid calendar')
            result = self.compare('cohort_authoring_payload', {'calendarPolicy': {}}, watched=(events,), allow_error=True)
            self.assertEqual(result, ValueError)

    def test_group_payload_and_canonical_programme_read_contracts(self):
        with self.hierarchy() as mocks:
            self.compare('group_authoring_payload', {}, watched=tuple(mocks.values()))
            result = self.compare('group_authoring_payload', {'id': 'G', 'programmeId': 'PROG-P', 'cohortId': 'C'},
                                  module_rows=[{'module_catalogue_id': 'M', 'group_id': 'G', 'source_id': 'S', 'status': 'active'}],
                                  extra={'color': 'Blue'}, watched=tuple(mocks.values()))
            self.assertEqual((result['group_id'], result['cohort_id'], result['color']), ('G', 'C', 'Blue'))
            for value in ('program-prog-p', 'PROG-P', 'programme', 'missing', ''):
                self.compare('canonical_programme_id', value, 'Programme', watched=(mocks['get_program_config_rows'],))
                self.compare('persistable_programme_id', value, watched=(mocks['get_program_config_rows'],))
            self.compare('canonical_group_coaches', ['Coach', 'Coach'])
            self.compare('cohort_applied_holidays', ['ignored'], [], '2026-01-01', '2026-12-31')

    def test_parent_resolution_and_missing_parent_keep_exact_short_circuits(self):
        with composition_fixture(views, 'resolve_cohort_row', return_value={'id': 'C'}) as cohort, \
             composition_fixture(views, 'resolve_group_row', return_value={'cohort_id': 'C'}) as group, \
             composition_fixture(views, 'serialize_cohort_authoring_detail', side_effect=lambda row: row), \
             composition_fixture(views, 'curriculum_cohort_from_authoring_detail', side_effect=lambda row: row):
            self.compare('module_parent_cohort', 'C', 'G', watched=(cohort, group))
            group.assert_not_called()
            self.compare('module_parent_cohort', '', 'G', watched=(cohort, group))
            cohort.return_value = None
            self.assertIsNone(self.compare('module_parent_cohort', '', '', watched=(cohort, group)))

    def test_hierarchy_query_matching_and_missing_results(self):
        rows = [{'id': 'T', 'programme': 'Programme'}]
        programme = {'id': 'PROG-P', 'sourceId': 'PROG-P', 'name': 'Programme'}
        cohort, group = {'id': 'C'}, {'id': 'G', 'cohortId': 'C'}
        with self.hierarchy(), \
             composition_fixture(views, 'get_curriculum_rows', return_value={'training': rows, 'program_configs': []}), \
             composition_fixture(views, 'get_training_rows', return_value=rows), \
             composition_fixture(views, 'build_curriculum_payload_from_rows', return_value={'programmes': [programme]}), \
             composition_fixture(views, 'build_curriculum_payload', return_value={'programmes': [programme]}) as build, \
             composition_fixture(views, 'build_cohorts_and_groups', return_value=([cohort], [group])), \
             composition_fixture(views, 'programme_identity', return_value=programme), \
             composition_fixture(views, 'actual_cohort_identity', return_value=cohort), \
             composition_fixture(views, 'actual_group_identity', return_value=group), \
             bind_test_defaults(hierarchy_queries, programme_identity=views.programme_identity,
                                actual_cohort_identity=views.actual_cohort_identity,
                                actual_group_identity=views.actual_group_identity):
            self.compare('rows_for_programme', 'PROG-P')
            self.assertEqual(self.compare('rows_for_programme', 'missing'), (None, []))
            self.compare('find_training_rows_by_cohort', 'C')
            self.assertEqual(self.compare('find_training_rows_by_cohort', 'missing'), (None, []))
            self.compare('find_group_with_parent', 'G')
            self.assertEqual(self.compare('find_group_with_parent', 'missing'), (None, None, []))
            self.compare('programme_config_by_identifier', 'PROG-P')
            self.compare('first_programme_response', '', 'missing', 'PROG-P', watched=(build,))
            build.assert_called_once()

    def test_fingerprint_and_delivery_scope_keep_cache_keys_and_visibility(self):
        with composition_fixture(views, 'active_learner_programme_counts', return_value=({'P': 2}, {'Name': 2})), \
             composition_fixture(views, 'active_learner_delivery_counts', return_value=({'C': 2}, {'G': 2})):
            self.compare('programme_shell_learner_fingerprint')
        request = SimpleNamespace(GET={}, headers={})
        observed = []
        def cache(key, build, **kwargs):
            observed.append((key, kwargs))
            return build()
        with composition_fixture(views, 'curriculum_visibility', return_value='all'), \
             composition_fixture(views, 'request_bypasses_curriculum_cache', return_value=True), \
             composition_fixture(views, 'cached_curriculum_value', side_effect=cache), \
             composition_fixture(views, 'build_cohorts_and_groups', return_value=([{'id': 'C'}], [{'id': 'G'}])) as build:
            self.compare('delivery_scope_lists', request, watched=(build,))
        self.assertEqual(observed, [('delivery-scope:all', {'force': True})] * 2)

    def test_lifecycle_read_inputs_and_history_annotations(self):
        rows = [{'id': 'A', 'status': 'inactive'}, {'id': 'B', 'status': 'active'}]
        with self.hierarchy(), composition_fixture(views, 'authoring_fetch_all', return_value=rows) as read, \
             patch.object(views.archive_state, 'annotate') as annotate, \
             composition_fixture(views, 'ensure_program_config_archive_columns'):
            self.assertEqual(self.compare('archived_authoring_ids', 'modules', 'id', watched=(read,)), {'A'})
            self.compare('programme_archived_for_authoring', 'PROG-P')
            self.compare('authoring_programme_config_for_save', 'PROG-P', 'Programme')
            self.compare('archived_parent_programme', 'PROG-P')
            self.compare('module_withdrawn_on_its_own', {'status': 'inactive'}, watched=(annotate,))
            self.compare('module_recovered_by_move_to_live', {'programme_id': 'OLD', 'status': 'inactive'}, 'PROG-P')
            self.compare('module_archive_event_bounds', {'status': 'inactive', 'deleted_at': '2026-01-01T00:00:00Z'}, watched=(annotate,))
            self.compare('surviving_authoring_module_rows', rows)
            self.assertEqual(self.compare('soft_deleted_structure_ids', {'weeks': ['A', 'B']}, watched=(read,)), {'A'})

    def test_delete_plan_preserves_child_resolution_order_and_empty_scope(self):
        events = Mock()
        events.ids.side_effect = lambda table, key, clauses: {'cohorts': ['C'], 'groups': ['G'], 'modules': ['M'],
            'module_weeks': ['W'], 'module_components': ['COMP'], 'week_templates': ['T']}.get(table, [])
        events.blockers.return_value = {'learner_training_plan_modules': 2}
        events.counts.return_value = {'learners': 3}
        with composition_fixture(views, 'curriculum_ids_matching', events.ids), \
             composition_fixture(views, 'orphan_programme_name_clause', return_value=('', [])), \
             composition_fixture(views, 'programme_permanent_delete_blockers', events.blockers), \
             composition_fixture(views, 'programme_dependency_counts', events.counts):
            self.compare('programme_permanent_delete_plan', 'PROG-P', {'id': 'PROG-P'}, watched=(events,))
            result = self.compare('programme_permanent_delete_plan', '', watched=(events,))
            self.assertEqual(result['learners'], 0)
            events.ids.assert_not_called()

    def test_lifecycle_sql_and_payload_adapters_preserve_statements_and_parameters(self):
        events = Mock()
        events.read.return_value = [{'value': 'ID', 'total': 2}]
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='sqlite')), \
             composition_fixture(views, 'table_exists', return_value=True), \
             composition_fixture(views, 'has_column', return_value=True), \
             composition_fixture(views, 'column_names', return_value={'id', 'programme_id', 'module_catalogue_id'}), \
             composition_fixture(views, 'authoring_table_name', side_effect=lambda t: t), \
             composition_fixture(views, 'table_name', side_effect=lambda t: t), \
             composition_fixture(views, 'fetch_all', events.read), \
             composition_fixture(views, 'now_iso', return_value='2026-01-01T00:00:00'):
            self.compare('programme_dependency_counts', 'PROG-P', watched=(events,))
            self.compare('archived_rows_under', views.AUTHORING_COMPONENTS_TABLE, 'M', watched=(events,))
            self.compare('curriculum_ids_matching', 'modules', 'id', [('id=%s', ['ID'])], watched=(events,))
            self.assertEqual(self.compare('curriculum_ids_matching', 'modules', 'id', [], watched=(events,)), [])
            events.read.assert_not_called()
            self.compare('orphan_programme_name_clause', 'groups', 'Programme')
            self.compare('programme_config_rows_remaining', ['PROG-P'], watched=(events,))
            self.compare('archive_payload', 'modules', 'Notes')
            self.compare('restore_payload', 'modules', 'Notes\n__archived: true')
            self.compare('programme_permanent_delete_blockers', {'moduleIds': ['M']})
            self.compare('permanent_delete_reference_blockers', 'module', 'M')
            self.compare('refuse_if_programme_owns_content', {'childIds': {}})
            with self.assertRaises(views.ProgrammeContentRetained):
                views.refuse_if_programme_owns_content({'childIds': {'weekIds': ['W']}})

    def test_postgresql_guard_sql_uses_only_select_and_keeps_per_table_errors(self):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.return_value = (2,)
        connection = SimpleNamespace(vendor='postgresql', cursor=Mock(return_value=cursor))
        columns = {column for refs in views.PERMANENT_DELETE_REFERENCES.values() for _, _, column, _, _ in refs}
        with composition_fixture(views, 'connection', connection), \
             patch.object(views.schema_compat, 'columns_of', return_value=columns), \
             composition_fixture(views, 'transaction', SimpleNamespace(atomic=nullcontext)):
            self.compare('permanent_delete_reference_blockers', 'group', 'G', watched=(cursor,))
            self.compare('programme_permanent_delete_blockers', {'moduleIds': ['M']}, watched=(cursor,))
            statements = [call.args[0] for call in cursor.execute.call_args_list]
            self.assertTrue(statements)
            self.assertTrue(all(sql.lower().startswith('select ') for sql in statements))
            cursor.execute.side_effect = ValueError('synthetic unavailable relation')
            self.assertEqual(self.compare('programme_permanent_delete_blockers', {'moduleIds': ['M']}, watched=(cursor,)), {})

    def test_api_guards_keep_status_and_payload_without_writing(self):
        with composition_fixture(views, 'authoring_programme_config_for_save', return_value={'status': 'inactive'}), \
             composition_fixture(views, 'permanent_delete_reference_blockers', return_value={'learners': 2}), \
             composition_fixture(views, 'module_delivery_day_gap', return_value={'group_id': 'G', 'group_name': 'Group'}), \
             composition_fixture(views, 'safe_group_delivery_rows', return_value={}), \
             composition_fixture(views, 'safe_authoring_module_rows', return_value=[]):
            result = self.compare('archived_programme_module_edit_error', {'status': 'active'}, title='M', programme_id='P')
            self.assertEqual(result[0], 400)
            self.assertEqual(self.compare('permanent_delete_reference_refusal', 'group', 'G')[0], 409)
            self.assertEqual(self.compare('tutor_assignment_delivery_day_error', {'tutor_name': 'New', 'group_id': 'G'})[0], 409)
            self.compare('group_tutor_assignment_delivery_day_error', 'G', 'New', module_rows=[])
        self.compare('requested_expected_revision', SimpleNamespace(headers={'If-Match': 'HEADER'}), {})
        for payload in ({}, {'startDate': '2026-09-01'}, {'startDate': '2026-09-02', 'endDate': '2026-09-01'}):
            self.compare('holiday_date_payload', payload)

    def test_ksb_preparation_preserves_dedup_source_cache_and_uniqueness(self):
        mapping = {'id': 'MAP', 'code': ' k1 ', 'sourceType': 'standard', 'sourceId': 'ST', 'type': 'main', 'weight': 5}
        with composition_fixture(views, 'canonical_authoring_id', side_effect=lambda prefix, value='': value or prefix + '-SYNTHETIC'), \
             composition_fixture(views, 'ensure_authoring_mapping_unique') as unique, \
             composition_fixture(views, 'infer_mapping_source_from_module', return_value=('standard', 'ST')) as source:
            self.compare('authoring_mapping_payload', 'M', mapping, component_id='C', watched=(unique, source))
            self.compare('authoring_mapping_payload', 'M', {'code': 'K1'}, module_row={}, source_cache={}, watched=(unique, source))
            result = self.compare('normalise_component_ksb_mappings', 'M', [mapping, None, deepcopy(mapping)], component_id='C', watched=(unique, source))
            self.assertEqual((len(result[0]), len(result[1])), (1, 1))

    def test_free_course_preparation_preserves_ids_empty_states_and_shared_ownership(self):
        with composition_fixture(views, 'canonical_authoring_id', side_effect=lambda prefix, value='': value or prefix + '-SYNTHETIC'), \
             composition_fixture(views, 'unique_timestamp_prefixed_id', return_value='SYNTHETIC-ID'), \
             composition_fixture(views, 'free_programme_fetch_all', return_value=[]) as read:
            self.compare('free_programme_module_id', 'P', {}, 0, watched=(read,))
            self.compare('free_programme_week_payload', 'COURSE', {'title': 'Course'}, 0)
            self.compare('free_programme_component_payload', {'type': 'reading', 'displayOrder': 0}, 5)
            self.assertEqual(self.compare('free_programme_owned_ids', '', watched=(read,)), (set(), set()))
            read.assert_not_called()
        def read_rows(table, where='', params=None, **kwargs):
            if table == views.FREE_PROGRAMME_COMPONENTS_TABLE:
                return [{'free_module_id': 'W1'}]
            if where.startswith('id in'):
                return [{'id': 'W1', 'course_id': 'SHARED'}]
            return [{'id': 'W1'}, {'id': 'W2'}]
        with composition_fixture(views, 'free_programme_fetch_all', side_effect=read_rows) as read:
            self.assertEqual(self.compare('free_programme_owned_ids', 'P', watched=(read,)), ({'W1'}, set()))
        with patch.object(views.free_course_catalogue, 'fetch_many', return_value=([], [], [])) as read, \
             patch.object(legacy_free_course_adoption, 'adopted_courses', return_value=set()) as adopted:
            self.compare('get_free_programme_modules_payload', 'P', watched=(read, adopted))

    def test_free_read_transport_preserves_batching_nextsets_and_mismatch_errors(self):
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        connection = SimpleNamespace(vendor='postgresql', cursor=Mock(return_value=cursor))
        reads = [('free_courses', 'id=%s', ['A'], 'id', ['id']), ('free_course_weeks', '', [], '', ['id'])]
        with composition_fixture(views, 'connection', connection), \
             composition_fixture(views, 'ensure_free_programme_tables') as setup, \
             composition_fixture(learning_storage, 'free_read_table', side_effect=lambda table: table), \
             composition_fixture(views, 'rows_as_dicts', return_value=[{'id': 'SYNTHETIC'}]), \
             composition_fixture(views, 'CURRICULUM_BATCHED_READS', True):
            self.compare('free_programme_select_sql', 'free_courses', 'id=%s', 'id', ['id'], watched=(setup,))
            self.compare('free_programme_fetch_all', 'free_courses', 'id=%s', ['A'], watched=(setup, cursor))
            self.compare('free_programme_fetch_many', reads[:1], watched=(setup, cursor))
            # Reset per invocation, including the old branch of the comparison.
            cursor.nextset.side_effect = lambda: cursor.nextset.call_count % 2 == 1
            self.compare('free_programme_fetch_many', reads, watched=(setup, cursor))
            cursor.nextset.side_effect = None
            cursor.nextset.return_value = False
            self.compare('free_programme_fetch_many', reads, watched=(setup, cursor), allow_error=True)


PURE_CASES = {
    'format_created_at': [(None,), ('2026-09-01 12:13:14',), (datetime(2026, 9, 1, tzinfo=timezone.utc),)],
    'calculate_cohort_end_date': [('2026-09-01', 24), ('2024-01-31', 1), ('bad', 0)],
    'holiday_extension_days': [([], '2026-01-01', '2026-01-31')],
    'holiday_extension_breakdown': [([], '2026-01-01', '2026-01-31')],
    'cohort_practical_end_date': [('2026-09-01', 12, ['IGNORED'], [])],
    'parse_epa_months': [(None,), ('',), (0,), (-1,), ('5',)],
    'payload_epa_months': [({}, {'epa_months': 3}), ({'epaMonths': ''}, {'epa_months': 3})],
    'parse_apprenticeship_end_override': [(None,), ('bad',), ('2027-05-31',)],
    'payload_apprenticeship_end_override': [({}, {'apprenticeship_end_override': '2027-01-01'}),
        ({'apprenticeshipEndOverride': '', 'apprenticeshipEndDate': '2028-01-01'}, {})],
    'apprenticeship_end_override_sent': [({},), ({'apprenticeshipEndOverride': None},)],
    'calculate_apprenticeship_end_date': [('2027-01-31', 1), ('2027-01-31', 0)],
    'cohort_apprenticeship_end_date': [('2027-01-31', 3, '2028-01-01'), ('2027-01-31', 0)],
    'cohort_epa_dates': [('2027-01-31', 3), ('2027-01-31', None)],
    'module_calendar_end_date': [('2026-09-01', 3), ('bad', 0)],
    'cohort_delivery_window': [({},), ({'practicalEndDate': '2027-01-01', 'endDate': '2028-01-01'},)],
    'shift_date_by_months': [('2024-01-31', 1), ('bad', -1)],
    'infer_duration_months': [('2026-09-01', '2027-08-31'), ('2026-09-15', '2027-09-14')],
    'append_notes_meta': [('Notes\n__x: old', {'x': 'new'}), ('', {})],
    'remove_notes_meta': [('Notes\n__x: old\n__y: keep', ['x'])],
    'parse_required_otjh': [(None,), ('',), (0,), (-1,), ('12.345',)],
    'payload_required_otjh': [({}, {'required_otjh': 10}), ({'requiredOtjh': ''}, {'required_otjh': 10})],
    'curriculum_row_effectively_deleted': [({'status': 'active'},), ({'status': 'inactive'},)],
    'is_operational_training_row': [({'_meta': {'hidden': True}},), ({'_meta': {'is_active': False}},), ({},)],
    'title_case_status': [(True, '', ''), (False, '2099-01-01', ''), (False, '', '2000-01-01')],
    'delivery_status_for_training_row': [({},), ({'start_date': '2099-01-01'},), ({'status': 'inactive'},)],
    'get_module_session_names': [({'session_names_json': '["A"]', 'session_name_1': 'B'},), ({'session_name_1': 'B'},)],
    'program_config_by_id': [([{'programme_id': 'PROG-P', 'name': 'Same'}, {'programme_id': 'PROG-Q', 'name': 'Same'}],)],
    'programme_config_for_programme': [([{'programme_id': 'PROG-P', 'name': 'Same'}], {'id': 'PROG-P'})],
    'is_placeholder_programme_id': [('',), ('Unassigned programme',), ('local-1',), ('PROG-P',)],
    'module_row_belongs_to_group': [({'group_id': 'G'}, {'id': 'G'}), ({'group_name': 'Same', 'cohort_id': 'X'}, {'name': 'Same', 'cohortId': 'C'})],
    'group_tutor_from_module_names': [([],), (['A', 'A'],), (['A', 'B'],)],
    'curriculum_identifier_candidates': [('PROG-P',), ('',)],
    'compact_module_list_rows': [([{'id': 'M', 'sessionNames': ['A'], 'privateValue': 'omit'}],)],
    'find_programme': [({'programmes': [{'id': 'P', 'name': 'Same'}, {'id': 'Q', 'name': 'Same'}]}, 'Q')],
    'programme_identifier_candidates': [('PROG-P', {'id': 'PROG-Q'}, {'programme_id': 'PROG-P'})],
    'module_archive_parent_markers': [({'deleted_via_parent': 'P'}, 'M'), ({}, '')],
    'stamp_datetime': [(None,), ('bad',), ('2026-01-01T00:00:00Z',)],
    'row_in_module_archive': [({'status': 'active'}, set()), ({'status': 'inactive', 'deleted_via_parent': 'P'}, {'P'})],
    'is_archived_module_summary': [({'authoringStatus': 'archived'},), ({'status': 'active'},)],
    'curriculum_where_any': [([],), ([('', []), ('id=%s', ['A'])],)],
    'component_reflection_question': [({'reflection_question': 'New'}, {'reflectionPrompt': 'Old'}), ({}, {})],
    'component_coach_validation': [({},), ({'coach_validation_required': False},)],
    'payload_coach_validation': [({},), ({'coachValidationRequired': False},)],
    'component_ksb_mapping_json_item': [({'ksb_code': ' k1 ', 'classification': 'main', 'weight': 2},)],
    'component_ksb_mapping_api_item': [({'ksb_code': ' k1 ', 'classification': 'main', 'weight': 2},)],
    'component_ksb_mappings_from_row': [({'ksb_mappings': [{'code': 'K1'}]}, [{'ksb_code': 'K2'}]), ({}, [{'ksb_code': 'K2'}])],
    'authoring_row_differs': [({'title': 'New'}, {'title': 'Old'}), ({'updated_at': 'New'}, {'updated_at': 'Old'})],
    'authoring_mapping_signature': [([{'id': 'A', 'ksb_code': 'K1'}, {'id': 'B', 'ksb_code': 'K1'}],)],
    'week_template_scope_fields': [({'programmeId': 'PROG-P'}, 'free'), ({}, 'paid')],
    'active_component_rows': [([{'status': 'active', 'type': 'reading'}, {'status': 'inactive', 'type': 'reading'}],)],
    'authoring_comparable': [('settings_json', '{"x":1}'), ('points', 1), ('x', None)],
    'authoring_mapping_owner': [({'component_id': 'C', 'week_id': 'W'},), ({'week_id': 'W'},), ({},)],
    'free_course_sale_values': [({}, {}, False)],
}


def pure_test(name, cases):
    def test(self):
        for args in cases:
            with self.subTest(arguments=args):
                self.compare(name, *args)
    return test


for _name, _cases in PURE_CASES.items():
    setattr(HierarchyPreparationParity, 'test_policy_' + _name, pure_test(_name, _cases))
