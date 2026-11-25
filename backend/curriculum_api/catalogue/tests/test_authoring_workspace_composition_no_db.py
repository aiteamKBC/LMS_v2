"""Concrete read entry points against task-start code, using synthetic IO only."""
import ast
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from curriculum_api import views, learning_storage, programme_workspace_reads, authoring_read_transport
from curriculum_api.catalogue.infrastructure import authoring_runtime as runtime, authoring_schema_runtime as schema, learning_read_routes as routes, programme_reads, authoring_columns, database_reads, cache_runtime, storage_context
from curriculum_api.catalogue.tests.parity.workspace_composition_oracle import SNAPSHOT


def original(file, names, namespace):
    namespace = dict(namespace)
    for name in names:
        source = SNAPSHOT['original_functions'][file + ':' + name]
        exec(compile(source, '<task-start-' + file + '>', 'exec'), namespace)
    return namespace


class AuthoringWorkspaceComposition(SimpleTestCase):
    def test_compatibility_exports_share_real_owners_and_caches(self):
        for name in ('authoring_fetch_all', 'authoring_select_sql', 'complete_authoring_rows',
                     'prefetch_authoring_reads', 'learning_read_table'):
            self.assertIs(getattr(views, name), getattr(runtime, name))
        self.assertIs(views.ensure_module_authoring_tables, schema.ensure_module_authoring_tables)
        self.assertIs(authoring_read_transport.compact_authoring_rows, runtime.compact_authoring_rows)
        self.assertIs(programme_workspace_reads.programme_structure_child_rows,
                      programme_reads.programme_structure_child_rows)
        for name in ('enabled', 'reset', 'native_read_table', 'read_table', '_ready', '_not_ready_until'):
            self.assertIs(getattr(learning_storage, name), getattr(routes, name))

    def test_memo_keys_match_original_including_defaults_columns_and_native_scope(self):
        old = original('views.py', ('authoring_fetch_all',), {
            '__package__': 'curriculum_api', 'scoped_curriculum_read': views.scoped_curriculum_read,
        })['authoring_fetch_all']
        for native in (False, True):
            with storage_context.native_authoring_scope() if native else nullcontext():
                for kwargs in ({}, {'ensure_tables': False}, {'columns': ('id',)},
                               {'exclude_columns': ['description']}, {'params': []}):
                    self.assertEqual(runtime.authoring_fetch_all.memo_key('modules', **kwargs),
                                     old.memo_key('modules', **kwargs))

    def test_schema_gate_native_warm_cold_and_bootstrap_order_matches_original(self):
        for native, ready, bootstrap in ((True, False, False), (True, True, True),
                                         (False, True, True), (False, False, False), (False, False, True)):
            results = []
            for old in (True, False):
                events = []
                gate = SimpleNamespace(
                    require_tables=lambda *tables: events.append(('require', tables)),
                    runtime_bootstrap_allowed=lambda: events.append(('bootstrap',)) or bootstrap,
                )
                values = dict(_AUTHORING_TABLES_READY=ready, schema_gate=gate,
                              native_only=lambda: native, AUTHORING_REQUIRED_TABLES=schema.AUTHORING_REQUIRED_TABLES,
                              provision_module_authoring_tables=lambda: events.append(('provision',)))
                if old:
                    ns = original('views.py', ('ensure_module_authoring_tables',), values)
                    ns['ensure_module_authoring_tables']()
                    result = ns['_AUTHORING_TABLES_READY']
                else:
                    with patch.dict(vars(schema), values):
                        schema.ensure_module_authoring_tables()
                        result = schema._AUTHORING_TABLES_READY
                results.append((result, events))
            self.assertEqual(*results)

    def test_schema_failure_never_marks_ready_and_propagates(self):
        with patch.object(schema, '_AUTHORING_TABLES_READY', False), \
             patch.object(schema, 'native_only', return_value=False), \
             patch.object(schema.schema_gate, 'runtime_bootstrap_allowed', return_value=False), \
             patch.object(schema.schema_gate, 'require_tables', side_effect=RuntimeError('missing synthetic table')):
            with self.assertRaisesRegex(RuntimeError, 'missing synthetic table'):
                schema.ensure_module_authoring_tables()
            self.assertFalse(schema._AUTHORING_TABLES_READY)

    def test_reset_uses_single_schema_latch(self):
        with patch.object(schema, '_AUTHORING_TABLES_READY', True):
            schema.reset_ready_flag()
            self.assertFalse(schema._AUTHORING_TABLES_READY)
        self.assertNotIn('_AUTHORING_TABLES_READY', vars(views))
        source = SNAPSHOT['original_functions']['views.py:reset_schema_ready_flags']
        self.assertIn("globals().update", source)
        self.assertNotIn('_SCHEMA_READY_FLAGS', vars(views))

    def test_read_route_preserves_native_union_physical_and_non_postgres_sources(self):
        for vendor, native, enabled in (('postgresql', False, True), ('postgresql', False, False),
                                        ('postgresql', True, False), ('sqlite', False, False)):
            for table in ('modules', 'ksb_mappings', 'live_sessions', 'unrelated'):
                db = SimpleNamespace(vendor=vendor, ops=SimpleNamespace(quote_name=lambda value: '[' + value + ']'))
                for old in (True, False):
                    values = dict(connection=db, native_only=lambda: native, enabled=Mock(return_value=enabled),
                                  READ_VIEWS=routes.READ_VIEWS, NATIVE_VIEWS=routes.NATIVE_VIEWS)
                    if old:
                        ns = original('learning_storage.py', ('native_read_table', 'read_table'), values)
                        expected = ns['read_table'](table, db)
                        expected_calls = values['enabled'].call_args_list
                    else:
                        with patch.dict(vars(routes), values):
                            self.assertEqual(routes.read_table(table, db), expected)
                            self.assertEqual(values['enabled'].call_args_list, expected_calls)

    def test_storage_readiness_cache_and_refresh_use_identical_sql_and_ttl(self):
        outcomes = []
        for old in (True, False):
            clock = [100.0]
            cursor = Mock()
            cursor.__enter__ = Mock(return_value=cursor)
            cursor.__exit__ = Mock(return_value=False)
            cursor.fetchone.side_effect = [(False,), (True,), (True,)]
            db = SimpleNamespace(vendor='postgresql', alias='synthetic',
                                 settings_dict={'HOST': 'fixture', 'PORT': '5432', 'NAME': 'fixture'},
                                 cursor=Mock(return_value=cursor))
            ns = dict(connection=db, _ready={}, _not_ready_until={}, monotonic=lambda: clock[0],
                      NATIVE_REQUIRED_COLUMNS=routes.NATIVE_REQUIRED_COLUMNS, NATIVE_VIEWS=routes.NATIVE_VIEWS)
            with ExitStack() as stack:
                if old:
                    ns = original('learning_storage.py', ('enabled', 'reset'), ns)
                else:
                    stack.enter_context(patch.dict(vars(routes), ns))
                    ns = vars(routes)
                results = [ns['enabled'](db), ns['enabled'](db)]
                clock[0] += 6
                results += [ns['enabled'](db), ns['enabled'](db), ns['enabled'](db, refresh=True)]
                outcomes.append((results, deepcopy(ns['_ready']), deepcopy(ns['_not_ready_until']),
                                 cursor.execute.call_args_list, db.cursor.call_count))
                ns['reset']()
                self.assertEqual(ns['_ready'], {})
                self.assertEqual(ns['_not_ready_until'], {})
        self.assertEqual(*outcomes)
        self.assertEqual(outcomes[0][0], [False, False, True, True, True])
        self.assertEqual(outcomes[0][-1], 3)

    def test_workspace_default_composition_preserves_calls_projection_and_empty_ids(self):
        for text in (False, True):
            for ids in ([], [' B ', 'A', 'A', None]):
                observed = []
                for old in (True, False):
                    events = []
                    def fetch(*args, **kwargs):
                        events.append(('fetch', args, kwargs))
                        return [{'id': args[0]}]
                    def compact(*args, **kwargs):
                        events.append(('compact', args, kwargs))
                        return [{'id': args[0]}]
                    def prefetch(calls):
                        events.append(('prefetch', calls))
                    def live(table):
                        events.append(('live', table))
                        return 'status <> %s', ['inactive']
                    kwargs = dict(component_text=text, authoring_fetch_all=fetch, compact_authoring_rows=compact,
                                  prefetch_authoring_reads=prefetch, live_authoring_rows_sql=live)
                    if old:
                        ns = original('catalogue/infrastructure/programme_reads.py', ('programme_structure_child_rows',), {})
                        result = ns['programme_structure_child_rows'](
                            ids, **kwargs, clean_str=views.clean_str,
                            AUTHORING_COMPONENTS_TABLE='components', AUTHORING_KSB_MAPPINGS_TABLE='ksb_mappings',
                            AUTHORING_MODULES_TABLE='modules', AUTHORING_WEEKS_TABLE='weeks',
                            CATALOGUE_SUMMARY_COMPONENT_COLUMNS=authoring_columns.CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
                            workspace_component_text_columns=authoring_columns.workspace_component_text_columns)
                    else:
                        with patch.object(runtime, 'authoring_fetch_all', fetch), \
                             patch.object(runtime, 'compact_authoring_rows', compact), \
                             patch.object(runtime, 'prefetch_authoring_reads', prefetch), \
                             patch.object(programme_reads, '_live_rows_sql', live):
                            result = programme_workspace_reads.programme_structure_child_rows(ids, component_text=text)
                    observed.append((result, events))
                self.assertEqual(*observed)

    def test_scope_reuses_same_reader_but_never_across_requests(self):
        from curriculum_api.catalogue.infrastructure import authoring_reads
        with patch.object(authoring_reads, 'authoring_fetch_all', return_value=[{'id': 'synthetic'}]) as read:
            with cache_runtime.curriculum_read_scope():
                first = runtime.authoring_fetch_all('modules')
                self.assertIs(views.authoring_fetch_all('modules', ensure_tables=True), first)
                read.assert_called_once()
            views.authoring_fetch_all('modules')
            self.assertEqual(read.call_count, 2)
