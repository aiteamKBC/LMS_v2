"""Reviewed state relocation for frozen source oracles; no application imports."""
import ast
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT_PATH = ROOT / 'catalogue/tests/fixtures/legacy_snapshots/cache_ownership_snapshot.json'
SNAPSHOT = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))
STATE = frozenset(SNAPSHOT['state'])


class RelocateState(ast.NodeTransformer):
    """Change only global state addresses, never the original decisions."""
    def visit_Name(self, node):
        if node.id in STATE:
            return ast.copy_location(ast.Attribute(
                value=ast.Name(id='cache_state', ctx=ast.Load()), attr=node.id, ctx=node.ctx), node)
        return node

    def visit_Global(self, node):
        remaining = [name for name in node.names if name not in STATE]
        return ast.Global(names=remaining) if remaining else None


def relocated_source(source):
    return ast.fix_missing_locations(RelocateState().visit(ast.parse(source)))


def restore_views_tree(tree):
    """Restore this batch only, so the older whole-file guard stays unchanged."""
    spec = importlib.util.spec_from_file_location('hierarchy_commands_oracle', Path(__file__).with_name('hierarchy_commands_oracle.py'))
    hierarchy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(hierarchy)
    tree = hierarchy.restore_views_tree(tree)
    functions = SNAPSHOT['functions']
    initializers = SNAPSHOT['initializers']

    class PreviousAddress(ast.NodeTransformer):
        def visit_Attribute(self, node):
            if isinstance(node.value, ast.Name) and node.value.id == 'cache_state' and node.attr in STATE:
                return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
            return self.generic_visit(node)

    result = []
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == 'catalogue.infrastructure' and any(a.asname == 'cache_state' for a in node.names):
            continue
        if isinstance(node, ast.ImportFrom) and node.module == 'catalogue.infrastructure.runtime_state':
            result.extend(ast.parse(source).body[0] for name, source in initializers.items() if name != '_CURRICULUM_READ_SCOPE')
            continue
        name = node.name if isinstance(node, ast.FunctionDef) else None
        if isinstance(node, ast.ImportFrom) and node.module in {'catalogue.infrastructure.cache_runtime', 'catalogue.infrastructure.cache_epochs', 'catalogue.infrastructure.cache_invalidation'}:
            assert len(node.names) == 1 and node.names[0].asname is None
            name = node.names[0].name
        if name in functions:
            if name == 'curriculum_read_scope':
                result.append(ast.parse(initializers['_CURRICULUM_READ_SCOPE']).body[0])
            entry = functions[name]
            node = ast.parse(entry['source']).body[0]
            node.decorator_list = [ast.parse(d, mode='eval').body for d in entry['decorators']]
        else:
            if name == 'reset_schema_ready_flags':
                extra = ast.parse('cache_state._CURRICULUM_EPOCH_TABLE_READY = False').body[0]
                matches = [n for n in node.body if ast.dump(n) == ast.dump(extra)]
                assert len(matches) == 1
                node.body.remove(matches[0])
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_SCHEMA_READY_FLAGS' for t in node.targets):
                # Preserve the exact old tuple ordering, verified independently.
                old = SNAPSHOT['schema_ready_flags']
                node = ast.parse(old).body[0]
            node = PreviousAddress().visit(node)
        result.append(node)
    tree.body = result
    return tree
