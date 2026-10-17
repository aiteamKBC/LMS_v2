"""Offline readiness checks: no schema setup, learner writes or external calls."""
from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from . import key_readiness, views
from .models import QuizPackage
from . import tests_publication as publication

question = publication.question


class KeyReadinessTests(SimpleTestCase):
    def test_published_and_external_packages_do_not_need_link_discovery(self):
        with patch.object(key_readiness, 'connection') as connection:
            self.assertTrue(key_readiness.quiz_requires_valid_key(QuizPackage(id=1, status='published')))
            self.assertFalse(key_readiness.quiz_requires_valid_key(QuizPackage(id=2, status='draft', package_type='scorm')))
            connection.cursor.assert_not_called()

    def test_linked_draft_is_protected_and_unused_draft_is_not(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        with patch.object(key_readiness, 'connection', connection):
            for linked in (True, False):
                cursor.fetchone.return_value = (linked,)
                self.assertEqual(key_readiness.quiz_requires_valid_key(QuizPackage(id=7)), linked)
                self.assertEqual(cursor.execute.call_args.args[1], ['7'])

    def test_inventory_filters_missing_references_without_guessing_ids(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('7',), ('7',), (None,), ('not-an-id',), ('12',)]
        self.assertEqual(key_readiness.linked_quiz_ids(cursor), {7, 12})


class LinkedDraftMutationTests(SimpleTestCase):
    setUp = publication.PublicationTests.setUp
    request = publication.PublicationTests.request

    def test_linked_draft_can_save_a_valid_question_without_replacing_answers(self):
        self.quiz.status = 'draft'
        self.active = [question()]
        with patch.object(views, 'quiz_requires_valid_key', return_value=True), \
             patch.object(views, '_quiz_preview_payload', return_value={}), \
             patch.object(views, '_update_question_answers') as update_answers:
            response = views.quiz_questions(self.request('patch', {'questions': [
                {'id': 21, 'text': 'Updated wording'}]}), 7)
        self.assertEqual(response.status_code, 200)
        self.active[0].save.assert_called_once()
        update_answers.assert_not_called()

    def test_linked_draft_cannot_clear_its_last_correct_answer(self):
        self.quiz.status = 'draft'
        self.active = [question()]
        with patch.object(views, 'quiz_requires_valid_key', return_value=True):
            response = views.quiz_questions(self.request('patch', {'questions': [{
                'id': 21, 'answers': [{'text': 'Yes', 'isCorrect': False},
                                       {'text': 'No', 'isCorrect': False}]}]}), 7)
        self.assertEqual(response.status_code, 400)
        self.active[0].save.assert_not_called()

    def test_linked_draft_cannot_archive_its_last_question(self):
        self.quiz.status = 'draft'
        self.active = [question()]
        with patch.object(views, 'quiz_requires_valid_key', return_value=True):
            response = views.quiz_questions(self.request('patch', {'questions': [{'id': 21, 'isArchived': True}]}), 7)
        self.assertEqual(response.status_code, 400)
        self.active[0].save.assert_not_called()

    def test_linked_draft_rejects_bad_bank_copy_before_creating_records(self):
        self.quiz.status = 'draft'
        self.active = [question()]
        self.questions.select_related.return_value.prefetch_related.return_value.get.return_value = question(False)
        with patch.object(views, 'quiz_requires_valid_key', return_value=True):
            response = views.add_question_to_quiz(self.request('post', {'quizId': 7}), 21)
        self.assertEqual(response.status_code, 400)
        self.questions.create.assert_not_called()

    def test_course_assignment_rejects_bad_draft_key_before_link_writes(self):
        self.quiz.status = 'draft'
        self.quiz.programme = 'Synthetic'
        self.active = [question(False)]
        options = [{'id': 'M1', 'module': 'Module', 'programmeId': 'P1',
                    'programme': 'Synthetic', 'weeks': [{'id': 'W1'}]}]
        with patch.object(views, '_ensure_quiz_course_links_table'), \
             patch.object(views, '_ensure_quiz_component_links_table'), \
             patch.object(views, '_quiz_module_options', return_value=options), \
             patch.object(views, 'connection') as connection:
            response = views.quiz_course_links(self.request('patch', {
                'moduleAssignments': [{'moduleCatalogueId': 'M1', 'weekId': 'W1'}]}), 7)
        self.assertEqual(response.status_code, 400)
        self.packages.select_for_update.assert_called_once()
        connection.cursor.assert_not_called()
        self.save.assert_not_called()

    def test_bad_draft_can_be_unlinked_without_changing_its_questions(self):
        self.quiz.status = 'draft'
        self.quiz.programme = 'Synthetic'
        self.active = [question(False)]
        with patch.object(views, '_ensure_quiz_course_links_table'), \
             patch.object(views, '_ensure_quiz_component_links_table'), \
             patch.object(views, '_quiz_module_options', return_value=[]), \
             patch.object(views, '_first_existing_curriculum_table', return_value=None), \
             patch.object(views, '_selected_quiz_module_link_assignments', return_value=[]), \
             patch.object(views, '_distinct_assignment_group_count', return_value=0), \
             patch.object(views, 'connection') as connection:
            response = views.quiz_course_links(self.request('patch', {'moduleCatalogueIds': []}), 7)
        self.assertEqual(response.status_code, 200)
        connection.cursor.return_value.__enter__.return_value.execute.assert_called_once()
        self.questions.filter.assert_not_called()
        self.active[0].save.assert_not_called()
