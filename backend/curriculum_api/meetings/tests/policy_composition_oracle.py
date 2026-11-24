"""Historical source contracts for replacing pure facades with direct exports."""
import ast
from collections import Counter, defaultdict, deque
import hashlib
import importlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((Path(__file__).parent / 'fixtures/policy_composition_snapshot.json').read_text(encoding='utf-8'))
EXPORTS = SNAPSHOT['exports']


def actual(name):
    return getattr(importlib.import_module('curriculum_api.' + EXPORTS[name]), name)


def assert_export_contract(test, tree, name, original):
    if name not in EXPORTS:
        return False
    bindings = [(n.level, n.module, a.name) for n in tree.body if isinstance(n, ast.ImportFrom)
                for a in n.names if (a.asname or a.name) == name]
    test.assertEqual(bindings, [(1, EXPORTS[name], name)])
    test.assertFalse(any(isinstance(n, ast.FunctionDef) and n.name == name for n in tree.body))
    source = ROOT / (EXPORTS[name].replace('.', '/') + '.py')
    owner = next(n for n in ast.parse(source.read_text(encoding='utf-8')).body
                 if isinstance(n, ast.FunctionDef) and n.name == name)
    test.assertEqual(ast.dump(owner.args), ast.dump(original.args))
    test.assertEqual([ast.dump(n) for n in owner.decorator_list], [ast.dump(n) for n in original.decorator_list])
    test.assertEqual([ast.dump(n) for n in owner.body], [ast.dump(n) for n in original.body])
    return True


def assert_owner_imports(test, tree, owner):
    # Exact reviewed imports, not a generic exemption for domain modules.
    test.assertEqual([ast.dump(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))],
                     SNAPSHOT['owner_imports'].get(owner, []))


def restore_tree(tree, relative):
    from curriculum_api.catalogue.tests.parity.content_composition_oracle import restore_tree as restore_content
    tree = restore_content(tree, relative)
    if relative != 'views.py' or getattr(tree, '_meeting_policy_composition_restored', False):
        return tree
    added = Counter(SNAPSHOT['views_added'])
    if not any(ast.dump(n) in added for n in tree.body):
        return tree
    kept = []
    for node in tree.body:
        key = ast.dump(node)
        if added[key]:
            added[key] -= 1
        else:
            kept.append(node)
    kept += [ast.parse(s).body[0] for s in SNAPSHOT['views_removed']]
    grouped = defaultdict(deque)
    for node in kept:
        grouped[hashlib.sha256(ast.dump(node).encode()).hexdigest()].append(node)
    ordered = []
    for key in SNAPSHOT['views_order']:
        if grouped[key]:
            ordered.append(grouped[key].popleft())
    tree.body = ordered + [n for remaining in grouped.values() for n in remaining]
    tree._meeting_policy_composition_restored = True
    return tree
