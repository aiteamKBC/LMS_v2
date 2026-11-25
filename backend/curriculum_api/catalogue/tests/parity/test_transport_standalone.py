"""Source, dependency and process-local snapshot checks; no Django startup."""
import ast
from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/transport_snapshot.json').read_text(encoding='utf-8'))


def function(source, name):
    return next(n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef) and n.name == name)


def implementation(name):
    return (ROOT / 'infrastructure' / (name + '.py')).read_text(encoding='utf-8')


class TransportContracts(unittest.TestCase):
    def test_snapshot_storage_functions_and_limits_move_unchanged(self):
        old = ast.parse(SNAPSHOT['authoring_row_cache'])
        new = ast.parse(implementation('authoring_row_snapshots'))
        keep = lambda t: [ast.dump(n) for n in t.body if not isinstance(n, ast.FunctionDef) or n.name in {'_key', '_load', '_store'}]
        self.assertEqual(keep(old), keep(new))

    def test_compact_sql_decoder_and_fingerprint_preserved_except_source_routing(self):
        for name, file in (('_compact_rows', 'authoring_read_transport'), ('_fingerprint_sql', 'authoring_row_cache')):
            old = function(SNAPSHOT[file], name)
            new = function(implementation('authoring_transport'), name)
            old.body = [n for n in old.body if not isinstance(n, ast.ImportFrom)]

            class Normalize(ast.NodeTransformer):
                def visit_Attribute(self, node):
                    if isinstance(node.value, ast.Name) and node.value.id == 'views':
                        rename = {'learning_read_table': 'read_source', 'REFLECTION_QUESTION_COLUMN': 'reflection_question_column'}
                        return ast.Name(id=rename.get(node.attr, node.attr), ctx=node.ctx)
                    return self.generic_visit(node)
            old = Normalize().visit(old)
            self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_verified_read_algorithm_and_bounded_race_fallback_are_preserved(self):
        old = function(SNAPSHOT['authoring_row_cache'], 'read_verified_rows')
        new = deepcopy(function(implementation('authoring_transport'), 'read_verified_rows'))
        old.body = [n for n in old.body if not isinstance(n, ast.ImportFrom)]

        class Normalize(ast.NodeTransformer):
            def visit_Attribute(self, node):
                if isinstance(node.value, ast.Name) and node.value.id in {'views', 'snapshots'}:
                    return ast.Name(id='read_source' if node.attr == 'learning_read_table' else node.attr, ctx=node.ctx)
                return self.generic_visit(node)

            def visit_Call(self, node):
                node = self.generic_visit(node)
                if isinstance(node.func, ast.Name) and node.func.id == '_compact_rows':
                    node.keywords = [k for k in node.keywords if k.arg == 'fingerprint_sql']
                elif isinstance(node.func, ast.Name) and node.func.id == '_fingerprint_sql':
                    node.keywords = []
                return node

        old, new = Normalize().visit(old), Normalize().visit(new)
        self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_public_signatures_and_dependency_direction(self):
        for file, names in {'authoring_read_transport': ('compact_authoring_rows', '_compact_rows'),
                            'authoring_row_cache': ('read_verified_rows', '_fingerprint_sql')}.items():
            source = (ROOT.parent / (file + '.py')).read_text(encoding='utf-8')
            for name in names:
                if file == 'authoring_read_transport':
                    exports = [(n.level, n.module, a.name, a.asname) for n in ast.parse(source).body
                               if isinstance(n, ast.ImportFrom) for a in n.names if (a.asname or a.name) == name]
                    self.assertEqual(exports, [(1, 'catalogue.infrastructure.authoring_runtime', name, None)])
                    actual = function(implementation('authoring_runtime'), name)
                else:
                    actual = function(source, name)
                self.assertEqual(ast.dump(actual.args), ast.dump(function(SNAPSHOT[file], name).args))
        for file in ('authoring_transport', 'authoring_row_snapshots'):
            for node in ast.walk(ast.parse(implementation(file))):
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), {(0, 'collections'), (0, 'copy'), (1, None), (1, 'authoring_row_snapshots')})
                if isinstance(node, ast.Import):
                    self.assertTrue(all(a.name in {'hashlib', 'json', 'pickle', 'threading', 'time', 'zlib'} for a in node.names))
        # The old transport -> old row-cache -> old transport cycle is gone.
        self.assertNotIn('authoring_row_cache', (ROOT.parent / 'authoring_read_transport.py').read_text(encoding='utf-8'))


class SnapshotValues(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location('snapshot_unit', ROOT / 'infrastructure/authoring_row_snapshots.py')
        self.cache = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.cache)

    def test_native_types_null_unicode_and_mutable_values_are_lossless(self):
        rows = [{'id': '1', 'text': 'عربي 🙂', 'null': None, 'blank': '', 'spaces': '  ',
                 'decimal': Decimal('1.20'), 'when': datetime(2026, 1, 1, tzinfo=timezone.utc), 'json': {'x': [1]}}]
        self.cache._store('key', rows)
        actual = self.cache._load('key')
        self.assertEqual(actual, rows)
        actual[0]['json']['x'].append(2)
        self.assertEqual(self.cache._load('key'), rows)

    def test_oversized_and_unserializable_values_do_not_replace_fresh_results(self):
        with patch.object(self.cache, '_MAX_ENTRY_BYTES', 1):
            self.cache._store('large', [{'text': 'large synthetic body'}])
        self.assertIsNone(self.cache._load('large'))
        self.cache._store('unserializable', [{'value': self.cache._LOCK}])
        self.assertIsNone(self.cache._load('unserializable'))


if __name__ == '__main__':
    unittest.main()
