"""Read-boundary source contracts; stdlib only, no application startup."""
import ast
import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
SNAPSHOT = json.loads((ROOT / 'directory/tests/fixtures/legacy_snapshots/progress_membership_snapshot.json').read_text(encoding='utf-8'))
PROTECTED = {'learner_assignments.py:_target': '2ae5edf1fb1804573cdfea6cf0eb759ac24f07e8b516ea04010b137a4bbee418', 'learner_assignments.py:_same_cohort': 'f8b207194a87612e3e838ce416451975c9d51d393dbbc3228e0812cadd8117e8', 'learner_assignments.py:_cohort_members': 'e66c49b8db6bac227af23139bdfaa98ffce828357a7e778c74072bd8531cec6a', 'learner_assignments.py:_assigned': '6962be1857415d269c61c7cc5786fa6c889aa1e6f322dec2d6665fe16e2f76d7', 'learner_assignments.py:_save_legacy_plan': '6783d51aacd30a62da4772e27b807d28665435004bc2e8d8c04a95d1a68cb454', 'learner_assignments.py:_module_members': 'db2a70f1ad4ac7efc8ea573c7495c4004eb6c22ceae41456584d68de51045e82', 'learner_assignments.py:_assign_module': 'b70218ba78684bf1c02f9369c35dfe3dedd34bb91864442b6ebc89024d1674bc', 'learner_assignments.py:_unassign_module': '2adef5da62f63ecd93b48f164ffaf69fcdbbdccc070eb17117695804f6f1e342', 'learner_assignments.py:_assign': '6c0a325585615a509ec790df8aac9489b2059798de05fea5a187127138520c1d', 'learner_assignments.py:_unassign': '816a0708c5531988be3603f47ff1cfd712c0d8c8329b95d8a541b6ef942e9241', 'learner_assignments.py:_handle': 'eaa2d506772e8138fc57bec4a7a816e79f0df6e2800e7f213514a5e16e2cbb1f', 'learner_assignments.py:cohort_learner_assignments': 'e331c0545257d0f2f029f9fb10e3b602f49b41b8daf7403296a7afa33f494026', 'learner_assignments.py:module_learner_assignments': '1b4e6d61f9eb69d562de1c59c05ee90180ab41b5bf5aa3e5eea6d0d703f74a63', 'learner_assignments.py:bulk_assigned_learner_counts': 'b192f66fd3d105bd9f25a0e7655ec424ac4b581a5282b351140610b0f06fe0d3', 'learner_status_counts.py:status_key': 'd9ecaa310ef7239502b945080b9a90283639066a912e9494efb3a3bc0cf654f8', 'learner_status_counts.py:plan_membership': 'ccb450d7a41c819d63e3b3f96700776755d8535946044bcb19a0f9afec669ad1', 'learner_status_counts.py:learner_facts': '9798db7d2c6fcaaaeaca9d134557443450889c899b29d4c8e86af1f6371bebcb', 'learner_status_counts.py:module_member_enrolment_ids': '4812d49fae848e18f7a994783d6e3f3095a084de14fc6725af4be2cccb1398f3', 'module_plan_rows.py:_s': '130c4783727c1c79dab833759e42f1266cba167548757d7c60e7cdaa8a746c9b', 'module_plan_rows.py:_normalized_children': '423d1494756f95e154208149ba9d7d5549293dec91cee0ed3aa332f72d55abde', 'module_plan_rows.py:add_module_row': 'd19a61f8cbba11bd9b8299caedfca28099deec347add93cfca7365c0414cc3f3', 'module_plan_rows.py:_add_normalized_children': '05b2f6d7ff8a14c971bcc44a4c59973c2ca79c1d713398af64eea99b31f8a0b2', 'module_plan_rows.py:remove_module_rows': '25aaad3c47b3a77c667cb0e6549ba5d7fafb8ca909036b7050f3001481c1df35', 'module_plan_rows.py:refresh_title_columns': '07539f709f60e420eeb0e206b77c39730912f4f4836adb75dce4196919d3aa73', 'learner_directory_details.py:activity_summary': 'd0939211f96789d304380ca7724d1166790b202b3bcb2fd05d9d58dc840acb6d', 'learner_directory_details.py:learner_progress': 'c5b9cbb4b7f93d5817d18e6a9ef6cbe1346bf7669a495660f65e04d88c6bef52', 'learner_directory_details.py:target_rows': 'a95115cc54f10094bb3c57d294f1cd64f27d82304462b45ed0aeb97c3b5fe873', 'learner_directory_details.py:membership': '6dc955e603826d0129d2e2ea727a320cd6862d927291158bb2e6dd86b0236d5e'}
OWNERS = ['directory/application/assignment_queries.py', 'directory/infrastructure/assignment_reads.py', 'directory/infrastructure/registration_reads.py', 'directory/application/status_queries.py', 'directory/infrastructure/lineage_reads.py', '../learner_api/learning_plans/infrastructure/plan_reads.py', 'directory/api/progress.py']
MIGRATED_PUBLIC_FUNCTIONS = {
    'learner_assignments.py:_assign_module',
    'learner_assignments.py:_unassign_module',
    'learner_assignments.py:_assign',
    'learner_assignments.py:_unassign',
    'learner_assignments.py:_handle',
    'module_plan_rows.py:_s',
    'module_plan_rows.py:refresh_title_columns',
}


def source_tree(path):
    import sys
    sys.path.insert(0, str(ROOT.parent))
    from curriculum_api.catalogue.tests.parity.overview_composition_oracle import restore_tree
    return restore_tree(ast.parse(path.read_text(encoding='utf-8-sig')), path.relative_to(ROOT).as_posix())


def function(path, name):
    return next(n for n in source_tree(path).body
                if isinstance(n, ast.FunctionDef) and n.name == name)


class ProgressMembershipContracts(unittest.TestCase):
    def test_public_arguments_and_decorators_are_unchanged(self):
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            old = ast.parse(entry['source']).body[0]
            actual = function(ROOT / filename, name)
            self.assertEqual(ast.dump(old.args), ast.dump(actual.args), key)
            self.assertEqual(entry['decorators'], [ast.unparse(n) for n in actual.decorator_list], key)

    def test_all_nonextracted_functions_including_writers_are_unchanged(self):
        trees = {}
        for key, digest in PROTECTED.items():
            if key in MIGRATED_PUBLIC_FUNCTIONS:
                continue
            filename, name = key.split(':')
            if filename not in trees:
                trees[filename] = {n.name: n for n in source_tree(ROOT / filename).body
                                   if isinstance(n, ast.FunctionDef)}
            self.assertEqual(hashlib.sha256(ast.dump(trees[filename][name]).encode()).hexdigest(), digest, key)

    def test_no_second_membership_policy_implementation_survives(self):
        node = function(
            ROOT / 'directory/infrastructure/membership_runtime.py',
            'members_for_lineages',
        )
        calls = [
            value for value in ast.walk(node)
            if isinstance(value, ast.Call)
            and ast.unparse(value.func) == 'learner_plans.members_for_lineages'
        ]
        self.assertEqual(len(calls), 1)

    def test_migrated_consumers_use_only_the_supported_public_boundary(self):
        for relative in ('learner_assignments.py', 'module_plan_rows.py'):
            source = source_tree(ROOT / relative)
            self.assertFalse(any(
                isinstance(node, ast.ImportFrom)
                and (
                    node.module == 'learner_api.learning_plan'
                    or (node.module == 'learner_api' and any(alias.name == 'learning_plan' for alias in node.names))
                    or (node.module or '').startswith('learner_api.learning_plans.infrastructure')
                )
                for node in ast.walk(source)
            ))
        handle = function(ROOT / 'learner_assignments.py', '_handle')
        self.assertEqual(
            sum(isinstance(node, ast.Call) and ast.unparse(node.func) == '_assignment_catalogue'
                for node in ast.walk(handle)),
            1,
        )

    def test_profile_projection_retains_exact_fields_and_conversions(self):
        old = ast.parse(SNAPSHOT['learner_assignments.py:module_assignment_roster']['source']).body[0]
        old_value = next(n.value for n in ast.walk(old) if isinstance(n, ast.Assign)
                         and any(isinstance(t, ast.Subscript) and ast.unparse(t) == 'result[key]' for t in n.targets))
        new = function(ROOT / 'directory/infrastructure/assignment_reads.py', '_profile_payload')
        self.assertEqual(ast.dump(old_value), ast.dump(new.body[0].value))

    def test_plan_count_sql_and_bridge_filter_are_exact(self):
        old = ast.parse(SNAPSHOT['learner_assignments.py:_plan_row_counts']['source']).body[0]
        old_sql = next(n for n in ast.walk(old) if isinstance(n, ast.Constant) and isinstance(n.value, str) and 'SELECT' in n.value)
        new = function(ROOT / 'directory/infrastructure/assignment_reads.py', '_plan_row_counts')
        new_sql = next(n for n in ast.walk(new) if isinstance(n, ast.Constant) and isinstance(n.value, str) and 'SELECT' in n.value)
        self.assertEqual(old_sql.value, new_sql.value)

    def test_dependency_direction_and_no_writer_operations_in_read_owners(self):
        for relative in OWNERS + ['directory/application/progress.py']:
            p = ROOT / relative
            for n in ast.walk(ast.parse(p.read_text(encoding='utf-8-sig'))):
                if isinstance(n, ast.ImportFrom):
                    self.assertNotIn('views', [a.name for a in n.names], relative)
                    if '/application/' in relative or '/domain/' in relative:
                        self.assertFalse((n.module or '').startswith(('django', 'config')), relative)
                        self.assertNotIn('infrastructure', (n.module or '').split('.'), relative)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute):
                    self.assertNotIn(n.func.attr, {'save', 'create', 'bulk_create', 'delete', 'select_for_update'}, relative)


if __name__ == '__main__':
    unittest.main()
