"""Frozen content source and explicit removal of training GET fabrication."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/content_commands_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))


def restore_views_tree(tree):
    import importlib.util
    spec = importlib.util.spec_from_file_location('row_persistence_oracle', Path(__file__).with_name('row_persistence_oracle.py'))
    newer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(newer)
    tree = newer.restore_views_tree(tree)
    for index, node in enumerate(tree.body):
        if not isinstance(node, ast.FunctionDef):
            continue
        if node.name in SNAPSHOT['functions']:
            entry = SNAPSHOT['functions'][node.name]
            old = ast.parse(entry['source']).body[0]
            old.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
            tree.body[index] = old
        elif node.name == 'curriculum_module_structure':
            old = ast.parse(SNAPSHOT['structure_wrapper']).body[0]
            old.decorator_list = node.decorator_list
            tree.body[index] = old
    for name, entry in sorted(SNAPSHOT['removed'].items(), key=lambda item: item[1]['index']):
        assert not any(isinstance(n, ast.FunctionDef) and n.name == name for n in tree.body)
        tree.body.insert(entry['index'], ast.parse(entry['source']).body[0])
    return tree


def readonly_training_get(fn):
    """Only two reviewed changes: no placeholder save and no identity write on GET."""
    get = next(n for n in fn.body if isinstance(n, ast.If) and ast.unparse(n.test) == "request.method == 'GET'")
    attempt = next(n for n in get.body if isinstance(n, ast.Try))
    scope = attempt.body[0]
    assignment = scope.body[0]
    if isinstance(assignment, ast.If):
        # Earlier immutable baseline kept canonical GET in this same scope.
        assignment = assignment.body[0]
    assert isinstance(assignment, ast.Assign) and isinstance(assignment.value, ast.IfExp)
    assert ast.unparse(assignment.value.orelse) == 'stamp_revision_after_write(ensure_training_module_authoring_structure(module_catalogue_id), resolved_catalogue_id)'
    assignment.value.orelse = ast.Constant(value=None)
    assert len(attempt.body) == 2 and isinstance(attempt.body[1], ast.If)
    assert ast.unparse(attempt.body[1].body[0].value.func) == 'link_training_row_to_catalogue'
    attempt.body = [scope]
    return fn


def relocated_body(source):
    class Imports(ast.NodeTransformer):
        def visit_ImportFrom(self, node):
            if node.module == 'learning_storage':
                assert node.names[0].name == 'course'
                return None
            assert node.module is None and node.names[0].name in {'content_cache', 'free_course_catalogue_store'}
            alias = node.names[0]
            return ast.parse((alias.asname or alias.name) + ' = load_' + alias.name + '()').body[0]
    fn = Imports().visit(ast.parse(source).body[0])
    if fn.name == '_curriculum_ksb_mapping_detail':
        attempt = next(n for n in fn.body if isinstance(n, ast.Try))
        attached = next(n for n in attempt.body if isinstance(n, ast.If))
        assert ast.unparse(attached.body[-1]) == "updated = (authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id]) or [{}])[0]"
        atomic = attached.body[-2]
        assert isinstance(atomic, ast.With) and len(atomic.body) == 1
        atomic.body.extend(ast.parse('''updated_rows = authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, 'id = %s', [mapping_id])
if not updated_rows:
    transaction.set_rollback(True)
    return json_error('The updated KSB mapping could not be read back. No changes were saved.', status=500)
updated = updated_rows[0]
''').body)
        attached.body.pop()
    return fn
