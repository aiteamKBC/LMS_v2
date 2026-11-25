"""Actual frozen-source parity for reporting, executed only in isolated Django."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import json
from pathlib import Path
from types import FunctionType
import unittest
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from curriculum_api import views
from curriculum_api.reporting.tests import tests_ksb_achievement as ksb_fixtures, tests_scope_achievement as scope_fixtures
from curriculum_api.progress_errors import LearnerProgressUnavailable
from curriculum_api.reporting.application import consumption
from curriculum_api.reporting.infrastructure import progress, reflections

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'reporting/tests/fixtures/legacy_snapshots/snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_reporting():
    """Original bodies and original-to-original calls, with current mock bindings."""
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-reporting>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = eval(decorator, vars(views))(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


@contextmanager
def capture_results():
    records = []
    def record(name, fn):
        def call(*args, **kwargs):
            result = fn(*args, **kwargs)
            records.append((name, deepcopy(result)))
            return result
        return call
    with ExitStack() as stack:
        for name in SNAPSHOT:
            stack.enter_context(composition_fixture(views, name, record(name, getattr(views, name))))
        yield records


class OriginalFixtureParity(SimpleTestCase):
    """Run reviewed synthetic fixtures through both real implementations."""


def parity_case(case_class, method):
    def test(self):
        def run():
            with capture_results() as records:
                result = unittest.TestResult()
                case_class(method).run(result)
            self.assertTrue(result.wasSuccessful(), str(result.errors + result.failures))
            self.assertEqual(result.skipped, [])
            return records
        current = run()
        with original_reporting():
            original = run()
        self.assertEqual(current, original)
        self.assertTrue(current, 'Fixture must invoke actual extracted reporting code')
    return test


for module in (ksb_fixtures, scope_fixtures):
    for class_name, case in vars(module).items():
        if not isinstance(case, type) or case.__module__ != module.__name__ or not issubclass(case, SimpleTestCase):
            continue
        if class_name in {'ScopePlacementLineageTests', 'ScopedRosterTests'}:
            continue  # Existing placement tests still run separately; no reporting call here.
        for method in unittest.defaultTestLoader.getTestCaseNames(case):
            setattr(OriginalFixtureParity, 'test_' + class_name + '_' + method[5:], parity_case(case, method))


# Do not expose the loop variable as an additional discoverable test class.
del module, class_name, case, method


class ReportingReadContracts(SimpleTestCase):
    def compare(self, call):
        current = call()
        with original_reporting():
            original = call()
        self.assertEqual(current, original)
        return current

    def test_scope_predicate_whitelist_order_and_bound_values(self):
        for column in ('module_ref', 'unreviewed_column', ''):
            self.compare(lambda: views.progress_scope_predicate({' B ', 'A'}, column, 'MOD'))

    def test_outcome_predicate_keeps_null_and_rejects_failed_or_unresolved(self):
        for rows in ([], [('quiz', None), ('component', False)],
                     [('component', None), ('quiz', True), ('quiz', False)]):
            def run():
                cursor = ksb_fixtures.FakeCursor(('kind', 'passed'), rows)
                result = views.achieved_outcome_predicate(cursor, [19])
                return result, cursor.executed
            self.compare(run)

    def test_progress_array_unfolding_sql_parameters_and_empty_ksb_activity(self):
        columns = ('learner_id', 'progress_id', 'ksb_codes', 'ksb_weights', 'ksb_classes')
        rows = [(19, 2, ['K1', 'S2'], [50, 25], ['hard', 'soft']), (19, 1, None, None, None)]
        for codes in (None, ['K1']):
            def run():
                cursor = ksb_fixtures.FakeCursor(columns, rows)
                with composition_fixture(views, 'connection', ksb_fixtures.FakeConnection(cursor)), \
                     composition_fixture(views, 'and_not_excluded', return_value=' and not k.is_excluded'):
                    value = views.progress_consumption_rows([19], codes, ('p.module_ref = %s', ['MOD']))
                return value, cursor.executed
            value, _sql = self.compare(run)
            self.assertEqual(len(value), 3)
            self.assertIsNone(value[-1]['ksb_code'])

    def test_out_of_scope_count_preserves_sql_and_parameters(self):
        def run():
            cursor = ksb_fixtures.FakeCursor(('count',), [(3,)])
            with composition_fixture(views, 'connection', ksb_fixtures.FakeConnection(cursor)), \
                 composition_fixture(views, 'and_not_excluded', return_value=''):
                value = views.out_of_scope_progress_count([19], 'p.module_ref = %s', ['MOD'])
            return value, cursor.executed
        self.assertEqual(self.compare(run)[0], 3)

    def test_progress_failure_stays_unavailable_not_empty(self):
        cursor = ksb_fixtures.FakeCursor((), [])
        cursor.execute = Mock(side_effect=RuntimeError('synthetic read failure'))
        for legacy in (False, True):
            with ExitStack() as stack:
                if legacy: stack.enter_context(original_reporting())
                stack.enter_context(composition_fixture(views, 'connection', ksb_fixtures.FakeConnection(cursor)))
                stack.enter_context(composition_fixture(views, 'learner_schema_table_exists', return_value=True))
                stack.enter_context(composition_fixture(views, 'and_not_excluded', return_value=''))
                with self.assertRaises(LearnerProgressUnavailable) as error:
                    views.learner_progress_ksb_consumption([19], ['K1'])
                self.assertIsInstance(error.exception.__cause__, RuntimeError)

    def test_reflection_sql_and_error_mapping_are_unchanged(self):
        def run(fail=False):
            cursor = ksb_fixtures.FakeCursor(ksb_fixtures.REFLECTION_COLUMNS, [ksb_fixtures.reflection_row()])
            if fail: cursor.execute = Mock(side_effect=RuntimeError('synthetic reflection failure'))
            with composition_fixture(views, 'connection', ksb_fixtures.FakeConnection(cursor)), \
                 composition_fixture(views, 'learner_schema_table_exists', return_value=True), \
                 composition_fixture(views, 'learner_schema_columns', return_value=ksb_fixtures.REFLECTION_TABLE_COLUMNS), \
                 composition_fixture(views, 'logger'):
                value = views.reflection_submission_ksb_consumption([{'id':19}], ['K1'], ['COMP-20260816E2E'])
            return value, cursor.executed
        self.compare(run)
        self.assertEqual(self.compare(lambda: run(True))[0], ({}, [], [], []))

    def test_actual_application_and_infrastructure_owners_are_invoked(self):
        with patch.object(consumption, 'learner_progress_ksb_consumption', wraps=consumption.learner_progress_ksb_consumption) as app, \
             patch.object(progress, 'progress_source_available', return_value=False) as source:
            self.assertEqual(views.learner_progress_ksb_consumption([19], ['K1']), ({}, [], []))
            app.assert_called_once()
            source.assert_called_once()
        with patch.object(consumption, 'reflection_submission_ksb_consumption', wraps=consumption.reflection_submission_ksb_consumption) as app, \
             patch.object(reflections, 'reflection_columns', return_value=None) as source:
            self.assertEqual(views.reflection_submission_ksb_consumption([{'id':19}], ['K1']), ({}, [], [], []))
            app.assert_called_once()
            source.assert_called_once()

    def test_activity_trace_reflection_hours_and_learner_mutation_match(self):
        activities = [{'learnerId':19, 'progressId':90, 'componentId':'C1',
                       'code':'K1', 'weight':50, 'countsTowardAchievement':True,
                       'scopeStatus':'in_scope', 'expectedOtjh':3}]
        reflections_rows = [{'learnerId':19, 'progressEntryId':90, 'submissionId':'R1',
                             'componentId':'C1', 'code':'K1', 'weight':50,
                             'actualOtjh':2.5, 'actualTimeHours':2.5, 'expectedOtjh':3,
                             'scopeStatus':'in_scope', 'activityCountsTowardAchievement':True}]
        self.compare(lambda: views.learner_activity_trace(deepcopy(activities), [], deepcopy(reflections_rows), [], {}))
        def mutate():
            learners = [{'id':19}, {'id':20}]
            result = views.apply_reflection_otjh_to_learners(learners, deepcopy(reflections_rows))
            return result, learners
        self.compare(mutate)
