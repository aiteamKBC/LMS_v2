"""Home summary local phase timing: opt-in, read-only, no learner data logged.

Database and network are prohibited; every reader below the instrumented
phases is mocked. These tests prove the gate, phase coverage, exclusive
nesting and log contents, not real timings.
"""
from contextlib import contextmanager
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import overview_week as week_module
from . import projection_performance as perf
from .test_home_summary_register_reuse_no_db import REGISTER, Harness, source as learner_source

LOGGER = 'learner_api.projection_performance'
SECRET_EMAIL = 'private.learner@example.test'
LEARNER_ID = 987654


@contextmanager
def tracing():
    measurement = perf.LocalProjectionPerformance('00000000-0000-4000-8000-000000000001',
                                                  'overview-week:home-summary')
    token = perf._local_projection.set(measurement)
    try:
        yield measurement
    finally:
        perf._local_projection.reset(token)


def stage_names(measurement):
    return set(measurement.rows)


def cursor_connections():
    cursor = MagicMock()
    cursor.fetchall.return_value = [('MOD-1', 'Marketing', True)]
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor
    return {'enrolment': connection}


def summary(record):
    """The emitted dict; logging stores a lone mapping argument as ``args`` itself."""
    return record.args if isinstance(record.args, dict) else record.args[0]


def emitted(test, call):
    with test.assertLogs(LOGGER, level='INFO') as logs:
        result = call()
    lines = [record for record in logs.records if record.getMessage().startswith('projection_stage')]
    return result, lines


class GateTests(SimpleTestCase):
    def view(self, request, *args, **kwargs):
        self.seen = perf._local_projection.get()
        with perf.projection_stage('identity'):
            pass
        return 'response'

    def test_disabled_by_default_calls_the_view_unchanged_and_logs_nothing(self):
        wrapped = perf.local_home_summary_trace(self.view)
        request = RequestFactory().get('/x/', {'section': 'home-summary'})
        with patch.dict('os.environ', {}, clear=False), self.assertNoLogs(LOGGER, level='INFO'):
            self.assertEqual(wrapped(request, kind='commercial', pk=LEARNER_ID), 'response')
        self.assertIsNone(self.seen)

    def test_enabled_process_traces_only_home_summary(self):
        wrapped = perf.local_home_summary_trace(self.view)
        with patch.object(perf, '_local_trace_allowed', return_value=True):
            for section in (None, 'home', 'dashboard'):
                with self.subTest(section=section), self.assertNoLogs(LOGGER, level='INFO'):
                    params = {'section': section} if section else {}
                    wrapped(RequestFactory().get('/x/', params), kind='commercial', pk=LEARNER_ID)
                    self.assertIsNone(self.seen)

    def test_request_headers_cannot_enable_tracing(self):
        request = RequestFactory().get('/x/', {'section': 'home-summary'}, HTTP_X_TRACE='1',
                                       REMOTE_ADDR='127.0.0.1', SERVER_NAME='localhost')
        self.assertFalse(perf._local_trace_allowed(request))   # env/DEBUG/runserver are all required

    def test_enabled_emits_one_line_and_an_exception_is_still_measured(self):
        def failing(request, *args, **kwargs):
            with perf.projection_stage('attendance_register'):
                raise RuntimeError('boom')

        wrapped = perf.local_home_summary_trace(failing)
        request = RequestFactory().get('/x/', {'section': 'home-summary'})
        with patch.object(perf, '_local_trace_allowed', return_value=True):
            with self.assertLogs(LOGGER, level='INFO') as logs, self.assertRaises(RuntimeError):
                wrapped(request, kind='commercial', pk=LEARNER_ID)
        lines = [r for r in logs.records if r.getMessage().startswith('projection_stage')]
        self.assertEqual(len(lines), 1)
        payload = summary(lines[0])
        self.assertEqual(payload['projection'], 'overview-week:home-summary')
        self.assertIn('attendance_register', {stage['stage'] for stage in payload['stages']})
        self.assertIsNone(perf._local_projection.get())         # reset after the failure


class PhaseCoverageTests(SimpleTestCase):
    def test_read_week_reports_identity_hours_progress_plan_and_week_phases(self):
        owner = {'id': 9, 'enrolment_id': 265}
        with tracing() as measurement, \
                patch.object(week_module.canonical_learning, 'require_profile', return_value=owner), \
                patch.object(week_module.canonical_learning, 'metrics', return_value={'otjh': {}}), \
                patch.object(week_module, 'connections', cursor_connections()), \
                patch.object(week_module, '_direct_progress_records', return_value=[]), \
                patch.object(week_module, 'rows', return_value=[]), \
                patch.object(week_module, 'read_builder_activity_dates', return_value={}), \
                patch('learner_api.home_progress.read_home_progress',
                      return_value={'otjh': {}, 'period': {'start': None, 'end': '2026-10-18'}}):
            week_module.read_week(SimpleNamespace(pk=265), home_kind='commercial', home_summary=True)
        self.assertTrue({'identity', 'canonical_hours', 'progress_entries', 'plan_resolution',
                         'week_summary'} <= stage_names(measurement))

    def read_home(self, *, scope):
        from .home_progress import read_home_progress
        top_up = MagicMock()
        top_up.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        metrics = {'otjh': {'actual': 3.0, 'planned': 175.0},
                   'programme': {'completed': 0, 'total': 0, 'status': 'ready'}}
        with tracing() as measurement, Harness(), \
                patch('learner_api.home_progress.connections', {'enrolment': MagicMock()}), \
                patch('learner_api.live_session_progress.connections', {'enrolment': top_up}), \
                patch('learner_api.home_progress.rows', return_value=[]), \
                patch('learner_api.home_progress._group_dates',
                      return_value=(date(2026, 9, 1), date(2027, 9, 1), 'learner')), \
                patch('learner_api.home_progress.lecture_register', return_value=list(REGISTER)), \
                patch('learner_api.module_progress._module_progress_facts', return_value={
                    'modules': [], 'nativeComponents': [],
                    'historicalComponents': 0, 'retainedComponents': 0,
                }), \
                patch('learner_api.home_progress.canonical_learning.entries_for', return_value=[]):
            result = read_home_progress(
                learner_source(), 'commercial', [], [], [], [('M1', 'One'), ('M2', 'Two')], date(2026, 10, 4),
                attendance_module_ids=scope, canonical_metrics=metrics, reuse_attendance_register=True)
        return measurement, result

    def test_home_progress_reports_every_card_phase_and_the_p1_reuse_decision(self):
        measurement, _ = self.read_home(scope=['M1', 'M2'])
        self.assertTrue({'programme_dates', 'submissions', 'attendance_register', 'card_aggregation',
                         'canonical_hours', 'module_progress', 'live_credits'} <= stage_names(measurement))
        self.assertIn('module_credits_register_reused', measurement.operation_rows)
        self.assertNotIn('module_credits_register_built', measurement.operation_rows)

    def test_p1_fallback_is_reported_as_a_built_register(self):
        measurement, _ = self.read_home(scope=['M1'])                # M2 not covered
        self.assertIn('module_credits_register_built', measurement.operation_rows)
        self.assertNotIn('module_credits_register_reused', measurement.operation_rows)

    def test_instrumentation_does_not_change_the_card(self):
        _, traced = self.read_home(scope=['M1', 'M2'])
        from .home_progress import read_home_progress
        top_up = MagicMock()
        top_up.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        metrics = {'otjh': {'actual': 3.0, 'planned': 175.0},
                   'programme': {'completed': 0, 'total': 0, 'status': 'ready'}}
        with Harness(), \
                patch('learner_api.home_progress.connections', {'enrolment': MagicMock()}), \
                patch('learner_api.live_session_progress.connections', {'enrolment': top_up}), \
                patch('learner_api.home_progress.rows', return_value=[]), \
                patch('learner_api.home_progress._group_dates',
                      return_value=(date(2026, 9, 1), date(2027, 9, 1), 'learner')), \
                patch('learner_api.home_progress.lecture_register', return_value=list(REGISTER)), \
                patch('learner_api.module_progress._module_progress_facts', return_value={
                    'modules': [], 'nativeComponents': [],
                    'historicalComponents': 0, 'retainedComponents': 0,
                }), \
                patch('learner_api.home_progress.canonical_learning.entries_for', return_value=[]):
            plain = read_home_progress(
                learner_source(), 'commercial', [], [], [], [('M1', 'One'), ('M2', 'Two')], date(2026, 10, 4),
                attendance_module_ids=['M1', 'M2'], canonical_metrics=metrics, reuse_attendance_register=True)
        self.assertEqual(traced, plain)


class ViewTraceTests(SimpleTestCase):
    def call(self):
        model = type('Model', (), {'all_learners': MagicMock(), 'DoesNotExist': LookupError})
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(pk=LEARNER_ID, email=SECRET_EMAIL)
        request = RequestFactory().get(f'/learner_api/overview-week/commercial/{LEARNER_ID}/',
                                       {'section': 'home-summary'})
        payload = {'weekStart': '2026-11-02', 'weekEnd': '2026-11-08', 'modules': [],
                   'homeProgress': {'otjh': {'actual': 1.0}}}
        with patch.dict(week_module.SOURCE_MODELS, {'commercial': model}), \
                patch.object(perf, '_local_trace_allowed', return_value=True), \
                patch.object(week_module, 'read_week', return_value=payload):
            # Below require_GET and the auth gate, as existing endpoint tests call it.
            return emitted(self, lambda: week_module.overview_week.__wrapped__.__wrapped__(
                request, 'commercial', LEARNER_ID))

    def test_one_summary_line_with_source_and_serialisation_and_unchanged_response(self):
        response, lines = self.call()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(len(lines), 1)
        payload = summary(lines[0])
        names = {stage['stage'] for stage in payload['stages']}
        self.assertTrue({'dispatch', 'source', 'serialize'} <= names)
        self.assertNotEqual(payload['serialization_ms'], 'UNMEASURED')

    def test_nested_phases_are_exclusive_and_never_exceed_the_total(self):
        _, lines = self.call()
        payload = summary(lines[0])
        self.assertLessEqual(sum(stage['elapsed_ms'] for stage in payload['stages']), payload['elapsed_ms'] + 1)

    def test_summary_line_carries_no_learner_data_or_sql(self):
        _, lines = self.call()
        text = lines[0].getMessage()
        for forbidden in (SECRET_EMAIL, str(LEARNER_ID), 'SELECT', 'commercial/'):
            self.assertNotIn(forbidden, text)
