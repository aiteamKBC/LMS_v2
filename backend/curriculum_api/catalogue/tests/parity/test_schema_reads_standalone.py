"""Frozen-source contracts for schema/KSB reads; no Django or database startup."""
import ast
import hashlib
import importlib
import json
from pathlib import Path
import sys
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
RAW = (ROOT / 'catalogue/tests/fixtures/legacy_snapshots/schema_read_snapshot.json').read_bytes()
assert hashlib.sha256(RAW).hexdigest() == '47f31c1395974e0a47c44347ab481d0a9b80cc20a61c2033cbda8f766ca0e7f7'
SNAPSHOT = json.loads(RAW)


def tree(path):
    return _read_dependencies.source_tree(path)


def definitions(value):
    return {n.name: n for n in value.body if isinstance(n, (ast.FunctionDef, ast.ClassDef))}


class SchemaReadSourceContracts(unittest.TestCase):
    def test_actual_owned_bodies_match_reviewed_originals(self):
        for key, entry in SNAPSHOT['entries'].items():
            name = key.split(':')[1]
            source = entry['source']
            for old, new in entry['replacements']:
                self.assertIn(old, source)
                source = source.replace(old, new)
            old = ast.parse(source).body[0]
            current = definitions(tree(ROOT / ('catalogue/infrastructure/' + entry['owner'] + '.py')))[name]
            self.assertEqual([ast.dump(n) for n in current.body], [ast.dump(n) for n in old.body], key)
            self.assertEqual([a.arg for a in current.args.kwonlyargs][len(old.args.kwonlyargs):], entry['dependencies'])

    def test_legacy_signatures_and_explicit_owner_bindings(self):
        for key, entry in SNAPSHOT['entries'].items():
            filename, name = key.split(':')
            old = ast.parse(entry['source']).body[0]
            current_tree = tree(ROOT / filename)
            current = definitions(current_tree).get(name)
            if current is not None:
                self.assertEqual(ast.dump(current.args), ast.dump(old.args), key)
                binding = next(n for n in current.body if isinstance(n, ast.ImportFrom) and n.module == 'catalogue.infrastructure.' + entry['owner'])
                self.assertEqual([(n.name, n.asname) for n in binding.names], [(name, 'read')])
                self.assertEqual([k.arg for k in current.body[-1].value.keywords],
                                 [a.arg for a in old.args.kwonlyargs] + entry['dependencies'])
            else:
                self.assertEqual(entry['owner'], 'schema_contracts')
                imports = [n for n in current_tree.body if isinstance(n, ast.ImportFrom) and n.module == 'catalogue.infrastructure.schema_contracts']
                self.assertTrue(any((a.name, a.asname) == (name, None) for n in imports for a in n.names))

    def test_writer_and_middleware_definitions_are_unchanged(self):
        for filename, source in SNAPSHOT['files'].items():
            if source is None:
                continue
            current = definitions(tree(ROOT / filename))
            for name, node in definitions(ast.parse(source)).items():
                if filename + ':' + name not in SNAPSHOT['entries']:
                    self.assertEqual(ast.dump(current[name]), ast.dump(node), filename + ':' + name)

    def test_schema_shape_constants_are_the_original_values(self):
        current = tree(ROOT / 'catalogue/infrastructure/schema_contracts.py')
        originals = {n.targets[0].id: n for n in ast.parse(SNAPSHOT['files']['schema_compat.py']).body
                     if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name)}
        for node in current.body:
            if isinstance(node, ast.Assign):
                self.assertEqual(ast.dump(node), ast.dump(originals[node.targets[0].id]))

    def test_new_owners_import_without_framework_or_legacy_dependencies(self):
        for owner in {entry['owner'] for entry in SNAPSHOT['entries'].values()}:
            module = importlib.import_module('curriculum_api.catalogue.infrastructure.' + owner)
            for node in ast.walk(tree(Path(module.__file__))):
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.module, node.level), (('datetime', 0),
                        ('curriculum_api.catalogue.application.read_errors', 0)))
                self.assertNotIsInstance(node, ast.Import)
        self.assertNotIn('django', sys.modules)
        self.assertNotIn('curriculum_api.views', sys.modules)


if __name__ == '__main__':
    unittest.main()
