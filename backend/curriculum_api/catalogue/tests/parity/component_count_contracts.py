"""Historical source checks only: account for the explicit count-reader bug fix.

Runtime tests use current production owners. The frozen pre-fix source and both
fingerprints prevent old architectural snapshots from either demanding the bug
back or silently accepting unrelated edits.
"""
import ast
import hashlib
import json
from pathlib import Path

REFERENCE_PATH = Path(__file__).parents[1] / 'fixtures/component_count_compatibility_fix.json'
REFERENCE = json.loads(REFERENCE_PATH.read_text(encoding='utf-8'))


def fingerprint(tree):
    return hashlib.sha256(ast.dump(tree).encode()).hexdigest()


def restore_tree(tree, relative):
    if getattr(tree, '_component_count_fix_restored', False):
        return tree
    entry = REFERENCE['files'].get(relative)
    if entry is None:
        return tree
    assert fingerprint(tree) == entry['after_ast_sha256'], f'Unreviewed count-reader edit: {relative}'
    restored = ast.parse(entry['before_source'])
    assert fingerprint(restored) == entry['before_ast_sha256'], f'Invalid count-reader baseline: {relative}'
    restored._component_count_fix_restored = True
    return restored
