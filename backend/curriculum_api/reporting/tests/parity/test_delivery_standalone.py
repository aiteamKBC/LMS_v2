"""Read-boundary source and dependency proofs; standard library only."""
import ast
import builtins
import importlib
import json
from pathlib import Path
import symtable
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT/'tests/fixtures/legacy_snapshots/delivery_snapshot.json').read_text(encoding='utf-8'))
MODULES = ('application.queries','application.achievement','application.coverage',
           'application.supplementary','api.responses','infrastructure.achievement_cache',
           'infrastructure.supplementary')


def dump(nodes):
    return [ast.dump(n) for n in nodes]


class ReportingDeliveryContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = {n.name:n for n in ast.parse((ROOT.parent/'views.py').read_text(encoding='utf-8-sig')).body if isinstance(n,ast.FunctionDef)}
        cls.owners = {n.name:n for module in MODULES for n in ast.parse(ROOT.joinpath(*module.split('.')).with_suffix('.py').read_text(encoding='utf-8')).body if isinstance(n,ast.FunctionDef)}

    def test_public_signatures_and_decorators_are_unchanged(self):
        self.assertEqual(len(SNAPSHOT),18)
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(old.args),ast.dump(self.current[name].args),name)
            self.assertEqual(entry['decorators'],[ast.unparse(d) for d in self.current[name].decorator_list])

    def test_eight_unsplit_implementations_are_exact_original_bodies(self):
        for name in ('coverage_part_mapping','coverage_part','coverage_entry','coverage_response',
                     '_coverage_response_uncached','scope_learner_roster_entry',
                     'programme_achievement_inputs','achievement_inputs_fingerprint'):
            self.assertEqual(dump(ast.parse(SNAPSHOT[name]['source']).body[0].body),dump(self.owners[name].body),name)

    def test_all_sql_expressions_and_parameter_order_are_exact(self):
        def calls(node):
            return [ast.dump(n) for n in ast.walk(node) if isinstance(n,ast.Call)
                    and isinstance(n.func,ast.Attribute) and n.func.attr=='execute']
        for old,new in (('learner_progress_ksb_totals','progress_total_rows'),
                        ('learner_declared_ksb_codes','declaration_rows'),
                        ('progress_evidence_index','evidence_rows')):
            self.assertEqual(calls(ast.parse(SNAPSHOT[old]['source'])),calls(self.owners[new]),old)

    def test_summary_deduplication_and_evidence_projection_are_unchanged(self):
        for name,first in (('learner_progress_ksb_totals','seen'),('learner_declared_ksb_codes','declared'),('progress_evidence_index','index')):
            old=ast.parse(SNAPSHOT[name]['source']).body[0];new=self.owners[name]
            def tail(fn):
                i=next(i for i,n in enumerate(fn.body) if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id==first)
                return fn.body[i:]
            self.assertEqual(dump(tail(old)),dump(tail(new)),name)

    def test_achievement_projection_only_receives_plain_query_values_and_payload(self):
        old=ast.parse(SNAPSHOT['_achievement_projection']['source']).body[0]
        class QueryValues(ast.NodeTransformer):
            def visit_Attribute(self,node):
                if isinstance(node.value,ast.Name) and node.value.id=='request' and node.attr=='GET':
                    return ast.copy_location(ast.Name(id='query',ctx=ast.Load()),node)
                return self.generic_visit(node)
            def visit_Name(self,node):
                return ast.copy_location(ast.Name(id='query',ctx=node.ctx),node) if node.id=='request' else node
        expected=QueryValues().visit(old)
        self.assertEqual(dump(expected.body[3:]),dump(self.owners['_achievement_projection'].body))

    def test_application_has_no_http_database_or_legacy_view_edges(self):
        forbidden={'request','connection','cursor','HttpResponse','JsonResponse','json_error','settings'}
        for module in MODULES[:4]:
            tree=ast.parse(ROOT.joinpath(*module.split('.')).with_suffix('.py').read_text(encoding='utf-8'))
            self.assertFalse({n.id for n in ast.walk(tree) if isinstance(n,ast.Name)} & forbidden,module)
            self.assertFalse([n for n in ast.walk(tree) if isinstance(n,ast.Attribute) and n.attr in {'execute','cursor'}],module)

    def test_import_closure_and_explicit_dependencies(self):
        sys.path.insert(0,str(ROOT.parent.parent))
        for module in MODULES:
            text=ROOT.joinpath(*module.split('.')).with_suffix('.py').read_text(encoding='utf-8')
            for n in ast.walk(ast.parse(text)):
                if isinstance(n,ast.Import):self.assertTrue(all(a.name in {'sys','time'} for a in n.names))
                if isinstance(n,ast.ImportFrom):self.assertIn((n.level,n.module),((0,'collections'),(3,'ksb_coverage'),(3,'ksb_achievement')))
            def collect(t):
                return {x.get_name() for x in t.get_symbols() if x.is_global() and x.is_referenced()} | set().union(*(collect(c) for c in t.get_children()))
            for child in symtable.symtable(text,module,'exec').get_children():
                self.assertFalse(collect(child)-set(dir(builtins))-{'Counter','defaultdict','time','sys'},module)
            importlib.import_module('curriculum_api.reporting.'+module)
        for name in ('django','psycopg','curriculum_api.views','requests'):
            self.assertNotIn(name,sys.modules)


if __name__=='__main__':
    unittest.main()
