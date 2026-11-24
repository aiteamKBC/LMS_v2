"""Read actual relocated entry bodies for existing source-isolated fixtures.

No application imports or execution. Historical fixtures supply their own ports;
this reader follows the reviewed exports to today's definitions, never to a
frozen implementation. Runtime suites separately exercise the real imports.
"""
import ast
import copy
from functools import lru_cache
from pathlib import Path

from .entry_composition_oracle import SNAPSHOT

ROOT = Path(__file__).resolve().parents[3]
from .runtime_ownership_oracle import SNAPSHOT as RUNTIME_SNAPSHOT

from .registry_composition_oracle import SNAPSHOT as REGISTRY_SNAPSHOT

from .calendar_composition_oracle import SNAPSHOT as CALENDAR_SNAPSHOT

from .cache_composition_oracle import SNAPSHOT as CACHE_SNAPSHOT

from .overview_composition_oracle import SNAPSHOT as OVERVIEW_SNAPSHOT
from .cache_lifecycle_oracle import SNAPSHOT as CACHE_LIFECYCLE_SNAPSHOT
from .final_bindings_oracle import SNAPSHOT as FINAL_BINDINGS_SNAPSHOT

MANIFEST = {key: {**SNAPSHOT['manifest'][key], **RUNTIME_SNAPSHOT['manifest'][key], **REGISTRY_SNAPSHOT['manifest'][key], **CALENDAR_SNAPSHOT['manifest'][key], **CACHE_SNAPSHOT['manifest'][key], **OVERVIEW_SNAPSHOT['manifest'][key], **CACHE_LIFECYCLE_SNAPSHOT['manifest'][key], **FINAL_BINDINGS_SNAPSHOT['manifest'][key]}
            for key in ('functions', 'constants', 'modules')}


class FixtureImports(ast.NodeTransformer):
    def visit_ImportFrom(self, node):
        # Source fixtures execute in the legacy curriculum_api package context.
        if node.level == 0 and (node.module or '').startswith('curriculum_api.'):
            node.module = node.module.removeprefix('curriculum_api.')
            node.level = 1
        return node


@lru_cache(maxsize=1)
def _definitions():
    owners = {name: ast.parse((ROOT / (name.replace('.', '/') + '.py')).read_text(encoding='utf-8'))
              for name in MANIFEST['modules']}
    nodes = []
    for name, owner in MANIFEST['functions'].items():
        matches = [n for n in owners[owner].body if isinstance(n, ast.FunctionDef) and n.name == name]
        assert len(matches) == 1, (name, owner)
        nodes.append(FixtureImports().visit(copy.deepcopy(matches[0])))
    for name, owner in CACHE_SNAPSHOT['manifest']['classes'].items():
        matches = [n for n in owners[owner].body if isinstance(n, ast.ClassDef) and n.name == name]
        assert len(matches) == 1, (name, owner)
        nodes.append(FixtureImports().visit(copy.deepcopy(matches[0])))
    for name, owner in MANIFEST['constants'].items():
        matches = [n for n in owners[owner].body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)]
        assert len(matches) == 1, (name, owner)
        nodes.append(copy.deepcopy(matches[0]))
    return nodes


def current_entry_tree():
    tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
    # Replace export bindings only in the synthetic AST, retaining all other
    # imports and actual source nodes. Never mutate the application module.
    exports = set(MANIFEST['functions']) | set(MANIFEST['constants']) | set(CACHE_SNAPSHOT['manifest']['classes'])
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            node.names = [a for a in node.names if (a.asname or a.name) not in exports]
    tree.body = [n for n in tree.body if not isinstance(n, ast.ImportFrom) or n.names]
    tree.body.extend(copy.deepcopy(_definitions()))
    # Actual read adapters now take the former module globals as explicit ports.
    # Synthetic source fixtures already provide those same globals. Follow the
    # current body, not a historical oracle, and retain the real lazy bridges.
    from .read_entry_oracle import SNAPSHOT as READ_ENTRY
    bindings = READ_ENTRY['manifest']
    for index, node in enumerate(tree.body):
        if not isinstance(node, ast.FunctionDef) or node.name not in bindings:
            continue
        entry = bindings[node.name]
        owner = ast.parse((ROOT / entry['owner']).read_text(encoding='utf-8'))
        actual = copy.deepcopy(next(n for n in owner.body if isinstance(n, ast.FunctionDef) and n.name == node.name))
        ports = set(entry['ports'])
        pairs = [(a, d) for a, d in zip(actual.args.kwonlyargs, actual.args.kw_defaults) if a.arg not in ports]
        actual.args.kwonlyargs = [a for a, _ in pairs]
        actual.args.kw_defaults = [d for _, d in pairs]
        actual.decorator_list = copy.deepcopy(node.decorator_list)
        bridges = [copy.deepcopy(n) for n in node.body if isinstance(n, ast.FunctionDef)]
        referenced = {n.id for n in ast.walk(actual) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
        imports = [copy.deepcopy(n) for n in owner.body if isinstance(n, ast.ImportFrom)
                   and any((a.asname or a.name) in referenced for a in n.names)]
        actual.body = imports + bridges + actual.body
        tree.body[index] = FixtureImports().visit(actual)
    return ast.fix_missing_locations(tree)
