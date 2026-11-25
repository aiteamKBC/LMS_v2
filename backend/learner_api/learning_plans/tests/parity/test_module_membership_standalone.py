"""DB-free application and exact SQL-reader contract tests; no Django startup.

The infrastructure function is compiled intact with a synthetic DatabaseError.
Its only import is checked explicitly. The old SQL oracle was frozen before B02.
Actual module imports and SQL execution are covered by the isolated Docker suite.
"""
import ast
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))
from learner_api.learning_plans.application.module_membership import module_member_enrolment_ids
from learner_api.learning_plans.tests.parity import test_membership_integration_standalone as oracle

INFRA = BACKEND / 'learner_api/learning_plans/infrastructure'
snapshot = (Path(__file__).resolve().parents[1] / 'fixtures/legacy_snapshots/learner_facts_prebatch02.json').read_bytes()
assert hashlib.sha256(snapshot).hexdigest() == '0a82781326dd696a2ab622350688ddbfef7c6e6dd667bc09fb2b0d8ad99c4376'
old_node = ast.parse(json.loads(snapshot)['source']).body[0]
source = ast.parse((INFRA / 'membership_facts.py').read_text(encoding='utf-8'))
assert [ast.unparse(n) for n in ast.walk(source) if isinstance(n, (ast.Import, ast.ImportFrom))] == ['from django.db import DatabaseError']
new_node = next(n for n in source.body if isinstance(n, ast.FunctionDef))


class DatabaseError(Exception):
    pass


class Cursor:
    description = [('id',), ('enrolment_id',), ('explicit',), ('module_ids',)]

    def __init__(self, rows, error=None):
        self.rows, self.error, self.calls = rows, error, []

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def execute(self, sql, params):
        self.calls.append((sql, params))
        if self.error:
            raise self.error

    def fetchall(self):
        return self.rows


def run_facts(node, modules, profiles=None, *, columns=None, vendor='postgresql', exists=True, error=None):
    cursor = Cursor([(2, '0', True, ['M']), (1, None, False, [])], error)
    trace = []
    columns = {'id', 'lifecycle_status', 'programme_status', 'programme_id', 'cohort_id', 'group_id', 'enrolment_id'} if columns is None else columns
    def check(table):
        trace.append(('exists', table))
        return exists
    def names(table):
        trace.append(('columns', table))
        return columns
    connection = SimpleNamespace(vendor=vendor, cursor=lambda: cursor)
    definition = deepcopy(node)
    env = {'DatabaseError': DatabaseError}
    if node is old_node:
        imports = [n for n in ast.walk(definition) if isinstance(n, (ast.Import, ast.ImportFrom))]
        assert [ast.unparse(n) for n in imports] == ['from . import views']
        definition.body.remove(imports[0])
        env['views'] = SimpleNamespace(connection=connection, learner_schema_table_exists=check, learner_schema_columns=names)
        kwargs = {}
    else:
        assert not any(isinstance(n, (ast.Import, ast.ImportFrom)) for n in ast.walk(definition))
        kwargs = dict(connection=connection, table_exists=check, columns_for=names)
    exec(compile(ast.Module(body=[definition], type_ignores=[]), '<facts-contract>', 'exec'), env)
    try:
        result = ('ok', env['learner_facts'](modules, profiles, **kwargs))
    except Exception as exc:
        result = ('error', type(exc), str(exc))
    return result, trace, cursor.calls


class ReadBoundaryTests(unittest.TestCase):
    def parity(self, modules, profiles=None, **kwargs):
        old = run_facts(old_node, modules, profiles, **kwargs)
        new = run_facts(new_node, modules, profiles, **kwargs)
        self.assertEqual(old, new)  # Exact SQL text, parameter order, output and errors.
        return new

    def test_normalized_query_and_row_order(self):
        result, _, calls = self.parity({'Z', 'M'})
        self.assertEqual([row['id'] for row in result[1]], [2, 1])
        sql, params = calls[0]
        self.assertEqual(params, [['M', 'Z']])
        self.assertIn('count(*) > 0 AS explicit', sql)
        self.assertIn('array_agg(DISTINCT plan.curriculum_module_id)', sql)
        self.assertNotIn('training_plan AS', sql)

    def test_optional_columns(self):
        result, _, calls = self.parity({'M'}, columns={'id', 'lifecycle_status'})
        self.assertEqual(result[0], 'ok')
        self.assertIn('NULL AS enrolment_id', calls[0][0])
        self.assertNotIn('LEFT JOIN curriculum.', calls[0][0])

    def test_empty_modules_skip_plan_join(self):
        for modules in (set(), None):
            with self.subTest(modules=modules):
                _, _, calls = self.parity(modules)
                self.assertNotIn('JOIN LATERAL', calls[0][0])
                self.assertEqual(calls[0][1], [])

    def test_profile_filters_and_parameter_order(self):
        for profiles in ([], ['2', 1, 2, 0], ['bad']):
            with self.subTest(profiles=profiles):
                result, _, calls = self.parity({'M'}, profiles)
                if profiles == ['bad']:
                    self.assertEqual(result[1], ValueError)
                    self.assertFalse(calls)
                else:
                    self.assertEqual(calls[0][1], [['M'], sorted({int(v) for v in profiles})])

    def test_schema_errors_before_cursor(self):
        for kwargs in ({'vendor': 'sqlite'}, {'exists': False}, {'columns': {'id'}}):
            with self.subTest(kwargs=kwargs):
                result, _, calls = self.parity({'M'}, **kwargs)
                self.assertEqual(result[1], DatabaseError)
                self.assertFalse(calls)

    def test_driver_error_propagates(self):
        result, _, calls = self.parity({'M'}, error=DatabaseError('synthetic cursor failure'))
        self.assertEqual(result, ('error', DatabaseError, 'synthetic cursor failure'))
        self.assertEqual(len(calls), 1)

    def test_application_missing_target_short_circuits(self):
        def forbidden(*args):
            self.fail('Missing target must not load facts or candidates')
        self.assertIsNone(module_member_enrolment_ids('M', read_lineages=lambda *args: {},
            read_facts=forbidden, programme_identifier=forbidden, programme_candidates=forbidden))

    def test_actual_application_bridge_and_duplicate_parity(self):
        facts = [oracle.parity.fact(profile=i, bridge=bridge) for i, bridge in
                 enumerate([None, 0, '0', 17, '17', False, '', 19])]
        for rows in (facts, list(reversed(facts)), [], facts + facts):
            old = oracle.reader('old', rows, {'M': oracle.parity.TARGET})[0]
            actual = oracle.reader('actual', rows, {'M': oracle.parity.TARGET})[0]
            self.assertEqual(actual('M'), old('M'))
        self.assertEqual(oracle.reader('actual', facts, {'M': oracle.parity.TARGET})[0]('M'), {'0', '17', '19'})

    def test_dependency_failure_identity(self):
        failure = RuntimeError('synthetic reader failure')
        def fail(*args):
            raise failure
        with self.assertRaises(RuntimeError) as caught:
            module_member_enrolment_ids('M', read_lineages=fail, read_facts=fail,
                                       programme_identifier=fail, programme_candidates=fail)
        self.assertIs(caught.exception, failure)

    def test_pure_import_boundary(self):
        self.assertFalse(any(n == 'django' or n.startswith('django.') for n in sys.modules))
        tree = ast.parse(Path(sys.modules[module_member_enrolment_ids.__module__].__file__).read_text())
        self.assertEqual([ast.unparse(n) for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))],
                         ['from learner_api.learning_plans.domain import membership_policy'])


if __name__ == '__main__':
    unittest.main()
