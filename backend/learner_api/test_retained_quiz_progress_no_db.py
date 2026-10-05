"""No database, application imports, or external services."""
import unittest
from unittest.mock import patch

from django.db import DatabaseError

from . import retained_quiz_progress as retained


def component(component_id, quiz_id, module_id='MOD-A'):
    return {'module': 'Module A', 'week': 'Week 2', 'component': f'Quiz {component_id}', 'moduleId': module_id,
            'componentId': component_id, 'isQuiz': True,
            'quizMeta': {'quizId': quiz_id, 'questions': 10, 'duration': None, 'timeUnit': None}}


def attempt(quiz_id, passed=True, component_id=None):
    return {'kind': 'quiz', 'quizId': quiz_id, 'passed': passed, 'componentId': component_id}


def slot(component_id, quiz_id, module_id='MOD-A'):
    return {'componentId': component_id, 'moduleId': module_id, 'weekId': 'WEEK-2', 'week': 'Week 2',
            'title': f'Old {component_id}', 'quizId': str(quiz_id)}


class RetainedQuizProgressTests(unittest.TestCase):
    def detail(self, *attempts):
        return {'components': [component('COMP-1', 200), component('COMP-2', 201)], 'quizAttempts': list(attempts)}

    def test_matched_attempts_never_query_the_curriculum_history(self):
        detail = self.detail(attempt(200), attempt(999, component_id='COMP-2'))
        with patch.object(retained, 'read_quiz_slots') as reader:
            retained.retain_quiz_progress(detail)
        reader.assert_not_called()
        self.assertEqual(detail['retiredQuizComponents'], [])
        self.assertIsNone(detail['quizAttempts'][0]['componentId'])

    def test_relinked_component_takes_its_earlier_attempts_in_the_response_only(self):
        passed, failed = attempt(100), attempt(100, passed=False)
        detail = self.detail(passed, failed)
        with patch.object(retained, 'read_quiz_slots', return_value=[slot('COMP-1', 100)]) as reader:
            retained.retain_quiz_progress(detail)
        reader.assert_called_once_with(['MOD-A'], ['100'])
        self.assertEqual([passed['componentId'], failed['componentId']], ['COMP-1', 'COMP-1'])
        self.assertEqual(passed['quizId'], 100)
        self.assertEqual(detail['retiredQuizComponents'], [])

    def test_passed_quiz_with_only_a_removed_slot_is_listed_once_as_retired(self):
        detail = self.detail(attempt(99), attempt(99), attempt(98, passed=False))
        retained.attach_quiz_slots(detail, detail['quizAttempts'], [slot('COMP-OLD', 99), slot('COMP-OLD-2', 98)])
        self.assertEqual(len(detail['retiredQuizComponents']), 1)
        retired = detail['retiredQuizComponents'][0]
        self.assertEqual((retired['componentId'], retired['module'], retired['retired']), ('COMP-OLD', 'Module A', True))
        self.assertEqual(retired['quizMeta'], {'quizId': 99, 'questions': None, 'duration': None, 'timeUnit': None})
        self.assertTrue(all(item['componentId'] is None for item in detail['quizAttempts']))

    def test_ambiguous_history_is_left_unchanged(self):
        detail = self.detail(attempt(100), attempt(99))
        retained.attach_quiz_slots(detail, detail['quizAttempts'], [
            slot('COMP-1', 100), slot('COMP-2', 100), slot('COMP-OLD', 99), slot('COMP-OLD-B', 99),
        ])
        self.assertEqual([item['componentId'] for item in detail['quizAttempts']], [None, None])
        self.assertEqual(detail['retiredQuizComponents'], [])

    def test_database_failure_keeps_the_current_plan_view(self):
        detail = self.detail(attempt(100))
        with patch.object(retained, 'read_quiz_slots', side_effect=DatabaseError('down')), \
                self.assertLogs(retained.logger, 'WARNING'):
            retained.retain_quiz_progress(detail)
        self.assertIsNone(detail['quizAttempts'][0]['componentId'])
        self.assertEqual(detail['retiredQuizComponents'], [])


if __name__ == '__main__':
    unittest.main()
