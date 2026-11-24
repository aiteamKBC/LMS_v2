"""Real pre/post implementation parity with synthetic, database-forbidden ports."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase
from . import views, content_cache, module_live
from .catalogue.tests.parity.row_persistence_oracle import SNAPSHOT
from .test_module_commands_boundary_no_db import recording
from .test_hierarchy_commands_boundary_no_db import FrozenClock


@contextmanager
def persistence_scope(original=False, **ports):
    with ExitStack() as stack:
        stack.enter_context(composition_fixture(views, 'datetime', FrozenClock))
        for name, value in ports.items():
            stack.enter_context(composition_fixture(views, name, value))
        if original:
            for name, entry in SNAPSHOT['functions'].items():
                if name in ports:
                    continue
                env = dict(vars(views))
                exec(compile(entry['source'], '<pre-row-persistence>', 'exec'), env)
                fn = env[name]
                old = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
                old.__kwdefaults__ = fn.__kwdefaults__
                for decorator in reversed(entry['decorators']):
                    old = eval(decorator, vars(views))(old)
                stack.enter_context(composition_fixture(views, name, old))
        yield stack


def write_ports(events, *, columns=('id', 'title', 'module_catalogue_id')):
    return dict(
        column_names=Mock(return_value=list(columns)),
        curriculum_names=SimpleNamespace(
            store_staff=lambda table, payload, fields: (dict(payload), set()),
            attach=lambda table, rows: rows),
        write_shape=SimpleNamespace(normalise=lambda table, payload, fields: (payload, set())),
        native_only=Mock(return_value=False),
        note_previous_content_modules=recording(events, 'previous'),
        note_live_rows=recording(events, 'live'),
        versioning=SimpleNamespace(record_rows=recording(events, 'history')),
    )


class RowPersistenceParity(SimpleTestCase):
    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def test_field_shaping_keeps_only_writable_fields_and_explicit_nulls(self):
        def scenario(old):
            ports = write_ports([])
            ports['column_names'].return_value += ['staff', 'status', 'clear']
            ports['curriculum_names'].store_staff = lambda t, p, c: ({**p, 'staff': None}, {'staff'})
            ports['write_shape'].normalise = lambda t, p, c: ({**p, 'status': None}, {'status'})
            with persistence_scope(old, **ports):
                return views.filtered_payload('modules', {'id': 'A', 'title': None, 'clear': None, 'unknown': 3}, ['clear'])
        self.assertEqual(self.compare(scenario), {'id': 'A', 'clear': None, 'staff': None, 'status': None})

    def test_insert_sql_params_and_history_then_live_order(self):
        def scenario(old):
            events = []
            ports = write_ports(events)
            ports.update(table_name=lambda t: 'synthetic.rows', execute_returning=recording(events, 'sql', [{'id': 'A', 'title': 'Saved'}]))
            with persistence_scope(old, **ports):
                row = views.insert_row('modules', {'id': 'A', 'title': 'Saved', 'unknown': 'ignored'})
            return row, events
        row, events = self.compare(scenario)
        self.assertEqual([e[0] for e in events], ['sql', 'history', 'live'])
        self.assertEqual(events[0][1], ('insert into synthetic.rows ("id", "title") values (%s, %s) returning *', ['A', 'Saved']))

    def test_insert_schema_retry_is_narrow_and_invalidates_only_its_column_cache(self):
        def scenario(old, message):
            events = []
            ports = write_ports(events)
            sql = Mock(side_effect=[DatabaseError(message), [{'id': 'A'}]])
            cached = {'modules': ['stale'], 'curriculum.modules': ['stale'], 'keep': ['safe']}
            ports.update(table_name=lambda t: t, execute_returning=sql, _TABLE_COLUMNS_CACHE=cached)
            with persistence_scope(old, **ports):
                try:
                    result = views.insert_row('modules', {'id': 'A'})
                except DatabaseError as exc:
                    result = str(exc)
            return result, sql.call_count, cached, events
        result = self.compare(lambda old: scenario(old, 'table has no column named obsolete'))
        self.assertEqual(result[1:3], (2, {'keep': ['safe']}))
        result = self.compare(lambda old: scenario(old, 'permission denied'))
        self.assertEqual(result[1], 1)
        self.assertEqual(result[3], [])

    def test_empty_write_is_rejected_before_sql(self):
        for old in (False, True):
            with persistence_scope(old, **write_ports([]), execute_returning=Mock(side_effect=AssertionError('SQL'))):
                with self.assertRaisesRegex(ValueError, 'No writable columns'):
                    views.insert_row('modules', {'unknown': 1})
                with self.assertRaisesRegex(ValueError, 'No writable columns'):
                    views.update_rows('modules', 'id = %s', ['A'], {'unknown': 1})

    def test_normalized_free_course_update_routes_once_without_duplicate_history(self):
        from .free_course_contract import COLUMNS
        table = next(iter(COLUMNS))
        def scenario(old):
            events = []
            ports = write_ports(events)
            ports.update(native_only=Mock(return_value=True), update_authoring_rows=recording(events, 'native', [{'id': 'A'}]),
                         execute_returning=Mock(side_effect=AssertionError('independent SQL')))
            with persistence_scope(old, **ports):
                result = views.update_rows(table, 'id = %s', ['A'], {'title': 'Saved'})
            return result, events
        self.assertEqual([e[0] for e in self.compare(scenario)[1]], ['native'])

    def test_programme_identity_wins_over_same_name_and_unchanged_save_has_no_write(self):
        def scenario(old, name):
            events = []
            with persistence_scope(old, ensure_program_config_archive_columns=Mock(),
                    get_program_config_rows=Mock(return_value=[{'programme_id': 'PROG-OTHER', 'name': name, 'status': 'active'},
                                                              {'programme_id': 'PROG-KEEP', 'name': 'Original', 'status': 'active'}]),
                    programme_config_key_column=Mock(return_value='programme_id'),
                    update_rows=recording(events, 'update'), insert_row=Mock(side_effect=AssertionError('create')),
                    invalidate_curriculum_cache=recording(events, 'invalidate')):
                result = views.ensure_programme_config_for_authoring(name, ' PROG-KEEP ')
            return result, events
        result, events = self.compare(lambda old: scenario(old, 'Original'))
        self.assertEqual(result['id'], 'PROG-KEEP')
        self.assertEqual(events, [])
        _, events = self.compare(lambda old: scenario(old, 'Renamed'))
        self.assertEqual(events[0][1][2], ['PROG-KEEP'])
        self.assertEqual([e[0] for e in events], ['update', 'invalidate'])

    def test_programme_placeholder_uses_existing_name_or_mints_only_on_write(self):
        def scenario(old, existing):
            events = []
            with persistence_scope(old, ensure_program_config_archive_columns=Mock(),
                    get_program_config_rows=Mock(return_value=existing),
                    programme_config_key_column=Mock(return_value='programme_id'),
                    unique_program_id=recording(events, 'mint', 'PROG-NEW'),
                    insert_row=recording(events, 'insert'), update_rows=recording(events, 'update'),
                    invalidate_curriculum_cache=recording(events, 'invalidate')):
                result = views.ensure_programme_config_for_authoring(' Stored ', 'programme-local')
                missing = views.ensure_programme_config_for_authoring('Unassigned programme', 'programme-local')
            return result, missing, events
        found = self.compare(lambda old: scenario(old, [{'programme_id': 'PROG-REAL', 'name': 'Stored', 'status': 'active'}]))
        self.assertEqual(found[0]['id'], 'PROG-REAL')
        self.assertIsNone(found[1])
        self.assertEqual(found[2], [])
        created = self.compare(lambda old: scenario(old, []))
        self.assertEqual(created[0]['id'], 'PROG-NEW')
        self.assertEqual([e[0] for e in created[2]], ['mint', 'insert', 'invalidate'])
        self.assertEqual(created[2][0][1][0], '')

    def test_notifications_preserve_order_and_best_effort_live_sync(self):
        def scenario(old, fail):
            events = []
            live = recording(events, 'live')
            if fail:
                live.side_effect = ValueError('synthetic live failure')
            with persistence_scope(old, curriculum_names=SimpleNamespace(invalidate_for=recording(events, 'names')),
                                   logger=Mock()), composition_fixture(module_live, 'note_rows', live), \
                    patch.object(content_cache, 'note_rows', recording(events, 'content')):
                views.note_live_rows('components', [{'id': 'C'}])
            return events
        self.assertEqual([e[0] for e in self.compare(lambda old: scenario(old, False))], ['names', 'live', 'content'])
        self.assertEqual([e[0] for e in self.compare(lambda old: scenario(old, True))], ['names', 'content'])

    def test_moving_content_retires_original_modules_or_explicitly_retires_all(self):
        def scenario(old, *, vendor='postgresql', failure=False, kwargs=None):
            events = []
            reader = recording(events, 'read', [{'module_catalogue_id': 'OLD'}])
            if failure:
                reader.side_effect = ValueError('synthetic read refusal')
            with persistence_scope(old, connection=SimpleNamespace(vendor=vendor), fetch_all=reader,
                                   table_name=lambda t: 'synthetic.components', logger=Mock()), \
                    patch.object(content_cache, 'note_modules', side_effect=lambda ids: events.append(('modules', list(ids)))), \
                    patch.object(content_cache, 'retire_all', side_effect=lambda: events.append(('all',))):
                views.note_previous_content_modules('components', payloads=[{'id': 'C', 'module_catalogue_id': 'NEW'}], **(kwargs or {}))
            return events
        for kwargs in ({'where_sql': 'id = %s', 'where_params': ['C']}, {'key_columns': ['id']}):
            self.assertEqual(self.compare(lambda old: scenario(old, kwargs=kwargs))[-1], ('modules', ['OLD']))
        self.assertEqual(self.compare(lambda old: scenario(old)), [('all',)])
        self.assertEqual(self.compare(lambda old: scenario(old, vendor='sqlite')), [('all',)])
        self.assertEqual(self.compare(lambda old: scenario(old, failure=True, kwargs={'key_columns': ['id']})), [('all',)])

    def test_schema_bootstrap_guard_and_missing_column_cache_invalidation(self):
        for old in (False, True):
            with persistence_scope(old, schema_gate=SimpleNamespace(runtime_bootstrap_allowed=lambda: False),
                                   ensure_columns=Mock(side_effect=AssertionError('DDL'))):
                views.ensure_program_config_archive_columns()
        def scenario(old):
            cursor = MagicMock()
            cursor.__enter__.return_value = cursor
            cached = {'programmes': ['old'], 'curriculum.programmes': ['old'], 'other': ['keep']}
            with persistence_scope(old, connection=SimpleNamespace(vendor='postgresql', cursor=lambda: cursor),
                    has_column=lambda t, c: c == 'existing', table_name=lambda t: 'synthetic.programmes', _TABLE_COLUMNS_CACHE=cached):
                views.ensure_columns('programmes', {'existing': 'text', 'new': 'text'})
            return cursor.execute.call_args_list, cached
        calls, cached = self.compare(scenario)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].args, ('alter table synthetic.programmes add column if not exists "new" text',))
        self.assertEqual(cached, {'other': ['keep']})

    def test_group_unassignment_clears_only_relationship_columns(self):
        def scenario(old):
            events = []
            with persistence_scope(old, authoring_fetch_all=recording(events, 'read', [{'module_catalogue_id': 'KEEP'}, {'module_catalogue_id': 'REMOVE'}]),
                                   update_authoring_rows=recording(events, 'update')):
                result = views.unassign_authoring_modules_from_group(' G ', [' KEEP '])
            return result, events
        result, events = self.compare(scenario)
        self.assertEqual(result, ['REMOVE'])
        self.assertEqual(events[0][1][2], ['G'])
        self.assertEqual(events[1][1][-1], {'cohort_id': None, 'group_id': None})

    def test_programme_read_uses_optional_display_order_without_writes(self):
        for ordered in (False, True):
            def scenario(old):
                sql = Mock(return_value=[{'programme_id': 'PROG-A'}])
                with persistence_scope(old, has_column=Mock(return_value=ordered), table_name=lambda t: 'synthetic.programmes', fetch_all=sql):
                    result = views.get_program_config_rows_raw()
                return result, sql.call_args.args
            _, sql = self.compare(scenario)
            self.assertIn('order by coalesce(display_order, 0), name' if ordered else 'order by name', sql[0])
