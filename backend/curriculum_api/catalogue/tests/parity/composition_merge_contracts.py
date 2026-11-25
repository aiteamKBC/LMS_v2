"""Reverse fixed, reviewed composition deltas for historical evidence only."""
import ast
import hashlib
import json
from pathlib import Path

REFERENCE_PATH = Path(__file__).parents[1] / 'fixtures/composition_merge_deltas.json'
REFERENCE = json.loads(REFERENCE_PATH.read_text(encoding='utf-8'))


def fingerprint(tree):
    return hashlib.sha256(ast.dump(tree).encode()).hexdigest()


def restore_tree(tree, relative):
    entry = REFERENCE['files'].get(relative)
    if entry is None or getattr(tree, '_composition_merge_restored', False):
        return tree
    assert fingerprint(tree) == entry['current_sha256'], f'Unreviewed source change: {relative}'
    lines = ast.unparse(tree).splitlines()
    for edit in reversed(entry['edits']):
        start = edit['start']
        stop = start + len(edit['current'])
        assert lines[start:stop] == edit['current'], f'Invalid composition delta: {relative}'
        lines[start:stop] = edit['historical']
    restored = ast.parse('\n'.join(lines))
    assert fingerprint(restored) == entry['historical_sha256'], f'Invalid composition baseline: {relative}'
    restored._composition_merge_restored = True
    return restored
