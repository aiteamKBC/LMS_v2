"""Opt-in SELECT-only tests of source exclusion joins on Development.

Synthetic CTE records shadow every table in the production query. No DDL,
fixtures persisted, schema changes, or Django database connection is used.
"""
import ast
import os
from pathlib import Path
import unittest

from psycopg.types.json import Jsonb
from scripts.verify_inclusion_canonical_targets import connect_development


@unittest.skipUnless(os.environ.get('RUN_MY_LEARNING_READ_ONLY_TESTS') == '1',
                     'requires read-only Development opt-in')
class CanonicalSourceSeparationSQLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source = Path(__file__).with_name('my_learning.py')
        node = next(node for node in ast.parse(source.read_text(encoding='utf-8')).body
                    if isinstance(node, ast.FunctionDef) and node.name == 'free_course_exclusions')
        namespace = {}
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), namespace)
        cls.exclusions = staticmethod(namespace['free_course_exclusions'])
        cls.connection = connect_development()

    @classmethod
    def tearDownClass(cls):
        cls.connection.rollback()
        cls.connection.close()

    def setUp(self):
        self.free = [{'id': 'FREE-1'}, {'id': 'FREECOURSE-MBA-IMPORT-1'}]
        self.weeks = [{'id': 'FW-1', 'course_id': 'FREE-1'}]
        self.modules = [{'module_catalogue_id': 'MODULE-1'}]
        self.sources = [{'source_course_ref': '50', 'source_system': 'old_lms',
                         'mapping_status': 'retired', 'mapping_method': 'exact_legacy_module_source_id'}]
        self.imports = [{'course_id': 50, 'module_id': 'IMPORT-1'}]

    def query(self):
        tables = [
            ('curriculum.free_courses', self.free),
            ('curriculum.free_course_weeks', self.weeks),
            ('curriculum.modules', self.modules),
            ('curriculum.source_courses', self.sources),
            ('"MBA".course_curriculum', self.imports),
        ]
        outer = self

        class Cursor:
            def execute(self, sql, params):
                ctes = []
                values = []
                for index, (table, rows) in enumerate(tables):
                    alias = f'synthetic_{index}'
                    sql = sql.replace(table, alias)
                    ctes.append(f'{alias} AS (SELECT * FROM jsonb_populate_recordset(NULL::{table}, %s::jsonb))')
                    values.append(Jsonb(rows))
                assert sql.lstrip().startswith('WITH ')
                self.cursor = outer.connection.execute(
                    'WITH ' + ','.join(ctes) + ',' + sql.lstrip()[5:], values + params)

            def fetchall(self):
                return self.cursor.fetchall()

        return self.exclusions(Cursor(), ['FREE-1', 'FW-1', 'MODULE-1', 'UNASSIGNED'], ['50'])

    def test_exact_id_and_verified_import_links_exclude_free_representations(self):
        self.assertEqual(self.query(), ({'FREE-1', 'FW-1'}, {'50'}))

    def test_global_catalogue_does_not_add_unrequested_enrollment(self):
        self.free.append({'id': 'GLOBAL-ONLY'})
        identities, refs = self.query()
        self.assertNotIn('GLOBAL-ONLY', identities)
        self.assertEqual(refs, {'50'})

    def test_same_title_without_lineage_does_not_hide_historical_course(self):
        self.free[1]['course_name'] = 'Same title'
        self.sources[0].update(source_course_title='Same title', mapping_status='unmatched')
        self.assertEqual(self.query(), ({'FREE-1', 'FW-1'}, set()))

    def test_live_module_id_collision_and_live_import_remain_visible(self):
        self.modules.extend([{'module_catalogue_id': 'FREE-1'}, {'module_catalogue_id': 'IMPORT-1'}])
        self.assertEqual(self.query(), ({'FW-1'}, set()))

    def test_ambiguous_import_relationship_does_not_choose_a_course(self):
        self.imports.append({'course_id': 50, 'module_id': 'IMPORT-2'})
        self.free.append({'id': 'FREECOURSE-MBA-IMPORT-2'})
        self.assertEqual(self.query(), ({'FREE-1', 'FW-1'}, set()))
