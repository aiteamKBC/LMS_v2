"""Frozen authoring storage source; test-only restoration without LMS startup."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/authoring_storage_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_views_tree(tree):
    import importlib.util
    spec = importlib.util.spec_from_file_location('content_oracle', Path(__file__).with_name('content_commands_oracle.py'))
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    tree = oracle.restore_views_tree(tree)
    for index, node in enumerate(tree.body):
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name in SNAPSHOT['functions']:
            entry = SNAPSHOT['functions'][node.name]
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[index] = old
        elif node.name == 'permanent_module_delete_response':
            tree.body[index] = ast.parse(SNAPSHOT['compatibility_wrapper']).body[0]
    return tree


def relocated_body(entry):
    fn = ast.parse(entry['source']).body[0]
    if entry['ready']:
        flag = entry['ready']
        fn.body = [n for n in fn.body if not isinstance(n, ast.Global)
                   and not (isinstance(n, ast.If) and ast.unparse(n.test) == flag)
                   and not (isinstance(n, ast.Assign) and ast.unparse(n) == flag + ' = True')]
    class Imports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            if node.module == 'catalogue.application.week_templates':
                node.level, node.module = 2, 'application.week_templates'
                return node
            if node.module == 'free_course_contract':
                return ast.parse('COLUMNS = load_free_course_columns()').body[0]
            if node.module is None:
                return ast.parse('catalogue_store = load_free_course_catalogue_store()').body[0]
            assert node.module in {'learning_storage', 'legacy_free_course_adoption', 'course_pricing_schema'}
            return None
    return Imports().visit(fn)
