"""A quiz attempt reaches the Audit Trail as its outcome, never its answers."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import versioning
from learner_api import quizzes


class QuizAuditLineTests(SimpleTestCase):
    def record(self, **overrides):
        values = dict(
            kind='apprenticeship', learner_id='42', source=SimpleNamespace(username='Test Learner', email='t@example.invalid'),
            quiz={'id': 9, 'title': 'Week 1 check', 'module': 'Module A'}, attempt_number=2, passed=True,
            grade_pct=80.0, correct_count=4, question_count=5, time_taken='00:03:10',
            submitted_at=datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc), module_title='', week_title='Week 1',
        )
        values.update(overrides)
        with mock.patch('system_audit.writes.record_table_rows') as record:
            quizzes.record_quiz_attempt(**values)
        return record

    def test_one_line_with_the_result_and_no_answers(self):
        record = self.record()
        table, rows = record.call_args.args
        self.assertEqual(table, 'learner_quiz_attempts')
        row = rows[0]
        self.assertEqual(row['id'], 'apprenticeship:42:9:2')
        self.assertEqual((row['result'], row['score_percent'], row['correct_answers'], row['total_questions']),
                         ('Passed', 80.0, 4, 5))
        self.assertEqual(row['module_title'], 'Module A')
        self.assertFalse({'questions', 'answers', 'breakdown'} & set(row))

    def test_only_the_registered_columns_can_reach_history(self):
        columns = versioning.SNAPSHOT_COLUMNS['quiz_attempt']
        self.assertFalse({'questions', 'answers', 'breakdown', 'feedback'} & set(columns))
        self.assertEqual(versioning.VERSIONED_TABLES['learner_quiz_attempts']['entity_type'], 'quiz_attempt')

    def test_it_is_recorded_as_created_not_as_a_first_sighting(self):
        row = self.record().call_args.args[1][0]
        self.assertTrue(versioning.looks_newly_created({'created_at': row['created_at'], 'updated_at': row['updated_at']}))

    def test_a_failure_never_breaks_the_submission(self):
        with mock.patch('system_audit.writes.record_table_rows', side_effect=RuntimeError('down')):
            with self.assertLogs(quizzes.logger, level='WARNING'):
                quizzes.record_quiz_attempt(
                    kind='commercial', learner_id='1', source=None, quiz={'id': 1}, attempt_number=1,
                    passed=False, grade_pct=0, correct_count=0, question_count=1, time_taken='',
                    submitted_at=datetime.now(timezone.utc), module_title='', week_title='',
                )
