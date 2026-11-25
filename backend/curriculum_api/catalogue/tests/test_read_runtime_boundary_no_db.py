"""Frozen production-source parity, synthetic values, no database access."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import database_read_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

from django.core.cache.backends.locmem import LocMemCache
from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.tests.parity.cache_ownership_oracle import relocated_source

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/read_runtime_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_read_runtime():
    """Restore actual pre-batch bodies, resolving calls through their real globals."""
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(relocated_source(entry['source']), '<pre-read-runtime>', 'exec'), namespace)
            compiled = namespace[name]
            original = FunctionType(compiled.__code__, vars(views), name, compiled.__defaults__)
            original.__kwdefaults__ = compiled.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(views))(original)
            stack.enter_context(composition_fixture(views, name, original))
        yield


class ReadRuntimeParity(SimpleTestCase):
    def setUp(self):
        self.request = RequestFactory()
        self.enterContext(composition_fixture(views, 'logger'))

    def compare(self, name, *args, **kwargs):
        with original_read_runtime():
            expected = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        owner = importlib.import_module(SNAPSHOT[name]['owner'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*deepcopy(args), **deepcopy(kwargs))
        called.assert_called_once()
        if hasattr(actual, 'status_code'):
            self.assertEqual((actual.status_code, actual.content, dict(actual.items())),
                             (expected.status_code, expected.content, dict(expected.items())))
        else:
            self.assertEqual(actual, expected)
        return actual

    def test_pagination_empty_invalid_clamped_and_legacy_unpaged(self):
        for params in ({}, {'page': '-2', 'pageSize': '999'}, {'page': '5', 'page_size': '2'}, {'page': 'bad'}):
            with self.subTest(params=params):
                req = self.request.get('/', params)
                self.compare('paginate_curriculum_results', req, [1, 2, 3])
                self.compare('curriculum_collection_response', {'schema': 'curriculum', 'items': [1, 2, 3]}, 'items', request=req)
                self.compare('curriculum_results_response', [], request=req)

    def test_etag_private_304_and_changed_content(self):
        response = self.compare('reference_json_response', self.request.get('/'), {'value': [1, None]})
        self.assertEqual(response['Cache-Control'], 'private, no-cache')
        request = self.request.get('/', HTTP_IF_NONE_MATCH='"other", ' + response['ETag'])
        self.assertEqual(self.compare('reference_json_response', request, {'value': [1, None]}).status_code, 304)
        self.assertEqual(self.compare('reference_json_response', request, {'value': [2]}).status_code, 200)

    def test_bypass_keeps_original_non_boolean_return_values(self):
        for params, headers in (({}, {}), ({'_ts': 'token'}, {}), ({'skipCache': 'yes'}, {}), ({}, {'HTTP_CACHE_CONTROL': 'no-store'})):
            self.compare('request_bypasses_curriculum_cache', self.request.get('/', params, **headers))
        self.assertEqual(views.request_bypasses_curriculum_cache(self.request.get('/')), '')

    def test_cached_request_composition_keeps_keys_force_and_visibility(self):
        calls = []
        def cached(key, factory, **options):
            calls.append((key, options))
            return factory()
        with composition_fixture(views, 'cached_curriculum_value', side_effect=cached), \
             composition_fixture(views, 'build_curriculum_payload', return_value={'modules': []}), \
             composition_fixture(views, 'build_curriculum_sessions', return_value=[]):
            request = self.request.get('/', {'visibility': 'all', '_ts': 'stamp'})
            self.compare('get_cached_payload', request, compact=True)
            self.assertEqual(calls[0], calls[1])
            calls.clear()
            self.compare('get_cached_sessions', request)
            self.assertEqual(calls[0], calls[1])

    def test_row_cache_and_programme_fingerprint_options(self):
        calls = []
        def cached(key, factory, **options):
            calls.append((key, options))
            return factory()
        with composition_fixture(views, 'cached_curriculum_value', side_effect=cached), \
             composition_fixture(views, 'get_curriculum_rows', return_value={'rows': []}), \
             composition_fixture(views, 'programme_detail_section_entry', return_value={'results': []}):
            self.compare('get_cached_curriculum_rows', True, True)
            self.assertEqual(calls[0], calls[1])
            self.assertTrue(calls[0][1]['compress'])
            for section in ('shell', 'modules'):
                calls.clear()
                self.compare('cached_programme_detail_section', ' PROG-A ', 'all', section, True, force=True)
                self.assertEqual(calls[0], calls[1])
                self.assertEqual(calls[0][1]['scope'], 'PROG-A')
                self.assertEqual(calls[0][1]['fingerprint'], views.programme_shell_learner_fingerprint if section == 'shell' else None)

    def test_payload_build_preserves_opt_in_learner_identity(self):
        with composition_fixture(views, 'get_cached_curriculum_rows', return_value={'rows': []}), \
             composition_fixture(views, 'build_curriculum_payload_from_rows', return_value={'modules': []}) as build:
            for enabled in (False, True):
                build.reset_mock()
                self.compare('build_curriculum_payload', 'all', True, True, learner_profiles=enabled)
                self.assertEqual(build.call_args_list[0], build.call_args_list[1])

    def test_structure_key_normalizes_identifiers_but_retains_options(self):
        self.compare('structure_payloads_cache_key', [' MOD-A ', 'MOD-A', 'MOD-B'], include_extra=True, compact=False)
        # Arbitrary shaping options must not collide with the owner's injected ports.
        self.compare('structure_payloads_cache_key', ['MOD-A'], clean_str=False, hashlib=True, unique=False, options=True)
        self.assertEqual(views.structure_payloads_cache_key(['MOD-A', 'MOD-B']),
                         views.structure_payloads_cache_key([' MOD-B ', 'MOD-A', 'MOD-A']))
        self.assertNotEqual(views.structure_payloads_cache_key(['MOD-A'], compact=False),
                            views.structure_payloads_cache_key(['MOD-A'], compact=True))

    def test_archive_status_rules_and_stamp_projection(self):
        for row in ({}, {'status': ' ARCHIVED '}, {'status': 'active'}, {'deleted_at': '2026-01-01', 'deleted_via_parent': 'PROG-A'}):
            self.compare('curriculum_row_is_archived', row)
            self.compare('archive_stamp_fields', row)

    def test_archive_lists_preserve_projection_order_and_parent_state(self):
        cohorts = [{'cohort_id': 'C1', 'cohort_name': 'Archived cohort', 'programme_id': 'P1', 'status': 'archived'}]
        groups = [{'group_id': 'G2', 'cohort_id': 'missing', 'status': 'archived'},
                  {'group_id': 'G1', 'cohort_id': 'C1', 'status': 'archived'}]
        def archived(table):
            return deepcopy(groups if table == views.GROUPS_TABLE else cohorts)
        cohort_detail = dict.fromkeys(('startDate', 'endDate', 'practicalEndDate', 'apprenticeshipEndDate', 'color'), '')
        cohort_detail.update(epaMonths=3, durationMonths=12)
        group_detail = dict.fromkeys(('coach', 'weekDays', 'startTime', 'endTime', 'schedule', 'color'), '')
        with composition_fixture(views, 'archived_authoring_rows', side_effect=archived), \
             composition_fixture(views, 'authoring_fetch_all', return_value=cohorts), \
             composition_fixture(views, 'active_learner_delivery_counts', return_value=({}, {})), \
             composition_fixture(views, 'get_holiday_rows_safe', return_value=[]), \
             composition_fixture(views, 'serialize_cohort_authoring_detail', return_value=cohort_detail), \
             composition_fixture(views, 'serialize_group_authoring_detail', return_value=group_detail):
            for symbol in ('curriculum_archived_cohorts', 'curriculum_archived_groups'):
                response = self.compare(symbol, self.request.get('/'))
                self.assertEqual(response.status_code, 200)
            self.compare('archived_cohort_payload', cohorts[0], groups, {}, [])
            self.compare('archived_group_payload', groups[0], {}, {})
            self.compare('archived_cohort_learners', cohorts[0])
            self.compare('archived_group_learners', groups[0])

    def test_module_archive_list_counts_and_parent_archive(self):
        rows = [{'module_catalogue_id': 'MOD-A', 'programme_id': 'P1', 'sessions_number': 3}, {'module_catalogue_id': ''}]
        with composition_fixture(views, 'archived_module_rows', return_value=rows), \
             composition_fixture(views, 'archived_module_component_counts', return_value={'MOD-A': 2}), \
             composition_fixture(views, 'archived_parent_programme', return_value={'id': 'P1'}), \
             composition_fixture(views, 'module_stored_week_count', return_value=2):
            response = self.compare('curriculum_archived_modules', self.request.get('/'))
            body = json.loads(response.content)
            self.assertEqual(body['count'], 1)
            self.assertTrue(body['results'][0]['programmeArchived'])
            self.compare('archived_module_payload', rows[0], {'MOD-A': 2})

    def test_archive_structure_missing_live_empty_error_and_success(self):
        cases = [(None, None, 404), ({'status': 'active'}, None, 409),
                 ({'deleted_at': '2026-01-01'}, {}, 404),
                 ({'deleted_at': '2026-01-01'}, {'weeks': []}, 200)]
        for row, payload, status in cases:
            with self.subTest(status=status), \
                 composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='MOD-A'), \
                 composition_fixture(views, 'authoring_module_exists', return_value=row), \
                 composition_fixture(views, 'get_authoring_structure_payload', return_value=payload):
                self.assertEqual(self.compare('curriculum_archived_module_structure', self.request.get('/'), 'alias').status_code, status)
        with composition_fixture(views, 'resolve_stored_module_catalogue_id', return_value='MOD-A'), \
             composition_fixture(views, 'authoring_module_exists', return_value={'deleted_at': '2026-01-01'}), \
             composition_fixture(views, 'get_authoring_structure_payload', side_effect=RuntimeError('private detail')):
            response = self.compare('curriculum_archived_module_structure', self.request.get('/'), 'alias')
            self.assertEqual(response.status_code, 500)
            self.assertNotIn(b'private detail', response.content)

    def test_archive_read_handlers_reject_writes(self):
        for name in ('curriculum_archived_cohorts', 'curriculum_archived_groups', 'curriculum_archived_modules'):
            self.assertEqual(getattr(views, name)(self.request.post('/')).status_code, 405)
        self.assertEqual(views.curriculum_archived_module_structure(self.request.delete('/'), 'MOD-A').status_code, 405)

    def test_archive_row_read_copy_history_and_sort(self):
        rows = [{'cohort_id': 'C1', 'status': 'archived', 'deleted_at': '2026-01-01'},
                {'cohort_id': 'C2', 'status': 'archived', 'deleted_at': '2026-02-01'},
                {'cohort_id': 'live', 'status': 'active'}]
        with composition_fixture(views, 'authoring_fetch_all', return_value=rows), \
             patch.object(views.archive_state, 'uses_status', return_value=True), \
             patch.object(views.archive_state, 'annotate') as annotate:
            result = self.compare('archived_authoring_rows', views.COHORT_AUTHORING_DETAILS_TABLE)
            self.assertEqual([r['cohort_id'] for r in result], ['C2', 'C1'])
            self.assertEqual(annotate.call_count, 2)
            self.assertIsNot(result[0], rows[1])
        with composition_fixture(views, 'safe_authoring_module_rows', return_value=[{'module_catalogue_id': 'MOD-A', 'deleted_at': '2026-01-01'}]), \
             patch.object(views.archive_state, 'annotate'):
            self.compare('archived_module_rows')

    def test_scope_lineage_all_levels_keeps_alias_and_missing_states(self):
        module = {'module_catalogue_id': 'MOD-A', 'title': 'Module', 'programme_id': 'P1', 'programme_name': 'Programme',
                  'cohort_id': 'C1', 'cohort_name': 'Cohort', 'group_id': 'G1', 'group_name': 'Group', 'learner_roster_mode': 'MANUAL'}
        def read(table, *args, **kwargs):
            if table == views.AUTHORING_COMPONENTS_TABLE:
                return [{'id': 'X1', 'week_id': 'W1', 'module_catalogue_id': 'MOD-A', 'title': 'Component'}]
            if table == views.AUTHORING_WEEKS_TABLE:
                return [{'id': 'W1', 'module_catalogue_id': 'MOD-A', 'title': 'Week'}]
            return [module]
        with composition_fixture(views, 'authoring_fetch_all', side_effect=read), \
             composition_fixture(views, 'resolve_authoring_catalogue_id', return_value='MOD-A'), \
             composition_fixture(views, 'resolve_cohort_row', return_value=module), \
             composition_fixture(views, 'resolve_group_row', return_value=module), \
             composition_fixture(views, 'programme_config_by_identifier', return_value={'id': 'P1', 'name': 'Programme'}):
            for scope in ('programme', 'cohort', 'group', 'module', 'week', 'component', 'unknown'):
                self.compare('scope_placement_lineage', scope, ' alias ')
            self.compare('scope_placement_lineage', 'module', '')
            self.assertEqual(views.scope_placement_lineage('programme', 'alias')['programmeId'], 'alias')
            self.assertEqual(views.scope_placement_lineage('module', 'alias')['learnerRosterMode'], 'manual')
        with composition_fixture(views, 'resolve_authoring_catalogue_id', return_value=''), composition_fixture(views, 'authoring_fetch_all', return_value=[]):
            self.assertFalse(self.compare('scope_placement_lineage', 'module', 'missing')['found'])

    def test_programme_candidates_keep_names_order_and_skip_missing_catalogue_ids(self):
        with composition_fixture(views, 'get_program_config_rows', return_value=[{'id': 'P1', 'name': 'Name', 'sub': 'Sub', 'standard': 'Name'}]), \
             composition_fixture(views, 'programme_config_identity', side_effect=lambda row: row['id']), \
             composition_fixture(views, 'authoring_scope_module_rows', return_value=[{'module_catalogue_id': 'MOD-A', 'programme_name': 'Alias'}, {'programme_name': 'Ignore'}]):
            self.assertEqual(self.compare('programme_identity_candidates', 'P1'), ['P1', 'Name', 'Sub', 'Alias'])

    def test_free_course_projection_preserves_canonical_and_provenance_ids(self):
        component = {'id': 'X1', 'free_module_id': 'FW1', 'type': 'video', 'title': 'Item', 'expected_otjh': '1.5'}
        for week in ({'id': 'FW1', 'course_id': 'FC1'}, {'id': 'FW1', 'course_id': 'FC1', 'week_id': 'legacy-week'}):
            self.compare('free_programme_component_response', component, week)
            self.compare('free_programme_module_response', week, [component, {**component, 'free_module_id': 'OTHER'}], {'id': 'FC1', 'course_name': 'Course'})


class ReadRuntimeCacheParity(SimpleTestCase):
    def exercise(self, original, scenario):
        with ExitStack() as stack:
            stack.enter_context(patch.object(views.cache_state, '_CURRICULUM_CACHE', {}))
            stack.enter_context(patch.object(views.cache_state, '_CURRICULUM_BUILD_LOCKS', {}))
            stack.enter_context(patch.object(views.cache_state, '_CURRICULUM_CACHE_EPOCH', 0))
            stack.enter_context(patch.object(views.cache_state, '_CURRICULUM_EPOCH_BUMP', SimpleNamespace(pending=False)))
            stack.enter_context(database_read_fixture('connection', SimpleNamespace(in_atomic_block=False)))
            stack.enter_context(composition_fixture(views, 'cache', LocMemCache('read-runtime-parity', {})))
            views.cache.clear()
            stack.enter_context(composition_fixture(views, 'shared_curriculum_epoch', return_value=7))
            stack.enter_context(composition_fixture(views, 'programme_cache_generation', return_value=None))
            stack.enter_context(patch.object(views.shared_build, 'try_acquire', return_value=(True, None)))
            stack.enter_context(patch.object(views.shared_build, 'release'))
            if original:
                stack.enter_context(original_read_runtime())
            return scenario()

    def test_cache_hit_force_compression_and_shared_hit(self):
        def scenario():
            factory = Mock(side_effect=[{'v': 1}, {'v': 2}])
            values = [views.cached_curriculum_value('key', factory, compress=True), views.cached_curriculum_value('key', factory, compress=True)]
            views.cache_state._CURRICULUM_CACHE.clear()
            values.append(views.cached_curriculum_value('key', factory, compress=True))
            values.append(views.cached_curriculum_value('key', factory, force=True, compress=True))
            return values, factory.call_count
        expected = self.exercise(True, scenario)
        self.assertEqual(self.exercise(False, scenario), expected)
        self.assertEqual(expected, ([{'v': 1}, {'v': 1}, {'v': 1}, {'v': 2}], 2))

    def test_inflight_invalidation_does_not_publish_stale_values(self):
        def scenario():
            def build():
                views.cache_state._CURRICULUM_CACHE_EPOCH += 1
                return 'old'
            value = views.cached_curriculum_value('key', build)
            return value, dict(views.cache_state._CURRICULUM_CACHE), views.cache.get(views.shared_curriculum_cache_key('key', 7))
        self.assertEqual(self.exercise(True, scenario), ('old', {}, None))
        self.assertEqual(self.exercise(False, scenario), ('old', {}, None))

    def test_factory_errors_are_never_cached(self):
        def scenario():
            with self.assertRaisesRegex(ValueError, 'synthetic'):
                views.cached_curriculum_value('key', Mock(side_effect=ValueError('synthetic')))
            self.assertNotIn('key', views.cache_state._CURRICULUM_CACHE)
            return views.cached_curriculum_value('key', lambda: 'recovered')
        self.assertEqual(self.exercise(True, scenario), self.exercise(False, scenario))

    def test_read_scope_reentrant_cleanup_and_native_partition(self):
        def scenario():
            calls = []
            @views.scoped_curriculum_read
            def read(ids, enabled=True):
                calls.append((ids, enabled))
                return len(calls)
            values = []
            with views.curriculum_read_scope(targeted_child_reads=True):
                values.append(read(['A']))
                with views.curriculum_read_scope(targeted_child_reads=False):
                    self.assertTrue(views.cache_state._CURRICULUM_READ_SCOPE.targeted_child_reads)
                    values.append(read(['A'], enabled=True))
                with composition_fixture(views, 'native_only', return_value=True):
                    values.append(read(['A']))
            self.assertIsNone(views.cache_state._CURRICULUM_READ_SCOPE.memo)
            values.append(read(['A']))
            with self.assertRaises(ValueError), views.curriculum_read_scope():
                raise ValueError('cleanup')
            self.assertIsNone(views.cache_state._CURRICULUM_READ_SCOPE.memo)
            return values
        with composition_fixture(views, 'native_only', return_value=False):
            self.assertEqual(self.exercise(True, scenario), [1, 1, 2, 3])
            self.assertEqual(self.exercise(False, scenario), [1, 1, 2, 3])
