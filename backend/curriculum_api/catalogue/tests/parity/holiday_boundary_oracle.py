"""Frozen holiday HTTP/storage source, with explicit preview and input-validation changes."""
import ast
import json
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/holiday_boundary_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_module(tree, filename):
    if filename == 'views.py':
        spec = importlib.util.spec_from_file_location('session_editing_oracle', Path(__file__).with_name('session_editing_oracle.py'))
        oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(oracle)
        tree = oracle.restore_views_tree(tree)
    for i, node in enumerate(tree.body):
        if not isinstance(node, ast.FunctionDef):
            continue
        entry = SNAPSHOT['functions'].get(filename + ':' + node.name)
        if entry:
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[i] = old
    return tree


def restore_views_tree(tree):
    return restore_module(tree, 'views.py')


def relocated_body(source):
    class Imports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            assert node.level == 1
            if node.module is None:
                if node.names[0].name == 'england_holidays':
                    return ast.parse('england_holidays = load_england_holidays()').body[0]
                assert node.names[0].name == 'views'
                return None
            assert node.module == 'curriculum_names'
            return None

        def visit_Attribute(self, node):
            if isinstance(node.value, ast.Name) and node.value.id == 'views':
                return ast.Name(id=node.attr, ctx=node.ctx)
            return self.generic_visit(node)

    fn = Imports().visit(ast.parse(source).body[0])
    if fn.name == 'curriculum_england_holidays_refresh':
        i = next(i for i, n in enumerate(fn.body) if isinstance(n, ast.Assign)
                 and isinstance(n.targets[0], ast.Name) and n.targets[0].id == 'payload')
        assert ast.unparse(fn.body[i]) == 'payload = json_body(request) or {}'
        fn.body[i:i + 1] = ast.parse("payload = json_body(request)\nif not isinstance(payload, dict):\n    return json_error('Invalid JSON body.')").body
    return fn
