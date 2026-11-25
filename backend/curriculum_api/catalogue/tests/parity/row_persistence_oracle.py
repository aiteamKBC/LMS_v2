"""Immutable pre-extraction row persistence and programme configuration source."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/row_persistence_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_views_tree(tree):
    import importlib.util
    spec = importlib.util.spec_from_file_location('holiday_boundary_oracle', Path(__file__).with_name('holiday_boundary_oracle.py'))
    newer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(newer)
    tree = newer.restore_views_tree(tree)
    for index, node in enumerate(tree.body):
        if isinstance(node, ast.FunctionDef) and node.name in SNAPSHOT['functions']:
            entry = SNAPSHOT['functions'][node.name]
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[index] = old
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == '_SCHEMA_READY_FLAGS' for t in node.targets
        ):
            tree.body[index] = ast.parse(SNAPSHOT['flags']).body[0]
    for entry in sorted(SNAPSHOT['removed'].values(), key=lambda e: e['index']):
        tree.body.insert(entry['index'], ast.parse(entry['source']).body[0])
    return tree


def relocated_body(source):
    class Imports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            assert node.level == 1
            if node.module == 'module_live':
                assert node.names[0].name == 'note_rows'
                return None
            if node.module == 'free_course_contract':
                assert node.names[0].name == 'COLUMNS'
                return ast.parse('COLUMNS = load_free_course_columns()').body[0]
            assert node.module is None and node.names[0].name == 'content_cache'
            return ast.parse('content_cache = load_content_cache()').body[0]
    return Imports().visit(ast.parse(source).body[0])
