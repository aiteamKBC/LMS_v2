"""Frozen-source contracts for the cohesive programme read extraction; no Django."""
import ast
from copy import deepcopy
import json
from pathlib import Path
import unittest

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/programme_reads_snapshot.json').read_text(encoding='utf-8'))


def function(path, name):
    return next(n for n in _read_dependencies.source_tree(path).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


CHANGED = {'programme_workspace_module_candidates', '_build_curriculum_programme_tree_detail_payload'}


class ProgrammeReadContracts(unittest.TestCase):
    def test_unchanged_bodies_match_original_queries_and_decisions(self):
        self.assertEqual(len(SNAPSHOT), 20)
        for key, entry in SNAPSHOT.items():
            if key.split(':')[-1] in CHANGED:
                continue  # Current convergence has executable frozen-source parity tests.
            with self.subTest(function=key):
                original_source = entry['source']
                if key == 'views.py:_build_curriculum_programme_tree_detail_payload':
                    # The sole intentional orchestration change: sessions now
                    # come from the resolved programme's authored source.
                    begin = original_source.index('    session_holiday_rows = get_holiday_rows()')
                    end = original_source.index('    module_catalogue_ids = ', begin)
                    original_source = (original_source[:begin] +
                        '    sessions = read_programme_sessions(programme, visibility)\n' + original_source[end:])
                original = ast.parse(original_source).body[0]
                actual = deepcopy(function(ROOT.parent.parent.joinpath(*entry['module'].split('.')).with_suffix('.py'), original.name))
                attrs = set(entry['view_attrs'])
                class RestoreReferences(ast.NodeTransformer):
                    def visit_Name(self, node):
                        if node.id in attrs and isinstance(node.ctx, ast.Load):
                            return ast.copy_location(ast.Attribute(value=ast.Name(id='views',ctx=ast.Load()),attr=node.id,ctx=ast.Load()),node)
                        return node
                actual = RestoreReferences().visit(actual)
                # These imports stay in the compatibility adapter, and their
                # original concrete capabilities are supplied explicitly.
                original.body = [n for n in original.body if not isinstance(n,(ast.Import,ast.ImportFrom))]
                self.assertEqual([ast.dump(n) for n in original.body], [ast.dump(n) for n in actual.body])

    def test_old_signatures_and_explicit_dependency_bindings(self):
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            with self.subTest(function=key):
                public_tree = _read_dependencies.source_tree(ROOT.parent / filename)
                public_defs = {n.name: n for n in public_tree.body if isinstance(n, ast.FunctionDef)}
                if filename == 'home_summary.py' and name in {
                    '_clean', '_key', '_missing', '_zero', '_date_value',
                    'project_home_summary', 'summary_only', 'project_home',
                }:
                    exported = [a.name for n in public_tree.body if isinstance(n, ast.ImportFrom)
                                and n.module == 'catalogue.application.home_projection' for a in n.names]
                    self.assertIn(name, exported)
                    owned = function(ROOT / 'application/home_projection.py', name)
                    self.assertEqual(ast.dump(owned.args), ast.dump(ast.parse(entry['source']).body[0].args))
                    continue  # Body fidelity remains checked above, now through a direct re-export.
                moved = filename in {'home_summary.py', 'programme_list.py'}
                owner_path = ROOT.parent / ('views.py' if moved else filename)
                wrapper = function(owner_path, name) if moved else public_defs.get(name) or function(owner_path, name)
                self.assertEqual(ast.dump(wrapper.args), ast.dump(ast.parse(entry['source']).body[0].args))
                if moved:
                    wrapper = function(owner_path, name)
                if name == 'programme_workspace_module_candidates':
                    call = wrapper.body[-1].value
                    self.assertEqual(call.func.id, 'programme_module_candidates')
                    self.assertEqual({k.arg: ast.literal_eval(k.value) for k in call.keywords}, {'workspace_view': True})
                    continue
                query_import = next(n for n in wrapper.body if isinstance(n,ast.ImportFrom) and any(a.asname=='query' for a in n.names))
                self.assertEqual('curriculum_api.'+query_import.module,entry['module'])
                call = wrapper.body[-1].value
                keywords = {k.arg:ast.unparse(k.value) for k in call.keywords}
                deps = entry['deps']
                if name == '_build_curriculum_programme_tree_detail_payload':
                    deps = [dep for dep in deps if dep not in
                            ('build_sessions_basic', 'cohort_selected_holidays_by_id', 'get_holiday_rows',
                             'enrich_curriculum_modules_with_authoring_details', 'programme_authoring_modules',
                             'programme_config_modules', 'programme_workspace_module_candidates', 'slugify')]
                    self.assertEqual(keywords['read_programme_sessions'], 'read_programme_sessions')
                    self.assertEqual(keywords['programme_module_candidates'], 'programme_module_candidates')
                    self.assertEqual(keywords['programme_identifier_looks_exact'], 'programme_identifier_looks_exact')
                for dep in deps:
                    self.assertEqual(keywords[dep], dep if moved else ('views.' if dep in entry['view_attrs'] else '')+dep)

    def test_no_reverse_imports_or_new_runtime_cycles(self):
        for module in {e['module'] for e in SNAPSHOT.values()}:
            path = ROOT.parent.parent.joinpath(*module.split('.')).with_suffix('.py')
            for node in ast.walk(_read_dependencies.source_tree(path)):
                if isinstance(node,ast.Import): self.fail(ast.unparse(node))
                if isinstance(node,ast.ImportFrom):
                    self.assertIn((node.level, node.module), {(0, 'collections'), (0, 'datetime'), (2, 'domain.programme_scope')})

    def test_detail_repair_capability_stays_disabled(self):
        path=ROOT/'application/programme_detail.py'
        node=function(path,'_build_curriculum_programme_tree_detail_payload')
        calls=[n for n in ast.walk(node) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='repair_curriculum_parent_links']
        self.assertEqual(len(calls),1)
        self.assertEqual({k.arg:ast.literal_eval(k.value) for k in calls[0].keywords},{'allow_writes':False})


if __name__ == '__main__': unittest.main()
