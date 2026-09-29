"""Low-overhead, PII-free timing for learner read projections."""
from contextlib import contextmanager
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
        self.stages = {}
        self.current_stage = 'source'
        self.failed_stage = None

    def execute(self, execute, sql, params, many, context):
        started = perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            self.query_count += 1
            self.db_seconds += perf_counter() - started

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
    with connections['enrolment'].execute_wrapper(measurement.execute):
        try:
            yield measurement
        except Exception:
            measurement.emit(status='error')
            raise
        else:
            measurement.emit()
