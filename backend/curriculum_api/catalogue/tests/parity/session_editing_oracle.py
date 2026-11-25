"""Actual pre-session-editing source for old/new contract checks."""
import ast
import copy
import json
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/session_editing_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_views_tree(tree):
    spec = importlib.util.spec_from_file_location("read_dependencies_oracle", Path(__file__).with_name("read_dependencies_oracle.py"))
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    tree = oracle.restore_views_tree(tree)
    for i, node in enumerate(tree.body):
        if isinstance(node, ast.FunctionDef) and node.name in SNAPSHOT['functions']:
            entry = SNAPSHOT['functions'][node.name]
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[i] = old
    return tree


def relocated_function(source):
    class Relocate(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            if node.module in {'curriculum_api.country_calendars', 'curriculum_api.delivery_calendar'}:
                return None
            if node.level == 1 and (node.module or '').startswith('catalogue.'):
                node.level = 2
                node.module = node.module.removeprefix('catalogue.')
            return node

        def visit_Call(self, node):
            if ast.unparse(node.func) == 'isinstance' and len(node.args) == 2 and ast.unparse(node.args[1]) == 'CalendarUnavailable':
                return ast.Call(func=ast.Name(id='is_calendar_unavailable', ctx=ast.Load()), args=[node.args[0]], keywords=[])
            return self.generic_visit(node)
    return Relocate().visit(ast.parse(source).body[0])
