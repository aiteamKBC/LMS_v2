"""Stdlib source contracts for session planning, persistence and staffing editing."""
import ast
import copy
import hashlib
import importlib.util
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

spec = importlib.util.spec_from_file_location('session_oracle', Path(__file__).with_name('session_editing_oracle.py'))
oracle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oracle)
ROOT, SNAPSHOT = oracle.ROOT, oracle.SNAPSHOT


def function(path, name):
    return next(n for n in _read_dependencies.source_tree(path).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


def dumps(nodes):
    return [ast.dump(n) for n in nodes]


class SessionEditingSourceContracts(unittest.TestCase):
    def old(self, name):
        return oracle.relocated_function(SNAPSHOT['functions'][name]['source'])

    def owner(self, name):
        entry = SNAPSHOT['functions'][name]
        return function(ROOT.parent / (entry['owner'].replace('.', '/') + '.py'), name)

    def test_immutable_baseline_and_no_unrelated_views_changes(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '063239a4719e44529b348415227a3dfcbe65321504adcfbda29f70be61369896')
        tree = oracle.restore_views_tree(_read_dependencies.source_tree(ROOT / 'views.py'))
        self.assertEqual(hashlib.sha256(ast.dump(tree).encode()).hexdigest(), SNAPSHOT['ast_sha256'])

    def test_relocated_api_identity_and_conflict_bodies_remain_exact(self):
        for name in SNAPSHOT['functions']:
            if name in {'apply_module_session_plan_to_weeks', 'persist_group_module_session_dates', 'update_staffing_assignment'}:
                continue
            self.assertEqual(dumps(self.old(name).body), dumps(self.owner(name).body), name)

    def test_planner_domain_split_preserves_every_rule_and_error(self):
        old = self.old('apply_module_session_plan_to_weeks')
        app = self.owner(old.name)
        domain = function(ROOT / 'catalogue/domain/week_session_dates.py', 'stamp_week_session_dates')
        self.assertEqual(dumps(app.body[:-1]), dumps(old.body[:2]))
        self.assertEqual(dumps(domain.body), dumps(old.body[2:]))
        call = app.body[-1].value
        self.assertEqual(ast.unparse(call.func), domain.name)
        self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in domain.args.args])
        self.assertEqual({k.arg for k in call.keywords}, {a.arg for a in domain.args.kwonlyargs})
        self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords))

    def test_session_persistence_recomposes_exact_original_reads_and_writes(self):
        old = self.old('persist_group_module_session_dates')
        app = self.owner(old.name)
        reader = function(ROOT / 'catalogue/infrastructure/session_writes.py', 'read_session_plan_rows')
        writer = function(ROOT / 'catalogue/infrastructure/session_writes.py', 'write_session_settings')
        class Inline(ast.NodeTransformer):
            def visit_Assign(self, node):
                if isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'read_session_plan_rows':
                    self_outer.assertEqual([ast.unparse(a) for a in node.value.args], ['catalogue_id'])
                    self_outer.assertEqual(ast.unparse(reader.body[-1]), 'return (week_rows, component_rows)')
                    return copy.deepcopy(reader.body[:-1])
                return self.generic_visit(node)
            def visit_Expr(self, node):
                if isinstance(node.value, ast.Call) and ast.unparse(node.value.func) == 'write_session_settings':
                    self_outer.assertEqual([ast.unparse(a) for a in node.value.args], ['component_id', 'planned_settings', 'now'])
                    return copy.deepcopy(writer.body)
                return self.generic_visit(node)
        self_outer = self
        self.assertEqual(dumps(Inline().visit(app).body), dumps(old.body))

    def test_staffing_guards_and_write_semantics_with_explicit_required_read(self):
        old = self.old('update_staffing_assignment')
        api = self.owner(old.name)
        start = next(i for i, n in enumerate(old.body) if isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == 'updates')
        prefix = [n for n in old.body[:start] if not (isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == 'previous_coach')]
        start = len(prefix)
        self.assertEqual(dumps(api.body[:start]), dumps(prefix))
        app = function(ROOT / 'catalogue/application/staff_assignment_writes.py', 'save_staffing_assignment')
        tail_start = next(i for i, n in enumerate(old.body) if isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == 'updates')
        expected = copy.deepcopy([n for n in old.body[tail_start:] if not (isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == 'next_coach')])
        original_ids = next(n for n in expected if isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == 'module_assignment_ids')
        expected.remove(original_ids)
        expected[-1].value = expected[-1].value.args[0]
        self.assertEqual(dumps(app.body[1:]), dumps(expected))
        self.assertEqual(ast.unparse(app.body[0]), "module_assignment_ids = read_staffing_module_ids(group_id) if 'tutor' in payload else []")
        reader = function(ROOT / 'catalogue/infrastructure/session_writes.py', 'read_staffing_module_ids')
        original_ids.value.generators[0].iter = ast.Name(id='rows', ctx=ast.Load())
        self.assertEqual(ast.dump(reader.body[-1].value), ast.dump(original_ids.value))
        self.assertEqual(ast.unparse(reader.body[0].body[0]), 'rows = authoring_fetch_all(AUTHORING_MODULES_TABLE)')
        self.assertEqual(ast.unparse(reader.body[0].handlers[0].body[0]), "raise StaffingSourceUnavailable('Module assignments unavailable.') from exc")
        self.assertEqual(ast.unparse(api.body[start].handlers[0].body[0]), "return json_error('Unable to read module assignments. Please try again.', status=503)")
        self.assertEqual(ast.unparse(api.body[-1]), 'return JsonResponse(result)')

    def test_public_signatures_decorators_and_explicit_bindings(self):
        for name, entry in SNAPSHOT['functions'].items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT / 'views.py', name)
            owner = self.owner(name)
            self.assertEqual(ast.dump(old.args), ast.dump(wrapper.args), name)
            self.assertEqual([ast.unparse(d) for d in wrapper.decorator_list], entry['decorators'])
            self.assertEqual(wrapper.body[0].module, entry['owner'].removeprefix('curriculum_api.'))
            call = wrapper.body[-1].value
            self.assertEqual(ast.unparse(call.func), 'implementation')
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            self.assertEqual({k.arg for k in call.keywords}, {a.arg for a in owner.args.kwonlyargs})
            self.assertTrue(all(ast.unparse(k.value) == k.arg for k in call.keywords))

    def test_pure_domain_has_no_imports_and_owners_point_inward(self):
        domain = _read_dependencies.source_tree(ROOT / 'catalogue/domain/week_session_dates.py')
        self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(domain)))
        for path in ['application/session_plan_updates.py', 'application/staff_assignment_writes.py', 'infrastructure/session_writes.py', 'api/calendar_editing.py']:
            for n in ast.walk(_read_dependencies.source_tree(ROOT / 'catalogue' / path)):
                if isinstance(n, ast.Import):
                    self.fail(f'Unexpected import in {path}: {ast.unparse(n)}')
                if isinstance(n, ast.ImportFrom):
                    self.assertTrue((n.level == 2 and n.module.startswith(('application.', 'domain.', 'infrastructure.')))
                                    or (n.level == 0 and n.module == 'functools'), ast.unparse(n))
                    if path.startswith('application/'):
                        self.assertTrue(n.module.startswith('domain.'))


if __name__ == '__main__':
    unittest.main()
