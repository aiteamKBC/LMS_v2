"""Reverse only the reviewed home-reader import edit for older frozen evidence."""
import ast


def restore_tree(tree, relative):
    if relative != 'read_model.py':
        return tree
    for function in tree.body:
        if not isinstance(function, ast.FunctionDef) or function.name != 'build_curriculum_home':
            continue
        bindings = {}
        imports = []
        for node in function.body:
            if isinstance(node, ast.ImportFrom) and (node.module or '').startswith('curriculum_api.catalogue.'):
                imports.append(node)
                bindings.update({a.asname or a.name: a.name for a in node.names})
        if not imports:
            continue
        assert set(bindings) == {'build_curriculum_payload', 'compact_module_rows', 'curriculum_read_scope',
                                 'enrich_modules_with_authoring', 'enrich_programmes_with_module_counts'}

        class RestoreLookup(ast.NodeTransformer):
            def visit_Name(self, node):
                if isinstance(node.ctx, ast.Load) and node.id in bindings:
                    return ast.copy_location(ast.Attribute(ast.Name('views', ast.Load()), bindings[node.id], ast.Load()), node)
                return node

        first = function.body.index(imports[0])
        function.body = [node for node in function.body if node not in imports]
        function.body.insert(first, ast.parse('from . import views').body[0])
        RestoreLookup().visit(function)
    return ast.fix_missing_locations(tree)
