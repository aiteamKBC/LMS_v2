"""Source equivalence and pure workspace policy, with forbidden IO import guards."""
import ast
import hashlib
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import workspace_composition_oracle as oracle
from curriculum_api.catalogue.domain import module_selection, values
from curriculum_api.catalogue.infrastructure import authoring_columns


def current(file, name):
    return next(n for n in ast.parse((ROOT / file).read_text(encoding='utf-8')).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


class WorkspaceCompositionContracts(unittest.TestCase):
    def test_exact_reviewed_source_diff_and_frozen_original(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '53348bcae934ae55e29a02a7e81c10288c197416a6f0fdc707d6065162537acb')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            tree = ast.parse((ROOT / relative).read_text(encoding='utf-8'))
            from curriculum_api.catalogue.tests.parity.placement_names_oracle import restore_tree
            tree = restore_tree(tree, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in tree.body],
                             entry['after'], relative)
            tree = oracle.restore_tree(tree, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in tree.body],
                             entry['order'], relative)

    def test_storage_read_functions_move_without_body_or_signature_changes(self):
        for name in ('enabled', 'reset', 'native_read_table', 'read_table'):
            old = ast.parse(oracle.SNAPSHOT['original_functions']['learning_storage.py:' + name]).body[0]
            new = current('catalogue/infrastructure/learning_read_routes.py', name)
            self.assertEqual(ast.dump(old), ast.dump(new), name)

    def test_guard_and_provisioning_sequence_changes_only_relative_import_paths(self):
        for name in ('authoring_json_type', 'ensure_module_authoring_tables', 'provision_module_authoring_tables'):
            source = oracle.SNAPSHOT['original_functions']['views.py:' + name]
            source = source.replace('from .catalogue.infrastructure.authoring_schema', 'from .authoring_schema')
            source = source.replace('from .course_pricing_schema', 'from curriculum_api.course_pricing_schema')
            self.assertEqual(ast.dump(ast.parse(source).body[0]),
                             ast.dump(current('catalogue/infrastructure/authoring_schema_runtime.py', name)))

    def test_cached_reader_and_completion_keep_exact_signature_and_sequence(self):
        for name in ('authoring_fetch_all', 'authoring_select_sql', 'complete_authoring_rows',
                     'learning_read_table', 'prefetch_authoring_reads'):
            source = oracle.SNAPSHOT['original_functions']['views.py:' + name]
            source = source.replace('from .catalogue.infrastructure.authoring_reads', 'from .authoring_reads')
            source = source.replace('from .catalogue.infrastructure.authoring_sql', 'from .authoring_sql')
            source = source.replace('from .learning_storage import read_table', 'from .learning_read_routes import read_table')
            self.assertEqual(ast.dump(ast.parse(source).body[0]),
                             ast.dump(current('catalogue/infrastructure/authoring_runtime.py', name)))

    def test_compact_transport_changes_only_dependency_lookup(self):
        for name in ('_read_source', 'compact_authoring_rows', '_compact_rows'):
            source = oracle.SNAPSHOT['original_functions']['authoring_read_transport.py:' + name]
            source = source.replace('    from . import views\n', '').replace('views.', '')
            source = source.replace('from .ksb_mapping_placement import', 'from .ksb_read_store import')
            source = source.replace('from .catalogue.infrastructure.authoring_transport', 'from .authoring_transport')
            self.assertEqual(ast.dump(ast.parse(source).body[0]),
                             ast.dump(current('catalogue/infrastructure/authoring_runtime.py', name)))

    def test_workspace_query_body_and_pure_rule_body_unchanged(self):
        for file, name in (('catalogue/infrastructure/programme_reads.py', 'programme_structure_child_rows'),
                           ('catalogue/domain/module_selection.py', 'component_text_cancels')):
            old = ast.parse(oracle.SNAPSHOT['original_functions'][file + ':' + name]).body[0]
            new = current(file, name)
            self.assertEqual([ast.dump(n) for n in old.body], [ast.dump(n) for n in new.body])

    def test_new_read_owners_have_no_api_or_writer_imports(self):
        for relative in ('catalogue/infrastructure/authoring_runtime.py',
                         'catalogue/infrastructure/learning_read_routes.py',
                         'catalogue/infrastructure/learning_relations.py',
                         'catalogue/infrastructure/authoring_columns.py',
                         'authoring_read_transport.py', 'programme_workspace_reads.py'):
            tree = ast.parse((ROOT / relative).read_text(encoding='utf-8'))
            for node in ast.walk(tree):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    self.assertFalse(any(x in ast.unparse(node) for x in
                        ('views', 'learning_storage', 'free_course_native_schema', 'ksb_mapping_placement')))

    def test_pure_cancellation_matches_original_with_concrete_defaults(self):
        source = oracle.SNAPSHOT['original_functions']['catalogue/domain/module_selection.py:component_text_cancels']
        ns = dict(vars(module_selection))
        exec(compile(source, '<original-policy>', 'exec'), ns)
        cases = [None, [], [None, 1], [{'id': ' A ', 'weekStructure': []}, {'id': 'A'}],
                 [{'name': ' A ', 'components': [{'id': 'C'}]}],
                 [{'id': 'A', 'weekStructure': [{'components': [{'id': 'C'}]}]}, {'id': 'A'}],
                 [{'name': 'Mixed CASE'}, {'name': 'mixed case'}], [{'id': ''}, {'id': None}]]
        for rows in cases:
            self.assertEqual(module_selection.component_text_cancels(rows, ('id',)),
                ns['component_text_cancels'](rows, ('id',), clean_str=values.clean_str, normalise=values.normalise))
        self.assertEqual(authoring_columns.workspace_component_text_columns(),
                         ('title', 'description', 'Reflection_Question'))


if __name__ == '__main__':
    unittest.main()
