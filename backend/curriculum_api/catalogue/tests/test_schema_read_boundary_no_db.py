"""Actual frozen schema/KSB implementations compared inside isolated Docker."""
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import database_read_fixture
from curriculum_api.catalogue.infrastructure import database_reads
import copy
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase
from curriculum_api import schema_compat as schema, ksb_mapping_placement as placement, views
from curriculum_api.catalogue.infrastructure import schema_relations, schema_projection, ksb_placement_reads, schema_reads

RAW = (Path(__file__).parents[2] / 'catalogue/tests/fixtures/legacy_snapshots/schema_read_snapshot.json').read_bytes()
assert hashlib.sha256(RAW).hexdigest() == '47f31c1395974e0a47c44347ab481d0a9b80cc20a61c2033cbda8f766ca0e7f7'
SNAPSHOT = json.loads(RAW)


def frozen(filename):
    namespace = {'__name__': 'curriculum_api.frozen_schema_read', '__package__': 'curriculum_api'}
    exec(compile(SNAPSHOT['files'][filename], '<frozen-' + filename + '>', 'exec'), namespace)
    return SimpleNamespace(**namespace)


class Cursor:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchall(self):
        return self.rows


def connection_for(rows):
    cursor = Cursor(rows)
    connection = MagicMock(vendor='postgresql')
    connection.cursor.return_value = cursor
    return connection, cursor


def set_original(module, **values):
    # Frozen functions retain their actual original module globals.
    namespace = next(value.__globals__ for value in vars(module).values()
                     if hasattr(value, '__globals__') and getattr(value, '__module__', '') == 'curriculum_api.frozen_schema_read')
    namespace.update(values)


class SchemaReadParity(SimpleTestCase):
    def setUp(self):
        self.old = frozen('schema_compat.py')
        self.old_placement = frozen('ksb_mapping_placement.py')
        self.addCleanup(schema.reset_standard_ksb_texts)
        self.addCleanup(placement.reset_standard_ksb_texts)
        self.addCleanup(schema._ADAPTED.clear)

    def test_relation_and_column_contract_matrix(self):
        schemas = {
            'modules': {'module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'status', 'updated_at'},
            'ksb_mappings': {'id', 'component_id', 'standard_ksb_id', 'status', 'updated_at'},
            'components': {'id', 'module_catalogue_id', 'status', 'updated_at'},
            'weeks': {'id', 'module_catalogue_id', 'status', 'updated_at'},
            'free_course_weeks': {'id', 'course_id', 'week_id'},
            'unknown': set(),
        }
        for vendor in ('postgresql', 'sqlite'):
            connection = SimpleNamespace(vendor=vendor)
            set_original(self.old, connection=connection)
            with patch.object(schema, 'connection', connection):
                for table, columns in schemas.items():
                    for alias in (True, False):
                        for defer in ((), ('ksb_description',), ('programme_name',)):
                            with self.subTest(table=table, vendor=vendor, alias=alias, defer=defer):
                                self.assertEqual(schema.read_relation(table, columns, alias, defer),
                                                 self.old.read_relation(table, columns, alias, defer))
                    self.assertEqual(schema.legacy_read_columns(table, columns), self.old.legacy_read_columns(table, columns))

    def test_sql_translation_and_passthrough_preserve_exact_text(self):
        connection = SimpleNamespace(vendor='postgresql')
        columns = lambda *_: {'module_catalogue_id', 'programme_id', 'status', 'updated_at'}
        set_original(self.old, connection=connection, columns_of=columns)
        with patch.object(schema, 'connection', connection), patch.object(schema, 'columns_of', columns):
            for sql in (
                'select m.title from curriculum.modules m where m.deleted_at is null',
                'select * from curriculum.modules where deleted_at is null for update',
                'delete from curriculum.modules where deleted_at is not null',
                'update curriculum.components set title = %s from curriculum.modules m where m.deleted_at is null',
                'select "curriculum"."modules"."title" from "curriculum"."modules" where deleted_at is null',
                'select * from only curriculum.modules',
                'select status from curriculum.modules',
            ):
                with self.subTest(sql=sql):
                    expected = self.old.adapt_sql(sql)
                    self.assertEqual(schema.adapt_sql(sql), expected)
                    self.assertEqual(schema.adapt_sql(expected), self.old.adapt_sql(expected))

    def test_lifecycle_projection_preserves_existing_values_and_selection(self):
        rows = [{'id': 'a', 'status': 'inactive', 'updated_at': 'then'},
                {'id': 'b', 'status': 'planned'}, {'id': 'c', 'status': ' Archived '}]
        for table in ('modules', 'weeks', 'coaches'):
            for requested in (None, ['id'], ['id', 'deleted_at', 'is_archived']):
                for excluded in (None, ['deleted_at']):
                    before, after = copy.deepcopy(rows), copy.deepcopy(rows)
                    expected = self.old.project_rows(table, before, {'id', 'status'}, requested=requested, excluded=excluded)
                    actual = schema.project_rows(table, after, {'id', 'status'}, requested=requested, excluded=excluded)
                    self.assertIs(actual, after)
                    self.assertEqual(actual, expected)

    def test_placement_scope_and_projection_keep_duplicates_and_null_rules(self):
        with database_read_fixture('authoring_table_name', side_effect=lambda name: '"curriculum"."' + name + '"'):
            for module_ids, week, components in [([], None, []), (' MOD-1 ', '', ['C', 'C']),
                                                (['MOD-1', None, 'MOD-1'], ' W ', [' C ', None])]:
                self.assertEqual(placement.where(module_ids, week, components),
                                 self.old_placement.where(module_ids, week, components))
            for description in (True, False):
                self.assertEqual(placement.relation(include_description=description),
                                 self.old_placement.relation(include_description=description))

    def test_schema_reference_cache_preserves_expiry_missing_and_chunking(self):
        connection, cursor = connection_for([(7, 'K1', 'Synthetic standard text')])
        clock = SimpleNamespace(monotonic=lambda: 1000.0)
        set_original(self.old, connection=connection, time=clock)
        wanted = list(range(2002)) + [None, 7]
        expected = self.old.standard_ksb_texts(wanted)
        self.assertEqual(len(cursor.calls), 2)
        queries = copy.deepcopy(cursor.calls)
        cursor.calls.clear()
        schema.reset_standard_ksb_texts()
        with patch.object(schema, 'connection', connection), patch.object(schema, 'time', clock):
            self.assertEqual(schema.standard_ksb_texts(wanted), expected)
            self.assertEqual(cursor.calls, queries)
            cursor.calls.clear()
            self.assertEqual(schema.standard_ksb_texts([7]), expected)
            self.assertEqual(cursor.calls, [])
            clock.monotonic = lambda: 1061.0
            self.assertEqual(schema.standard_ksb_texts([7]), self.old.standard_ksb_texts([7]))
            self.assertEqual(len(cursor.calls), 2)

    def test_component_mapping_queries_and_row_shapes_match(self):
        rows = [('C1', 'M1', None, 3, None, None, None, None, 'K1', None)]
        connection, cursor = connection_for(rows)
        set_original(self.old, connection=connection)
        expected = self.old.component_mapping_items(['C1', None, 'C1'])
        queries = copy.deepcopy(cursor.calls)
        cursor.calls.clear()
        with patch.object(schema, 'connection', connection):
            self.assertEqual(schema.component_mapping_items(['C1', None, 'C1']), expected)
            self.assertEqual(cursor.calls, queries)
        cursor.calls.clear()
        with patch('django.db.connection', connection):
            expected = self.old_placement.component_items(['C1', None, 'C1'])
            queries = copy.deepcopy(cursor.calls)
            cursor.calls.clear()
            self.assertEqual(placement.component_items(['C1', None, 'C1']), expected)
            self.assertEqual(cursor.calls, queries)

    def test_columns_cache_missing_table_and_postgresql_listing_match(self):
        old = dict(vars(views))
        exec(compile(SNAPSHOT['entries']['views.py:column_names']['source'], '<original column reader>', 'exec'), old)
        answers = [[{'table_name': 'modules', 'column_name': 'id'}], [{'column_name': 'late_column'}]]
        before_fetch = MagicMock(side_effect=copy.deepcopy(answers))
        old.update(_TABLE_COLUMNS_LISTED=False, _TABLE_COLUMNS_CACHE={}, fetch_all=before_fetch,
                   native_only=lambda: False, connection=SimpleNamespace(vendor='postgresql'))
        expected = [old['column_names'](name) for name in ('modules', 'missing', 'modules')]
        after_fetch = MagicMock(side_effect=copy.deepcopy(answers))
        with database_read_fixture('_TABLE_COLUMNS_LISTED', False), database_read_fixture('_TABLE_COLUMNS_CACHE', {}), \
                database_read_fixture('fetch_all', after_fetch), database_read_fixture('native_only', return_value=False), \
                database_read_fixture('connection', SimpleNamespace(vendor='postgresql')):
            self.assertEqual([views.column_names(name) for name in ('modules', 'missing', 'modules')], expected)
            self.assertTrue(database_reads._TABLE_COLUMNS_LISTED)
        self.assertEqual(after_fetch.call_args_list, before_fetch.call_args_list)

    def test_actual_owned_readers_are_invoked(self):
        with patch.object(schema_relations, 'read_relation', wraps=schema_relations.read_relation) as relation, \
                patch.object(schema_projection, 'project_rows', wraps=schema_projection.project_rows) as projection, \
                patch.object(ksb_placement_reads, 'where', wraps=ksb_placement_reads.where) as where, \
                patch.object(schema_reads, 'column_names', wraps=schema_reads.column_names) as columns, \
                database_read_fixture('_TABLE_COLUMNS_CACHE', {'curriculum.modules': {'id'}}), \
                database_read_fixture('native_only', return_value=False):
            schema.read_relation('unknown', set())
            schema.project_rows('unknown', [], set())
            placement.where()
            self.assertEqual(views.column_names('modules'), {'id'})
        for called in (relation, projection, where, columns):
            called.assert_called_once()

    def test_native_free_course_columns_bypass_schema_queries(self):
        old = dict(vars(views))
        exec(compile(SNAPSHOT['entries']['views.py:column_names']['source'], '<original columns>', 'exec'), old)
        contract = SimpleNamespace(COLUMNS={'free_courses': [('id', 'text'), ('title', 'text')]})
        forbidden = MagicMock(side_effect=AssertionError('Native columns must not query the database'))
        old.update(native_only=lambda: True, fetch_all=forbidden)
        with patch.dict(sys.modules, {'curriculum_api.catalogue.infrastructure.free_course_contract': contract}), \
                database_read_fixture('native_only', return_value=True), database_read_fixture('fetch_all', forbidden):
            self.assertEqual(views.column_names('free_courses'), old['column_names']('free_courses'))
            self.assertEqual(views.column_names('free_courses'), {'id', 'title'})
        forbidden.assert_not_called()

    def test_sqlite_column_probe_and_cache_remain_equivalent(self):
        old = dict(vars(views))
        exec(compile(SNAPSHOT['entries']['views.py:column_names']['source'], '<original columns>', 'exec'), old)
        connection, cursor = connection_for([(0, 'id'), (1, 'title')])
        connection.vendor = 'sqlite'
        old.update(_TABLE_COLUMNS_CACHE={}, connection=connection, native_only=lambda: False)
        expected = old['column_names']('modules')
        queries = copy.deepcopy(cursor.calls)
        cursor.calls.clear()
        with database_read_fixture('_TABLE_COLUMNS_CACHE', {}), database_read_fixture('connection', connection), \
                database_read_fixture('native_only', return_value=False):
            self.assertEqual(views.column_names('modules'), expected)
            self.assertEqual(views.column_names('modules'), expected)
        self.assertEqual(cursor.calls, queries)
