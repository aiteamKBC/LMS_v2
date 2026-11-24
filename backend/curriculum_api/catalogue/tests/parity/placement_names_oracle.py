"""Reconstruct prior layout only for exactly reviewed moved source nodes."""
import ast
from collections import Counter, defaultdict, deque
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/placement_names_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_tree(tree, relative):
    from .entry_composition_oracle import restore_tree as restore_entries
    tree = restore_entries(tree, relative)
    entry = SNAPSHOT['source_changes'].get(relative)
    if entry is None or getattr(tree, '_placement_names_restored', False):
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
    tree._placement_names_restored = True
    return tree
