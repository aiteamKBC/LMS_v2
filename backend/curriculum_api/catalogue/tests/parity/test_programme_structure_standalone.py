"""Standalone source-oracle and synthetic parity; never imports Django."""
import ast
from collections import Counter
from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import Mock

import importlib.util as _read_dependencies_util
_read_dependencies_spec = _read_dependencies_util.spec_from_file_location('read_dependencies_oracle', Path(__file__).with_name('read_dependencies_oracle.py'))
_read_dependencies = _read_dependencies_util.module_from_spec(_read_dependencies_spec)
_read_dependencies_spec.loader.exec_module(_read_dependencies)

ROOT = Path(__file__).resolve().parents[2]
ORIGINAL = json.loads((ROOT / 'tests/fixtures/legacy_snapshots/programme_structure_snapshot.json').read_text())
SPEC = importlib.util.spec_from_file_location('structure_query', ROOT / 'application/programme_structure.py')
NEW = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(NEW)


def dependencies():
    return dict(clean_str=lambda v: str(v or '').strip(), normalise=lambda v: str(v or '').strip().lower(),
                programme_deleted_row=lambda r: bool(r.get('deleted_at')),
                COHORT_AUTHORING_DETAILS_TABLE='cohorts', COHORT_ROWS_ORDER='cohort_id',
                GROUPS_TABLE='groups', GROUP_ROWS_ORDER='group_id',
                authoring_fetch_all=Mock(side_effect=RuntimeError('unavailable')),
                logger=Mock(), active_week_rows=lambda rows: [r for r in rows if not r.get('deleted_at')],
                AUTHORING_WEEKS_TABLE='weeks', WEEK_INDEX_COLUMNS=('id', 'module_catalogue_id'),
                module_index_rows=Mock(side_effect=RuntimeError('unavailable')),
                module_stored_week_count=lambda row, count: count or row.get('fallback_weeks', 0))


class ProgrammeStructureParity(unittest.TestCase):
    def compare(self, source):
        deps = dependencies()
        old = dict(deps, Counter=Counter)
        exec(compile('\n'.join(ORIGINAL.values()), '<frozen-existing-source>', 'exec'), old)
        expected = old['authoring_programme_structure_counts'](source=deepcopy(source))
        actual = NEW.authoring_programme_structure_counts(source=deepcopy(source), **deps)
        self.assertEqual(actual, expected)
        return actual

    def test_exact_original_bodies(self):
        tree = _read_dependencies.source_tree(ROOT / 'application/programme_structure.py')
        for node in tree.body:
            if isinstance(node, ast.FunctionDef):
                original = ast.parse(ORIGINAL[node.name]).body[0]
                self.assertEqual([ast.dump(n) for n in node.body], [ast.dump(n) for n in original.body])

    def test_wrapper_contracts(self):
        tree = _read_dependencies.source_tree(ROOT.parent / 'views.py')
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in ORIGINAL:
                self.assertEqual(ast.dump(node.args), ast.dump(ast.parse(ORIGINAL[node.name]).body[0].args))
                self.assertEqual(node.body[1].module, 'catalogue.application.programme_structure')
                if node.name == 'authoring_programme_structure_counts':
                    self.assertEqual([ast.unparse(d) for d in node.decorator_list], ['scoped_curriculum_read'])

    def test_id_priority_name_fallback_deleted_archived_and_weeks(self):
        source = dict(cohorts=[{'programme_id':' P ', 'programme_name':'other'},
                               {'programme_name':' Name '}, {'programme_id':'P','status':'ARCHIVED'}],
                      groups=[{'programme_id':'P','deleted_at':'stamp'}, {}],
                      modules=[{'programme_id':'P','module_catalogue_id':'M'},
                               {'programme_name':'Name','fallback_weeks':3},
                               {'programme_id':'P','deleted_at':'stamp'}],
                      weeks=[{'module_catalogue_id':'M'}, {'module_catalogue_id':'M'},
                             {'module_catalogue_id':'M','deleted_at':'stamp'}])
        by_id, by_name = self.compare(source)
        self.assertEqual(by_id['P'], dict(cohorts=1,groups=0,modules=1,weeks=2))
        self.assertEqual(by_name['name']['weeks'], 3)
        self.assertNotIn('other', by_name)

    def test_empty_and_missing_sources(self):
        for source in (None, {}, dict(cohorts=[],groups=[],modules=[],weeks=[])):
            with self.subTest(source=source): self.assertEqual(self.compare(source), ({},{}))

    def test_partial_failure_and_duplicate_rows(self):
        by_id, _ = self.compare(dict(cohorts=[{'programme_id':'P'}, None], groups=[],
                                    modules=[{'programme_id':'P'}]*2, weeks=[]))
        self.assertEqual(by_id['P']['cohorts'], 1)
        self.assertEqual(by_id['P']['modules'], 2)

    def test_selection_priority_missing_and_empty_states(self):
        deps=dependencies(); old=dict(deps,Counter=Counter)
        exec(compile('\n'.join(ORIGINAL.values()), '<frozen-existing-source>', 'exec'),old)
        by_id={'P':dict(modules=2),'Q':dict(modules=3)}; by_name={'name':dict(modules=4)}
        for programme in (None, {}, {'sourceId':' P ','id':'Q','name':'Name'}, {'id':'Q'}, {'name':' Name '}):
            expected=old['programme_structure_counts'](programme,by_id,by_name)
            actual=NEW.programme_structure_counts(programme,by_id,by_name,clean_str=deps['clean_str'],
                      normalise=deps['normalise'],authoring_programme_structure_counts=Mock(side_effect=AssertionError))
            self.assertEqual(actual,expected)

    def test_dependency_direction(self):
        tree=_read_dependencies.source_tree(ROOT / 'application/programme_structure.py')
        imports=[ast.unparse(n) for n in ast.walk(tree) if isinstance(n,(ast.Import,ast.ImportFrom))]
        self.assertEqual(imports,['from collections import Counter'])


if __name__ == '__main__': unittest.main()
