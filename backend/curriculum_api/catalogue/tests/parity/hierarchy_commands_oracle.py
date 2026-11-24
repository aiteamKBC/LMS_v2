"""Frozen hierarchy sources and restoration; stdlib only, never imports the LMS."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/hierarchy_commands_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_views_tree(tree):
    # Later relocations are restored first; the older frozen hash stays intact.
    import importlib.util
    spec = importlib.util.spec_from_file_location('module_commands_oracle', Path(__file__).with_name('module_commands_oracle.py'))
    newer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(newer)
    tree = newer.restore_views_tree(tree)
    for index, node in enumerate(tree.body):
        if isinstance(node, ast.FunctionDef) and node.name in SNAPSHOT['functions']:
            entry = SNAPSHOT['functions'][node.name]
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[index] = old
    return tree


def relocated_body(source):
    """Only the reviewed deferred imports change; business statements do not."""
    class Imports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            if node.module in {'read_model', 'placement_rename', 'curriculum_api.delivery_calendar'}:
                return None
            if node.module == 'cohort_rename':
                return ast.parse('CohortRenameConflict, propagate_cohort_name = cohort_rename_bindings()').body[0]
            if node.module == 'catalogue.api.module_reads':
                node.module = 'module_reads'
            return node
    return Imports().visit(ast.parse(source).body[0])
