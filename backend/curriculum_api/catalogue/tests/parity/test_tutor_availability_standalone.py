"""Source and dependency contracts for tutor availability; no Django imports."""
import ast
from copy import deepcopy
from functools import lru_cache
import importlib
import json
from pathlib import Path
import sys
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/tutor_availability_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body if isinstance(n,ast.FunctionDef) and n.name==name)


class TutorAvailabilityContracts(unittest.TestCase):
    def test_nine_complete_original_bodies_preserved(self):
        for name,entry in SNAPSHOT.items():
            if entry.get('kind')=='http':
                continue
            old=ast.parse(entry['source']).body[0]
            new=function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'),name)
            self.assertEqual([ast.dump(n) for n in new.body],[ast.dump(n) for n in old.body],name)

    def test_public_signatures_and_dependency_bindings_preserved(self):
        for name,entry in SNAPSHOT.items():
            old=ast.parse(entry['source']).body[0]
            wrapper=function(ROOT.parent/'views.py',name)
            self.assertEqual(ast.dump(old.args),ast.dump(wrapper.args))
            self.assertEqual([ast.unparse(n) for n in wrapper.decorator_list],entry['decorators'])
            if entry.get('kind')=='http':
                continue
            call=wrapper.body[-1].value
            self.assertEqual([ast.unparse(n) for n in call.args],[a.arg for a in old.args.args])
            expected=dict(entry['bindings'])
            if old.args.kwarg:
                expected[None]=old.args.kwarg.arg
            self.assertEqual({k.arg:ast.unparse(k.value) for k in call.keywords},expected)

    def test_preview_algorithm_preserved_except_explicit_strict_reads_and_http_mapping(self):
        old=ast.parse(SNAPSHOT['curriculum_preview_tutor_availability']['source']).body[0]
        new=function(ROOT/'api/calendar_editing.py',old.name)
        self.assertEqual([ast.dump(n) for n in old.body[:6]],[ast.dump(n) for n in new.body[:6]])
        query=function(ROOT/'application/tutor_availability.py','preview_tutor_availability')
        class Normalize(ast.NodeTransformer):
            def visit_Name(self,node):
                return ast.copy_location(ast.Name(id={'safe_authoring_module_rows':'read_module_rows','get_tutor_rows':'read_tutor_rows'}.get(node.id,node.id),ctx=node.ctx),node)
            def visit_Call(self,node):
                if isinstance(node.func,ast.Name) and node.func.id=='JsonResponse':
                    return self.visit(node.args[0])
                if isinstance(node.func,ast.Name) and node.func.id=='json_error':
                    return ast.copy_location(ast.Constant(None),node)
                if isinstance(node.func,ast.Name) and node.func.id=='tutor_conflict_context':
                    node.keywords=[]
                return self.generic_visit(node)
        expected=[Normalize().visit(deepcopy(n)) for n in old.body[6:]]
        actual=[Normalize().visit(deepcopy(n)) for n in query.body[1:]]
        self.assertEqual([ast.dump(n) for n in expected],[ast.dump(n) for n in actual])
        context=next(n for n in ast.walk(query) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='tutor_conflict_context')
        self.assertEqual({k.arg:ast.unparse(k.value) for k in context.keywords},dict(
            safe_group_delivery_rows='read_group_rows',surviving_authoring_module_rows='surviving_authoring_module_rows',
            tutor_delivery_schedule='tutor_delivery_schedule',module_schedule_view='module_schedule_view',module_session_dates='module_session_dates'))

    def test_dependencies_have_no_framework_or_reverse_edges_and_import_without_startup(self):
        sys.path.insert(0,str(ROOT.parent.parent))
        for module in ('domain.tutor_conflicts','application.tutor_availability','infrastructure.tutor_reads'):
            path=ROOT.joinpath(*module.split('.')).with_suffix('.py')
            imports=[n for n in ast.walk(tree(path)) if isinstance(n,(ast.Import,ast.ImportFrom))]
            self.assertTrue(all(isinstance(n,ast.ImportFrom) for n in imports))
            self.assertTrue(all(n.module in ('collections','application.tutor_availability') for n in imports))
            importlib.import_module('curriculum_api.catalogue.'+module)
        for forbidden in ('django','curriculum_api.views','requests','psycopg'):
            self.assertNotIn(forbidden,sys.modules)


if __name__=='__main__':
    unittest.main()
