"""Exact-source/contract checks; imports no Django or application settings."""
import ast
from copy import deepcopy
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
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/placement_records_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return deepcopy(next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name))


class PlacementRecordContracts(unittest.TestCase):
    def test_actual_original_bodies_preserved_with_one_narrow_coach_capability(self):
        for name, entry in SNAPSHOT.items():
            original = entry['source'].replace('group_coaches.split_names(', 'split_coach_names(')
            old = ast.parse(original).body[0]
            new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name)
            self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body], name)

    def test_public_signature_and_explicit_capability_bindings(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            wrapper = function(ROOT.parent / 'views.py', name)
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args))
            self.assertEqual(wrapper.decorator_list, [])
            call = wrapper.body[-1].value
            self.assertEqual([ast.unparse(a) for a in call.args], [a.arg for a in old.args.args])
            self.assertEqual({k.arg: ast.unparse(k.value) for k in call.keywords}, entry['bindings'])

    def test_leaf_owners_import_without_framework_or_legacy_dependencies(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(tree(path))))
            importlib.import_module(module)
        self.assertNotIn('django', sys.modules)
        self.assertNotIn('curriculum_api.views', sys.modules)

    def test_empty_identity_does_not_use_a_reader(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        from curriculum_api.catalogue.infrastructure import placement_records
        def forbidden(*args, **kwargs):
            raise AssertionError('An empty canonical identity must not read data')
        for name, table in [('fetch_cohort_row', 'COHORT_AUTHORING_DETAILS_TABLE'), ('fetch_group_row', 'GROUPS_TABLE')]:
            self.assertIsNone(getattr(placement_records, name)(
                ' \t', clean_str=lambda value: value.strip(), authoring_fetch_all=forbidden, **{table: 'unused'}))


if __name__ == '__main__':
    unittest.main()
