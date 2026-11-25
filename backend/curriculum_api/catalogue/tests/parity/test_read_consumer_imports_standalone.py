"""Source parity for the bounded facade removal; no application imports."""
import ast
import hashlib
import json
from pathlib import Path
import unittest
import sys

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
from curriculum_api.catalogue.tests.parity.approved_dev_contracts import source_tree
MANIFEST = json.loads((Path(__file__).parents[1] /
    'fixtures/read_consumer_imports.json').read_text(encoding='utf-8'))


class NormalizeLookup(ast.NodeTransformer):
    def visit_Import(self, node):
        return None

    def visit_ImportFrom(self, node):
        return None

    def visit_Attribute(self, node):
        if isinstance(node.value, ast.Name) and node.value.id in ('views', 'curriculum_views', 'V'):
            return ast.copy_location(ast.Name(node.attr, node.ctx), node)
        return self.generic_visit(node)


class ReadConsumerImportsTests(unittest.TestCase):
    def test_all_bodies_sql_decorators_and_contracts_match_pre_batch_source(self):
        self.assertEqual(len(MANIFEST), 12)
        for entry in MANIFEST:
            with self.subTest(file=entry['file']):
                tree = source_tree(BACKEND.parent / entry['file'])
                actual = hashlib.sha256(ast.dump(NormalizeLookup().visit(tree)).encode()).hexdigest()
                self.assertEqual(actual, entry['normalized_body_sha256'])

    def test_imports_resolve_to_reviewed_concrete_owners_in_original_scope(self):
        self.assertEqual(sum(len(entry['bindings']) for entry in MANIFEST), 60)
        for entry in MANIFEST:
            tree = ast.parse((BACKEND.parent / entry['file']).read_text(encoding='utf-8-sig'))
            for binding in entry['bindings']:
                with self.subTest(file=entry['file'], binding=binding):
                    scope = tree if binding['scope'] == '<module>' else next(
                        n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == binding['scope'])
                    nodes = scope.body
                    if entry['file'] == 'backend/old_otjh/repository.py':
                        nodes = next(n for n in scope.body if isinstance(n, ast.With)).body
                    matches = [(n.module, a.name) for n in nodes if isinstance(n, ast.ImportFrom)
                               for a in n.names if (a.asname or a.name) == binding['symbol']]
                    self.assertIn((binding['owner'], binding.get('original', binding['symbol'])), matches)

    def test_no_consumer_imports_the_retired_facades_or_uses_dynamic_lookup(self):
        for entry in MANIFEST:
            tree = ast.parse((BACKEND.parent / entry['file']).read_text(encoding='utf-8-sig'))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotIn(node.module, {'curriculum_api.views', 'curriculum_api.learning_storage'})
                    self.assertFalse(node.level == 1 and node.module is None and
                                     any(a.name == 'views' for a in node.names), entry['file'])
                if isinstance(node, ast.Name):
                    self.assertNotIn(node.id, {'views', 'curriculum_views', 'V'}, entry['file'])


if __name__ == '__main__':
    unittest.main()
