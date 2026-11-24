"""Reconstruct prior layout only for exactly reviewed moved source nodes."""
import ast
from collections import Counter, defaultdict, deque
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/authoring_composition_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_tree(tree, relative):
    from .content_composition_oracle import restore_tree as restore_content
    tree = restore_content(tree, relative)
    from curriculum_api.meetings.tests.layout_oracle import restore_tree as restore_meetings
    tree = restore_meetings(tree, relative)
    entry = SNAPSHOT['source_changes'].get(relative)
    if entry is None or getattr(tree, '_authoring_composition_restored', False):
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
    tree._authoring_composition_restored = True
    return tree
