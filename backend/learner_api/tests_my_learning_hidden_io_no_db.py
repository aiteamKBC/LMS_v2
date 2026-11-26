"""Bounded hidden-I/O timing and duplicated-work regressions; no real I/O."""
from copy import deepcopy
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from uuid import uuid4

from django.test import SimpleTestCase
from . import projection_performance as perf, attendance, learning_plan, mappers
from .live_session_progress import project_live_credits
from .tests_live_session_progress import component, lecture, NOW


class HiddenIOTests(SimpleTestCase):
    def test_operation_wall_cpu_and_sql_accounting_keeps_parent_stage_total(self):
        wall, cpu = [0.0], [0.0]
        def advance(seconds, processing):
            wall[0] += seconds
            cpu[0] += processing
        with patch.object(perf,'perf_counter',side_effect=lambda:wall[0]), \
             patch.object(perf,'thread_time',side_effect=lambda:cpu[0]):
            measurement = perf.LocalProjectionPerformance(uuid4())
            token = perf._local_projection.set(measurement)
            try:
                with perf.projection_stage('live_credits'), perf.projection_operation('teams_reports'):
                    advance(1,.2)
                    with perf.projection_operation('teams_evidence'):
                        def execute(*args): advance(2,.03)
                        measurement.execute_for('enrolment',execute,'private SQL',{'token':'private'},False,{})
                        advance(3,.3)
                    advance(1,.1)
            finally:
                perf._local_projection.reset(token)
            with patch.object(perf.log,'info') as log:
                measurement.emit()
        payload = log.call_args.args[1]
        self.assertEqual(next(row for row in payload['stages'] if row['stage']=='live_credits')['elapsed_ms'],7000)
        operations = {row['operation']:row for row in payload['operations']}
        self.assertEqual(operations['teams_reports']['elapsed_ms'],2000)
        self.assertEqual(operations['teams_reports']['inclusive_elapsed_ms'],7000)
        evidence = operations['teams_evidence']
        self.assertEqual(evidence['elapsed_ms'],5000)
        self.assertEqual(evidence['django_sql_calls'],1)
        self.assertEqual(evidence['django_client_execute_ms'],2000)
        self.assertEqual(evidence['processing_cpu_ms'],300)
        self.assertEqual(evidence['non_cpu_wall_ms'],4670)
        self.assertEqual(evidence['unwrapped_wall_ms'],2700)
        self.assertNotIn('private',str(payload))
        self.assertFalse(measurement.operation_frames)

    def test_disabled_operations_make_no_timer_or_logging_calls(self):
        with patch.object(perf,'perf_counter',side_effect=AssertionError('Timer')), \
             patch.object(perf,'thread_time',side_effect=AssertionError('CPU timer')), \
             patch.object(perf.log,'info') as log:
            self.assertEqual(perf.projection_call('kbc_connect',lambda value:value,7),7)
            with perf.projection_operation('identity_matching'): pass
        log.assert_not_called()

    def test_unknown_operation_labels_are_bounded_and_failure_text_is_not_retained(self):
        measurement = perf.LocalProjectionPerformance(uuid4())
        token = perf._local_projection.set(measurement)
        try:
            for i in range(100):
                with perf.projection_operation('secret-label-'+str(i)): pass
            with self.assertRaises(ValueError):
                with perf.projection_operation('kbc_fetch'): raise ValueError('private response body')
        finally:
            perf._local_projection.reset(token)
        self.assertEqual(set(measurement.operation_rows),{'other','kbc_fetch'})
        self.assertEqual(measurement.operation_rows['other']['calls'],100)
        self.assertEqual(measurement.operation_rows['kbc_fetch']['failures'],1)
        self.assertFalse(measurement.operation_frames)
        with patch.object(perf.log,'info') as log: measurement.emit()
        self.assertNotIn('secret-label',str(log.call_args))
        self.assertNotIn('private response body',str(log.call_args))

    def test_kbc_connection_execute_fetch_and_cleanup_are_independent_without_extra_queries(self):
        wall, cpu = [0.0], [0.0]
        def advance(seconds, processing): wall[0] += seconds; cpu[0] += processing
        cursor = MagicMock()
        cursor.execute.side_effect = lambda *args: advance(3,.01)
        cursor.fetchall.side_effect = lambda: (advance(4,.2) or [])
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value = cursor
        connection.__exit__.side_effect = lambda *args: (advance(.5,0) or False)
        def connect(*args,**kwargs): advance(2,.02); return connection
        with patch.object(perf,'perf_counter',side_effect=lambda:wall[0]), \
             patch.object(perf,'thread_time',side_effect=lambda:cpu[0]), \
             patch.object(attendance,'_kbc_attendance_connection_string',return_value='synthetic-dsn'), \
             patch.object(attendance.psycopg,'connect',side_effect=connect) as factory:
            measurement = perf.LocalProjectionPerformance(uuid4())
            token = perf._local_projection.set(measurement)
            try:
                rows = attendance.fetch_kbc_attendance_rows(aptem_id='7',learner_id=1,
                    learner_name='Synthetic',learner_email='learner@example.test')
            finally: perf._local_projection.reset(token)
        self.assertEqual(rows,[])
        self.assertEqual(factory.call_count,1)
        self.assertEqual(factory.call_args.kwargs['connect_timeout'],10)
        self.assertEqual(cursor.execute.call_count,1)
        cursor.fetchall.assert_called_once_with()
        connection.__exit__.assert_called_once_with(None,None,None)
        self.assertAlmostEqual(measurement.operation_rows['kbc_connect']['elapsed'],2)
        self.assertAlmostEqual(measurement.operation_rows['kbc_execute']['elapsed'],3)
        self.assertAlmostEqual(measurement.operation_rows['kbc_fetch']['elapsed'],4)
        self.assertAlmostEqual(measurement.operation_rows['kbc_total']['elapsed'],.5)
        self.assertAlmostEqual(measurement.operation_rows['kbc_total']['inclusive_elapsed'],9.5)

    def test_kbc_failure_still_exits_connection_context(self):
        connection, cursor = MagicMock(), MagicMock()
        connection.__enter__.return_value = connection
        connection.cursor.return_value.__enter__.return_value = cursor
        cursor.execute.side_effect = RuntimeError('synthetic')
        with patch.object(attendance,'_kbc_attendance_connection_string',return_value='synthetic'), \
             patch.object(attendance.psycopg,'connect',return_value=connection):
            with self.assertRaises(RuntimeError):
                attendance.fetch_kbc_attendance_rows(aptem_id='7',learner_id=1,learner_name='',learner_email='')
        self.assertEqual(connection.__exit__.call_args.args[0],RuntimeError)
        cursor.fetchall.assert_not_called()


class DuplicatedWorkTests(SimpleTestCase):
    def test_saved_training_plan_is_decoded_once_for_both_learner_kinds(self):
        saved = [{'moduleId':'M1','assignmentMode':'explicit','weeks':[{'components':[{'componentId':str(i)} for i in range(1000)]}]}]
        for kind in ('commercial','apprenticeship'):
            source = SimpleNamespace(training_plan=json.dumps(saved) if kind=='commercial' else None,
                learning_plan=json.dumps(saved) if kind=='apprenticeship' else None,learner_type=kind)
            original = mappers.stored_training_plan
            with patch.object(learning_plan,'stored_training_plan',wraps=original) as direct, \
                 patch.object(mappers,'stored_training_plan',wraps=original) as nested:
                result = learning_plan.effective_training_plan(source)
            self.assertEqual(result,saved)
            self.assertEqual(direct.call_count+nested.call_count,1)

    def test_plan_reuse_preserves_inheritance_empty_explicit_and_next_read_freshness(self):
        for saved, expected in ((None,['M2']),([],[]),([{'moduleId':'M1'}],['M1','M2']),
                                ([{'moduleId':'M1','assignmentMode':'explicit'}],['M1'])):
            source = SimpleNamespace(training_plan=deepcopy(saved),learning_plan=None,modules='',weeks='',components='')
            with patch.object(learning_plan,'_preset_ids_for',return_value=['M2']):
                self.assertEqual([row['moduleId'] for row in learning_plan.effective_training_plan(source)],expected)
        source.training_plan = [{'moduleId':'M9','assignmentMode':'explicit'}]
        self.assertEqual(learning_plan.effective_training_plan(source),source.training_plan)

    def test_live_credit_register_is_visited_once_across_many_modules(self):
        class CountingRows(list):
            visits = 0
            def __iter__(self):
                for row in super().__iter__():
                    self.visits += 1
                    yield row
        rows = CountingRows([lecture(session_id=f'O{i}-{j}',occurrence_id=f'O{i}-{j}',
            module_catalogue_id=f'M{i}') for i in range(50) for j in range(20)])
        components = [component(componentId=f'C{i}',moduleId=f'M{i}',teamsOccurrenceId=f'O{i}-0') for i in range(50)]
        result = project_live_credits(components,rows,now=NOW)
        self.assertEqual(len(result),50)
        self.assertEqual(rows.visits,1000)
        self.assertEqual({credit['componentId'] for credit in result},{f'C{i}' for i in range(50)})
