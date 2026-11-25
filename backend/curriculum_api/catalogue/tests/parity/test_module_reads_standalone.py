"""Static original-source and dependency contracts; imports only the standard library."""
import ast
import importlib.util
import json
from pathlib import Path
import unittest
import sys
import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/module_reads_snapshot.json').read_text(encoding='utf-8'))


def function(path, name):
    return next(n for n in _read_dependencies.source_tree(path).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


CHANGED = {'programme_authoring_module_rows', 'programme_authoring_modules',
           'programme_config_modules', 'enrich_curriculum_modules_with_authoring_details'}


class ModuleReadContracts(unittest.TestCase):
    def test_unchanged_original_bodies_preserve_decisions_and_fields(self):
        self.assertEqual(len(SNAPSHOT), 13)
        for name, entry in SNAPSHOT.items():
            if name in CHANGED:
                continue  # Executable old/new and deliberate-correction cases: test_programme_sources_no_db.
            with self.subTest(function=name):
                old = ast.parse(entry['source']).body[0]
                new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name)
                self.assertEqual([ast.dump(n) for n in new.body], [ast.dump(n) for n in old.body])

    def test_compatibility_signatures_and_dependency_bindings(self):
        for name, entry in SNAPSHOT.items():
            with self.subTest(function=name):
                wrapper = function(ROOT.parent / 'views.py', name)
                old = ast.parse(entry['source']).body[0]
                if name in CHANGED:
                    # New optional snapshot inputs must preserve every existing parameter/default.
                    old_names = [arg.arg for arg in old.args.args + old.args.kwonlyargs]
                    new_names = [arg.arg for arg in wrapper.args.args + wrapper.args.kwonlyargs]
                    self.assertTrue(set(old_names) <= set(new_names))
                    self.assertEqual([ast.dump(n) for n in wrapper.args.defaults], [ast.dump(n) for n in old.args.defaults])
                    added = {arg.arg: value for arg, value in zip(wrapper.args.kwonlyargs, wrapper.args.kw_defaults) if arg.arg not in old_names}
                    self.assertTrue(all(ast.literal_eval(value) is None for value in added.values()))
                else:
                    self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
                self.assertEqual('curriculum_api.' + wrapper.body[0].module, entry['module'])
                self.assertEqual(wrapper.body[0].names[0].name, name)
                call = wrapper.body[-1].value
                self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
                keywords = {k.arg: ast.unparse(k.value) for k in call.keywords}
                deps = [dep for dep in entry['deps'] if not (name == 'programme_config_modules' and dep == 'get_authoring_structure_payload')]
                if name == 'programme_config_modules': deps.append('get_authoring_structure_payloads')
                for dep in deps + [a.arg for a in old.args.kwonlyargs]:
                    self.assertEqual(keywords[dep], dep)

    def test_new_modules_have_no_reverse_or_infrastructure_import_edges(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for node in ast.walk(_read_dependencies.source_tree(path)):
                if isinstance(node, ast.Import):
                    self.assertEqual([a.name for a in node.names], ['json'])
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), {(0, 'collections'), (2, 'domain.module_selection'), (2, 'domain.programme_scope')})

    def test_leaf_modules_import_without_django_or_application_startup(self):
        # Load actual leaf files directly, without executing package initializers.
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            spec = importlib.util.spec_from_file_location(module, path)
            loaded = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(loaded)
            for name, entry in SNAPSHOT.items():
                if entry['module'] == module:
                    self.assertTrue(callable(getattr(loaded, name)))


if __name__ == '__main__':
    unittest.main()
