"""Validate reviewed dev deltas before historical extraction comparisons.

The immutable reference records the accepted merge, not today's working tree.
Every approved file must match its AST fingerprint before its recorded deltas
can be reversed. Unknown edits, missing imports and reverted changes fail closed.
This is source evidence only; behavior tests must use the actual current owners.
No application module imports this test helper.
"""
import ast
import hashlib
import json
from pathlib import Path
from curriculum_api.review_management.tests.source_contracts import restore_tree as _restore_review_readiness
from curriculum_api.catalogue.tests.parity.free_course_layout_oracle import restore_tree as restore_free_course_imports

BACKEND = Path(__file__).resolve().parents[4]
REFERENCE_PATH = Path(__file__).parents[1] / 'fixtures/approved_dev_source_deltas.json'
REFERENCE = json.loads(REFERENCE_PATH.read_text(encoding='utf-8'))


def fingerprint(tree):
    return hashlib.sha256(ast.dump(tree).encode()).hexdigest()


def restore_review_readiness(tree, relative):
    return _restore_review_readiness(restore_free_course_imports(tree, relative), relative)


def restore_tree(tree, relative):
    """Reverse only fixed, reviewed edits after validating the current source."""
    if getattr(tree, '_catalogue_approved_dev_restored', False):
        return tree
    from .composition_merge_contracts import restore_tree as restore_composition_merge
    tree = restore_composition_merge(tree, relative)
    tree = restore_review_readiness(tree, relative)
    entry = REFERENCE['files'].get(relative)
    if entry is None:
        return tree
    assert fingerprint(tree) == entry['approved_ast_sha256'], f'Unreviewed source change: {relative}'
    lines = ast.unparse(tree).splitlines()
    for edit in reversed(entry['edits']):
        start = edit['start']
        stop = start + len(edit['approved'])
        assert lines[start:stop] == edit['approved'], f'Invalid approved delta: {relative}:{start}'
        lines[start:stop] = edit['historical']
    restored = ast.parse('\n'.join(lines))
    assert fingerprint(restored) == entry['historical_ast_sha256'], f'Invalid historical delta: {relative}'
    restored._catalogue_approved_dev_restored = True
    return restored


def source_tree(path):
    path = Path(path)
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    return restore_tree(tree, path.resolve().relative_to(BACKEND.resolve()).as_posix())
