"""Source fidelity and import-boundary checks; standard library only."""
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
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/delivery_schedules_snapshot.json').read_text(encoding='utf-8'))


@lru_cache(None)
def tree(path):
    return _read_dependencies.source_tree(path)


def function(path, name):
    return next(n for n in tree(path).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


class DeliveryScheduleContracts(unittest.TestCase):
    def test_complete_original_bodies_preserved(self):
        for name, entry in SNAPSHOT.items():
            if entry.get('kind') == 'http':
                continue
            if name in ('curriculum_sessions_from_rows', 'module_scoped_sessions'):
                # Their intentionally changed assembly is exercised against the
                # actual authored pipeline by the convergence/HTTP fixtures.
                if name == 'module_scoped_sessions':
                    node = function(ROOT.parent / 'views.py', name)
                    calls = [n for n in ast.walk(node) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
                    self.assertIn('build_calendar_snapshot', [n.func.id for n in calls])
                    self.assertNotIn('get_cached_sessions', [n.func.id for n in calls])
                else:
                    node = function(ROOT / 'application/session_calendar.py', name)
                    self.assertIn('calendar_snapshot_from_rows', ast.unparse(node))
                    self.assertNotIn('build_sessions(', ast.unparse(node))
                    self.assertNotIn('prefer_authoring_module_sessions', ast.unparse(node))
                continue
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), name)
            self.assertEqual([ast.dump(n) for n in new.body], [ast.dump(n) for n in old.body], name)

    def test_public_signatures_decorators_and_all_named_bindings(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            new = function(ROOT.parent / 'views.py', name)
            if name == 'module_scoped_sessions':
                self.assertEqual([n.arg for n in new.args.args], [n.arg for n in old.args.args])
                self.assertEqual([n.arg for n in new.args.kwonlyargs], ['visibility'])
                self.assertEqual(ast.literal_eval(new.args.kw_defaults[0]), 'operational')
            else:
                self.assertEqual(ast.dump(new.args), ast.dump(old.args), name)
            self.assertEqual([ast.unparse(n) for n in new.decorator_list], entry['decorators'])
            if entry.get('kind') == 'http' or name in ('curriculum_sessions_from_rows', 'module_scoped_sessions'):
                continue
            call = new.body[-1].value
            self.assertEqual([ast.unparse(n) for n in call.args], [n.arg for n in old.args.args])
            self.assertEqual({k.arg: ast.unparse(k.value) for k in call.keywords},
                             {**{a.arg:a.arg for a in old.args.kwonlyargs}, **entry['bindings']})

    def test_http_validation_and_exception_serialization_boundaries_preserved(self):
        old = ast.parse(SNAPSHOT['curriculum_preview_module_session_plan']['source']).body[0]
        new = function(ROOT / 'api/calendar_editing.py', old.name)
        self.assertEqual([ast.dump(n) for n in old.body[:5]], [ast.dump(n) for n in new.body[:5]])
        class UnwrapResponse(ast.NodeTransformer):
            def visit_Call(self, node):
                if isinstance(node.func,ast.Name) and node.func.id == 'JsonResponse':
                    return node.args[0]
                return self.generic_visit(node)
        expected = [UnwrapResponse().visit(deepcopy(n)) for n in old.body[5:]]
        query = function(ROOT / 'application/delivery_schedules.py','preview_module_session_plan')
        self.assertEqual([ast.dump(n) for n in expected], [ast.dump(n) for n in query.body[1:]])
        old = ast.parse(SNAPSHOT['curriculum_module_session_plan']['source']).body[0]
        wrapper = function(ROOT.parent / 'views.py', old.name)
        self.assertEqual(wrapper.body[0].module, 'catalogue.api.module_reads')
        self.assertEqual(wrapper.body[0].names[0].name, old.name)
        new = function(ROOT / 'api/module_reads.py', old.name)
        call = wrapper.body[-1].value
        self.assertEqual(call.func.id, wrapper.body[0].names[0].asname)
        self.assertEqual([ast.unparse(arg) for arg in call.args], [arg.arg for arg in old.args.args])
        self.assertEqual({kw.arg: ast.unparse(kw.value) for kw in call.keywords},
                         {arg.arg: arg.arg for arg in new.args.kwonlyargs})
        self.assertEqual(ast.dump(old.body[-1]), ast.dump(new.body[-1]))
        self.assertEqual(ast.dump(old.body[1]), ast.dump(new.body[1]))
        self.assertEqual([ast.dump(n) for n in old.body[2].handlers], [ast.dump(n) for n in new.body[2].handlers])
        # Compare the actual extracted query with the original try body after
        # only the explicit missing sentinel / HTTP query mapping substitutions.
        expected = deepcopy(old.body[2].body)
        class RequestMapping(ast.NodeTransformer):
            def visit_Attribute(self, node):
                if isinstance(node.value, ast.Name) and node.value.id == 'request' and node.attr == 'GET':
                    return ast.copy_location(ast.Name(id='query_params',ctx=ast.Load()),node)
                return self.generic_visit(node)
            def visit_Return(self, node):
                if isinstance(node.value, ast.Call) and isinstance(node.value.func,ast.Name) and node.value.func.id == 'json_error':
                    return ast.copy_location(ast.Return(value=ast.Constant(None)),node)
                return node
        expected = [RequestMapping().visit(n) for n in expected]
        query = function(ROOT / 'application/delivery_schedules.py','load_module_session_plan')
        self.assertEqual([ast.dump(n) for n in expected], [ast.dump(n) for n in query.body[1:-1]])

    def test_owners_import_only_stdlib_and_do_not_import_application_or_legacy_state(self):
        sys.path.insert(0,str(ROOT.parent.parent))
        for module in {e['module'] for e in SNAPSHOT.values() if 'module' in e}:
            path=ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for node in ast.walk(_read_dependencies.source_tree(path)):
                if isinstance(node,ast.Import):
                    self.assertEqual([n.name for n in node.names],['re'])
                if isinstance(node,ast.ImportFrom):
                    if node.level:
                        self.assertEqual((node.level, node.module, [a.name for a in node.names]),
                                         (1, 'overview', ['CurriculumOverviewUnavailable']))
                    else:
                        self.assertEqual(node.module,'datetime')
            importlib.import_module(module)
        for name in ('django','curriculum_api.views','requests','psycopg'):
            self.assertNotIn(name,sys.modules)


if __name__ == '__main__':
    unittest.main()
