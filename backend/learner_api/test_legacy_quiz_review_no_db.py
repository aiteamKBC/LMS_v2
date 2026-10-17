"""Synthetic review regressions: no application startup, database or network."""
import ast
from contextlib import nullcontext
import functools
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT.parent))
from django.conf import settings
if not settings.configured:
    settings.configure(DEFAULT_CHARSET='utf-8')
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from learner_api.subject_content import public_quiz, quiz_definition
from learner_api.subject_quiz import imported_quiz


class ServiceError(Exception):
    def __init__(self, message, code=None, status=400):
        super().__init__(message)
        self.status = status


def load(path, names, scope, *, decorated=False):
    nodes = [node for node in ast.parse(path.read_text(encoding='utf-8')).body
             if isinstance(node, ast.FunctionDef) and node.name in names]
    if not decorated:
        for node in nodes:
            node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)
    return scope


class QuizReviewTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network prohibited'))
        network.start(); self.addCleanup(network.stop)
        self.owner = {'id': 7, 'enrolment_id': 9, 'aptem_id': 11, 'email': 'learner@example.test'}
        self.item = {'group_id': 50, 'source_activity_id': 60, 'catalogue_kind': 'quiz',
                     'completed': True, 'activity': 'Example quiz'}
        self.catalogue = Mock(return_value={'activities': [self.item]})
        self.canonical = SimpleNamespace(source_subjects=self.catalogue, ServiceError=ServiceError)
        self.cursor = Mock()
        self.export = {'passing_grade_percent': 80, 'quiz_definition': {'question_count': 1, 'questions': [
            {'question_id': 12, 'question_text': 'Example?', 'question_type': 'single_choice',
             'answer_options': [{'option_order': 1, 'option_text': 'Yes'}, {'option_order': 2, 'option_text': 'No'}],
             'correct_answers': ['Yes']}]}}
        self.cursor.fetchall.return_value = [(self.export,)]
        self.attempt = {'score': 100, 'maximum_score': 100, 'passed': True,
            'attempt_number': 2, 'status': 'passed', 'answers': [{'question_id': 12,
                'question_body': 'Example?', 'learner_answer': ['Yes'], 'is_correct': True,
                'correct_answer': ['Yes'], 'awarded_score': 100, 'maximum_score': 100}]}
        self.query = Mock(return_value=[self.attempt])
        self.repository = SimpleNamespace(query=self.query, DB='enrolment',
                                          _query_alias=SimpleNamespace(get=lambda: 'isolated'))
        self.scope = load(ROOT / 'legacy_quiz_review.py', {'read_review'}, dict(json=json,
            canonical_learning=self.canonical, repository=self.repository,
            connections={'isolated': SimpleNamespace(cursor=lambda: nullcontext(self.cursor))},
            imported_quiz=imported_quiz, public_quiz=public_quiz, quiz_definition=quiz_definition))

    def review(self):
        return self.scope['read_review'](self.owner, 50, 60)

    def test_owned_course_quiz_returns_one_original_attempt_without_grading_keys_or_writes(self):
        result = self.review()
        self.assertEqual(result['historical']['score'], 100)
        self.assertEqual(result['historical']['attempt_number'], 2)
        self.assertEqual(result['historical']['answers'][0]['learner_answer'], ['Yes'])
        self.assertTrue(result['completed'])
        self.assertTrue(result['available'])
        self.assertFalse(result['can_attempt'])
        self.assertFalse(result['persistence_ready'])
        self.assertEqual(result['history'], [])
        self.assertNotIn('solution_ids', json.dumps(result))
        self.assertNotIn('correct_answer', json.dumps(result))
        self.assertNotIn('awarded_score', json.dumps(result))
        self.assertEqual(self.cursor.execute.call_args.args[1], [50, '60'])
        self.assertEqual(self.query.call_args.args[1], [7, 50, 60])
        self.assertTrue(self.query.call_args.args[0].lstrip().startswith('SELECT'))
        self.assertEqual(self.catalogue.call_args.args[0], 9)
        self.assertEqual(self.catalogue.call_args.kwargs, {'owner': self.owner})

    def test_django_json_text_matches_decoded_content_and_history(self):
        expected = self.review()
        self.cursor.fetchall.return_value = [(json.dumps(self.export),)]
        self.attempt['answers'] = json.dumps(self.attempt['answers'])
        self.assertEqual(self.review(), expected)

    def test_other_course_kind_unfinished_or_excluded_quiz_is_denied_before_reading_answers(self):
        for changes in ({'group_id': 51}, {'source_activity_id': 61},
                        {'catalogue_kind': 'material'}, {'completed': False}):
            with self.subTest(changes=changes):
                self.catalogue.return_value = {'activities': [{**self.item, **changes}]}
                with self.assertRaises(ServiceError) as caught:
                    self.review()
                self.assertEqual(caught.exception.status, 404)
        self.catalogue.return_value = {'activities': []}
        with self.assertRaises(ServiceError):
            self.review()
        self.cursor.execute.assert_not_called()
        self.query.assert_not_called()

    def test_catalogue_identity_or_scope_error_is_preserved(self):
        self.catalogue.side_effect = ServiceError('Scope needs review', status=409)
        with self.assertRaises(ServiceError) as caught:
            self.review()
        self.assertEqual(caught.exception.status, 409)
        self.query.assert_not_called()

    def test_missing_attempt_does_not_invent_answers_or_a_score(self):
        self.query.return_value = []
        result = self.review()
        self.assertTrue(result['available'])
        self.assertTrue(result['completed'])
        self.assertEqual(result['historical']['answers'], [])
        self.assertIsNone(result['historical']['score'])

    def test_missing_original_questions_keeps_saved_attempt_review(self):
        self.cursor.fetchall.return_value = []
        result = self.review()
        self.assertIsNone(result['quiz'])
        self.assertTrue(result['available'])
        self.assertEqual(len(result['historical']['answers']), 1)

    def test_missing_content_and_attempt_is_explicit_and_preserves_completion(self):
        self.cursor.fetchall.return_value = []
        self.query.return_value = []
        result = self.review()
        self.assertFalse(result['available'])
        self.assertTrue(result['completed'])

    def test_available_questions_can_be_reviewed_without_grading_definitions(self):
        self.export['quiz_definition']['questions'][0]['correct_answers'] = []
        self.assertIsNone(imported_quiz(self.cursor, 50, 60))
        result = self.review()
        self.assertEqual(len(result['quiz']['questions']), 1)
        self.assertFalse(result['quiz']['ready'])
        self.assertFalse(result['can_attempt'])

    def test_malformed_saved_answers_are_reported_instead_of_silently_discarded(self):
        for value in ('invalid', 'null', '{}', '[1]', {}, 0, False, {'unexpected': True}):
            with self.subTest(value=value):
                self.attempt['answers'] = value
                with self.assertRaises(ServiceError) as caught:
                    self.review()
                self.assertEqual(caught.exception.status, 409)


class QuizReviewEndpointTests(unittest.TestCase):
    def setUp(self):
        self.owner = {'id': 7, 'enrolment_id': 9, 'aptem_id': 11, 'email': 'learner@example.test'}
        canonical = ModuleType('learner_api.canonical_learning')
        canonical.require_profile = Mock(return_value=self.owner)
        canonical.ServiceError = ServiceError
        review = ModuleType('learner_api.legacy_quiz_review')
        review.read_review = Mock(return_value={'completed': True, 'can_attempt': False})
        case_file = ModuleType('learner_api.case_file_sources')
        case_file.source_for_case_file = Mock(return_value=None)
        self.canonical, self.review = canonical, review
        modules = patch.dict(sys.modules, {module.__name__: module for module in (canonical, review, case_file)})
        modules.start(); self.addCleanup(modules.stop)
        model = SimpleNamespace(all_learners=Mock(), DoesNotExist=LookupError)
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(aptem_id=11, email=self.owner['email'])
        scope = dict(__package__='learner_api', functools=functools, JsonResponse=JsonResponse,
            require_GET=require_GET, learner_journal_view=lambda view: view,
            authenticate_request=lambda request: request.account, _auth_gate_enabled=lambda: True,
            _target_learner_id=lambda request, kwargs, **_: kwargs['pk'],
            _unauthenticated=lambda _: JsonResponse({}, status=401),
            _read_only_learner_view=lambda: JsonResponse({}, status=403),
            SOURCE_MODELS={'commercial': model, 'apprenticeship': model},
            student_activity_available=lambda _: True, DatabaseError=RuntimeError)
        load(ROOT.parent / 'login/permissions.py', {'_learner_progress_gate', 'learner_self_or_staff'}, scope)
        load(ROOT / 'student_activity.py', {'_error', '_private', '_emails_match'}, scope)
        load(ROOT / 'student_activity.py', {'student_activity'}, scope, decorated=True)
        self.view = scope['student_activity']

    def request(self, role='learner', subject_id=9, method='GET', query=None, kind='commercial'):
        return self.view(SimpleNamespace(method=method, path='/quiz-review/',
            account=SimpleNamespace(role=role, subject_id=subject_id) if role else None,
            GET=query or {'catalogue_kind': 'quiz', 'group_id': '50', 'activity_id': '60',
                         'aptem_id': '999', 'learner_id': '999'}), kind=kind, pk=9)

    def test_owner_and_staff_can_read_both_learner_types_using_server_identity(self):
        for kind in ('commercial', 'apprenticeship'):
            for role in ('learner', 'staff', 'admin'):
                with self.subTest(kind=kind, role=role):
                    response = self.request(role=role, kind=kind)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response['Cache-Control'], 'private, no-store')
                    self.review.read_review.assert_called_with(self.owner, 50, 60)

    def test_other_learners_and_unprivileged_roles_cannot_read_answers(self):
        for role, subject, status in (('learner', 10, 404), ('coach', 9, 403),
                                      ('employer', 9, 403), (None, 9, 401)):
            with self.subTest(role=role):
                self.assertEqual(self.request(role, subject).status_code, status)
        self.review.read_review.assert_not_called()
        self.canonical.require_profile.assert_not_called()

    def test_review_endpoint_rejects_writes(self):
        self.assertEqual(self.request(method='POST').status_code, 405)
        self.review.read_review.assert_not_called()

    def test_invalid_references_do_not_reach_reader(self):
        for quiz in ('0', '-2', 'bad', '9223372036854775808'):
            self.assertEqual(self.request(query={'catalogue_kind': 'quiz', 'group_id': '50',
                                               'activity_id': quiz}).status_code, 400)
        self.review.read_review.assert_not_called()

    def test_mismatched_canonical_identity_is_denied(self):
        self.owner['aptem_id'] = 12
        self.assertEqual(self.request().status_code, 409)
        self.review.read_review.assert_not_called()

    def test_scope_and_database_errors_remain_visible(self):
        for failure, status in ((ServiceError('Missing', status=404), 404), (RuntimeError('Database'), 503)):
            self.review.read_review.side_effect = failure
            self.assertEqual(self.request().status_code, status)


if __name__ == '__main__':
    unittest.main()
