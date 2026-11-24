"""Standalone source and pure-rule checks; never imports Django or views."""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from urllib.parse import urlparse

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/content_validation_snapshot.json').read_text())
PROTECTED_AST = '7824186d0f7a9b5c0e049007483973dca0111f53b46974e887420fad9198e43d'


def tree(path):
    return _read_dependencies.source_tree(path)


class ContentValidationSourceContracts(unittest.TestCase):
    def test_every_other_views_definition_and_writer_is_unchanged(self):
        spec = importlib.util.spec_from_file_location('cache_ownership_oracle', Path(__file__).with_name('cache_ownership_oracle.py'))
        oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(oracle)
        actual = oracle.restore_views_tree(tree(ROOT / 'views.py'))
        # Canonicalize subsequent, explicitly reviewed extractions
        # before applying this earlier batch's guard. Its own contracts check
        # the extracted bodies and public wrappers against these originals.
        approved = {}
        for filename in ('attachment_preparation_snapshot.json', 'hierarchy_preparation_snapshot.json'):
            approved.update(json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots' / filename).read_text()))
        media = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/media_delivery_snapshot.json').read_text())
        approved.update(media['views'])
        schema = json.loads((ROOT / 'catalogue/tests/fixtures/legacy_snapshots/schema_read_snapshot.json').read_text())
        approved['column_names'] = schema['entries']['views.py:column_names']
        # The consumer-wiring contracts verify these added entry-point bindings.
        # Restore only the removed local import for the unchanged programme HTTP
        # body; retain the original hash for every pre-existing writer/definition.
        added_bindings = {
            'home_relationship_rows', 'home_source_rows', 'home_programmes_need_enrichment',
            'build_home_summary', 'programme_list_sources', 'programme_list_learner_counts',
            'programme_list_needs_module_enrichment', 'build_programme_list',
            '_home_projection', 'curriculum_home_summary', 'curriculum_home_attention',
        }
        self.assertEqual({n.name for n in actual.body if isinstance(n, ast.FunctionDef)
                          and n.name in added_bindings}, added_bindings)
        programmes = next(n for n in actual.body if isinstance(n, ast.FunctionDef)
                          and n.name == 'curriculum_programmes')
        index = next(i for i, n in enumerate(programmes.body) if isinstance(n, ast.Assign)
                     and any(isinstance(t, ast.Name) and t.id == 'programmes' for t in n.targets))
        programmes.body.insert(index, ast.parse('from .programme_list import build_programme_list').body[0])
        actual.body = [n for n in actual.body if not (isinstance(n, ast.FunctionDef)
                                                     and n.name in added_bindings)]
        for index, node in enumerate(actual.body):
            if isinstance(node, ast.FunctionDef) and node.name in approved:
                original = ast.parse(approved[node.name]['source']).body[0]
                original.decorator_list = node.decorator_list
                actual.body[index] = original
            elif isinstance(node, ast.ImportFrom) and node.module == 'catalogue.infrastructure.upload_paths':
                # The value now has one infrastructure owner; retain the original
                # guard without accepting a changed value or import contract.
                self.assertEqual(node.level, 1)
                self.assertEqual([(n.name, n.asname) for n in node.names], [('COMPONENT_UPLOAD_ROOT', None)])
                constant = tree(ROOT / 'catalogue/infrastructure/upload_paths.py').body[-1]
                expected = ast.parse("COMPONENT_UPLOAD_ROOT = 'curriculum_component_uploads'").body[0]
                self.assertEqual(ast.dump(constant), ast.dump(expected))
                actual.body[index] = constant
        actual.body = [n for n in actual.body if not (isinstance(n, ast.FunctionDef) and n.name in SNAPSHOT)]
        self.assertEqual(hashlib.sha256(ast.dump(actual).encode()).hexdigest(), PROTECTED_AST)

    def test_public_arguments_and_decorators_are_preserved(self):
        current = {n.name: n for n in tree(ROOT / 'views.py').body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(current[name].args), ast.dump(old.args), name)
            self.assertEqual(current[name].decorator_list, old.decorator_list, name)

    def test_extracted_bodies_are_exact_with_only_local_imports_injected(self):
        class RemoveReviewedImports(ast.NodeTransformer):
            def visit_ImportFrom(self, node):
                if node.module in {'video_uploads', 'curriculum_api.calendar_policy'}:
                    return None
                return node
        for name, entry in SNAPSHOT.items():
            old = RemoveReviewedImports().visit(ast.parse(entry['source']).body[0])
            path = ROOT.parent / (entry['owner'].replace('.', '/') + '.py')
            new = next(n for n in tree(path).body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body], name)

    def test_application_and_domain_have_only_stdlib_imports(self):
        for owner in {v['owner'] for v in SNAPSHOT.values()}:
            path = ROOT.parent / (owner.replace('.', '/') + '.py')
            for n in ast.walk(tree(path)):
                if isinstance(n, ast.Import):
                    self.assertTrue(all(x.name in {'re'} for x in n.names))
                if isinstance(n, ast.ImportFrom):
                    self.assertEqual(n.level, 0)
                    self.assertEqual(n.module, 'urllib.parse')
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
                    self.assertNotIn(n.func.attr, {'execute', 'save', 'create', 'delete', 'bulk_create'})

    def test_each_compatibility_export_calls_its_new_owner(self):
        current = {n.name: n for n in tree(ROOT / 'views.py').body if isinstance(n, ast.FunctionDef)}
        for name, entry in SNAPSHOT.items():
            n = current[name]
            self.assertEqual(n.body[0].module, entry['owner'].removeprefix('curriculum_api.'))
            self.assertEqual(n.body[0].names[0].name, name)
            self.assertIsInstance(n.body[-1], ast.Return)
            self.assertEqual(n.body[-1].value.func.id, 'implementation')

    def test_pure_rules_import_and_match_original_without_django(self):
        path = ROOT / 'catalogue/domain/content_validation.py'
        spec = importlib.util.spec_from_file_location('content_validation_pure', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        clean = next(n for n in tree(ROOT / 'views.py').body if isinstance(n, ast.FunctionDef) and n.name == 'clean_str')
        namespace = {'urlparse': urlparse}
        exec(compile(ast.Module(body=[clean], type_ignores=[]), '<actual-clean-str>', 'exec'), namespace)
        for name in ('frontend_component_type', 'http_url', 'component_uploaded_video_url'):
            exec(compile(SNAPSHOT[name]['source'], '<original-pure-rule>', 'exec'), namespace)
        for value in (None, '', 'https://example.invalid/a', '/curriculum_api/curriculum/uploads/old/a.mp4',
                      '/curriculum_api/curriculum/uploads/%2e%2e/a.mp4', 'file:///a.mp4', 'live_session'):
            self.assertEqual(module.frontend_component_type(value), namespace['frontend_component_type'](value))
            for name in ('http_url', 'component_uploaded_video_url'):
                self.assertEqual(getattr(module, name)(value, clean_str=namespace['clean_str']), namespace[name](value))


if __name__ == '__main__':
    unittest.main()
