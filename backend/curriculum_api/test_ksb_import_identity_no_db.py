"""Imported KSB identities against the real uniqueness rule, without app databases.

Lift the production normalizer and payload serializers, as the repository's
other no-DB suites do. Only source lookup and database transport are replaced;
SQLite enforces the same expression index, including withdrawn mappings.
"""
import ast
import itertools
import sqlite3
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


class KsbImportIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        wanted = {
            'normalise_component_ksb_mappings', 'authoring_mapping_payload',
            'component_ksb_mapping_json_item', 'component_mapping_identity',
        }
        tree = ast.parse(Path(__file__).with_name('views.py').read_text(encoding='utf-8-sig'))
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in wanted]
        assert {node.name for node in nodes} == wanted
        cls.production_code = compile(ast.Module(body=nodes, type_ignores=[]), str(Path(__file__)), 'exec')

    def setUp(self):
        self.network = patch('socket.socket.connect', side_effect=AssertionError('External network forbidden'))
        self.network.start()
        self.addCleanup(self.network.stop)
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.executescript("""
            CREATE TABLE mappings (
                id TEXT PRIMARY KEY, module_catalogue_id TEXT, week_id TEXT,
                component_id TEXT, ksb_code TEXT, source_type TEXT, source_id TEXT,
                weight REAL, deleted_at TEXT, created_at TEXT
            );
            CREATE UNIQUE INDEX curriculum_ksb_mapping_component_unique_idx
            ON mappings (component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, ''))
            WHERE component_id IS NOT NULL AND component_id <> '';
        """)
        sequence = itertools.count()
        self.fetch = Mock(side_effect=self.fetch_rows)
        self.namespace = {
            'AUTHORING_KSB_MAPPINGS_TABLE': 'mappings',
            'authoring_fetch_all': self.fetch,
            'clean_str': lambda value: str(value or '').strip(),
            'coverage_normalise_code': lambda value: str(value or '').strip().upper(),
            'canonical_authoring_id': lambda prefix, value: value or f'{prefix}-GENERATED-{next(sequence)}',
            'source_payload_from_mapping': lambda row: (
                row.get('sourceType') or row.get('source_type') or '',
                row.get('sourceId') or row.get('source_id') or '',
            ),
            'infer_mapping_source_from_module': lambda *args: ('standard', 'STD-1'),
            'normalise_ksb_classification': lambda value: value or 'main',
            'normalise_ksb_weight': lambda value: float(value or 0),
            'normalise_ksb_weight_class': lambda value, default: value or default,
            'legacy_weight_class_from_classification': lambda value: 'soft' if value == 'secondary' else 'hard',
        }
        exec(self.production_code, self.namespace)

    def fetch_rows(self, table, where, params, *args, **kwargs):
        self.assertEqual(table, 'mappings')
        self.assertEqual(where, 'module_catalogue_id = %s')
        return [dict(row) for row in self.db.execute('SELECT * FROM mappings WHERE module_catalogue_id = ?', params)]

    def seed(self, mapping_id='SAVED', component='C1', source='STD-1', deleted=None, module='M1', source_type='standard'):
        self.db.execute('INSERT INTO mappings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [mapping_id, module, 'W1', component, 'K6', source_type, source, 40, deleted, 'original-creation'])

    def normalize(self, mappings=None, component='C1', cache=None, module='M1'):
        if mappings is None:
            mappings = [{'id': 'IMPORTED', 'code': 'K6', 'sourceType': 'standard', 'sourceId': 'STD-1',
                         'weight': 25, 'classification': 'secondary'}]
        return self.namespace['normalise_component_ksb_mappings'](
            module, mappings, week_id='W1', component_id=component,
            module_row={'module_catalogue_id': module}, source_cache=cache,
        )

    def persist(self, projections):
        # This is the save path's withdraw + upsert-by-id, with the real index
        # enforcing the conflict that PostgreSQL reported in the incident.
        self.db.execute("UPDATE mappings SET deleted_at = 'withdrawn' WHERE component_id = 'C1'")
        for row in projections:
            self.db.execute("""
                INSERT INTO mappings VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'new-creation')
                ON CONFLICT(id) DO UPDATE SET weight = excluded.weight, deleted_at = NULL
            """, [row[key] for key in ('id', 'module_catalogue_id', 'week_id', 'component_id',
                                       'ksb_code', 'source_type', 'source_id', 'weight')])

    def test_changed_import_preserves_saved_identity_and_updates_weight(self):
        self.seed()
        inline, projection = self.normalize()
        self.persist(projection)
        self.assertEqual(inline[0]['id'], 'SAVED')
        self.assertEqual(projection[0]['id'], 'SAVED')
        self.assertEqual(inline[0]['classification'], 'secondary')
        self.assertEqual(inline[0]['weight_class'], 'soft')
        self.assertEqual([tuple(row) for row in self.db.execute('SELECT id, weight, deleted_at, created_at FROM mappings')],
                         [('SAVED', 25, None, 'original-creation')])

    def test_readding_a_withdrawn_mapping_reuses_its_identity(self):
        self.seed(deleted='removed-previously')
        inline, projection = self.normalize()
        self.persist(projection)
        self.assertEqual(inline[0]['id'], 'SAVED')
        self.assertEqual(self.db.execute('SELECT count(*) FROM mappings').fetchone()[0], 1)

    def test_repeated_imports_and_retries_do_not_add_mapping_rows(self):
        self.seed()
        for attempt in range(3):
            inline, projection = self.normalize([{'id': f'IMPORTED-{attempt}', 'code': 'k6',
                'sourceType': 'standard', 'sourceId': 'STD-1', 'weight': 20 + attempt}])
            self.persist(projection)
            self.assertEqual(inline[0]['id'], 'SAVED')
        self.assertEqual(self.db.execute('SELECT count(*) FROM mappings').fetchone()[0], 1)

    def test_other_sources_components_and_modules_keep_their_own_identities(self):
        for options in ({'source': 'STD-OTHER'}, {'component': 'C2'}, {'module': 'M2', 'component': 'C3'}):
            with self.subTest(options=options):
                self.db.execute('DELETE FROM mappings')
                self.seed(**options)
                inline, projection = self.normalize()
                self.assertEqual(inline[0]['id'], 'IMPORTED')
                self.persist(projection)
                stored = self.db.execute("SELECT weight FROM mappings WHERE id = 'SAVED'").fetchone()
                self.assertEqual(stored[0], 40)

    def test_an_inferred_source_resolves_to_the_saved_mapping(self):
        self.seed()
        inline, projection = self.normalize([{'code': 'K6', 'weight': 50}])
        self.persist(projection)
        self.assertEqual(inline[0]['id'], 'SAVED')

    def test_null_and_empty_sources_share_the_same_database_identity(self):
        self.seed(source=None, source_type=None)
        self.namespace['infer_mapping_source_from_module'] = lambda *args: ('', '')
        inline, projection = self.normalize([{'code': 'K6', 'sourceType': '', 'sourceId': '', 'weight': 50}])
        self.persist(projection)
        self.assertEqual(inline[0]['id'], 'SAVED')

    def test_one_module_mapping_lookup_is_shared_across_components(self):
        self.seed()
        self.seed(mapping_id='SAVED-C2', component='C2')
        cache = {}
        first, _ = self.normalize(cache=cache)
        second, _ = self.normalize(component='C2', cache=cache)
        self.assertEqual((first[0]['id'], second[0]['id']), ('SAVED', 'SAVED-C2'))
        self.fetch.assert_called_once()

    def test_duplicate_codes_are_deduplicated_without_collapsing_sources(self):
        self.seed()
        inline, projection = self.normalize([
            {'id': 'A', 'code': 'K6', 'sourceType': 'standard', 'sourceId': 'STD-1'},
            {'id': 'B', 'code': 'k6', 'sourceType': 'standard', 'sourceId': 'STD-1'},
            {'id': 'C', 'code': 'K6', 'sourceType': 'standard', 'sourceId': 'STD-2'},
        ])
        self.assertEqual([row['id'] for row in inline], ['SAVED', 'C'])
        self.persist(projection)
        self.assertEqual(self.db.execute('SELECT count(*) FROM mappings').fetchone()[0], 2)


if __name__ == '__main__':
    unittest.main()
