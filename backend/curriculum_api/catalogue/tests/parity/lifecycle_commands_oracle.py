"""Frozen lifecycle source restoration for parity tests; never imported by the app."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/lifecycle_commands_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_views_tree(tree):
    import importlib.util
    spec = importlib.util.spec_from_file_location('authoring_storage_oracle', Path(__file__).with_name('authoring_storage_oracle.py'))
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    tree = oracle.restore_views_tree(tree)
    for index, node in enumerate(tree.body):
        if isinstance(node, ast.FunctionDef) and node.name in SNAPSHOT['functions']:
            entry = SNAPSHOT['functions'][node.name]
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[index] = old
    removed = SNAPSHOT['removed']
    assert not any(isinstance(n, ast.FunctionDef) and n.name == removed['name'] for n in tree.body)
    tree.body.insert(removed['index'], ast.parse(removed['source']).body[0])
    return tree


def relocated_body(source):
    class Imports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            assert (node.level, node.module) == (1, 'module_collaboration')
            return None
    fn = Imports().visit(ast.parse(source).body[0])
    if fn.name == 'permanent_module_delete_response':
        # Approved normalized-KSB correction only; preserve the frozen failure
        # baseline and prove every other statement still matches the original.
        scope = next(n for n in ast.walk(fn) if isinstance(n, ast.With))
        assert ast.unparse(scope.body[0]) == "removed = {table: len(delete_rows(table, 'module_catalogue_id = %s', [catalogue_id])) for table in MODULE_CHILD_AUTHORING_TABLES}"
        scope.body[:1] = ast.parse('''removed = {}
for table in MODULE_CHILD_AUTHORING_TABLES:
    where_sql, params = (
        ksb_mapping_placement.where(catalogue_id)
        if table == AUTHORING_KSB_MAPPINGS_TABLE
        else ('module_catalogue_id = %s', [catalogue_id])
    )
    removed[table] = len(delete_rows(table, where_sql, params))
''').body
    return fn
