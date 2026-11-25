"""Reconstruct prior layout only for exactly reviewed moved source nodes."""
import ast
from collections import Counter, defaultdict, deque
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/final_bindings_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_tree(tree, relative):
    from .native_ksb_contracts import restore_tree as restore_native_ksb
    tree = restore_native_ksb(tree, relative)
    from .component_count_contracts import restore_tree as restore_count_fix
    tree = restore_count_fix(tree, relative)
    from .approved_dev_contracts import restore_tree as restore_approved_dev
    tree = restore_approved_dev(tree, 'curriculum_api/' + relative)
    from curriculum_api.meetings.tests.approved_dev_contracts import restore_pre_dev_exports
    tree = restore_pre_dev_exports(tree, relative)
    entry = SNAPSHOT['source_changes'].get(relative)
    if entry is None or getattr(tree, '_final_bindings_restored', False):
        return tree
    additions = Counter(entry['added'])
    if not any(ast.dump(node) in additions for node in tree.body):
        return tree
    kept = []
    for node in tree.body:
        fingerprint = ast.dump(node)
        if additions[fingerprint]:
            additions[fingerprint] -= 1
        else:
            kept.append(node)
    kept += [ast.parse(source).body[0] for source in entry['removed']]
    available = defaultdict(deque)
    for node in kept:
        available[hashlib.sha256(ast.dump(node).encode()).hexdigest()].append(node)
    ordered = []
    for fingerprint in entry['order']:
        if available[fingerprint]:
            ordered.append(available[fingerprint].popleft())
    tree.body = ordered + [node for remaining in available.values() for node in remaining]
    tree._final_bindings_restored = True
    return tree
