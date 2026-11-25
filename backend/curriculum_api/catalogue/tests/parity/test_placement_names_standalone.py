"""Pure label parity against actual frozen source; no Django or IO imports."""
import ast
import copy
import hashlib
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT.parent))
from curriculum_api.catalogue.domain import placement_labels as labels
from curriculum_api.catalogue.tests.parity import placement_names_oracle as oracle


def original_tree(file):
    return oracle.restore_tree(ast.parse((ROOT / file).read_text(encoding='utf-8')), file)


def original_labels():
    names = {'NAME_FIELDS', 'LIST_FIELDS', 'EMPTY_FIELDS', 'ROW_FIELDS', 'COACH_SEPARATOR',
             '_text', '_names', '_group_coach_names', '_index', '_lists'}
    nodes = [n for n in original_tree('curriculum_names.py').body
             if isinstance(n, ast.FunctionDef) and n.name in names
             or isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in n.targets)]
    env = {'is_inactive': labels.is_inactive}
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), '<original-labels>', 'exec'), env)
    return env


def facts():
    return {'programmes': {'P': {'name': 'Programme'}},
            'cohorts': {'C': {'name': 'Cohort', 'programme_id': 'P'}},
            'groups': {'G': {'name': 'Group', 'cohort_id': 'C', 'coach_ids': ['K2', 'K1']}},
            'coaches': {'K1': {'name': 'First'}, 'K2': {'name': 'Second'}},
            'tutors': {'T': {'name': 'Tutor', 'email': 'synthetic@example.invalid'}},
            'modules': {'M2': {'title': 'Same', 'group_id': 'G', 'cohort_id': 'C', 'tutor_id': 'T'},
                        'M1': {'title': 'Same', 'group_id': 'G', 'cohort_id': 'C', 'tutor_id': 'T'},
                        'X': {'title': 'Archived', 'group_id': 'G', 'cohort_id': 'C', 'status': 'archived'}}}


class PlacementNamesContracts(unittest.TestCase):
    def test_exact_diff_and_original_source_integrity(self):
        self.assertEqual(hashlib.sha256(oracle.SNAPSHOT_PATH.read_bytes()).hexdigest(),
                         '9f1cdd54ac5b73b86c1f0bc1838088dc164001b7f5bb10553b95735b370097e4')
        for relative, entry in oracle.SNAPSHOT['source_changes'].items():
            current = ast.parse((ROOT / relative).read_text(encoding='utf-8'))
            from curriculum_api.catalogue.tests.parity.entry_composition_oracle import restore_tree
            current = restore_tree(current, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in current.body], entry['after'], relative)
            old = oracle.restore_tree(current, relative)
            self.assertEqual([hashlib.sha256(ast.dump(n).encode()).hexdigest() for n in old.body], entry['order'], relative)

    def test_pure_function_bodies_and_signatures_are_unchanged(self):
        old = {n.name: n for n in original_tree('curriculum_names.py').body if isinstance(n, ast.FunctionDef)}
        for n in ast.parse((ROOT / 'catalogue/domain/placement_labels.py').read_text()).body:
            if isinstance(n, ast.FunctionDef):
                self.assertEqual(ast.dump(n), ast.dump(old[n.name]), n.name)

    def test_sql_cache_and_staff_writes_remain_exact(self):
        old = {n.name: n for n in original_tree('curriculum_names.py').body if isinstance(n, ast.FunctionDef)}
        for file, names in (
            ('curriculum_names.py', ('staff_id', 'store_staff')),
            ('catalogue/infrastructure/placement_reads.py', ('lookups', '_optional_tables', 'standards_digest',
                'name_of', 'invalidate', 'invalidate_for', 'begin_request', 'end_request', 'programme_name_sql', 'cohort_name_sql'))):
            new = {n.name: n for n in ast.parse((ROOT / file).read_text()).body if isinstance(n, ast.FunctionDef)}
            for name in names:
                self.assertEqual(ast.dump(new[name]), ast.dump(old[name]), name)

    def test_label_fields_missing_ids_whitespace_and_multiple_coaches(self):
        old = original_labels()
        for table in ('modules', 'groups', 'cohorts'):
            for row in ({}, {'programme_id': '\u2003P\t', 'cohort_id': 'C', 'group_id': 'G', 'tutor_id': 'T'},
                        {'programme_id': 'missing', 'group_id': None}):
                with self.subTest(table=table, row=row):
                    self.assertEqual(labels._names(table, row, facts()), old['_names'](table, row, facts()))
        self.assertEqual(labels._group_coach_names(facts(), 'G'), ['Second', 'First'])

    def test_single_coach_compatibility_and_empty_names(self):
        old = original_labels()
        for group in ({'coach_id': 'K1'}, {}, {'coach_ids': ['missing', 'K2', 'K2']}):
            data = facts(); data['groups']['G'] = group
            for row_id in (None, ' K1 ', 'missing'):
                self.assertEqual(labels._group_coach_names(data, 'G', row_id), old['_group_coach_names'](data, 'G', row_id))

    def test_live_child_lists_statuses_and_stable_ties(self):
        old = original_labels()
        for status in (None, '', 'active', 'inactive', 'archived', 'deleted'):
            data = facts(); data['modules']['X']['status'] = status
            for table, row in (('groups', {'group_id': 'G'}), ('cohorts', {'cohort_id': 'C'}),
                               ('tutors', {'id': 'T'}), ('coaches', {'id': 'K1'}), ('groups', {})):
                self.assertEqual(labels._lists(table, row, copy.deepcopy(data)), old['_lists'](table, row, copy.deepcopy(data)))
        self.assertEqual(labels._lists('groups', {'group_id': 'G'}, facts())['module_ids'], ['M1', 'M2'])

    def test_cached_index_and_returned_lists_keep_existing_mutability_contract(self):
        data = facts(); first = labels._index(data)
        self.assertIs(first, labels._index(data))
        row = {'group_id': 'G'}
        one = labels._lists('groups', row, data); one['module_ids'].append('local')
        self.assertEqual(labels._lists('groups', row, data)['module_ids'], ['M1', 'M2'])

    def test_boundary_imports_do_not_return_to_legacy_facades(self):
        forbidden = ('curriculum_api.views', 'curriculum_api.curriculum_names', 'curriculum_api.calendar_holidays')
        for file in ('catalogue/infrastructure/placement_reads.py', 'catalogue/domain/placement_labels.py'):
            tree = ast.parse((ROOT / file).read_text())
            imports = [n.module or '' for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
            self.assertFalse(set(imports).intersection(forbidden))
        self.assertEqual([n.module for n in ast.walk(ast.parse((ROOT / 'catalogue/domain/placement_labels.py').read_text()))
                          if isinstance(n, ast.ImportFrom)], ['archive_policy'])


if __name__ == '__main__':
    unittest.main()
