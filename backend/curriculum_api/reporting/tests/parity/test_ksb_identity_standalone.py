"""Pure KSB contracts and frozen-source extraction checks; stdlib only."""
import ast
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'reporting/tests/fixtures/legacy_snapshots/ksb_identity_snapshot.json').read_text(encoding='utf-8'))


def functions(path):
    return {n.name: n for n in ast.parse(path.read_text(encoding='utf-8-sig')).body
            if isinstance(n, ast.FunctionDef)}


class KsbIdentityContracts(unittest.TestCase):
    def test_extracted_bodies_preserve_old_rules_except_approved_identity_correction(self):
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            if filename != 'views.py' or name == 'ksb_profile_source_id':
                continue
            old = ast.parse(entry['source']).body[0]
            new = functions(ROOT.parent.joinpath(*entry['owner'].split('.')).with_suffix('.py'))[name]
            self.assertEqual([ast.dump(n) for n in new.body], [ast.dump(n) for n in old.body], name)

    def test_compatibility_signatures_decorators_and_capability_bindings(self):
        wrappers = functions(ROOT / 'views.py')
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            if filename != 'views.py':
                continue
            old = ast.parse(entry['source']).body[0]
            wrapper = wrappers[name]
            self.assertEqual(ast.dump(wrapper.args), ast.dump(old.args), name)
            self.assertEqual([ast.unparse(n) for n in wrapper.decorator_list], entry['decorators'], name)
            owner = functions(ROOT.parent.joinpath(*entry['owner'].split('.')).with_suffix('.py'))[name]
            call = wrapper.body[-1].value
            self.assertEqual({kw.arg for kw in call.keywords}, {arg.arg for arg in owner.args.kwonlyargs}, name)
            self.assertTrue(all(isinstance(kw.value, ast.Name) and kw.value.id == kw.arg for kw in call.keywords), name)

    def test_domain_imports_only_stdlib_and_does_not_load_infrastructure(self):
        source = ROOT / 'reporting/domain/sources.py'
        tree = ast.parse(source.read_text(encoding='utf-8'))
        imports = [n for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
        self.assertEqual([ast.dump(n) for n in imports], [ast.dump(ast.parse('import re').body[0])])
        spec = importlib.util.spec_from_file_location('ksb_pure_rules', source)
        rules = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rules)
        self.assertFalse({'django', 'psycopg', 'requests', 'curriculum_api.views'} & sys.modules.keys())
        clean = lambda value: str(value if value is not None else '').strip()
        for profile, expected in ((None, ''), ({'name': 'Only a name'}, ''),
                                  ({'id': 17}, '17'), ({'id': ' KSBP-A ', 'ksb_profile_id': 'KSBP-B'}, 'KSBP-A'),
                                  ({'id': 17, 'ksb_profile_id': ' KSBP-B '}, 'KSBP-B')):
            before = deepcopy(profile)
            self.assertEqual([rules.ksb_profile_source_id(profile, clean_str=clean) for _ in range(3)], [expected] * 3)
            self.assertEqual(profile, before)


if __name__ == '__main__':
    unittest.main()
