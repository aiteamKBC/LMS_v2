"""Execute the shared read SQL on synthetic data, never the application DB."""
import copy
import sqlite3
from contextlib import ExitStack
from unittest.mock import patch

from django.core.cache.backends.locmem import LocMemCache
from django.test import RequestFactory, SimpleTestCase

from . import programme_workspace_reads, views


class ProgrammeWorkspaceReadTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript('''
            create table components (
                id text, module_catalogue_id text, week_id text, type text,
                title text, description text, expected_otjh real, display_order int,
                deleted_at text, is_programme_deleted boolean, library_state text
            );
            create table ksb_mappings (
                id text, module_catalogue_id text, week_id text, component_id text,
                ksb_code text, ksb_description text, weight real, created_at text,
                source_type text, source_id text, deleted_at text,
                is_programme_deleted boolean, is_deleted boolean
            );
        ''')
        self.db.executemany('insert into components values (?,?,?,?,?,?,?,?,?,?,?)', [
            ('C2', 'M1', 'W1', 'quiz', 'Second', 'Retained text', .125, 1, None, False, ''),
            ('C1', 'M1', 'W1', 'reading', 'First', '', .125, 0, None, False, ''),
            ('C3', 'M2', 'W2', 'reading', 'Other module', '', 1, 0, '', False, ''),
            ('C4', 'M1', 'W1', 'quiz', 'Deleted', '', 99, 2, '2026-01-01', False, ''),
            ('C5', 'M1', 'W1', 'quiz', 'Parent deleted', '', 99, 3, None, True, ''),
            ('C6', 'M1', 'W1', 'quiz', 'Library', '', 99, 4, None, False, ' library '),
            ('C7', 'UNRELATED', 'W3', 'reading', 'Unrelated', '', 99, 0, None, False, ''),
        ])
        self.db.executemany('insert into ksb_mappings values (?,?,?,?,?,?,?,?,?,?,?,?,?)', [
            ('K1', 'M1', 'W1', 'C1', 'K1', 'Description', 10, '2026-01-01', 'standard', 'STD', None, False, False),
            ('K2', 'M2', 'W2', 'C3', 'S1', 'Description', 20, '2026-01-02', 'standard', 'STD', '', False, False),
            ('K3', 'M1', 'W1', 'C1', 'K2', 'Deleted', 99, '2026-01-01', 'standard', 'STD', None, False, True),
        ])
        self.modules = [{'module_catalogue_id': mid, 'title': mid, 'weeks_number': 1} for mid in ('M1', 'M2')]
        self.weeks = [{'id': wid, 'module_catalogue_id': mid, 'week_number': 1} for mid, wid in [('M1', 'W1'), ('M2', 'W2')]]
        self.child_reads = []
        columns = {table: {r['name'] for r in self.db.execute(f'pragma table_info({table})')} for table in ('components', 'ksb_mappings')}

        def read(table, where_sql='', params=None, order_sql='', **options):
            self.child_reads.append(table)
            if table in columns:
                fields = [c for c in options.get('columns') or [] if c in columns[table]]
                sql = f'select {", ".join(fields) if fields else "*"} from {table}'
                if where_sql:
                    sql += f' where {where_sql}'
                if order_sql:
                    sql += f' order by {order_sql}'
                return [dict(r) for r in self.db.execute(sql.replace('%s', '?'), params or [])]
            rows = {'modules': self.modules, 'weeks': self.weeks}.get(table, [])
            return [copy.deepcopy(r) for r in rows if not params or r.get('module_catalogue_id') in params]

        stack = self.enterContext(ExitStack())
        stack.enter_context(patch.object(views, 'connection', vendor='sqlite'))
        stack.enter_context(patch.object(views, 'has_column', side_effect=lambda table, col: col in columns.get(table, set())))
        stack.enter_context(patch.object(views, 'authoring_fetch_all', side_effect=read))

    def test_shared_rows_preserve_scope_order_deletion_counts_and_complete_payload(self):
        options = dict(include_extra=False, include_quality=False, include_staff=False, component_columns=views.CATALOGUE_SUMMARY_COMPONENT_COLUMNS)
        expected = [views.get_authoring_structure_payloads(ids, **options) for ids in [('M1',), ('M2', 'M1')]]
        self.child_reads.clear()
        shared = programme_workspace_reads.programme_structure_child_rows([' M1 ', 'M2', 'M1'])
        before = copy.deepcopy(shared)
        actual = [views.get_authoring_structure_payloads(ids, child_rows=shared, **options) for ids in [('M1',), ('M2', 'M1')]]
        self.assertEqual(actual, expected)
        self.assertEqual(shared, before)
        # One union read of each table; neither builder reads modules or weeks again.
        self.assertEqual(self.child_reads, ['components', 'ksb_mappings', 'modules', 'weeks'])
        module = actual[0]['M1']
        self.assertEqual(module['lessonCount'], 2)
        self.assertEqual(module['ksbCount'], 1)
        self.assertEqual([c['id'] for c in module['weekStructure'][0]['components']], ['C1', 'C2'])
        self.assertEqual(module['totalOtjh'], .27)
        self.assertNotIn('M2', actual[0])

    def test_empty_scope_does_not_read_entire_tables(self):
        self.assertEqual(programme_workspace_reads.programme_structure_child_rows(['', None]), {'components': [], 'mappings': [], 'modules': [], 'weeks': []})
        self.assertEqual(self.child_reads, [])

    def test_warm_section_returns_304_without_building_again_and_write_epoch_expires_it(self):
        payload = {'schema': 'curriculum', 'flat': {'modules': [{'id': 'M1', 'name': 'Before'}], 'sessions': []}}
        cache = LocMemCache('programme-workspace-regression', {})
        cache.clear()
        factory = RequestFactory()
        path = '/curriculum/programmes/P1/detail/modules/?visibility=all&view=workspace'
        with patch.object(views, '_CURRICULUM_CACHE', {}), patch.object(views, 'cache', cache), \
                patch.object(views, 'shared_curriculum_epoch', return_value=1) as epoch, \
                patch.object(views, 'repair_curriculum_parent_links'), \
                patch.object(views, 'build_curriculum_programme_tree_detail_payload', return_value=payload) as build:
            first = views.curriculum_programme_detail_section(factory.get(path), 'P1', 'modules')
            second = views.curriculum_programme_detail_section(factory.get(path, HTTP_IF_NONE_MATCH=first['ETag']), 'P1', 'modules')
            self.assertEqual(first.status_code, 200)
            self.assertEqual(second.status_code, 304)
            self.assertEqual(build.call_count, 1)
            self.assertTrue(build.call_args.kwargs['workspace_view'])
            epoch.return_value = 2
            build.return_value = {'schema': 'curriculum', 'flat': {'modules': [{'id': 'M1', 'name': 'After'}], 'sessions': []}}
            updated = views.curriculum_programme_detail_section(factory.get(path, HTTP_IF_NONE_MATCH=first['ETag']), 'P1', 'modules')
            self.assertEqual(updated.status_code, 200)
            self.assertNotEqual(updated['ETag'], first['ETag'])
            self.assertEqual(build.call_count, 2)
