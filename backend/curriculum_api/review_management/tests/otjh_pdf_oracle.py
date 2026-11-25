"""Frozen, hash-verified original implementations for this extraction only."""
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = json.loads((ROOT / 'tests/fixtures/otjh_pdf_boundary.json').read_text())
SOURCES = FIXTURE['sources']
SOURCE_HASH = '0f06e03ebeaf99d42e3ab66a505dea018a6cbbaf341a3e2d4a8acdfc93ce8e44'
assert hashlib.sha256(json.dumps(SOURCES, sort_keys=True).encode()).hexdigest() == SOURCE_HASH


def source_node(source, name):
    return next(node for node in ast.parse(source).body if
                getattr(node, 'name', None) == name or
                isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                and node.targets[0].id == name)


def compile_original(module, namespace):
    """Execute original declarations only; imports are explicitly supplied."""
    nodes = [node for node in ast.parse(SOURCES[module]).body
             if isinstance(node, (ast.FunctionDef, ast.Assign, ast.AnnAssign))]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<frozen-' + module + '>', 'exec'), namespace)
    return namespace


def normalized(node):
    class Bindings(ast.NodeTransformer):
        def visit_Attribute(self, node):
            if isinstance(node.value, ast.Name) and node.value.id in ('review_instances', 'reviews'):
                return ast.copy_location(ast.Name(id=node.attr, ctx=node.ctx), node)
            return self.generic_visit(node)

        def visit_Subscript(self, node):
            # Only the renderer's asset root changes with its source location.
            if ast.dump(node) == ast.dump(ast.parse('Path(__file__).resolve().parents[2]', mode='eval').body):
                return ast.parse('Path(__file__).parent', mode='eval').body
            return self.generic_visit(node)
    return ast.dump(Bindings().visit(deepcopy(node)))
