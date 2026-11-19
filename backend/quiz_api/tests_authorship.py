"""Creator identity and immutable authorship; synthetic requests, no database."""
import io
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from login import sessions
from . import views
from .models import QuizPackage
from .tests_publication import PublicationTests


class QuizAuthorshipTests(SimpleTestCase):
    setUp = PublicationTests.setUp
    request = PublicationTests.request

    def create(self, request, *, complete=False):
        self.packages.create.side_effect = lambda **values: QuizPackage(id=8, **values)
        with patch.object(views, '_match_programme_catalogue_id', return_value=''), \
             patch.object(views, '_build_week_id', return_value=''), \
             patch.object(views, '_sync_quiz_assignment_count', side_effect=lambda quiz: quiz), \
             patch.object(views, '_serialize_quiz', side_effect=lambda quiz: {'id': quiz.id, 'author': quiz.author}), \
             patch.object(views, '_save_questions'):
            return (views.create_quiz_with_questions if complete else views.quizzes)(request)

    def test_manual_creation_uses_current_staff_or_admin_and_ignores_forged_author(self):
        for role in ('staff', 'admin'):
            with self.subTest(role=role):
                request = self.request('post', {'title': 'New quiz', 'author': 'Someone else',
                                                'userId': 99, 'email': 'forged@example.invalid'})
                request.login_account = SimpleNamespace(role=role, display_name=' Signed-in creator ', email='creator@example.invalid')
                response = self.create(request)
                self.assertEqual(response.status_code, 201)
                self.assertEqual(json.loads(response.content)['author'], 'Signed-in creator')
                self.assertEqual(self.packages.create.call_args.kwargs['author'], 'Signed-in creator')

    def test_complete_manual_or_generated_batch_uses_the_session_creator(self):
        request = self.request('post', {'title': 'Generated quiz', 'author': 'Forged', 'initialQuestions': [
            {'text': 'Choose', 'questionType': 'single_choice', 'answers': [
                {'text': 'Right', 'isCorrect': True}, {'text': 'Wrong', 'isCorrect': False}]}]})
        response = self.create(request, complete=True)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(json.loads(response.content)['author'], 'Synthetic author')
        self.assertEqual(self.packages.create.call_args.kwargs['questions'], 1)

    def test_upload_ignores_multipart_author_and_uses_the_uploader(self):
        request = self.factory.post('/quiz_api/quizzes/', {
            'file': io.BytesIO(b'<quiz/>'), 'author': 'Forged uploader', 'status': 'draft'})
        request.FILES['file'].name = 'synthetic.xml'
        questions = [{'text': 'Choose', 'question_type': 'single_choice', 'answers': [
            {'text': 'Right', 'is_correct': True}, {'text': 'Wrong', 'is_correct': False}]}]
        with patch.object(views, '_validate_xml', return_value=(True, '', 1, 'Quiz', questions, {})), \
             patch.object(views, '_store_question_images'):
            response = self.create(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(json.loads(response.content)['author'], 'Synthetic author')

    def test_another_signed_in_creator_is_not_given_the_previous_users_name(self):
        for name in ('First creator', 'Second creator'):
            request = self.request('post', {'title': name})
            request.login_account.display_name = name
            response = self.create(request)
            self.assertEqual(json.loads(response.content)['author'], name)

    def test_email_is_used_only_when_the_accounts_display_name_is_empty(self):
        request = self.request('post', {})
        request.login_account.display_name = ' '
        response = self.create(request)
        self.assertEqual(json.loads(response.content)['author'], 'staff@example.invalid')

    def test_long_account_name_fits_the_existing_author_column(self):
        request = self.request('post', {})
        request.login_account.display_name = 'A' * 150
        response = self.create(request)
        self.assertEqual(json.loads(response.content)['author'], 'A' * 120)

    def test_existing_django_session_uses_its_server_side_identity(self):
        request = self.request('post', {'author': 'Forged'})
        request.login_account = None
        request.user = SimpleNamespace(is_authenticated=True, get_full_name=lambda: 'Legacy operator',
                                       get_username=lambda: 'operator')
        response = self.create(request)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(json.loads(response.content)['author'], 'Legacy operator')

    def test_cookie_session_is_resolved_by_the_existing_authentication_service(self):
        request = RequestFactory().post('/quiz_api/quizzes/', '{}', content_type='application/json')
        request.COOKIES[sessions.COOKIE_NAME] = 'synthetic-session-token'
        account = SimpleNamespace(role='staff', display_name='Cookie creator', email='creator@example.invalid')
        with patch.object(sessions, 'resolve_session', return_value=SimpleNamespace(account=account)) as resolve, \
             patch.object(sessions, 'touch_session'), patch.object(sessions, '_refresh_staff_role'):
            response = self.create(request)
        resolve.assert_called_once_with('synthetic-session-token')
        self.assertEqual(json.loads(response.content)['author'], 'Cookie creator')

    def test_anonymous_and_expired_sessions_cannot_create_or_run_schema_helpers(self):
        for complete in (False, True):
            request = RequestFactory().post('/quiz_api/quizzes/', json.dumps({'initialQuestions': []}),
                                            content_type='application/json')
            request.COOKIES[sessions.COOKIE_NAME] = 'expired-synthetic-token'
            with patch.object(sessions, 'resolve_session', return_value=None), \
                 patch.object(views, '_ensure_quiz_assessment_type_column') as schema:
                response = self.create(request, complete=complete)
            self.assertEqual(response.status_code, 401)
            schema.assert_not_called()
        self.packages.create.assert_not_called()

    def test_learner_and_employer_cannot_be_quiz_creators(self):
        for role in ('learner', 'employer'):
            request = self.request('post', {'author': 'Forged staff'})
            request.login_account.role = role
            self.assertEqual(self.create(request).status_code, 403)
        self.packages.create.assert_not_called()

    def test_unreadable_session_is_503_and_never_creates_a_quiz(self):
        request = self.request('post', {})
        request.login_account = None
        sessions.mark_session_unreadable(request)
        self.assertEqual(self.create(request).status_code, 503)
        with patch.object(views, 'authenticate_request', side_effect=DatabaseError):
            self.assertEqual(self.create(self.request('post', {})).status_code, 503)
        self.packages.create.assert_not_called()

    def test_missing_account_name_is_reported_without_a_placeholder_write(self):
        request = self.request('post', {})
        request.login_account.display_name = request.login_account.email = ''
        response = self.create(request)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)['code'], 'quiz_author_unavailable')
        self.packages.create.assert_not_called()

    def test_author_changes_are_rejected_atomically_including_with_other_fields(self):
        self.quiz.author = 'Historical creator'
        for author in ('Different person', '', None):
            response = views.quiz_detail(self.request('patch', {'author': author, 'title': 'Changed'}), 7)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(json.loads(response.content)['code'], 'quiz_author_read_only')
            self.assertEqual((self.quiz.author, self.quiz.title), ('Historical creator', 'Synthetic quiz'))
        self.save.assert_not_called()

    def test_other_edits_and_unchanged_legacy_author_payload_keep_history(self):
        for author in ('Historical creator', 'Curriculum Team', ''):
            self.quiz.author = author
            for payload in ({'duration': 45}, {'author': author, 'shortDescription': 'New description'}):
                response = views.quiz_detail(self.request('patch', payload), 7)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self.quiz.author, author)
        self.assertEqual(self.quiz.duration, 45)
        self.assertEqual(self.quiz.short_description, 'New description')
