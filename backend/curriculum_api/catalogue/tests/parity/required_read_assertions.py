"""Narrow exceptions to historical source parity for the approved error-policy fix.

Actual runtime failures/successes are exercised by test_required_read_failures_no_db.
Frozen snapshots stay unchanged; unrelated statements must still match exactly.
"""
import ast
from copy import deepcopy


CHANGED = frozenset({'active_learner_delivery_counts', 'cohort_authoring_detail_rows',
                     'group_authoring_detail_rows', 'table_exists', 'get_holiday_rows_safe',
                     'get_staff_profile_rows', 'get_authoring_module_rows',
                     'safe_module_index_rows', 'safe_authoring_module_rows',
                     'learner_schema_table_exists', 'learner_schema_columns'})


def assert_success_contract(test, old, new):
    test.assertIn(old.name, CHANGED)
    test.assertEqual(ast.dump(old.args), ast.dump(new.args), old.name)
    test.assertEqual([ast.dump(n) for n in old.decorator_list], [ast.dump(n) for n in new.decorator_list])
    if old.name == 'safe_module_index_rows':
        test.assertEqual(len(new.body), 2)
        test.assertEqual(ast.unparse(new.body[-1]), 'return get_authoring_module_rows()')
        return
    if old.name == 'get_staff_profile_rows':
        test.assertEqual(len(new.body), 3)
        test.assertIsInstance(new.body[1], ast.ImportFrom)
        test.assertEqual(new.body[1].module, 'curriculum_api.catalogue.infrastructure.staff_directory')
        call = new.body[2].value
        test.assertEqual(call.func.id, 'read_staff_profile_rows')
        test.assertEqual([ast.unparse(n) for n in call.args], ['role', 'include_archived'])
        test.assertEqual({n.arg: ast.unparse(n.value) for n in call.keywords}, {
            'enrolment_available': "'enrolment' in connections",
            'fetch_staff_users_by_access': 'fetch_staff_users_by_access',
            'staff_user_profile_source': 'staff_user_profile_source',
            'staff_profile_is_archived': 'staff_profile_is_archived',
        })
        return
    old, new = deepcopy(old), deepcopy(new)
    # Only the calendar compatibility helper's documentation/import changed.
    if old.name == 'get_holiday_rows_safe':
        test.assertEqual(new.body[1].module, 'curriculum_api.catalogue.application.read_errors')
        new.body.pop(1)
        new.body[0] = deepcopy(old.body[0])
    prior = next(n for n in old.body if isinstance(n, ast.Try))
    current = next(n for n in new.body if isinstance(n, ast.Try))
    test.assertIn(len(current.handlers), (1, 2))
    if len(current.handlers) == 2:
        test.assertEqual(current.handlers[0].type.id, 'CatalogueReadUnavailable')
        test.assertEqual(ast.dump(current.handlers[0].body[0]), ast.dump(ast.Raise()))
    handler = current.handlers[-1]
    test.assertEqual(len(handler.body), 1)
    failure = handler.body[0]
    test.assertIsInstance(failure, ast.Raise)
    test.assertEqual(failure.exc.func.id, 'CatalogueReadUnavailable')
    test.assertEqual(failure.cause.id, 'exc')
    # This restores only the checked error handler for the success-path comparison.
    current.handlers = deepcopy(prior.handlers)
    test.assertEqual(ast.dump(new), ast.dump(old), old.name)


def assert_module_contract(test, old, new):
    prior = {n.name: n for n in old.body if isinstance(n, ast.FunctionDef)}
    checked = deepcopy(new)
    statements = []
    for node in checked.body:
        if isinstance(node, ast.ImportFrom) and node.module in {
            'read_errors', 'curriculum_api.catalogue.application.read_errors',
        }:
            test.assertEqual([n.name for n in node.names], ['CatalogueReadUnavailable'])
            continue
        if isinstance(node, ast.FunctionDef) and node.name in CHANGED and node.name in prior:
            if ast.dump(node) != ast.dump(prior[node.name]):
                assert_success_contract(test, prior[node.name], node)
                node = deepcopy(prior[node.name])
        statements.append(node)
    checked.body = statements
    test.assertEqual(ast.dump(checked), ast.dump(old))
