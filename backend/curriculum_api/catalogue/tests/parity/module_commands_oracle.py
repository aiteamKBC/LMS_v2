"""Frozen pre-extraction module commands; source-only restoration, no LMS startup."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/module_commands_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_views_tree(tree):
    # Restore the subsequent lifecycle batch before this historical baseline.
    import importlib.util
    spec = importlib.util.spec_from_file_location('lifecycle_oracle', Path(__file__).with_name('lifecycle_commands_oracle.py'))
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    tree = oracle.restore_views_tree(tree)
    for index, node in enumerate(tree.body):
        if isinstance(node, ast.FunctionDef) and node.name in SNAPSHOT['functions']:
            entry = SNAPSHOT['functions'][node.name]
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[index] = old
    return tree


def relocated_body(source):
    """Translate only reviewed import locations/bindings, never business decisions."""
    class Imports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            if node.module in {'free_course_policy', 'learning_storage',
                               'curriculum_api.delivery_calendar', 'teams_external_calendar',
                               'module_collaboration', 'learner_api.student_activity'}:
                return None
            if node.module == 'module_merge':
                return ast.parse(', '.join(a.name for a in node.names) + ' = module_merge_bindings()').body[0]
            if node.module == 'catalogue.api.module_reads':
                node.level, node.module = 1, 'module_reads'
            if node.module == 'catalogue.application.structure_payloads':
                node.level, node.module = 2, 'application.structure_payloads'
            return node
    fn = Imports().visit(ast.parse(source).body[0])
    if fn.name == 'curriculum_module_structure':
        import importlib.util
        spec = importlib.util.spec_from_file_location('content_oracle', Path(__file__).with_name('content_commands_oracle.py'))
        oracle = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(oracle)
        fn = oracle.readonly_training_get(fn)
    return fn
