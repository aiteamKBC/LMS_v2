from unittest.mock import patch

from django.test import SimpleTestCase

from .projection_performance import ProjectionPerformance


class ProjectionPerformanceTests(SimpleTestCase):
    def test_records_query_and_stage_without_sql_or_personal_data(self):
        measurement = ProjectionPerformance(
            'overview-week', kind='apprenticeship', learner_id=265, section='overview',
        )
        with measurement.stage('activities'):
            self.assertEqual(measurement.execute(lambda *_: 'ok', 'SELECT secret', [], False, {}), 'ok')

        fields = measurement.fields()
        self.assertEqual(fields['query_count'], 1)
        self.assertEqual(fields['learner_id'], 265)
        self.assertIn('activities', fields['stage_durations_ms'])
        self.assertNotIn('sql', fields)

    def test_error_log_contains_only_structured_projection_fields(self):
        measurement = ProjectionPerformance('metrics', kind='commercial', learner_id=12)
        with patch('learner_api.projection_performance.log.info') as info:
            measurement.emit(status='error')
        payload = info.call_args.args[1]
        self.assertEqual(payload['status'], 'error')
        self.assertEqual(payload['projection'], 'metrics')
        self.assertNotIn('email', payload)

    def test_failed_stage_is_retained_for_database_error_diagnostics(self):
        measurement = ProjectionPerformance('training-plan-dashboard', kind='commercial', learner_id=12)
        with self.assertRaisesMessage(RuntimeError, 'failed'):
            with measurement.stage('overview'):
                raise RuntimeError('failed')
        self.assertEqual(measurement.failed_stage, 'overview')
