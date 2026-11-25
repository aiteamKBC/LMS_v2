"""Actual original/new structure read parity; isolated Django, synthetic facts only."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import placement_read_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import contextmanager, ExitStack
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType
from unittest.mock import Mock, MagicMock, patch

from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api.country_calendars import CalendarUnavailable
from curriculum_api import delivery_calendar

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/structure_reads_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_structure_reads():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-structure-reads>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = getattr(views, decorator)(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class StructureReadBoundaryParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.events = []
        self.rows = {
            views.AUTHORING_MODULES_TABLE: [
                {'module_catalogue_id': 'M1', 'title': 'Synthetic one', 'group_id': 'G', 'cohort_id': 'C', 'programme_id': 'P', 'sessions_number': 3, 'weeks_number': 2, 'quality_score': 12},
                {'module_catalogue_id': 'M2', 'title': 'Synthetic two', 'quality_score': 7}],
            views.GROUPS_TABLE: [{'group_id': 'G', 'coach_name': 'Synthetic coach'}],
            views.AUTHORING_WEEKS_TABLE: [
                {'id': 'W1', 'module_catalogue_id': 'M1', 'week_number': 1, 'title': 'First'},
                {'id': 'W2', 'module_catalogue_id': 'M1', 'week_number': 2, 'title': 'Second'},
                {'id': 'W3', 'module_catalogue_id': 'M1', 'week_number': 3, 'deleted_at': '2030-01-01'}],
            views.AUTHORING_COMPONENTS_TABLE: [
                {'id': 'C1', 'module_catalogue_id': 'M1', 'week_id': 'W1', 'type': 'reading', 'title': 'Text', 'settings_json': {'readingContent': 'Synthetic body'}, 'expected_otjh': .125},
                {'id': 'C2', 'module_catalogue_id': 'M1', 'week_id': 'W2', 'type': 'quiz', 'title': 'Quiz', 'expected_otjh': .125},
                {'id': 'C3', 'module_catalogue_id': 'M1', 'week_id': 'W2', 'type': 'reading', 'deleted_at': '2030-01-01'}],
            views.AUTHORING_KSB_MAPPINGS_TABLE: [
                {'id': 'K1', 'module_catalogue_id': 'M1', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'S'},
                {'id': 'K2', 'module_catalogue_id': 'M1', 'week_id': 'W1', 'ksb_code': 'K1', 'source_type': 'standard', 'source_id': 'S'},
                {'id': 'K3', 'module_catalogue_id': 'M1', 'component_id': 'C1', 'ksb_code': 'K2', 'source_type': 'standard', 'source_id': 'S'}],
        }
        def read(table, where='', params=None, order='', **kwargs):
            self.events.append((table, where, deepcopy(params), order, deepcopy(kwargs)))
            rows = self.rows.get(table, [])
            if params:
                key = 'group_id' if table == views.GROUPS_TABLE else 'module_catalogue_id'
                rows = [r for r in rows if r.get(key) in params]
            return deepcopy(rows)
        self.read = read
        self.stack.enter_context(composition_fixture(views, 'authoring_fetch_all', side_effect=read))
        self.stack.enter_context(composition_fixture(views, 'authoring_rows_by_id', side_effect=lambda table, column, ids, order: read(table, column, ids, order)))
        self.stack.enter_context(composition_fixture(views, 'live_component_rows_paged', side_effect=lambda ids, order: read(views.AUTHORING_COMPONENTS_TABLE, 'paged', ids, order)))
        self.stack.enter_context(composition_fixture(views, 'ensure_live_session_tracking_tables', side_effect=lambda: self.events.append(('schema-guard',))))
        self.stack.enter_context(composition_fixture(views, 'prefetch_authoring_reads', side_effect=lambda reads: self.events.append(('prefetch', deepcopy(reads)))))
        self.stack.enter_context(placement_read_fixture('attach', side_effect=lambda table, rows: rows))
        self.stack.enter_context(composition_fixture(views, 'mappings_with_inferred_sources', side_effect=lambda rows, modules: rows))
        # These unchanged delivery integrations are opaque ports, not Teams or
        # calendar tests. No provider, planning or tracking implementation runs.
        for name in ('apply_module_session_plan_to_weeks', 'apply_shared_teams_settings_to_weeks'):
            self.stack.enter_context(composition_fixture(views, name))
        for name in ('teams_delivery_metadata_from_weeks', 'teams_delivery_metadata_from_live_session', 'teams_delivery_metadata_from_live_session_row', 'cohort_selected_holidays_by_cohort'):
            self.stack.enter_context(composition_fixture(views, name, return_value={}))
        self.stack.enter_context(patch.object(views.free_course_pricing, 'lookup', return_value={}))
        self.stack.enter_context(patch.object(views.free_course_pricing, 'save', side_effect=AssertionError('write forbidden')))

    def compare(self, name, *args, **kwargs):
        inputs = deepcopy((args, kwargs, self.rows))
        self.events.clear()
        with original_structure_reads():
            expected = getattr(views, name)(*args, **kwargs)
        # Approved dev adds this nullable field; all historical fields and reads still match.
        if name == 'get_authoring_structure_payload' and expected is not None:
            expected = {**expected, 'weekBoundaryMode': None}
        elif name == 'get_authoring_structure_payloads':
            expected = {key: {**row, 'weekBoundaryMode': None} for key, row in expected.items()}
        expected_events = deepcopy(self.events)
        self.events.clear()
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*args, **kwargs)
        called.assert_called_once()
        self.assertEqual(actual, expected)
        self.assertEqual(self.events, expected_events)
        self.assertEqual((args, kwargs, self.rows), inputs)
        return actual

    def test_single_payload_fields_order_counts_and_shared_source_rows(self):
        actual = self.compare('get_authoring_structure_payload', 'M1')
        self.assertEqual([w['id'] for w in actual['weekStructure']], ['W1', 'W2'])
        self.assertEqual((actual['lessonCount'], actual['quizCount'], actual['ksbCount']), (2, 1, 2))
        owned = {table: self.read(table, params=['M1']) for table in
                 (views.AUTHORING_MODULES_TABLE, views.AUTHORING_WEEKS_TABLE, views.AUTHORING_COMPONENTS_TABLE,
                  views.AUTHORING_KSB_MAPPINGS_TABLE, views.AUTHORING_COMPLETION_TABLE, views.AUTHORING_ADVANCED_TABLE)}
        self.assertEqual(self.compare('get_authoring_structure_payload', 'M1', source_rows=owned), actual)
        self.assertEqual([event[0] for event in self.events], [views.GROUPS_TABLE])

    def test_batch_option_matrix_preserves_output_and_read_sequence(self):
        for staff in (False, True):
            for quality in (False, True):
                for extra in (False, True):
                    with self.subTest(staff=staff, quality=quality, extra=extra):
                        actual = self.compare('get_authoring_structure_payloads', [' M1 ', 'M1', 'M2'],
                                              include_staff=staff, include_quality=quality, include_extra=extra)
                        self.assertEqual(list(actual), ['M1', 'M2'])
                        self.assertEqual('qualityChecklist' in actual['M1'], quality)
                        self.assertEqual('completionCriteria' in actual['M1'], extra)
                        self.assertEqual(any(e[0] == 'schema-guard' for e in self.events), extra)

    def test_batch_shared_parents_and_projected_columns(self):
        baseline = self.compare('get_authoring_structure_payloads', ['M1'], include_extra=False)
        for parent_keys in (False, True):
            children = {'components': deepcopy(self.rows[views.AUTHORING_COMPONENTS_TABLE]),
                        'mappings': deepcopy(self.rows[views.AUTHORING_KSB_MAPPINGS_TABLE])}
            if parent_keys:
                children.update(modules=deepcopy(self.rows[views.AUTHORING_MODULES_TABLE]), weeks=deepcopy(self.rows[views.AUTHORING_WEEKS_TABLE]))
            self.assertEqual(self.compare('get_authoring_structure_payloads', ['M1'], child_rows=children, include_extra=False), baseline)
            if parent_keys:
                self.assertFalse(any(e[0] in (views.AUTHORING_MODULES_TABLE, views.AUTHORING_WEEKS_TABLE) for e in self.events))
        self.assertEqual(self.compare('get_authoring_structure_payloads', ['M1'], component_columns=('id', 'week_id'), include_extra=False), baseline)
        self.assertTrue(any(e[-1] == {'columns': ('id', 'week_id')} for e in self.events if len(e) == 5))

    def test_missing_and_empty_targets_remain_distinct(self):
        self.assertIsNone(self.compare('get_authoring_structure_payload', 'missing'))
        for ids in (None, [], ['', '  '], ['missing']):
            self.assertEqual(self.compare('get_authoring_structure_payloads', ids), {})
        self.assertEqual(self.compare('get_authoring_structure_payload', 'M2')['weekStructure'], [])

    def test_archived_path_annotates_copies_and_preserves_selection(self):
        with patch.object(views.archive_state, 'annotate', side_effect=lambda table, rows, **kwargs: rows), \
             composition_fixture(views, 'module_archive_parent_markers', return_value={'synthetic'}), \
             composition_fixture(views, 'module_archive_event_bounds', return_value=None), \
             composition_fixture(views, 'row_in_module_archive', side_effect=lambda row, markers, bounds: bool(row.get('deleted_at'))):
            actual = self.compare('get_authoring_structure_payload', 'M1', include_archived=True)
        self.assertEqual([w['id'] for w in actual['weekStructure']], ['W3'])

    def test_training_source_display_fallback_remains_owned_by_existing_adapter(self):
        self.rows[views.AUTHORING_MODULES_TABLE][0].update(source_type='training_plan', source_id='legacy-synthetic')
        with composition_fixture(views, 'training_row_by_id', return_value={'Cohort_name': 'Legacy cohort', '_meta': {'group_name': 'Legacy group'}}), \
             composition_fixture(views, 'delivery_status_for_training_row', return_value='synthetic-status'):
            for name, args in (('get_authoring_structure_payload', ('M1',)), ('get_authoring_structure_payloads', (['M1'],))):
                result = self.compare(name, *args)
                item = result if name.endswith('payload') else result['M1']
                self.assertEqual(item['deliveryMetadata']['group'], 'Legacy group')
                self.assertEqual(item['deliveryStatus'], 'synthetic-status')

    def test_calendar_unavailable_fallback_and_other_errors_keep_exception_boundary(self):
        with composition_fixture(views, 'cohort_selected_holidays_by_cohort', side_effect=CalendarUnavailable('synthetic')), \
             composition_fixture(delivery_calendar, 'display_cohort_holidays', return_value={'C': []}) as fallback:
            self.compare('get_authoring_structure_payloads', ['M1'])
            self.assertEqual(fallback.call_count, 2)
        with composition_fixture(views, 'cohort_selected_holidays_by_cohort', side_effect=ValueError('not unavailable')), \
             composition_fixture(delivery_calendar, 'display_cohort_holidays') as fallback:
            for original in (True, False):
                with ExitStack() as stack:
                    if original:
                        stack.enter_context(original_structure_reads())
                    with self.assertRaisesRegex(ValueError, 'not unavailable'):
                        views.get_authoring_structure_payloads(['M1'])
            fallback.assert_not_called()

    def test_read_and_pricing_failures_are_not_swallowed(self):
        for owner, attr in ((views, 'authoring_fetch_all'), (views.free_course_pricing, 'lookup')):
            with composition_fixture(owner, attr, side_effect=RuntimeError('synthetic')):
                for original in (True, False):
                    with ExitStack() as stack:
                        if original:
                            stack.enter_context(original_structure_reads())
                        for name, args in (('get_authoring_structure_payload', ('M1',)), ('get_authoring_structure_payloads', (['M1'],))):
                            with self.assertRaisesRegex(RuntimeError, 'synthetic'):
                                getattr(views, name)(*args)


class ComponentReaderBoundaryParity(SimpleTestCase):
    def test_paging_preserves_sql_order_duplicate_handling_and_empty_inputs(self):
        def capture(original):
            with ExitStack() as stack:
                if original:
                    stack.enter_context(original_structure_reads())
                stack.enter_context(composition_fixture(views, 'connection', vendor='postgresql'))
                stack.enter_context(composition_fixture(views, 'COMPONENT_FULL_READ_PAGE_ROWS', 2))
                fetch = stack.enter_context(composition_fixture(views, 'authoring_fetch_all', side_effect=[
                    [{'id': 'A'}, {'id': 'B'}], [{'id': 'B'}, {'id': 'C'}], []]))
                result = views.live_component_rows_paged([' M2 ', 'M1', 'M2'])
                self.assertEqual(views.live_component_rows_paged([]), [])
                return result, fetch.call_args_list
        actual = capture(False)
        self.assertEqual(actual, capture(True))
        self.assertEqual(actual[0], [{'id': 'A'}, {'id': 'B'}, {'id': 'C'}])

    def test_content_projection_keeps_exact_sql_parameters_and_result_order(self):
        for keep in (None, ('videoUrl',)):
            def capture(original):
                with ExitStack() as stack:
                    if original:
                        stack.enter_context(original_structure_reads())
                    connection = MagicMock(vendor='postgresql')
                    cursor = connection.cursor.return_value.__enter__.return_value
                    cursor.fetchall.return_value = [('B',), ('A',)]
                    stack.enter_context(composition_fixture(views, 'connection', connection))
                    stack.enter_context(composition_fixture(views, 'ensure_module_authoring_tables'))
                    stack.enter_context(composition_fixture(views, 'column_names', return_value={'id', 'type', 'settings_json', 'description'}))
                    stack.enter_context(composition_fixture(views, 'learning_read_table', return_value='curriculum.components'))
                    stack.enter_context(composition_fixture(views, 'rows_as_dicts', return_value=[{'id': 'A'}, {'id': 'B'}]))
                    result = views.live_component_rows_without_content(['M1', ' M1 '], keep_keys=keep, exclude_columns=('DESCRIPTION', 'id'))
                    return result, cursor.execute.call_args_list
            actual = capture(False)
            self.assertEqual(actual, capture(True))
            self.assertEqual(actual[0], [{'id': 'B'}, {'id': 'A'}])

    def test_unsupported_content_projection_still_returns_none_without_cursor(self):
        for original in (True, False):
            with ExitStack() as stack:
                if original:
                    stack.enter_context(original_structure_reads())
                connection = MagicMock(vendor='sqlite')
                stack.enter_context(composition_fixture(views, 'connection', connection))
                self.assertIsNone(views.live_component_rows_without_content(['M1']))
                self.assertIsNone(views.live_component_rows_without_content([]))
                connection.cursor.assert_not_called()
