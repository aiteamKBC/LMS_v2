"""Exact historical layout reconstruction; never used by runtime tests."""
import ast
from collections import Counter, defaultdict, deque
import hashlib
import json
from pathlib import Path

SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/legacy_snapshot.json').read_text(encoding='utf-8'))


def restore_tree(tree, relative):
    from .calendar_oracle import restore_tree as restore_calendar
    tree = restore_calendar(tree, relative)
    if relative != 'views.py' or getattr(tree, '_meeting_boundary_restored', False):
        return tree
    added = Counter(SNAPSHOT['views_added'])
    if not any(ast.dump(n) in added for n in tree.body):
        return tree
    kept = []
    for n in tree.body:
        key = ast.dump(n)
        if added[key]:
            added[key] -= 1
        else:
            kept.append(n)
    kept += [ast.parse(s).body[0] for s in SNAPSHOT['views_removed']]
    grouped = defaultdict(deque)
    for n in kept:
        grouped[hashlib.sha256(ast.dump(n).encode()).hexdigest()].append(n)
    ordered = []
    for key in SNAPSHOT['views_order']:
        if grouped[key]:
            ordered.append(grouped[key].popleft())
    tree.body = ordered + [n for q in grouped.values() for n in q]
    tree._meeting_boundary_restored = True
    return tree
