"""Source/import contracts for staff reads; never imports Django."""
import ast
from functools import lru_cache
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
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/staff_profiles_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def functions(path):
    return {n.name: n for n in _read_dependencies.source_tree(path).body
            if isinstance(n, ast.FunctionDef)}


class StaffReadContracts(unittest.TestCase):
    def test_complete_original_bodies_preserved(self):
        count = 0
        for name, entry in SNAPSHOT.items():
            if 'module' not in entry or name == 'build_curriculum_tutor_profile_collection':
                continue
            old = ast.parse(entry['source']).body[0]
            new = functions(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'))[name]
            self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body], name)
            count += 1
        self.assertEqual(count, 23)

    def test_public_signatures_decorators_and_shared_writer_reader_preserved(self):
        current = functions(ROOT.parent / 'views.py')
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(old.args), ast.dump(current[name].args), name)
            self.assertEqual(entry['decorators'], [ast.unparse(n) for n in current[name].decorator_list], name)
        old = ast.parse(SNAPSHOT['get_staff_profile_rows']['source']).body[0]
        self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in current[old.name].body])
        old = ast.parse(SNAPSHOT['curriculum_staffing_collection']['source']).body[0]
        self.assertEqual([ast.dump(n) for n in old.body[1:]], [ast.dump(n) for n in functions(ROOT / 'api/calendar_editing.py')[old.name].body[1:]])

    def test_curriculum_tutor_projection_and_staffing_display_preserved(self):
        old = ast.parse(SNAPSHOT['build_curriculum_tutor_profile_collection']['source']).body[0]
        start = next(i for i, n in enumerate(old.body) if isinstance(n, ast.Assign) and ast.unparse(n.targets[0]) == 'profiles')
        new = functions(ROOT / 'application/staff_profiles.py')[old.name]
        self.assertEqual([ast.dump(n) for n in old.body[start:]], [ast.dump(n) for n in new.body[1:]])
        # Its original SELECT is still the same AST, now in the concrete reader.
        old_call = old.body[start-1].value
        reader = functions(ROOT / 'infrastructure/staff_directory.py')['read_curriculum_tutor_rows']
        new_call = next(n for n in ast.walk(reader) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == 'fetch_all')
        self.assertEqual(ast.dump(old_call), ast.dump(new_call))

    def test_dependency_direction_and_import_without_startup(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        allowed = {'re', 'datetime', 'application.staff_profiles'}
        for module in ('domain.staff_identity', 'application.staff_profiles', 'application.staff_assignments', 'infrastructure.staff_directory'):
            tree = _read_dependencies.source_tree(ROOT.joinpath(*module.split('.')).with_suffix('.py'))
            for n in ast.walk(tree):
                if isinstance(n, ast.Import):
                    self.assertTrue(all(a.name in allowed for a in n.names))
                elif isinstance(n, ast.ImportFrom):
                    self.assertIn(n.module, allowed)
            importlib.import_module('curriculum_api.catalogue.' + module)
        for name in ('django', 'curriculum_api.views', 'psycopg', 'requests'):
            self.assertNotIn(name, sys.modules)


if __name__ == '__main__':
    unittest.main()
