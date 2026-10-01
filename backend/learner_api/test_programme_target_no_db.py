"""Overall learner targets must not shrink to a partial monthly schedule."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from learner_api import journal_sources
from learner_api.test_canonical_learning_no_db import adapter, ServiceError


class ProgrammeTargetTests(unittest.TestCase):
    def setUp(self):
        self.owner = dict(id=10, enrolment_id=20, aptem_id=30, name='Test Learner',
                          email='learner@example.invalid', account_record_id=20,
                          account_email='learner@example.invalid', account_aptem_id=30,
                          programme_planned_hours='300.00')
        self.query = Mock(return_value=[self.owner])
        self.scope = adapter(self.query)
        self.scope['entries_for'] = Mock(return_value=[
            {'accepted': True, 'actual_seconds': 7200, 'segments': [
                {'id': 1, 'actual_seconds': 3600}, {'id': 2, 'actual_seconds': 1800}]},
            {'accepted': False, 'actual_seconds': 3600}])
        self.scope['targets_for'] = Mock(return_value={'2026-06': 12, '2026-07': 18})
        token = journal_sources._current.set(True)
        self.addCleanup(journal_sources._current.reset, token)

    def test_overall_plan_does_not_use_partial_months_or_duplicate_segmented_hours(self):
        metrics = self.scope['metrics'](20)
        self.assertEqual(metrics['otjh']['planned'], 300)
        self.assertEqual(metrics['aptem_planned_total'], 300)
        self.assertEqual(metrics['otjh']['actual'], 1.5)
        self.assertEqual(self.scope['targets_for'](self.owner), {'2026-06': 12, '2026-07': 18})
        self.assertEqual(self.query.call_args.args[1], [20])

    def test_coach_context_keeps_previous_target_source(self):
        journal_sources._current.set(False)
        metrics = self.scope['metrics'](20)
        self.assertEqual(metrics['otjh']['planned'], 30)
        self.assertEqual(metrics['aptem_planned_total'], 30)
        self.query.assert_called()

    def test_unknown_target_stays_unknown_instead_of_using_a_partial_schedule(self):
        for value in (None, '', 'not available', '-1', 'nan', 'inf'):
            with self.subTest(value=value):
                self.owner['programme_planned_hours'] = value
                metrics = self.scope['metrics'](20)
                self.assertIsNone(metrics['otjh']['planned'])
                self.assertIsNone(metrics['aptem_planned_total'])
                self.assertEqual(metrics['otjh']['actual'], 1.5)
        self.owner['programme_planned_hours'] = '0'
        self.assertEqual(self.scope['metrics'](20)['otjh']['planned'], 0)

    def test_target_is_not_read_from_an_unverified_identity(self):
        self.owner['account_email'] = 'someone-else@example.invalid'
        with self.assertRaises(ServiceError):
            self.scope['programme_planned_hours'](20)
        self.query.return_value = []
        self.assertIsNone(self.scope['programme_planned_hours'](20))

    def test_subject_summary_and_dashboard_use_the_same_programme_target(self):
        self.scope['entries_for'] = Mock(return_value=[])
        self.scope['recorded_course_items'] = Mock(return_value=([], [], {}))
        self.query.side_effect = lambda sql, args: [self.owner] if 'account_record_id' in sql else []
        subject = self.scope['source_subjects'](20, lambda items: {'activities': items})
        self.assertEqual(subject['audit_tp_planned'], 300)
        self.assertEqual(subject['audit_tp_planned'], self.scope['metrics'](20)['otjh']['planned'])
        self.assertEqual(subject['recorded_otjh_total'], 0)


if __name__ == '__main__':
    unittest.main()
