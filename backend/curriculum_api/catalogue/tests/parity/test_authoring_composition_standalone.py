"""Exact source preservation for concrete authoring reads; no application imports."""
import ast
import hashlib
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import authoring_composition_oracle as oracle
from curriculum_api.catalogue.tests.parity import content_composition_oracle


def functions(source):
    return {n.name: n for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}


class AuthoringCompositionSourceTests(unittest.TestCase):
    def test_frozen_baseline_and_exact_closed_dependency_changes(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '5bbe727e02a4e8eea69a51c74f2d08a23766f11e733232c2189086dcc99e9cd7')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            tree = ast.parse((ROOT / relative).read_text(encoding='utf-8-sig'))
            restored = oracle.restore_tree(tree, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in restored.body],
                             entry['order'], relative)

    def test_query_completion_and_prefetch_bodies_are_unchanged(self):
        for relative in ('catalogue/infrastructure/authoring_sql.py',
                         'catalogue/infrastructure/authoring_reads.py'):
            old = functions(oracle.SNAPSHOT['old_sources'][relative])
            actual = {n.name: n for n in content_composition_oracle.restore_tree(
                ast.parse((ROOT / relative).read_text(encoding='utf-8')), relative).body
                if isinstance(n, ast.FunctionDef)}
            self.assertEqual(set(actual) - set(old), {'_database_reads', '_ksb_reads'}
                             if relative.endswith('authoring_reads.py') else set())
            for name, node in old.items():
                self.assertEqual([ast.dump(n) for n in node.body],
                                 [ast.dump(n) for n in actual[name].body], name)
                self.assertEqual([a.arg for a in node.args.kwonlyargs],
                                 [a.arg for a in actual[name].args.kwonlyargs], name)

    def test_ksb_reads_move_verbatim_and_writers_remain_exact(self):
        old = oracle.SNAPSHOT['old_sources']['ksb_mapping_placement.py']
        expected = old.split('# Writes:')[0].replace(
            'from .catalogue.infrastructure import database_reads', 'from . import database_reads'
        ).replace('from .catalogue.infrastructure.ksb_placement_reads', 'from .ksb_placement_reads')
        from curriculum_api.catalogue.tests.parity.placement_names_oracle import restore_tree
        relative = 'catalogue/infrastructure/ksb_read_store.py'
        actual = ast.unparse(restore_tree(ast.parse((ROOT / relative).read_text(encoding='utf-8')), relative))
        self.assertEqual({n: ast.dump(f) for n, f in functions(expected).items()},
                         {n: ast.dump(f) for n, f in functions(actual).items()})
        legacy = (ROOT / 'ksb_mapping_placement.py').read_text(encoding='utf-8')
        # Only _table's dependency now belongs directly to database_reads.
        # Preserve every other character of the writer SQL and decisions.
        expected_writers = old.split('# Writes:')[1].replace(
            "from . import views\n    return f'{_only()}{views.authoring_table_name(name)}'",
            "from .catalogue.infrastructure.database_reads import authoring_table_name\n    return f'{_only()}{authoring_table_name(name)}'",
        )
        self.assertEqual(expected_writers, legacy.split('# Writes:')[1])
        exports = next(n for n in ast.parse(legacy).body if isinstance(n, ast.ImportFrom)
                       and n.module == 'catalogue.infrastructure.ksb_read_store')
        self.assertTrue(set(functions(expected)) <= {a.name for a in exports.names})

    def test_read_owners_have_no_legacy_api_or_writer_import(self):
        for name in ('authoring_sql', 'authoring_reads', 'ksb_read_store'):
            tree = ast.parse((ROOT / ('catalogue/infrastructure/' + name + '.py')).read_text())
            imports = [ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))]
            for forbidden in ('views', 'learning_storage', 'ksb_mapping_placement', 'commands', 'authoring_schema'):
                self.assertFalse(any(forbidden in text for text in imports), (name, forbidden))


if __name__ == '__main__':
    unittest.main()
