"""Static extraction proofs and import closure; no Django or database startup."""
import ast
import builtins
import symtable
import importlib
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/snapshot.json').read_text(encoding='utf-8'))
MODULES = ('domain.ksb', 'domain.otjh', 'application.activity',
           'application.consumption', 'infrastructure.progress', 'infrastructure.reflections')


def parse(path):
    return ast.parse(path.read_text(encoding='utf-8-sig'))


def bodies(nodes):
    return [ast.dump(n) for n in nodes]


class ReportingExtractionContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = {n.name: n for n in parse(ROOT.parent / 'views.py').body
                       if isinstance(n, ast.FunctionDef)}
        cls.owned = {n.name: n for module in MODULES
                     for n in parse(ROOT.joinpath(*module.split('.')).with_suffix('.py')).body
                     if isinstance(n, ast.FunctionDef)}

    def test_nineteen_unsplit_bodies_are_exact_originals(self):
        names = set(SNAPSHOT) - {'learner_progress_ksb_consumption', 'reflection_submission_ksb_consumption'}
        self.assertEqual(len(names), 19)
        for name in sorted(names):
            original = ast.parse(SNAPSHOT[name]['source']).body[0]
            self.assertEqual(bodies(original.body), bodies(self.owned[name].body), name)

    def test_all_owner_globals_are_explicit_or_standard_library(self):
        for module in MODULES:
            text = ROOT.joinpath(*module.split('.')).with_suffix('.py').read_text(encoding='utf-8')
            table = symtable.symtable(text, module, 'exec')
            def collect(scope):
                return ({s.get_name() for s in scope.get_symbols() if s.is_global() and s.is_referenced()}
                        | set().union(*(collect(c) for c in scope.get_children())))
            allowed = set(dir(builtins)) | {'re', 'defaultdict'}
            for child in table.get_children():
                self.assertFalse(collect(child) - allowed, (module, child.get_name(), collect(child) - allowed))

    def test_all_public_signatures_and_decorators_are_preserved(self):
        for name, entry in SNAPSHOT.items():
            old = ast.parse(entry['source']).body[0]
            self.assertEqual(ast.dump(old.args), ast.dump(self.current[name].args), name)
            self.assertEqual(entry['decorators'], [ast.unparse(n) for n in self.current[name].decorator_list])

    def test_progress_only_changes_the_availability_port_and_error_import(self):
        old = ast.parse(SNAPSHOT['learner_progress_ksb_consumption']['source']).body[0]
        new = self.owned[old.name]
        # Original docstring, two availability guards, then the unchanged projection.
        expected = old.body[3:]
        for node in expected:
            for child in ast.walk(node):
                if isinstance(child, ast.ImportFrom) and child.module == 'progress_errors':
                    child.level = 3
        self.assertEqual(bodies(expected), bodies(new.body[2:]))
        self.assertEqual(ast.unparse(new.body[1].test), 'not learner_ids or not progress_source_available()')

    def test_reflection_projection_and_identity_mapping_are_original(self):
        old = ast.parse(SNAPSHOT['reflection_submission_ksb_consumption']['source']).body[0]
        new = self.owned[old.name]
        def assignment_index(nodes, name):
            return next(i for i, n in enumerate(nodes) if isinstance(n, ast.Assign)
                        and any(isinstance(t, ast.Name) and t.id == name for t in n.targets))
        oi, ni = [assignment_index(n.body, 'learners_by_profile_id') for n in (old,new)]
        oq = assignment_index(old.body, 'select_columns')
        nq = assignment_index(new.body, 'rows')
        self.assertEqual(bodies(old.body[oi:oq]), bodies(new.body[ni:nq]))
        op, np = [assignment_index(n.body, 'code_filter') for n in (old,new)]
        self.assertEqual(bodies(old.body[op:]), bodies(new.body[np:]))
        # SQL moves without changing its expressions, ordering or exception policy.
        query = ast.Module(body=old.body[oq:op], type_ignores=[])
        class EmptyToUnavailable(ast.NodeTransformer):
            def visit_Return(self, node):
                return ast.copy_location(ast.Return(value=ast.Constant(None)), node)
        expected = EmptyToUnavailable().visit(query).body
        self.assertEqual(bodies(expected), bodies(self.owned['reflection_rows'].body[:-1]))

    def test_owners_import_without_django_or_external_clients(self):
        sys.path.insert(0, str(ROOT.parent.parent))
        for module in MODULES:
            tree = parse(ROOT.joinpath(*module.split('.')).with_suffix('.py'))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    self.assertEqual([a.name for a in node.names], ['re'])
                if isinstance(node, ast.ImportFrom):
                    self.assertIn((node.level, node.module), ((0, 'collections'), (3, 'progress_errors')))
            importlib.import_module('curriculum_api.reporting.' + module)
        for module in ('django','psycopg','requests','curriculum_api.views'):
            self.assertNotIn(module, sys.modules)

    def test_domain_and_application_have_no_storage_or_transport_edges(self):
        forbidden = {'connection','cursor','execute','settings','request','JsonResponse',
                     'learner_schema_columns','learner_schema_table_exists'}
        for module in MODULES[:4]:
            tree = parse(ROOT.joinpath(*module.split('.')).with_suffix('.py'))
            self.assertFalse({n.id for n in ast.walk(tree) if isinstance(n,ast.Name)} & forbidden, module)
            self.assertFalse([n for n in ast.walk(tree) if isinstance(n,ast.Attribute) and n.attr in {'cursor','execute'}], module)


if __name__ == '__main__':
    unittest.main()
