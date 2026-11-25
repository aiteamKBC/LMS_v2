"""Exact moved-source and dependency contracts; no Django imports or execution."""
import ast
import copy
import hashlib
import importlib.util
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import cache_lifecycle_oracle as oracle

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative):
    return ast.parse((ROOT / relative).read_text(encoding='utf-8'))


class AbsoluteImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), 'curriculum_api')
            node.level = 0
        return node


class CacheLifecycleContracts(unittest.TestCase):
    def reference_count_functions(self):
        removed = oracle.SNAPSHOT['source_changes']['learner_assignments.py']['removed']
        original = next(n for source in removed for n in ast.parse(source).body
                        if isinstance(n, ast.FunctionDef) and n.name == 'bulk_assigned_learner_counts')
        actual = next(n for n in tree('learner_assignment_counts_sql.py').body
                      if isinstance(n, ast.FunctionDef) and n.name == original.name)
        self.assertEqual(ast.dump(original), ast.dump(actual))
        return original, actual

    def test_reference_reader_keeps_counts_deduplication_and_shared_preset_cache(self):
        for function in self.reference_count_functions():
            caches = []
            learners = [SimpleNamespace(ids=['A', 'A', 'B']), SimpleNamespace(ids=['A', 'C'])]
            def effective(learner, cache):
                caches.append(cache)
                return learner.ids
            manager = SimpleNamespace(only=Mock(return_value=learners))
            env = dict(plans=SimpleNamespace(_s=lambda value: str(value or '').strip(), _effective_plan_ids=effective),
                       EnrolmentUser=SimpleNamespace(all_learners=manager), with_placements=lambda rows: rows)
            exec(compile(ast.Module(body=[copy.deepcopy(function)], type_ignores=[]), '<actual-count-reader>', 'exec'), env)
            self.assertEqual(env[function.name]([' A ', 'B', 'A']), {'A': 2, 'B': 1})
            manager.only.assert_called_once_with('id', 'learning_plan', 'training_plan')
            self.assertIs(caches[0], caches[1])
            manager.only.reset_mock()
            self.assertEqual(env[function.name](['', None]), {})
            manager.only.assert_not_called()

    def test_count_sql_changes_only_dependency_lookup_not_queries_or_rules(self):
        originals = {n.name: n for source in oracle.SNAPSHOT['source_changes']['learner_assignment_counts_sql.py']['removed']
                     for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}
        current = {n.name: n for n in tree('learner_assignment_counts_sql.py').body if isinstance(n, ast.FunctionDef)}
        class DirectOwners(ast.NodeTransformer):
            def visit_Attribute(self, node):
                if isinstance(node.value, ast.Name) and node.value.id == 'views':
                    return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
                return self.generic_visit(node)
            def visit_ImportFrom(self, node):
                return None
        for name, original in originals.items():
            self.assertEqual(ast.dump(DirectOwners().visit(copy.deepcopy(original))),
                             ast.dump(DirectOwners().visit(copy.deepcopy(current[name]))), name)
        self.assertFalse(any(isinstance(n, ast.ImportFrom) and
                             (n.module in ('views', 'learner_assignments') or any(a.name == 'views' for a in n.names))
                             for n in ast.walk(tree('learner_assignment_counts_sql.py'))))

    def test_frozen_evidence_and_only_reviewed_source_changes(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'd5a21d86b08ce535c45a527452cdb1a1b3632ceac6138e5949a3f64873ec0bbd')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            with self.subTest(file=relative):
                from curriculum_api.catalogue.tests.parity.final_bindings_oracle import restore_tree as restore_final_bindings
                current = oracle.restore_count_read_import(restore_final_bindings(tree(relative), relative), relative)
                self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in current.body], entry['after'])
                restored = oracle.restore_tree(current, relative)
                self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in restored.body], entry['order'])

    def test_all_nine_actual_definitions_preserve_bodies_signatures_and_defaults(self):
        old = {n.name: n for source in oracle.SNAPSHOT['source_changes']['views.py']['removed']
               for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(set(old), set(MANIFEST['functions']))
        for name, owner in MANIFEST['functions'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body
                          if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual(ast.dump(AbsoluteImports().visit(copy.deepcopy(old[name]))), ast.dump(actual), name)

    def test_environment_flag_and_delay_expressions_are_unchanged(self):
        prior = {n.targets[0].id: n for source in oracle.SNAPSHOT['source_changes']['views.py']['removed']
                 for n in ast.parse(source).body if isinstance(n, ast.Assign)}
        for name, owner in MANIFEST['constants'].items():
            actual = next(n for n in tree(owner.replace('.', '/') + '.py').body
                          if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id == name)
            self.assertEqual(ast.dump(actual), ast.dump(prior[name]))

    def test_views_only_reexports_reviewed_entry_points(self):
        current = tree('views.py')
        exports = {a.asname or a.name: (n.module, a.name) for n in current.body
                   if isinstance(n, ast.ImportFrom) for a in n.names}
        for name, owner in {**MANIFEST['functions'], **MANIFEST['constants']}.items():
            self.assertEqual(exports[name], (owner, name))
            self.assertFalse(any(isinstance(n, ast.FunctionDef) and n.name == name for n in current.body))

    def test_composition_dependencies_do_not_point_back_to_views(self):
        for owner in MANIFEST['modules']:
            for node in ast.walk(tree(owner.replace('.', '/') + '.py')):
                if not isinstance(node, ast.ImportFrom):
                    continue
                module = node.module or ''
                self.assertNotEqual(module, 'curriculum_api.views')
                self.assertFalse(module == 'curriculum_api' and any(a.name == 'views' for a in node.names))
                if '.infrastructure.' in owner:
                    self.assertNotIn('.api.', module)

    def test_startup_calls_the_new_owner_without_importing_views(self):
        config = next(n for n in tree('apps.py').body if isinstance(n, ast.ClassDef) and n.name == 'CurriculumApiConfig')
        ready = next(n for n in config.body if isinstance(n, ast.FunctionDef) and n.name == 'ready')
        imports = [n for n in ast.walk(ready) if isinstance(n, ast.ImportFrom)]
        self.assertTrue(any(n.module == 'catalogue.api.cache_lifecycle' and n.names[0].name == 'schedule_curriculum_warm' for n in imports))
        self.assertFalse(any(n.module == 'views' for n in imports))


if __name__ == '__main__':
    unittest.main()
