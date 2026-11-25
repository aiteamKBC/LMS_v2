"""Frozen-source contracts for delivery reads; standard-library imports only."""
import ast
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/delivery_reads_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name)


class DeliveryReadContracts(unittest.TestCase):
    def test_nine_bodies_preserve_source_sql_and_decisions(self):
        self.assertEqual(len(SNAPSHOT), 9)
        for name, entry in SNAPSHOT.items():
            with self.subTest(function=name):
                original = ast.parse(entry['source']).body[0]
                current = deepcopy(function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name))
                if name in {'active_learner_delivery_counts', 'cohort_authoring_detail_rows', 'group_authoring_detail_rows'}:
                    # Approved bug fix: only failure handlers change. The SQL,
                    # successful projections and identity rules still match.
                    current_try = next(n for n in current.body if isinstance(n, ast.Try))
                    original_try = next(n for n in original.body if isinstance(n, ast.Try))
                    handler = current_try.handlers[-1]
                    self.assertEqual(len(handler.body), 1)
                    self.assertIsInstance(handler.body[0], ast.Raise)
                    self.assertEqual(handler.body[0].exc.func.id, 'CatalogueReadUnavailable')
                    if len(current_try.handlers) == 2:
                        self.assertEqual(current_try.handlers[0].type.id, 'CatalogueReadUnavailable')
                        self.assertEqual(ast.dump(current_try.handlers[0].body[0]), ast.dump(ast.Raise()))
                    current_try.handlers = deepcopy(original_try.handlers)
                if name == 'group_authoring_detail_rows':
                    # The overview batch moved the projection into a shared
                    # owner. Verify the delegation, then compare its real body
                    # with the frozen original; do not skip the projection.
                    projection = deepcopy(function(ROOT / 'application/delivery_reads.py', 'group_details_from_rows'))
                    call = current.body[0].body[0].value
                    self.assertEqual(call.func.id, 'group_details_from_rows')
                    self.assertEqual([ast.unparse(arg) for arg in call.args], [
                        'authoring_fetch_all(GROUPS_TABLE, order_sql=GROUP_ROWS_ORDER)',
                        'safe_module_index_rows()',
                    ])
                    self.assertEqual({kw.arg: ast.unparse(kw.value) for kw in call.keywords},
                                     {arg.arg: arg.arg for arg in projection.args.kwonlyargs})
                    self.assertEqual([arg.arg for arg in projection.args.args], ['rows', 'module_rows'])
                    reads = dict(zip(('rows', 'module_rows'), call.args))

                    class RestoreReadExpressions(ast.NodeTransformer):
                        def visit_Name(self, node):
                            return deepcopy(reads[node.id]) if node.id in reads else node

                    self.assertIsInstance(projection.body[0].value.value, str)
                    self.assertEqual(len(current.body[0].body), 1)
                    current.body[0].body = [RestoreReadExpressions().visit(node) for node in projection.body[1:]]
                for call in ast.walk(current):
                    if isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id in entry['direct']:
                        self.assertEqual([(k.arg, ast.unparse(k.value)) for k in call.keywords], [('clean_str', 'clean_str')])
                        call.keywords = []
                self.assertEqual([ast.dump(n) for n in current.body], [ast.dump(n) for n in original.body])

    def test_old_signatures_and_explicit_capabilities(self):
        for name, entry in SNAPSHOT.items():
            wrapper = function(ROOT.parent / 'views.py', name)
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual('curriculum_api.' + wrapper.body[0].module, entry['module'])
            call = wrapper.body[-1].value
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            keywords = {k.arg: ast.unparse(k.value) for k in call.keywords}
            for dep in entry['deps'] + [a.arg for a in old.args.kwonlyargs]:
                self.assertEqual(keywords[dep], dep)
            self.assertTrue(set(entry['direct']).isdisjoint(keywords))
        self.assertEqual([ast.unparse(d) for d in function(ROOT.parent / 'views.py', 'active_learner_delivery_counts').decorator_list], ['scoped_curriculum_read'])

    def test_dependency_direction_is_application_to_domain_only(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for n in ast.walk(tree(path)):
                self.assertNotIsInstance(n, ast.Import)
                if isinstance(n, ast.ImportFrom):
                    self.assertIn((n.level, n.module), ((0, 'collections'), (2, 'domain.delivery_identity'),
                        (1, 'read_errors'), (0, 'curriculum_api.catalogue.application.read_errors')))
                    if n.level:
                        self.assertTrue(module.endswith('application.delivery_reads'))

    def test_application_calls_owned_domain_rules_directly(self):
        node = function(ROOT / 'application/delivery_reads.py', 'build_cohorts_and_groups')
        calls = [n.func.id for n in ast.walk(node) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        self.assertEqual(calls.count('delivery_learner_count'), 3)
        self.assertEqual(calls.count('detail_is_archived'), 2)


if __name__ == '__main__':
    unittest.main()
