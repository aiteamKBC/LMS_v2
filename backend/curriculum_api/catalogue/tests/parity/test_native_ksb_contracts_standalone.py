"""Explicit native preparation source delta and pure SQL import closure."""
import ast
import hashlib
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity import native_ksb_contracts as contracts
from curriculum_api.catalogue.infrastructure.ksb_placement_reads import relation


class NativeKsbSourceContracts(unittest.TestCase):
    def test_pinned_delta_preserves_unchanged_historical_source(self):
        self.assertEqual(hashlib.sha256(contracts.REFERENCE_PATH.read_bytes()).hexdigest(),
                         '94d779d463230171eebcf5c92f8f6d32f0d1c7d4d388779682111990a3e7c726')
        tree = ast.parse((ROOT / contracts.CURRENT_FILE).read_text())
        old = contracts.restore_tree(tree, contracts.REFERENCE['file'])
        self.assertEqual(contracts.fingerprint(old), contracts.REFERENCE['before_sha256'])
        self.assertIs(contracts.restore_tree(old, contracts.REFERENCE['file']), old)

    def test_unknown_edits_and_reverting_the_fix_are_rejected(self):
        path = ROOT / contracts.CURRENT_FILE
        current = ast.parse(path.read_text())
        old = contracts.restore_tree(current, contracts.REFERENCE['file'])
        for changed in (ast.parse(ast.unparse(old)), ast.parse(path.read_text() + '\nunreviewed = True\n')):
            with self.assertRaisesRegex(AssertionError, 'Unreviewed native KSB change'):
                contracts.restore_tree(changed, contracts.REFERENCE['file'])

    def test_preparation_uses_actual_pure_catalogue_projection(self):
        tree = ast.parse((ROOT / contracts.CURRENT_FILE).read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_ksb_read_source')
        self.assertFalse(any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(function)))
        projection = Mock(wraps=relation)
        namespace = {'ksb_placement_relation': projection}
        exec(compile(ast.Module(body=[function], type_ignores=[]), '<actual-migration-sql-builder>', 'exec'), namespace)
        source = namespace['_ksb_read_source']()
        projection.assert_called_once()
        self.assertTrue(projection.call_args.kwargs['include_description'])
        self.assertIn('c.module_catalogue_id, c.week_id', source)
        self.assertIn('s.ksb_description', source)
        self.assertNotIn('m.module_catalogue_id', source)


if __name__ == '__main__':
    unittest.main()
