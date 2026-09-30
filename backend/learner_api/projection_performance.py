"""Low-overhead, PII-free timing for learner read projections."""
from contextlib import ExitStack, contextmanager
import logging
from time import perf_counter

from django.db import connections


log = logging.getLogger(__name__)


class ProjectionPerformance:
    def __init__(self, projection, *, kind, learner_id, section=None):
        self.projection = projection
        self.kind = kind
        self.learner_id = learner_id
        self.section = section
        self.started = perf_counter()
        self.query_count = 0
        self.db_seconds = 0.0
        self.query_count_by_alias = {}
        self.db_seconds_by_alias = {}
        self.stages = {}
        self.current_stage = 'source'
        self.failed_stage = None

    def execute_for(self, alias, execute, sql, params, many, context):
        started = perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            elapsed = perf_counter() - started
            self.query_count += 1
            self.db_seconds += elapsed
            self.query_count_by_alias[alias] = self.query_count_by_alias.get(alias, 0) + 1
            self.db_seconds_by_alias[alias] = self.db_seconds_by_alias.get(alias, 0.0) + elapsed

    def execute(self, execute, sql, params, many, context):
        """Backwards-compatible wrapper used by focused unit tests."""
        return self.execute_for('unknown', execute, sql, params, many, context)

    def wrapper(self, alias):
        def execute(execute_sql, sql, params, many, context):
            return self.execute_for(alias, execute_sql, sql, params, many, context)
        return execute

    @contextmanager
    def stage(self, name):
        previous = self.current_stage
        self.current_stage = name
        started = perf_counter()
        try:
            yield
        except Exception:
            self.failed_stage = name
            raise
        finally:
            self.stages[name] = self.stages.get(name, 0.0) + perf_counter() - started
            self.current_stage = previous

    def fields(self):
        return {
            'projection': self.projection,
            'kind': self.kind,
            'learner_id': self.learner_id,
            'section': self.section or '',
            'duration_ms': round((perf_counter() - self.started) * 1000, 2),
            'query_count': self.query_count,
            'db_duration_ms': round(self.db_seconds * 1000, 2),
            'query_count_by_alias': dict(sorted(self.query_count_by_alias.items())),
            'db_duration_ms_by_alias': {
                alias: round(seconds * 1000, 2)
                for alias, seconds in sorted(self.db_seconds_by_alias.items())
            },
            'stage_durations_ms': {
                name: round(seconds * 1000, 2) for name, seconds in self.stages.items()
            },
        }

    def emit(self, *, status='ok'):
        log.info('learner_projection_perf %s', {**self.fields(), 'status': status})


@contextmanager
def measure_projection(projection, *, kind, learner_id, section=None):
    measurement = ProjectionPerformance(
        projection, kind=kind, learner_id=learner_id, section=section,
    )
    # Learner projections deliberately span the enrolment and default aliases.
    # Measuring one alias made the diagnostic query count look materially lower
    # than the work the request actually performed.
    with ExitStack() as stack:
        for connection in connections.all():
            stack.enter_context(connection.execute_wrapper(measurement.wrapper(connection.alias)))
        try:
            yield measurement
        except Exception:
            measurement.emit(status='error')
            raise
        else:
            measurement.emit()
