"""Real SQL parity on synthetic tables in the existing isolated Docker runner."""
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import database_read_fixture
from curriculum_api.catalogue.infrastructure import database_reads
from contextlib import contextmanager
import copy
import unittest
from unittest.mock import patch

from django.conf import settings
from django.db import connection, transaction
from curriculum_api import schema_compat as schema, ksb_mapping_placement as placement, views
from curriculum_api.test_schema_read_boundary_no_db import frozen, set_original, SNAPSHOT


def table(name):
    return '"phase1f_schema_reads"."' + name + '"'


@contextmanager
def disposable_schema():
    assert connection.vendor == 'postgresql'
    assert len(settings.DATABASES) == 6
    assert all(db['HOST'] == '127.0.0.1' and db['NAME'] == 'phase1f' for db in settings.DATABASES.values())
    with transaction.atomic():
        try:
            with connection.cursor() as cursor:
                cursor.execute('CREATE SCHEMA phase1f_schema_reads')
                cursor.execute('CREATE TABLE phase1f_schema_reads.components (id text, module_catalogue_id text, week_id text)')
                cursor.execute('CREATE TABLE phase1f_schema_reads.standard_ksbs (id bigint, ksb_code text, ksb_description text)')
                cursor.execute('''CREATE TABLE phase1f_schema_reads.ksb_mappings (
                    id text, component_id text, standard_ksb_id bigint, ksb_id text, weight numeric,
                    classification text, source_type text, source_id text, weight_class text,
                    status text, updated_at timestamp)''')
                cursor.execute("INSERT INTO phase1f_schema_reads.components VALUES ('C1','MOD-SYNTHETIC','W1')")
                cursor.execute("INSERT INTO phase1f_schema_reads.standard_ksbs VALUES (7,'K1','Synthetic text')")
                cursor.execute("""INSERT INTO phase1f_schema_reads.ksb_mappings VALUES
                    ('M1','C1',7,'KSB-SYNTHETIC',40,'main','standard','synthetic','hard','active','2026-01-01'),
                    ('M2','C1',7,'KSB-SYNTHETIC',20,'secondary',null,null,null,'archived','2026-01-01'),
                    ('M3',null,8,null,0,null,null,null,null,'active','2026-01-01')""")
            with database_read_fixture('authoring_table_name', side_effect=table), \
                    patch.object(schema, '_internal', side_effect=lambda name: 'only ' + table(name)):
                yield
        finally:
            transaction.set_rollback(True)
            schema.reset_standard_ksb_texts()
            placement.reset_standard_ksb_texts()
            schema._ADAPTED.clear()


def rows(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        return [dict(zip([column[0] for column in cursor.description], row)) for row in cursor.fetchall()]


class SchemaReadsPostgreSQL(unittest.TestCase):
    def test_normalized_placement_joins_and_optional_description_execute(self):
        with disposable_schema():
            original = frozen('ksb_mapping_placement.py')
            for description in (True, False):
                old = original.relation(include_description=description)
                new = placement.relation(include_description=description)
                self.assertEqual(new, old)
                actual = rows('select * from ' + new + ' order by id')
                self.assertEqual(actual, rows('select * from ' + old + ' order by id'))
                self.assertEqual((actual[0]['module_catalogue_id'], actual[0]['ksb_code']), ('MOD-SYNTHETIC', 'K1'))
                self.assertIsNone(actual[2]['module_catalogue_id'])
                self.assertEqual(actual[2]['ksb_code'], '')
                self.assertEqual('ksb_description' in actual[0], description)

    def test_reference_text_and_component_items_execute_without_status_drift(self):
        with disposable_schema():
            original = frozen('schema_compat.py')
            original_placement = frozen('ksb_mapping_placement.py')
            set_original(original, _internal=lambda name: 'only ' + table(name))
            schema.reset_standard_ksb_texts()
            placement.reset_standard_ksb_texts()
            self.assertEqual(schema.standard_ksb_texts([7, 8, None, 7]), original.standard_ksb_texts([7, 8, None, 7]))
            self.assertEqual(placement.standard_ksb_texts([7, 8, None, 7]), original_placement.standard_ksb_texts([7, 8, None, 7]))
            actual = schema.component_mapping_items(['C1', 'C1', None])
            self.assertEqual(actual, original.component_mapping_items(['C1', 'C1', None]))
            self.assertEqual(placement.component_items(['C1']), original_placement.component_items(['C1']))
            self.assertEqual([item['id'] for item in actual['C1']], ['M1'])
            source = rows('select * from ' + table('ksb_mappings') + ' order by id')
            old_rows, new_rows = copy.deepcopy(source), copy.deepcopy(source)
            expected = original.project_rows('ksb_mappings', old_rows, set(source[0]))
            self.assertEqual(schema.project_rows('ksb_mappings', new_rows, set(source[0])), expected)
            self.assertEqual(new_rows[1]['is_programme_deleted'], True)
            self.assertEqual(new_rows[2]['ksb_code'], '')

    def test_schema_introspection_uses_same_postgresql_columns_and_cache(self):
        with disposable_schema():
            namespace = dict(vars(views))
            exec(compile(SNAPSHOT['entries']['views.py:column_names']['source'], '<frozen columns>', 'exec'), namespace)
            namespace.update(CURRICULUM_SCHEMA='phase1f_schema_reads', _TABLE_COLUMNS_CACHE={}, _TABLE_COLUMNS_LISTED=False)
            expected = [namespace['column_names'](name) for name in ('ksb_mappings', 'components', 'absent')]
            with database_read_fixture('CURRICULUM_SCHEMA', 'phase1f_schema_reads'), \
                    database_read_fixture('_TABLE_COLUMNS_CACHE', {}), database_read_fixture('_TABLE_COLUMNS_LISTED', False):
                self.assertEqual([views.column_names(name) for name in ('ksb_mappings', 'components', 'absent')], expected)
                self.assertTrue(database_reads._TABLE_COLUMNS_LISTED)
                self.assertNotIn('module_catalogue_id', views.column_names('ksb_mappings'))

    def test_translated_legacy_read_executes_with_equivalent_rows(self):
        with disposable_schema():
            original = frozen('schema_compat.py')
            columns = set(rows('select * from ' + table('ksb_mappings') + ' limit 1')[0])
            set_original(original, _internal=lambda name: 'only ' + table(name), columns_of=lambda *_: columns)
            statement = ('select id, module_catalogue_id, ksb_code from curriculum.ksb_mappings '
                         'where deleted_at is null order by id')
            with patch.object(schema, 'columns_of', return_value=columns):
                schema._ADAPTED.clear()
                actual = schema.adapt_sql(statement)
            expected = original.adapt_sql(statement)
            self.assertEqual(actual, expected)
            self.assertEqual(rows(actual), rows(expected))
            self.assertEqual([row['id'] for row in rows(actual)], ['M1', 'M3'])
