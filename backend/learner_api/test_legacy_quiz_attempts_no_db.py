"""Exercise legacy grading and owner/type boundaries without DB or network."""
from contextlib import nullcontext
import functools
import json
from html import escape
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch
from uuid import UUID

from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.middleware.csrf import CsrfViewMiddleware
from django.test import RequestFactory
from .test_legacy_quiz_review_no_db import ROOT, ServiceError, load
from .subject_content import ContentUnavailable, public_quiz, quiz_definition
from . import subject_store


def definition():
    return {'title': 'Synthetic quiz', 'available': True, 'has_reading': False,
        'catalogue_kind': 'quiz', 'quiz': quiz_definition({'quiz_id': 60,
            'maximum_score': 100, 'passing_score': 80,
            'questions': [{'question_id': 1, 'question_body': 'Example?',
                'options': [{'option_order': 1, 'option_text': 'Yes'}, {'option_order': 2, 'option_text': 'No'}]}],
            'solutions': [{'question_id': 1, 'correct_answer': ['Yes']}]})}


class StoredQuizAttemptTests(unittest.TestCase):
    def setUp(self):
        self.cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value = nullcontext(self.cursor)
        self.enterContext(patch.object(subject_store, 'connections', {'enrolment': connection}))
        self.enterContext(patch.object(subject_store, 'ready', return_value=True))
        self.enterContext(patch.object(subject_store.transaction, 'atomic', return_value=nullcontext()))
        self.enterContext(patch('learner_api.progress_transfer_store.lock_learner', side_effect=lambda _: nullcontext(self.cursor)))
        self.enterContext(patch('learner_api.progress_transfer_store.assert_legacy_writable'))
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network prohibited')))

    def finish(self, answers):
        return subject_store.finish(9, 11, 50, 60, 'attempt', answers, False, catalogue_kind='quiz')

    def test_new_snapshot_persists_catalogue_type_and_server_grading_keys(self):
        subject_store.start(9, 11, 50, 60, definition())
        args = self.cursor.execute.call_args.args[1]
        self.assertEqual(args[1:5], [9, 11, 50, 60])
        saved = json.loads(args[-1])
        self.assertEqual(saved['catalogue_kind'], 'quiz')
        self.assertEqual(saved['quiz']['questions'][0]['solution_ids'], ['1'])
        self.assertNotIn('solution_ids', json.dumps(public_quiz(saved['quiz'])))

    def test_server_grades_snapshot_and_passes_only_correct_answer(self):
        for answer, passed in [('1', True), ('2', False)]:
            self.cursor.reset_mock()
            self.cursor.fetchone.return_value = [definition(), None, None, None, False]
            result = self.finish({'1': [answer]})
            self.assertEqual(result['completed'], passed)
            self.assertEqual(result['passed'], passed)
            sql, params = self.cursor.execute.call_args_list[0].args
            self.assertIn("coalesce(definition->>'catalogue_kind','material')=%s", sql)
            self.assertEqual(params, ['attempt', 9, 11, 50, 60, 'quiz'])
            self.assertIn('submitted_at=CURRENT_TIMESTAMP', self.cursor.execute.call_args.args[0])

    def test_missing_wrong_owner_or_wrong_type_attempt_cannot_be_submitted(self):
        self.cursor.fetchone.return_value = None
        with self.assertRaises(LookupError):
            self.finish({'1': ['1']})
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_retry_is_idempotent_and_invalid_answers_never_write(self):
        self.cursor.fetchone.return_value = [definition(), 'saved', 100, True, True]
        self.assertTrue(self.finish({'1': ['2']})['already_submitted'])
        self.assertEqual(self.cursor.execute.call_count, 1)
        self.cursor.reset_mock()
        self.cursor.fetchone.return_value = [definition(), None, None, None, False]
        with self.assertRaises(ValueError):
            self.finish({'1': ['invented']})
        self.assertEqual(self.cursor.execute.call_count, 1)

    def test_overlay_does_not_complete_material_with_matching_quiz_number(self):
        items = [{'group_id': 50, 'source_activity_id': 60, 'catalogue_kind': kind, 'completed': False}
                 for kind in ('material', 'quiz')]
        rows = subject_store.overlay_progress(items, [{'group_id': 50, 'activity_id': 60,
            'catalogue_kind': 'quiz', 'completed': True, 'best_percent': 100}])
        self.assertFalse(rows[0]['completed'])
        self.assertTrue(rows[1]['completed'])


class LegacyAttemptEndpointTests(unittest.TestCase):
    def setUp(self):
        canonical = ModuleType('learner_api.canonical_learning')
        canonical.ServiceError = ServiceError
        self.enterContext(patch.dict('sys.modules', {canonical.__name__: canonical}))
        self.enterContext(patch('learner_api.canonical_learning', canonical))
        self.owned = Mock(return_value=(11, {'title': 'Example quiz', 'completed': False}))
        self.store = SimpleNamespace(start=Mock(return_value='attempt'), finish=Mock(return_value={'completed': True}),
                                     StoreUnavailable=subject_store.StoreUnavailable)
        self.scope = dict(__package__='learner_api', functools=functools, json=json, UUID=UUID,
            JsonResponse=JsonResponse, require_POST=require_POST,
            authenticate_request=lambda request: request.account, _auth_gate_enabled=lambda: True,
            _target_learner_id=lambda request, kwargs, **_: kwargs['pk'],
            _unauthenticated=lambda _: JsonResponse({}, status=401),
            _read_only_learner_view=lambda: JsonResponse({}, status=403),
            coach_owns_learner=lambda *_: False, staff_owns_learner=lambda *_: False, audit_admin_learner_action=Mock(),
            subject_store=self.store, ContentUnavailable=ContentUnavailable, DatabaseError=RuntimeError,
            _owned_quiz=self.owned, _owned_material=Mock(side_effect=AssertionError('Wrong catalogue route')),
            public_quiz=public_quiz, _local_pdf_urls=lambda value, *_: value)
        load(ROOT.parent / 'login/permissions.py', {'_learner_progress_gate', 'learner_self_or_admin'}, self.scope)
        load(ROOT / 'student_activity.py', {'_error', '_private'}, self.scope)
        load(ROOT / 'student_activity.py', {'start_subject_attempt', 'submit_subject_attempt'}, self.scope, decorated=True)

    def request(self, name='submit_subject_attempt', role='learner', learner=9, kind='commercial', payload=None, **kwargs):
        request = SimpleNamespace(method='POST', path='/attempts/',
            account=SimpleNamespace(role=role, subject_id=learner) if role else None,
            GET={'catalogue_kind': 'quiz'}, body=json.dumps(payload if payload is not None else {'answers': {'1': ['1']},
                'aptem_id': 999, 'completed': True, 'score_percent': 100}).encode())
        if name == 'submit_subject_attempt':
            kwargs['attempt_id'] = '00000000-0000-4000-8000-000000000001'
        return self.scope[name](request, kind=kind, pk=9, group_id=50, activity_id=60, **kwargs)

    def test_submission_uses_server_identity_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            self.assertEqual(self.request(kind=kind).status_code, 200)
            self.owned.assert_called_with(kind, 9, 50, 60)
            self.store.finish.assert_called_with(9, 11, 50, 60,
                '00000000-0000-4000-8000-000000000001', {'1': ['1']}, False, catalogue_kind='quiz', learner_kind=kind,
                timing_payload={'answers': {'1': ['1']}, 'aptem_id': 999, 'completed': True, 'score_percent': 100})

    def test_other_accounts_and_staff_preview_cannot_write(self):
        for role, learner, status in [('learner', 10, 404), ('staff', 9, 403), ('employer', 9, 403), (None, 9, 401)]:
            self.assertEqual(self.request(role=role, learner=learner).status_code, status)
        self.owned.assert_not_called()
        self.store.finish.assert_not_called()

    def test_attempt_endpoint_keeps_csrf_protection(self):
        request = RequestFactory().post('/attempts/', data='{}', content_type='application/json')
        # Only replace HTML error rendering, which otherwise starts Django's
        # template app registry. The real middleware must reject this request.
        with patch('django.middleware.csrf._get_failure_view', return_value=lambda request, reason:
                   JsonResponse({'reason': reason}, status=403)):
            response = CsrfViewMiddleware(lambda _: None).process_view(
                request, self.scope['start_subject_attempt'], [], {})
        self.assertEqual(response.status_code, 403)
        self.assertIn('CSRF cookie not set', json.loads(response.content)['reason'])
        self.store.start.assert_not_called()

    def test_completed_quiz_does_not_create_another_attempt(self):
        self.owned.return_value[1]['completed'] = True
        self.assertEqual(self.request('start_subject_attempt').status_code, 409)
        self.store.start.assert_not_called()

    def test_start_keeps_grading_keys_in_server_snapshot_only(self):
        original = {'quiz_id': 60, 'maximum_score': 100, 'passing_score': 80,
            'questions': [{'question_id': 1, 'question_body': 'Example?', 'options': [
                {'option_order': 1, 'option_text': 'Yes'}, {'option_order': 2, 'option_text': 'No'}]}],
            'solutions': [{'question_id': 1, 'correct_answer': ['Yes']}]}
        self.scope['_connection'] = lambda: SimpleNamespace(cursor=lambda: nullcontext(Mock()))
        with patch('learner_api.subject_quiz.imported_quiz', return_value=original):
            response = self.request('start_subject_attempt', payload={'track_time': True})
        self.assertEqual(response.status_code, 201)
        snapshot = self.store.start.call_args.args[-1]
        self.assertEqual(snapshot['catalogue_kind'], 'quiz')
        self.assertEqual(snapshot['quiz']['questions'][0]['solution_ids'], ['1'])
        self.assertNotIn('solution_ids', response.content.decode())
        self.assertTrue(json.loads(response.content)['definition']['quiz']['ready'])
        self.assertEqual(json.loads(response.content)['timing']['countingMode'], 'active_quiz')
        self.assertEqual(self.store.start.call_args.kwargs['timing_session'], json.loads(response.content)['timing'])

    def test_completion_validation_returns_recoverable_response_without_success(self):
        from .working_rules import DeclaredCompletionError
        self.store.finish.side_effect = DeclaredCompletionError('Choose a completion time', reason='outside_working_hours')
        response = self.request(payload={'trackingToken': 'signed', 'timeTakenSeconds': 60})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(json.loads(response.content)['validation']['reason'], 'outside_working_hours')

    def test_revoked_course_or_identity_conflict_cannot_save(self):
        for status in (404, 409):
            self.owned.side_effect = ServiceError('Unavailable', status=status)
            self.assertEqual(self.request().status_code, status)
        self.store.finish.assert_not_called()


class MonthlyQuizEvidenceTests(unittest.TestCase):
    def test_standalone_saved_answers_do_not_open_same_number_material(self):
        views = ModuleType('learner_api.student_activity')
        views._owned_quiz = Mock()
        views._owned_material = Mock(side_effect=AssertionError('Unrelated material opened'))
        views._definition_for = Mock()
        views._local_pdf_urls = Mock()
        scope = dict(__package__='learner_api', escape=escape,
            decoded=lambda value, default: json.loads(value) if isinstance(value, str) else value or default,
            query=Mock(return_value=[{'group_id': 50, 'activity_id': 60,
                'definition': definition(), 'answers': {'1': ['1']}}]))
        load(ROOT / 'monthly_log_sources.py', {'activity_content', '_answers_html', '_part'}, scope)
        item = {'id': 10, 'source_ref': 'subject:attempt', 'title': 'Example', 'category': 'Quiz'}
        with patch.dict('sys.modules', {views.__name__: views}):
            result = scope['activity_content']({'id': 9, 'aptem_id': 11, '_profile': {'learner_type': 'commercial'}}, item)
        views._owned_quiz.assert_called_once_with('commercial', 9, 50, 60)
        views._owned_material.assert_not_called()
        self.assertEqual(len(result['parts']), 1)
        self.assertIn('<p>Yes</p>', result['parts'][0]['html'])
        self.assertNotIn('solution_ids', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
