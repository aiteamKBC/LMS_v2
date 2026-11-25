"""Source contracts for GET extraction and untouched writer paths; stdlib only."""
import ast
from copy import deepcopy
import json
import importlib.util
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/module_get_snapshot.json').read_text(encoding='utf-8'))


def nodes(path):
    return {n.name: n for n in _read_dependencies.source_tree(path).body if isinstance(n, ast.FunctionDef)}


def dump(values):
    return [ast.dump(n) for n in values]


class ModuleGetSourceContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = nodes(ROOT / 'views.py')
        cls.old = {name: ast.parse(entry['source']).body[0] for name, entry in SNAPSHOT.items()}
        cls.api = nodes(ROOT / 'catalogue/api/module_reads.py')
        cls.application = nodes(ROOT / 'catalogue/application/structure_payloads.py')
        spec = importlib.util.spec_from_file_location('module_commands_oracle', Path(__file__).with_name('module_commands_oracle.py'))
        oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(oracle)
        cls.writers = {**cls.current, **nodes(ROOT / 'catalogue/api/module_commands.py'),
                       **nodes(ROOT / 'catalogue/api/module_structure.py')}
        cls.relocated_old = {name: oracle.relocated_body(ast.unparse(node)) for name, node in cls.old.items()}

    def test_public_signatures_and_decorators_are_unchanged(self):
        for name, old in self.old.items():
            self.assertEqual(ast.dump(old.args), ast.dump(self.current[name].args), name)
            self.assertEqual(SNAPSHOT[name]['decorators'], [ast.unparse(n) for n in self.current[name].decorator_list], name)

    def test_module_detail_is_unchanged_and_has_no_get_contract(self):
        self.assertEqual(dump(self.relocated_old['curriculum_module_detail'].body), dump(self.writers['curriculum_module_detail'].body))

    def test_structure_and_group_writer_statements_are_exact(self):
        for name in ('curriculum_module_structure', 'curriculum_group_modules'):
            old, new = self.relocated_old[name], self.writers[name]
            if name == 'curriculum_group_modules':
                # Writer statements now live in the concrete group HTTP adapter.
                # Compare the actual relocated body, never the forwarding facade.
                new = nodes(ROOT / 'catalogue/api/group_commands.py')[name]
            old_get = next(i for i, n in enumerate(old.body) if isinstance(n, ast.If) and ast.unparse(n.test) == "request.method == 'GET'")
            new_get = next(i for i, n in enumerate(new.body) if isinstance(n, ast.If) and ast.unparse(n.test) == "request.method == 'GET'")
            self.assertEqual(dump(old.body[:old_get]), dump(new.body[:new_get]), name)
            self.assertEqual(dump(old.body[old_get+1:]), dump(new.body[new_get+1:]), name)

    def test_training_alias_keeps_read_contract_except_approved_fabrication_and_link_removal(self):
        old_get = next(n for n in self.relocated_old['curriculum_module_structure'].body if isinstance(n, ast.If) and ast.unparse(n.test) == "request.method == 'GET'")
        new_get = next(n for n in self.writers['curriculum_module_structure'].body if isinstance(n, ast.If) and ast.unparse(n.test) == "request.method == 'GET'")
        old_try = next(n for n in old_get.body if isinstance(n, ast.Try))
        new_try = next(n for n in new_get.body if isinstance(n, ast.Try))
        old_scope, new_scope = old_try.body[0], new_try.body[0]
        self.assertEqual(dump(old_scope.items), dump(new_scope.items))
        self.assertEqual(dump(old_scope.body[0].body), dump(new_scope.body))
        self.assertEqual(dump(old_try.body[1:]), dump(new_try.body[1:]))
        self.assertEqual(dump(old_try.handlers), dump(new_try.handlers))
        self.assertEqual(dump(old_get.body[-2:]), dump(new_get.body[-2:]))

    def test_extracted_cache_expressions_and_http_errors_keep_original_contract(self):
        old_get = next(n for n in self.old['curriculum_module_structure'].body if isinstance(n, ast.If) and ast.unparse(n.test) == "request.method == 'GET'")
        old_try = next(n for n in old_get.body if isinstance(n, ast.Try))
        stored_branch = old_try.body[0].body[0].orelse[0]
        old_cache = deepcopy(stored_branch.body[0].value)
        old_cache.keywords[0].value.id = 'force'
        query_scope = self.application['load_stored_module_structure'].body[-1]
        self.assertEqual(ast.dump(old_cache), ast.dump(query_scope.body[0].body[0].value))
        self.assertEqual(ast.dump(stored_branch.orelse[0].value), ast.dump(query_scope.body[1].value))
        api = self.api['module_structure_response']
        new_try = next(n for n in api.body if isinstance(n, ast.Try))
        self.assertEqual(dump(old_try.handlers), dump(new_try.handlers))
        self.assertEqual(dump(old_get.body[-2:]), dump(api.body[-2:]))
        names = {n.id for n in ast.walk(self.application['load_stored_module_structure']) if isinstance(n, ast.Name)}
        self.assertFalse(names & {'request', 'JsonResponse', 'ensure_training_module_authoring_structure', 'link_training_row_to_catalogue', 'save_module_authoring_structure'})

    def test_group_get_and_projection_are_exact_original_bodies(self):
        self.assertEqual(dump(self.old['curriculum_group_modules'].body[0].body), dump(self.api['curriculum_group_modules_get'].body))
        projection = nodes(ROOT / 'catalogue/application/module_projection.py')['compact_module_rows']
        self.assertEqual(dump(self.old['compact_module_rows'].body), dump(projection.body))

    def test_session_plan_changes_only_relative_import_location(self):
        old = deepcopy(self.old['curriculum_module_session_plan'])
        for node in ast.walk(old):
            if isinstance(node, ast.ImportFrom) and node.module == 'catalogue.application.delivery_schedules':
                node.level, node.module = 2, 'application.delivery_schedules'
        self.assertEqual(dump(old.body), dump(self.api['curriculum_module_session_plan'].body))


if __name__ == '__main__':
    unittest.main()
