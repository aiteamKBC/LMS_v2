"""Restore only reviewed ownership moves for historical authoring AST guards.

Reconstruction reads the actual extracted body, never substitutes frozen code.
"""
import ast
import copy
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]


def authoring_definitions():
    api=ast.parse((ROOT/'catalogue/api/free_course_authoring.py').read_text(encoding='utf-8-sig'))
    functions={n.name:n for n in api.body if isinstance(n,ast.FunctionDef)}
    for relative in ('catalogue/domain/free_course_structure_edits.py','catalogue/infrastructure/free_course_structure_reads.py'):
        for node in ast.parse((ROOT/relative).read_text()).body:
            if isinstance(node,ast.FunctionDef): functions[node.name]=node
    app=ast.parse((ROOT/'catalogue/application/free_course_structure_edits.py').read_text()).body
    body=next(n for n in app if isinstance(n,ast.FunctionDef) and n.name=='edit_structure').body
    view_names={'lock_module_structure_row','refuse_stale_module_write','read_module_structure_with_revision','requested_expected_revision','json_error','json_body','authoring_module_exists','curriculum_row_effectively_deleted'}
    class Restore(ast.NodeTransformer):
        def visit_Return(self,node):
            if isinstance(node.value,ast.Call) and ast.unparse(node.value.func)=='edits.edit_structure':
                return [self.visit(copy.deepcopy(n)) for n in body]
            return self.generic_visit(node)
        def visit_Name(self,node):
            if node.id=='method': return ast.Attribute(value=ast.Name(id='request',ctx=ast.Load()),attr='method',ctx=node.ctx)
            if node.id in view_names:return ast.Attribute(value=ast.Name(id='v',ctx=ast.Load()),attr=node.id,ctx=node.ctx)
            if node.id=='reply':node.id='_reply'
            return node
        def visit_Call(self,node):
            original=ast.unparse(node.func)
            if original=='save_failed':
                return ast.Compare(left=ast.Attribute(value=node.args[0],attr='status_code',ctx=ast.Load()),ops=[ast.GtE()],comparators=[ast.Constant(300)])
            if original=='saved_payload':
                return ast.Call(func=ast.Attribute(value=ast.Name(id='json',ctx=ast.Load()),attr='loads',ctx=ast.Load()),args=[ast.Attribute(value=node.args[0],attr='content',ctx=ast.Load())],keywords=[])
            if original in {'collaboration_configuration','refuse_stale_module_write','requested_expected_revision','forward_save'}:
                node.args.insert(0,ast.Name(id='request',ctx=ast.Load()))
            if original=='forward_save':node.func=ast.Name(id='_forward_save',ctx=ast.Load())
            return self.generic_visit(node)
    # Only the new Application body has request capabilities; preserve existing
    # API helpers (including _forward_save's real request argument).
    for name in ('_active_module','catalogue','authoring'):
        functions[name]=ast.fix_missing_locations(Restore().visit(functions[name]))
    return {name:ast.dump(node,include_attributes=False) for name,node in functions.items()}
