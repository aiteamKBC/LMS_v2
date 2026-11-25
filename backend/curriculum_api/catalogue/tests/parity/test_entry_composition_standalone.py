"""Exact moved-source contracts and pure-value parity without application startup."""
import ast
import copy
import hashlib
import importlib
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import entry_composition_oracle as oracle
from curriculum_api.catalogue.tests.parity.required_read_assertions import assert_success_contract

MANIFEST = oracle.SNAPSHOT['manifest']


def tree(relative):
    from curriculum_api.catalogue.tests.parity.runtime_ownership_oracle import restore_tree
    return restore_tree(ast.parse((ROOT / relative).read_text(encoding='utf-8')), relative)


def original():
    return oracle.restore_tree(tree('views.py'), 'views.py')


class AbsoluteImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        if node.level:
            node.module = importlib.util.resolve_name('.' * node.level + (node.module or ''), 'curriculum_api')
            node.level = 0
        return node


class EntryCompositionContracts(unittest.TestCase):
    def test_immutable_source_snapshot_and_exact_view_changes(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         'd490465d374f7d882425336c1e9ec3140493b2ed5028ed9c3d3d0bbf972a6f66')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            current = tree(relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in current.body], entry['after'])
            prior = oracle.restore_tree(current, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in prior.body], entry['order'])

    def test_every_moved_function_preserves_actual_body_signature_and_decorators(self):
        before = {n.name: n for n in original().body if isinstance(n, ast.FunctionDef)}
        actual = {}
        for module in MANIFEST['modules']:
            actual[module] = {n.name: n for n in tree(module.replace('.', '/') + '.py').body if isinstance(n, ast.FunctionDef)}
        self.assertEqual(len(MANIFEST['functions']), 319)
        for name, module in MANIFEST['functions'].items():
            with self.subTest(symbol=name, owner=module):
                expected = AbsoluteImports().visit(copy.deepcopy(before[name]))
                if name in {'get_authoring_module_rows', 'safe_authoring_module_rows', 'safe_module_index_rows'}:
                    assert_success_contract(self, expected, actual[module][name])
                    continue
                if name == 'apply_shared_teams_settings_to_weeks':
                    # The optional global used to resolve this always-defined
                    # capability. Both functions now share one concrete owner.
                    self.assertIn('teams_module_owner_id', actual[module])
                    keyword = next(n for n in ast.walk(expected) if isinstance(n, ast.keyword)
                                   and n.arg == 'teams_module_owner_id')
                    self.assertEqual(ast.unparse(keyword.value), "globals().get('teams_module_owner_id')")
                    keyword.value = ast.Name(id='teams_module_owner_id', ctx=ast.Load())
                self.assertEqual(ast.dump(expected), ast.dump(actual[module][name]))

    def test_every_moved_value_has_one_definition_and_retains_initializer(self):
        old = {target.id: n for n in original().body if isinstance(n, ast.Assign)
               for target in n.targets if isinstance(target, ast.Name)}
        for name, module in MANIFEST['constants'].items():
            matches = [n for n in tree(module.replace('.', '/') + '.py').body if isinstance(n, ast.Assign)
                       and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)]
            self.assertEqual(len(matches), 1, name)
            expected = copy.deepcopy(old[name])
            if name == 'logger':
                self.assertEqual(ast.unparse(expected.value), 'logging.getLogger(__name__)')
                expected.value.args[0] = ast.Constant('curriculum_api.views')
            self.assertEqual(ast.dump(expected), ast.dump(matches[0]), name)

    def test_legacy_entry_point_exports_every_moved_symbol_without_forwarders(self):
        current = tree('views.py')
        remaining = {n.name for n in current.body if isinstance(n, ast.FunctionDef)}
        self.assertFalse(remaining.intersection(MANIFEST['functions']))
        exports = {alias.asname or alias.name: 'curriculum_api.' + (n.module or '')
                   for n in current.body if isinstance(n, ast.ImportFrom) and n.level == 1 for alias in n.names}
        for name, module in {**MANIFEST['functions'], **MANIFEST['constants']}.items():
            self.assertEqual(exports[name], 'curriculum_api.' + module)

    def test_layer_imports_and_no_hidden_legacy_lookup(self):
        for module in MANIFEST['modules']:
            parsed = tree(module.replace('.', '/') + '.py')
            for node in ast.walk(parsed):
                if isinstance(node, ast.ImportFrom):
                    self.assertNotEqual(node.module, 'curriculum_api.views', module)
                    if '.domain.' in module:
                        self.assertFalse(any(x in (node.module or '') for x in ('.infrastructure.', '.api.', 'django', 'settings')), (module, node.module))
                    if '.infrastructure.' in module:
                        self.assertNotIn('.api.', node.module or '', (module, node.module))
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
                    self.assertNotIn(node.func.id, ('globals', 'exec', 'eval', '__import__'), module)

    def test_pure_modules_import_under_standalone_guard(self):
        for module in MANIFEST['modules']:
            if '.domain.' in module:
                importlib.import_module('curriculum_api.' + module)

    def test_programme_and_delivery_policies_match_frozen_code(self):
        from curriculum_api.catalogue.domain import programme_values as programmes, delivery_values as delivery
        original_functions = {n.name: n for n in original().body if isinstance(n, ast.FunctionDef)}
        cases = {
            'is_archived_program_config': [(None,), ({},), ({'status': 'inactive'},), ({'archived': True},), ({'status': 'draft'},)],
            'programme_config_status': [(None,), ({},), ({'status': 'archived'},), ({'status': 'draft'},)],
            'programme_status_from_payload': [({}, {}), ({'status': ''}, {'status': 'active'}), ({'status': 'archived'}, {})],
            'preferred_program_config_by_name': [([], 'none'), ([{'name': ' Same ', 'status': 'active'}, {'name': 'same', 'status': 'archived'}], ' SAME ')],
            'module_stored_session_count': [({}, 0), ({'sessions_number': '5'}, 2), ({'sessions_number': 2}, 7), ({'sessions_number': 'invalid'}, 0)],
        }
        for name, inputs in cases.items():
            owner = delivery if name == 'module_stored_session_count' else programmes
            env = dict(vars(owner)); fn = AbsoluteImports().visit(copy.deepcopy(original_functions[name]))
            exec(compile(ast.fix_missing_locations(ast.Module(body=[fn], type_ignores=[])), '<original-policy>', 'exec'), env)
            for args in inputs:
                self.assertEqual(getattr(owner, name)(*copy.deepcopy(args)), env[name](*copy.deepcopy(args)), (name, args))


if __name__ == '__main__':
    unittest.main()
