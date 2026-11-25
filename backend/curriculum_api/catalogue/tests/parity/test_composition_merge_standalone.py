"""Ensure reviewed deltas cannot accept unknown or reverted source changes."""
import ast
import copy
import hashlib
from pathlib import Path
import unittest

from . import composition_merge_contracts as contracts

BACKEND = Path(__file__).resolve().parents[4]


class CompositionMergeContracts(unittest.TestCase):
    def test_reviewed_reference_is_immutable(self):
        self.assertEqual(hashlib.sha256(contracts.REFERENCE_PATH.read_bytes()).hexdigest(),
                         'e26678540dfb06813b6fae619636cd87ec5e453f339b1d0a8144f258bf265463')
        self.assertEqual(len(contracts.REFERENCE['files']), 6)

    def test_exact_restoration_and_idempotence(self):
        for relative, entry in contracts.REFERENCE['files'].items():
            with self.subTest(file=relative):
                current = ast.parse((BACKEND / relative).read_text(encoding='utf-8-sig'))
                restored = contracts.restore_tree(current, relative)
                self.assertEqual(contracts.fingerprint(restored), entry['historical_sha256'])
                self.assertIs(contracts.restore_tree(restored, relative), restored)
                self.assertEqual(contracts.fingerprint(current), entry['current_sha256'])
                with self.assertRaisesRegex(AssertionError, 'Unreviewed source change'):
                    contracts.restore_tree(ast.parse(ast.unparse(restored)), relative)

    def test_unknown_missing_and_duplicate_nodes_are_rejected(self):
        for relative in contracts.REFERENCE['files']:
            current = ast.parse((BACKEND / relative).read_text(encoding='utf-8-sig'))
            for change in ('unknown', 'missing', 'duplicate'):
                with self.subTest(file=relative, change=change):
                    changed = copy.deepcopy(current)
                    if change == 'unknown':
                        changed.body += ast.parse('unexpected_policy = True').body
                    elif change == 'missing':
                        changed.body.pop()
                    else:
                        changed.body.append(copy.deepcopy(changed.body[-1]))
                    with self.assertRaisesRegex(AssertionError, 'Unreviewed source change'):
                        contracts.restore_tree(changed, relative)
