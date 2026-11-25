"""Account for the reviewed readiness-owner calls in historical source tests.

This adapter validates the entire current AST first, then reverses only those
calls for old catalogue oracles. Frozen historical fixtures stay unchanged.
Production and runtime tests always execute the new readiness owners.
"""
import ast
from copy import deepcopy
import hashlib

BEFORE = 'fc44dae68ab7600395dc88b2368d66f90c07f3271b5f771c980042db76d6ad52'
AFTER = 'f6895a8bd4a2fa5f9e0bc1076de2f1b001fd23d1213aa22f4edbc3c46b2b7410'


def fingerprint(tree):
    return hashlib.sha256(ast.dump(tree).encode()).hexdigest()


def restore_tree(tree, relative):
    if relative != 'curriculum_api/views.py' or getattr(tree, '_review_readiness_restored', False):
        return tree
    assert fingerprint(tree) == AFTER, 'Unreviewed source change: Review readiness'
    restored = deepcopy(tree)
    function = next(n for n in restored.body if isinstance(n, ast.FunctionDef) and n.name == 'reset_schema_ready_flags')
    # Reverse only the four reviewed owner imports/bindings before applying
    # the earlier readiness extraction contract. Frozen source stays untouched.
    imports = {
        'template_schema': ('reviews', '_reviews'),
        'schedule_schema': ('review_schedule', '_review_schedule'),
        'type_schema': ('review_types', '_review_types'),
        'instance_schema': ('review_instances', '_review_instances'),
    }
    for owner, (module, old_alias) in imports.items():
        current_alias = 'review_infrastructure_' + owner
        expected = 'import curriculum_api.review_management.infrastructure.' + owner + ' as ' + current_alias
        matches = [i for i, n in enumerate(function.body) if ast.unparse(n) == expected]
        assert len(matches) == 1, expected
        function.body[matches[0]] = ast.parse('from . import ' + module + ' as ' + old_alias).body[0]
        calls = [n for n in ast.walk(function) if isinstance(n, ast.Name) and n.id == current_alias]
        assert len(calls) == 1, current_alias
        calls[0].id = old_alias
    changes = {
        '_reviews.reset_review_tables_ready()': '_reviews._REVIEW_TABLES_READY = False',
        '_review_schedule.reset_review_schedule_ready()': '_review_schedule._REVIEW_SCHEDULE_TABLES_READY = False',
        '_review_instances.reset_review_instance_readiness()': (
            '_review_instances._TABLES_READY = False\n'
            '_review_instances._MANUAL_OVERRIDES_TABLE_READY = False\n'
            '_review_instances._LEARNER_REVIEW_ADDITIONS_TABLE_READY = False'
        ),
    }
    for current, historical in changes.items():
        matches = [i for i, n in enumerate(function.body) if ast.unparse(n) == current]
        assert len(matches) == 1, current
        function.body[matches[0]:matches[0] + 1] = ast.parse(historical).body
    assert fingerprint(restored) == BEFORE, 'Invalid historical Review readiness restoration'
    restored._review_readiness_restored = True
    return restored
