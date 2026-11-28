import unittest

from audit_available_quizzes import inspect_quizzes


class AvailableQuizAuditTests(unittest.TestCase):
    def test_linked_draft_is_a_learner_blocker_but_unused_draft_remains_authorable(self):
        quizzes = [dict(id=i, title='Synthetic', status='draft', packageType='csv') for i in (1, 2)]
        result = inspect_quizzes(quizzes, [], {1})
        self.assertEqual([q['id'] for q in result['blocked']], [1])
        self.assertEqual(result['unusedIncompleteDrafts'], 1)

    def test_published_quiz_without_component_links_is_still_checked(self):
        quiz = dict(id=1, title='Synthetic', status='published', packageType='csv')
        self.assertEqual(inspect_quizzes([quiz], [], set())['blockedAvailableQuizzes'], 1)

    def test_external_packages_and_archived_quizzes_are_not_native_key_failures(self):
        quizzes = [dict(id=1, status='published', packageType='scorm'),
                   dict(id=2, status='trash', packageType='csv')]
        self.assertEqual(inspect_quizzes(quizzes, [], {1, 2})['availableQuizzesChecked'], 0)

    def test_conflicting_single_choice_fails_while_repaired_key_passes(self):
        quiz = dict(id=1, status='draft', packageType='csv')
        question = dict(quizId=1, id=10, type='single_choice', answers=[
            dict(text='One', isCorrect=True), dict(text='Two', isCorrect=True)])
        self.assertEqual(inspect_quizzes([quiz], [question], {1})['blockedAvailableQuizzes'], 1)
        question['answers'][1]['isCorrect'] = False
        self.assertEqual(inspect_quizzes([quiz], [question], {1})['blockedAvailableQuizzes'], 0)
