"""Overview extraction contracts; standard library only, no application startup."""
import ast
import importlib
import json
from pathlib import Path
import sys
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/overview_snapshot.json').read_text(encoding='utf-8'))


class OverviewContracts(unittest.TestCase):
    def test_complete_assembly_body_is_the_original_implementation(self):
        original = ast.parse(SNAPSHOT['_build_curriculum_payload_from_rows']['source']).body[0]
        current = _read_dependencies.source_tree(ROOT / 'application/overview.py')
        owner = next(n for n in current.body if isinstance(n, ast.FunctionDef)
                     and n.name == 'build_curriculum_payload_from_rows')
        self.assertEqual([ast.dump(n) for n in original.body], [ast.dump(n) for n in owner.body])

    def test_public_signatures_decorators_and_cache_contracts_are_preserved(self):
        current = {n.name: n for n in _read_dependencies.source_tree(ROOT.parent / 'views.py').body
                   if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT.items():
            original = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(original.args), ast.dump(current[name].args), name)
            self.assertEqual(entry['decorators'], [ast.unparse(n) for n in current[name].decorator_list], name)
            if name in {'build_curriculum_payload', 'build_curriculum_payload_from_rows',
                        'get_cached_curriculum_rows', 'get_cached_payload'}:
                actual = current[name]
                owners = {
                    'build_curriculum_payload': 'application.cached_reads',
                    'get_cached_curriculum_rows': 'application.cached_reads',
                    'get_cached_payload': 'api.cached_reads',
                }
                if name in owners:
                    # Read-runtime extraction changed ownership, not the
                    # original cache/assembly contract being compared here.
                    self.assertEqual(actual.body[0].module, 'catalogue.' + owners[name])
                    self.assertEqual(actual.body[0].names[0].name, name)
                    owner_tree = _read_dependencies.source_tree(ROOT.joinpath(*owners[name].split('.')).with_suffix('.py'))
                    owner = next(n for n in owner_tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
                    call = actual.body[-1].value
                    self.assertEqual(call.func.id, actual.body[0].names[0].asname)
                    self.assertEqual([ast.unparse(arg) for arg in call.args], [arg.arg for arg in original.args.args])
                    self.assertEqual({kw.arg: ast.unparse(kw.value) for kw in call.keywords},
                                     {arg.arg: arg.arg for arg in owner.args.kwonlyargs})
                    actual = owner
                self.assertEqual([ast.dump(n) for n in original.body], [ast.dump(n) for n in actual.body])

    def test_legacy_source_orchestration_is_preserved_for_post_save_consumers(self):
        original = ast.parse(SNAPSHOT['get_curriculum_rows']['source']).body[0]
        current = _read_dependencies.source_tree(ROOT / 'application/overview.py')
        owner = next(n for n in current.body if isinstance(n, ast.FunctionDef) and n.name == 'get_curriculum_rows')
        self.assertEqual([ast.dump(n) for n in original.body], [ast.dump(n) for n in owner.body])

    def test_dependency_direction_and_import_without_django(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        for module in ('application.overview', 'infrastructure.overview_reads'):
            tree = _read_dependencies.source_tree(ROOT.joinpath(*module.split('.')).with_suffix('.py'))
            for n in ast.walk(tree):
                self.assertNotIsInstance(n, ast.Import)
                if isinstance(n, ast.ImportFrom):
                    self.assertEqual((n.level, n.module), (2, 'application.overview'))
            importlib.import_module('curriculum_api.catalogue.' + module)
        for module in ('django', 'curriculum_api.views', 'psycopg', 'requests'):
            self.assertNotIn(module, sys.modules)


if __name__ == '__main__':
    unittest.main()
