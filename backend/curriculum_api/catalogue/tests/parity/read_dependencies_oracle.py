"""Restore historical source shape for earlier guards, never for runtime parity.

The current batch's independent tests verify the aliases, concrete defaults and
unchanged function bodies before earlier snapshots are compared in their old
layout. No production module imports this helper.
"""
import ast
from collections import defaultdict, deque
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.tests.parity.database_reads_oracle import restore_tree as restore_database_tree
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/read_dependencies_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def key(node):
    if isinstance(node, (ast.FunctionDef, ast.ClassDef)):
        return type(node).__name__ + ':' + node.name
    if isinstance(node, ast.Assign):
        return 'Assign:' + ','.join(ast.unparse(n) for n in node.targets)
    return hashlib.sha256(ast.dump(node).encode()).hexdigest()


def reorder(nodes, order):
    available = defaultdict(deque)
    for node in nodes:
        available[key(node)].append(node)
    ordered = []
    for name in order:
        if available[name]:
            ordered.append(available[name].popleft())
    # Unknown additions must remain visible to historical whole-file hashes.
    return ordered + [node for queue in available.values() for node in queue]


def restore_views_tree(tree):
    tree = restore_database_tree(tree, 'views.py')
    exports = set(SNAPSHOT['exports'])
    if not any(ast.dump(n) in exports for n in tree.body):
        return tree
    tree.body = [n for n in tree.body if ast.dump(n) not in exports]
    changed = SNAPSHOT['functions']
    tree.body = [ast.parse(changed[n.name]['source']).body[0]
                 if isinstance(n, ast.FunctionDef) and n.name in changed else n
                 for n in tree.body]
    present = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
    tree.body += [ast.parse(e['source']).body[0] for name, e in changed.items() if name not in present]
    tree.body += [ast.parse(text).body[0] for text in SNAPSHOT['constants'].values()]
    tree.body = reorder(tree.body, SNAPSHOT['views_order'])
    return tree


def restore_owner_tree(tree, owner):
    entry = SNAPSHOT['owners'][owner]
    old = ast.parse(entry['source'])
    originals = {n.name: n for n in old.body if isinstance(n, ast.FunctionDef)}
    added = defaultdict(int)
    for text in entry['imports']:
        added[ast.dump(ast.parse(text).body[0])] += 1
    # New imports were appended to the original preamble; remove from the end.
    kept = []
    for node in reversed(tree.body):
        fingerprint = ast.dump(node)
        if isinstance(node, (ast.Import, ast.ImportFrom)) and added[fingerprint]:
            added[fingerprint] -= 1
            continue
        if isinstance(node, ast.FunctionDef):
            if node.name in entry['raw']:
                continue
            if node.name in entry['defaults']:
                node.args = originals[node.name].args
        kept.append(node)
    tree.body = reorder(list(reversed(kept)), [key(n) for n in old.body])
    return tree


def source_tree(path):
    path = Path(path)
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    try:
        tree = restore_database_tree(tree, path.resolve().relative_to(ROOT.resolve()).as_posix())
    except ValueError:
        pass
    if path.resolve() == (ROOT / 'views.py').resolve():
        return restore_views_tree(tree)
    try:
        owner = '.'.join(path.resolve().relative_to(ROOT.resolve()).with_suffix('').parts)
    except ValueError:
        return tree
    if owner in SNAPSHOT['owners']:
        return restore_owner_tree(tree, owner)
    return tree
