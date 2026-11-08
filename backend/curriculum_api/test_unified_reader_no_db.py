"""Offline checks for the integrated reader; no application startup or DB writes."""
import ast
from pathlib import Path
import sqlite3
import unittest
from contextlib import closing
from types import SimpleNamespace
from unittest.mock import Mock, patch

from . import curriculum_names as cn, schema_compat as sc


def reader_namespace(physical):
    names = {'derived_programme_name_sql', 'derived_placement_names_sql', 'authoring_select_sql',
             'authoring_fetch_all', 'PROGRAMME_NAME_DERIVED_TABLES', 'PLACEMENT_NAME_DERIVED_COLUMNS'}
    tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8'))
    nodes = [node for node in tree.body if
             (isinstance(node, ast.FunctionDef) and node.name in names) or
             (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets))]
    namespace = dict(schema_compat=sc, curriculum_names=cn, CURRICULUM_SCHEMA='curriculum',
                     scoped_curriculum_read=lambda fn: fn,
                     column_names=lambda table: physical,
                     has_column=lambda table, key: key in physical,
                     authoring_table_name=lambda table: 'curriculum.' + table,
                     quote_ident=lambda value: '"' + value + '"',
                     archive_state=SimpleNamespace(uses_status=lambda table: True),
                     LEGACY_LIFECYCLE_READ_COLUMNS={'deleted_at'}, ensure_module_authoring_tables=Mock())
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'views.py', 'exec'), namespace)
    return namespace


class UnifiedReaderTests(unittest.TestCase):
    def setUp(self):
        self.physical = {'module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'status'}
        self.ns = reader_namespace(self.physical)
        self.enterContext(patch.object(sc, 'connection', Mock(vendor='postgresql')))
        self.enterContext(patch.object(sc, 'columns_of', side_effect=lambda schema, table: self.physical))

    def select(self, **kwargs):
        return self.ns['authoring_select_sql']('modules', ensure_tables=False, **kwargs)

    def test_compat_relation_preserves_names_lifecycle_filter_and_order(self):
        sql = self.select(columns=['module_catalogue_id', 'programme_name', 'deleted_at'],
                          where_sql='cohort_name = %s AND deleted_at IS NULL', order_sql='group_name LIMIT 10 OFFSET 5')
        for name in ('programme_name', 'cohort_name', 'group_name', 'deleted_at'):
            self.assertEqual(sql.count(f'as "{name}"'), 1)
        self.assertTrue(sql.endswith('where cohort_name = %s AND deleted_at IS NULL order by group_name LIMIT 10 OFFSET 5'))

    def test_fallback_derived_names_support_filters_without_selecting_names(self):
        # Even stale physical copies cannot determine placement display/filtering.
        self.physical.update({'programme_name', 'cohort_name', 'group_name'})
        with patch.object(sc, 'read_relation', return_value=None):
            sql = self.select(columns=['module_catalogue_id'], where_sql="programme_name = 'Renamed'",
                              order_sql='cohort_name DESC LIMIT 1 OFFSET 0')
        self.assertTrue(sql.startswith('select "module_catalogue_id" from (select '))
        self.assertIn('programme_name_source.programme_id = curriculum.modules.programme_id', sql)
        # Execute the actual join-free scalar lookup SQL using read-only CTEs.
        with closing(sqlite3.connect(':memory:')) as db:
            db.execute('PRAGMA query_only=ON')
            db.create_function('btrim', 1, lambda value: value.strip())
            fixture = '''WITH modules(module_catalogue_id,programme_id,cohort_id,group_id,status,
                        programme_name,cohort_name,group_name) AS
                        (VALUES ('M1','P','C','G','active','stale','stale','stale'),
                                ('M2','missing',NULL,NULL,'active','Renamed','stale','stale')),
                        programmes(programme_id,name) AS (VALUES ('P','Renamed')),
                        cohorts(cohort_id,cohort_name) AS (VALUES ('C','Cohort')),
                        groups(group_id,group_name) AS (VALUES ('G','Group')) '''
            self.assertEqual(db.execute(fixture + sql.replace('curriculum.', '')).fetchall(), [('M1',)])
            with patch.object(sc, 'read_relation', return_value=None):
                all_sql = self.select(columns=['module_catalogue_id', 'programme_name'], order_sql='module_catalogue_id')
            self.assertEqual(db.execute(fixture + all_sql.replace('curriculum.', '')).fetchall(), [('M1', 'Renamed'), ('M2', '')])

    def test_mixed_shape_replaces_copied_names_without_duplicate_aliases(self):
        self.physical.add('programme_name')
        sql = self.select(columns=['programme_name', 'deleted_at'])
        self.assertIn('programme_name_source.programme_id = "modules".programme_id', sql)
        self.assertEqual(sql.count('AS programme_name'), 1)
        self.assertIn('as "deleted_at"', sql)

    def test_ksb_placement_and_deleted_at_remain_sql_fields(self):
        self.physical = {'id', 'component_id', 'standard_ksb_id', 'status'}
        ns = reader_namespace(self.physical)
        sql = ns['authoring_select_sql']('ksb_mappings', columns=['id', 'module_catalogue_id', 'deleted_at'],
                                        where_sql='module_catalogue_id = %s', ensure_tables=False)
        self.assertIn('cc.id = t.component_id', sql)
        self.assertIn('as "module_catalogue_id"', sql)
        self.assertIn('as "deleted_at"', sql)

    def test_fetch_keeps_both_projection_stages_and_parameters(self):
        rows = [{'module_catalogue_id': 'M'}]
        cursor = Mock()
        self.ns.update(connection=SimpleNamespace(cursor=lambda: SimpleContext(cursor)),
                       rows_as_dicts=lambda cursor: rows)
        events = []
        with patch.object(sc, 'project_rows', side_effect=lambda *a, **kw: events.append('compat')), \
                patch.object(cn, 'attach', side_effect=lambda table, rows, **kw: events.append('names') or rows):
            result = self.ns['authoring_fetch_all']('modules', 'programme_id = %s', ['P'], ensure_tables=False)
        self.assertIs(result, rows)
        self.assertEqual(events, ['compat', 'names'])
        self.assertEqual(cursor.execute.call_args.args[1], ['P'])

    def test_sql_names_do_not_trigger_redundant_lookup_or_get_overwritten(self):
        rows = [{'programme_name': 'Current SQL name'}, {'programme_name': ''}]
        with patch.object(cn, 'connections', {'default': Mock(vendor='postgresql')}), \
                patch.object(cn, 'lookups', side_effect=AssertionError('Redundant lookup')):
            self.assertIs(cn.attach('modules', rows, requested=['programme_name']), rows)
        self.assertEqual(rows, [{'programme_name': 'Current SQL name'}, {'programme_name': ''}])

    def test_invalidation_discards_name_and_holiday_snapshot(self):
        cn._LOCAL.lookups = {'programmes': {'P': {'name': 'Old'}}, 'cohort_holidays': {'C': ['old']}}
        sc.invalidate()
        self.assertIsNone(cn._LOCAL.lookups)


class SimpleContext:
    def __init__(self, value):
        self.value = value

    def __enter__(self):
        return self.value

    def __exit__(self, *args):
        return False


if __name__ == '__main__':
    unittest.main()
