"""Run with python -I. AST-load actual policy/views with in-memory adapters.

No Django startup, application imports, database setup, SQL execution or network.
These checks complement (and do not replace) owner-run database integration tests.
"""
import ast
import copy
import functools
import importlib.util
import json
import math
import re
import sys
import types
import unittest
import uuid
from contextlib import contextmanager, nullcontext
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import unquote
from urllib.parse import urlparse

if __name__ == '__main__' and not sys.flags.isolated:
    raise RuntimeError('Use python -I backend/learner_api/test_personal_learning_no_db.py')
ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('personal_policy', ROOT / 'personal_learning_policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)


def functions(filename, namespace, names=None):
    tree = ast.parse((ROOT / filename).read_text(encoding='utf-8-sig'))
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and (names is None or n.name in names)]
    for node in nodes:
        if node.name != 'activity_state':
            node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), namespace)


class Response(dict):
    def __init__(self, value, status=200):
        super().__init__(value)
        self.status_code = status


class PersonalLearningTests(unittest.TestCase):
    def setUp(self):
        blocker = patch('socket.socket', side_effect=AssertionError('Network is forbidden'))
        blocker.start()
        self.addCleanup(blocker.stop)
        self.account = types.SimpleNamespace(id=7, role='admin', display_name='Synthetic Admin', email='admin@example.invalid')
        self.context = policy.context_for('pl.7.study.MOD-A', self.account)
        self.state = {'progress': [], 'submissions': {}, 'evidence': {}}
        self.writes = 0
        self.now = datetime(2026, 9, 18, 10, tzinfo=timezone.utc)
        self.detail = {'id': self.context['id'], 'modules': ['Module A'], 'programme': 'Synthetic programme', 'ksbs': [],
            'components': [{'componentId': 'C1', 'component': 'Reading', 'type': 'reading', 'moduleId': 'MOD-A', 'module': 'Module A', 'week': 'Week 1', 'reflectionRequired': False}],
            'learningAccess': {'blocked': False, 'startDate': '2026-09-01'}, 'videoProgress': [], 'componentProgress': [], 'quizAttempts': []}
        self.store = types.ModuleType('learner_api.personal_learning_store')
        self.store.__dict__['json'] = json
        functions('personal_learning_store.py', self.store.__dict__, {'json_value'})
        self.store.load = Mock(side_effect=lambda *a, **kw: copy.deepcopy(self.state))
        @contextmanager
        def edit(*args):
            snapshot = copy.deepcopy(self.state)
            yield snapshot
            self.state = snapshot
            self.writes += 1
        self.store.edit = edit
        tracking = types.ModuleType('learner_api.time_tracking')
        tracking.verify_tracking_session = Mock(return_value={'sessionId': 'TIME-1', 'verifiedSeconds': 30, 'claimedSeconds': 999,
            'serverSessionSeconds': 30, 'startedAt': self.now, 'submittedAt': self.now, 'source': 'signed_session_capped_visible_page'})
        tracking.outside_uk_working_hours = lambda _: False
        certificates = types.ModuleType('learner_api.certificates')
        certificates.__dict__.update(re=re)
        functions('certificates.py', certificates.__dict__, {'_clean_text', '_progress_counts', '_component_activity_progress', '_subject_ref', '_module_components', '_module_progress'})
        self.template = {'id': 1, 'version': 1, 'title': 'Achievement', 'bodyText': 'Completed', 'minimumProgress': 100, 'requireFinalTest': False, 'layoutConfig': {}}
        certificates._published_template = lambda _: self.template
        certificates._template_dict = lambda value: value
        self.quiz = types.ModuleType('learner_api.quizzes')
        self.quiz._fetch_quiz = lambda _: {'title': 'Final quiz', 'passingGrade': 70, 'questions': [{'id': 1, 'text': 'Q', 'type': 'single_choice', 'points': 1}]}
        self.quiz._grade_question = lambda q, answer: {'earned': int(answer == 10), 'possible': 1, 'correct': answer == 10}
        self.modules = {'learner_api': types.ModuleType('learner_api'), 'learner_api.personal_learning_store': self.store,
            'learner_api.time_tracking': tracking, 'learner_api.certificates': certificates, 'learner_api.quizzes': self.quiz}
        modules = patch.dict(sys.modules, self.modules)
        modules.start()
        self.addCleanup(modules.stop)
        self.cursor = Mock()
        self.cursor.__enter__ = Mock(return_value=self.cursor)
        self.cursor.__exit__ = Mock(return_value=False)
        connection = types.SimpleNamespace(cursor=lambda: self.cursor)
        self.ns = {'__package__': 'learner_api', 'functools': functools, 'json': json, 're': re, 'uuid': uuid, 'unquote': unquote,
            'contextmanager': contextmanager, 'store': self.store, 'context_for': policy.context_for, 'component_for': policy.component_for,
            'request_target': policy.request_target, 'progress_detail': policy.progress_detail,
            'submission_key': policy.submission_key,
            'JsonResponse': Response, 'csrf_exempt': lambda f: f, 'authenticate_request': lambda _: self.account,
            '_unauthenticated': lambda _: Response({'error': 'Authentication required'}, status=401),
            'DatabaseError': type('DatabaseError', (Exception,), {}), 'connections': {'enrolment': connection},
            'transaction': types.SimpleNamespace(atomic=lambda **_: nullcontext()),
            'timezone': types.SimpleNamespace(now=lambda: self.now), 'get_token': lambda _: 'csrf'}
        functions('personal_learning.py', self.ns)
        self.ns['course_detail'] = lambda *args: (copy.deepcopy(self.detail), {'title': 'Module A'})
        self.request = types.SimpleNamespace(method='POST', headers={'X-Requested-With': 'XMLHttpRequest'}, content_type='application/json', body=b'{}', GET={})

    def test_context_rejects_other_accounts_roles_and_modes(self):
        for identity in ['pl.8.study.MOD-A', 'pl.7.admin.MOD-A', '42']:
            with self.subTest(identity=identity), self.assertRaises(PermissionError):
                policy.context_for(identity, self.account)
        for role in ['learner', 'staff', 'employer']:
            self.account.role = role
            with self.assertRaises(PermissionError):
                policy.context_for(self.context['id'], self.account)

    def test_gateway_refuses_cross_course_and_cross_owner_requests(self):
        for path in ['/learner_api/evidence/commercial/pl.8.study.MOD-A/', '/learner_api/quizzes/2/?learnerId=pl.7.study.MOD-B']:
            with self.assertRaises(PermissionError):
                policy.request_target(path, self.context['id'])
        with self.assertRaises(ValueError):
            policy.request_target('https://example.invalid/learner_api/quizzes/', self.context['id'])

    def test_session_and_csrf_boundary_fail_closed(self):
        view = Mock(return_value=Response({'ok': True}))
        wrapped = self.ns['endpoint'](view)
        self.account = None
        self.assertEqual(wrapped(self.request).status_code, 401)
        self.account = types.SimpleNamespace(role='staff')
        self.assertEqual(wrapped(self.request).status_code, 403)
        self.account.role = 'admin'
        self.request.headers = {}
        self.assertEqual(wrapped(self.request).status_code, 403)
        view.assert_not_called()

    def test_preview_completion_cannot_write_personal_or_official_progress(self):
        for mode in ['preview', 'all']:
            context = {**self.context, 'mode': mode, 'id': f'pl.7.{mode}.MOD-A'}
            result = self.ns['complete_activity'](context, self.account, self.detail, 'C1', 'component', {'trackingToken': 'signed'})
            self.assertTrue(result['preview'])
            self.assertEqual(result['record']['verifiedSeconds'], 30)
        self.assertEqual(self.writes, 0)
        self.assertEqual(self.state['progress'], [])

    def test_retry_does_not_duplicate_completion(self):
        for _ in range(2):
            self.ns['complete_activity'](self.context, self.account, self.detail, 'C1', 'component', {'trackingToken': 'signed'})
        self.assertEqual(len(self.state['progress']), 1)
        self.assertEqual(self.state['progress'][0]['attempt'], 1)

    def test_unassigned_activity_is_refused_before_storage(self):
        with self.assertRaises(LookupError):
            self.ns['complete_activity'](self.context, self.account, self.detail, 'OTHER', 'component', {})
        self.assertEqual(self.writes, 0)

    def test_realistic_mode_observes_dates_and_all_content_preview_bypasses_only_dates(self):
        self.detail['learningAccess']['blocked'] = True
        for mode in ['study', 'preview']:
            with self.assertRaises(PermissionError):
                self.ns['ensure_open'](self.detail, {**self.context, 'mode': mode})
        self.ns['ensure_open'](self.detail, {**self.context, 'mode': 'all'})

    def test_tutor_required_activity_does_not_count_towards_certificate(self):
        self.detail['components'][0]['tutorValidationRequired'] = True
        self.ns['complete_activity'](self.context, self.account, self.detail, 'C1', 'component', {'feedback': 'My reflection'})
        self.assertFalse(self.state['progress'][0]['passed'])
        self.assertEqual(self.state['submissions']['reading:C1']['status'], 'submitted_for_tutor_review')
        detail = policy.progress_detail(self.detail, self.state['progress'], self.state['submissions'])
        self.assertEqual(self.ns['progress'](detail, 'MOD-A')['progressPercent'], 0)

    def test_tutor_required_activity_accepts_an_explicit_reflection_skip(self):
        self.detail['components'][0]['tutorValidationRequired'] = True
        result = self.ns['complete_activity'](
            self.context, self.account, self.detail, 'C1', 'component',
            {'feedback': '', 'skipReflection': True},
        )
        self.assertTrue(result['record']['reflectionSkipped'])
        self.assertEqual(result['record']['feedback'], '')
        self.assertFalse(result['record']['passed'])

    def test_quiz_uses_server_grade_and_retry_retains_original_result(self):
        self.detail['components'] = [{'componentId': 'Q1', 'component': 'Final quiz', 'moduleId': 'MOD-A', 'module': 'Module A', 'isQuiz': True, 'quizMeta': {'quizId': 1}}]
        result = self.ns['submit_quiz'](self.context, self.account, self.detail, '1', {'answers': {'1': 9}, 'passed': True, 'grade': 1})
        self.assertFalse(result['passed'])
        repeated = self.ns['submit_quiz'](self.context, self.account, self.detail, '1', {'answers': {'1': 10}})
        self.assertEqual(repeated, result)
        self.assertEqual(len(self.state['progress']), 1)

    def test_preview_and_incomplete_course_cannot_issue_certificate(self):
        self.cursor.fetchone.return_value = None
        for mode in ['preview', 'all', 'study']:
            with self.subTest(mode=mode), self.assertRaises(PermissionError):
                self.ns['certificate']({**self.context, 'mode': mode}, self.account, self.detail, self.request, issue=True)
        self.assertTrue(all(call.args[0].startswith('SELECT') for call in self.cursor.execute.call_args_list))

    def test_completed_course_certificate_is_idempotent(self):
        self.detail['componentProgress'] = [{'componentId': 'C1', 'passed': True}]
        self.cursor.fetchone.return_value = ({'certificateNumber': 'PL-EXISTING'},)
        result = self.ns['certificate'](self.context, self.account, self.detail, self.request, issue=True)
        self.assertFalse(result['issued'])
        self.assertEqual(result['certificate']['certificateNumber'], 'PL-EXISTING')
        self.assertTrue(all(call.args[0].startswith('SELECT') for call in self.cursor.execute.call_args_list))

    def test_postgres_json_text_and_decoded_records_have_same_shape(self):
        for value in [{'status': 'draft'}, '{"status":"draft"}']:
            self.assertEqual(self.store.json_value(value, dict), {'status': 'draft'})
        with self.assertRaises(ValueError):
            self.store.json_value('[]', dict)

    def test_new_certificate_writes_only_isolated_tables_and_keeps_snapshot(self):
        self.detail['componentProgress'] = [{'componentId': 'C1', 'passed': True}]
        self.cursor.fetchone.side_effect = [None, (12,)]
        result = self.ns['certificate'](self.context, self.account, self.detail, self.request, issue=True)
        self.assertTrue(result['issued'])
        self.assertEqual(result['certificate']['id'], 12)
        self.assertEqual(result['certificate']['snapshot']['progressPercent'], 100)
        self.assertTrue(result['certificate']['verificationUrl'].startswith('/verify-personal-certificate/'))
        for call in self.cursor.execute.call_args_list:
            self.assertIn('personal_course_certificates', call.args[0])

    def test_final_assessment_still_required_at_full_activity_progress(self):
        self.detail['componentProgress'] = [{'componentId': 'C1', 'passed': True}]
        self.template['requireFinalTest'] = True
        self.cursor.fetchone.return_value = None
        with self.assertRaises(PermissionError):
            self.ns['certificate'](self.context, self.account, self.detail, self.request, issue=True)
        self.assertTrue(all(call.args[0].startswith('SELECT') for call in self.cursor.execute.call_args_list))

    def test_gateway_does_not_dispatch_booking_or_sync(self):
        activity = types.ModuleType('learner_api.personal_learning_activities')
        activity.handle_activity_request = Mock(return_value=None)
        with patch.dict(sys.modules, {'learner_api.personal_learning_activities': activity}):
            for target in ['/learner_api/calendar/commercial/pl.7.study.MOD-A/book/', '/learner_api/session-results/commercial/pl.7.study.MOD-A/S1/sync/']:
                self.request.GET = {'path': target}
                with self.assertRaises(LookupError):
                    self.ns['learner_request'](self.request, self.account, self.context['id'])
        self.assertEqual(self.writes, 0)

    def activity_namespace(self):
        personal = types.ModuleType('learner_api.personal_learning')
        personal.__dict__.update(self.ns)
        patcher = patch.dict(sys.modules, {'learner_api.personal_learning': personal})
        patcher.start()
        self.addCleanup(patcher.stop)
        ns = {**self.ns, 'LOCKED': {'accepted', 'submitted_for_tutor_review'}, 'submission_key': policy.submission_key}
        tree = ast.parse((ROOT / 'personal_learning_activities.py').read_text(encoding='utf-8'))
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'SUBMISSION_FIELDS' for t in node.targets):
                ns['SUBMISSION_FIELDS'] = ast.literal_eval(node.value)
        functions('personal_learning_activities.py', ns, {'save_submission', 'owned_file', 'file_status'})
        return ns

    def test_reflection_uses_authored_activity_and_server_owned_status(self):
        ns = self.activity_namespace()
        self.detail['components'][0]['type'] = 'powerpoint'
        result = ns['save_submission'](self.context, self.account, self.detail, {
            'activityId': 'C1', 'activityType': 'slide deck', 'submissionMode': 'draft',
            'learningReflection': 'Synthetic reflection', 'status': 'accepted', 'submissionOrigin': 'imported_legacy', 'passed': True})
        self.assertEqual(result['status'], 'draft')
        stored = self.state['submissions']['powerpoint:C1']
        self.assertEqual(stored['submissionOrigin'], 'learner')
        self.assertNotIn('passed', stored)
        self.assertEqual(self.state['progress'], [])

    def test_personal_study_waives_only_booking_and_preview_keeps_the_learner_rule(self):
        shared = types.ModuleType('learner_api.monthly_assignment')
        shared.__dict__.update(math=math, urlparse=urlparse, valid_presentation=lambda _: False)
        functions('monthly_assignment.py', shared.__dict__, {'text', 'words', 'mapping', 'items', 'assignment_checks'})
        ns = self.activity_namespace()
        functions('personal_learning_activities.py', ns, {'assignment_checks', 'validate_assignment'})
        ordinary = shared.assignment_checks({}, evidence_ids=set(), meeting_booked=False, allowed_ksbs=set())
        with patch.dict(sys.modules, {'learner_api.monthly_assignment': shared}):
            personal = ns['assignment_checks'](self.context, self.detail, self.state, {})
            self.assertEqual(len(personal), len(ordinary))
            for before, after in zip(ordinary, personal):
                if before['key'] == 'meeting':
                    self.assertFalse(before['passed'])
                    self.assertTrue(after['passed'])
                    self.assertIn('not required', after['label'])
                else:
                    self.assertEqual(before, after)
            with self.assertRaisesRegex(ValueError, 'Assignment answer'):
                ns['validate_assignment'](self.context, self.detail, self.state, {})
            for mode in ('preview', 'all'):
                checks = ns['assignment_checks']({**self.context, 'mode': mode}, self.detail, self.state, {})
                self.assertEqual(checks, ordinary)

    def test_submitted_evidence_is_locked_and_other_course_files_are_inaccessible(self):
        ns = self.activity_namespace()
        self.state['submissions']['assignment:C1'] = {'activityId': 'C1', 'status': 'submitted_for_tutor_review'}
        file = {'sectionRef': 'presentation-reference-C1', 'activityId': 'C1'}
        self.assertTrue(ns['file_status'](self.state, file))
        with self.assertRaises(LookupError):
            ns['owned_file'](self.state, 'OTHER-FILE')

    def test_preview_revision_reading_is_refused_without_generation_or_storage(self):
        reading_ns = {'store': self.store}
        functions('personal_learning_quiz_reading.py', reading_ns, {'reading_record'})
        with self.assertRaises(PermissionError):
            reading_ns['reading_record']({**self.context, 'mode': 'preview'}, 'quiz-reading:1:1')
        self.store.load.assert_not_called()

    def test_quiz_reflection_ids_still_require_an_assigned_quiz(self):
        self.detail['components'][0].update(isQuiz=True, quizMeta={'quizId': 1})
        self.assertEqual(policy.component_for(self.detail, 'quiz-1')['componentId'], 'C1')
        with self.assertRaises(LookupError):
            policy.component_for(self.detail, 'quiz-2')

    def test_revision_reuses_saved_material_and_get_performs_no_write(self):
        personal = types.ModuleType('learner_api.personal_learning')
        personal.__dict__.update(self.ns)
        revision = types.ModuleType('learner_api.quiz_reading')
        revision._generate_material = Mock(return_value={'title': 'Revision', 'sections': []})
        revision._apply_reading_time_mode = lambda tracking, _: tracking
        ns = {**self.ns, 'SimpleNamespace': types.SimpleNamespace, 'nullcontext': nullcontext}
        functions('personal_learning_quiz_reading.py', ns)
        self.detail['components'][0].update(isQuiz=True, quizMeta={'quizId': 1})
        self.state['progress'] = [{'kind': 'quiz', 'quizId': 1, 'attempt': 1, 'grade': 0, 'passed': False, 'questions': []}]
        with patch.dict(sys.modules, {'learner_api.personal_learning': personal, 'learner_api.quiz_reading': revision}):
            for _ in range(2):
                response = ns['reading_request'](self.request, self.context, self.detail, '1', {'attempt': '1'}, {'action': 'generate'})
                self.assertEqual(response['material']['title'], 'Revision')
            revision._generate_material.assert_called_once()
            before = self.writes
            self.request.method = 'GET'
            ns['reading_request'](self.request, self.context, self.detail, '1', {'attempt': '1'}, {})
            self.assertEqual(self.writes, before)
            with self.assertRaises(LookupError):
                ns['reading_request'](self.request, self.context, self.detail, '1', {'attempt': '2'}, {})

    def review_namespace(self):
        ns = {**self.ns, 'copy': copy, 'datetime': datetime}
        functions('personal_learning_review.py', ns)
        return ns

    def test_course_coach_resolution_rejects_missing_or_ambiguous_assignments(self):
        ns = self.review_namespace()
        coach = {'id': 9, 'uuid': 'staff-9', 'name': 'Course Coach', 'email': 'coach@example.invalid'}
        self.assertEqual(ns['resolve_coach']({'coach_name': ' course coach '}, [coach]), coach)
        self.assertIsNone(ns['resolve_coach']({'coach_name': 'Unassigned'}, [coach]))
        self.assertIsNone(ns['resolve_coach']({'coach_name': 'Course Coach'}, [coach, {**coach, 'id': 10}]))
        self.assertIsNone(ns['resolve_coach']({'coach_name': 'Course Coach', 'coach_email': 'other@example.invalid'}, [coach]))

    def test_only_assigned_coach_can_access_work_and_admin_cannot_review_their_own(self):
        ns = self.review_namespace()
        coach = {'id': 9, 'uuid': 'staff-9', 'name': 'Course Coach', 'email': 'coach@example.invalid'}
        ns['coach_candidates'] = lambda: [coach]
        self.cursor.fetchall.return_value = [(7, 'MOD-A', {'reading:C1': {'id': 'SUB1'}}, 'Synthetic Admin',
                                            'admin@example.invalid', {'coach_name': 'Course Coach'})]
        request = types.SimpleNamespace(coach_staff=types.SimpleNamespace(id=9),
                    login_account=types.SimpleNamespace(id=11, email='coach@example.invalid'))
        self.assertEqual(len(list(ns['review_courses'](request))), 1)
        request.coach_staff.id = 10
        self.assertEqual(list(ns['review_courses'](request)), [])
        request.coach_staff.id = 9
        request.login_account = self.account
        self.assertEqual(list(ns['review_courses'](request)), [])

    def test_review_acceptance_updates_personal_progress_and_retains_audit_snapshot(self):
        ns = self.review_namespace()
        self.state['submissions']['reading:C1'] = {'id': 'SUB1', 'activityId': 'C1', 'version': 1,
            'status': 'submitted_for_tutor_review', 'learningReflection': 'Original answer'}
        self.state['progress'] = [{'kind': 'component', 'componentId': 'C1', 'passed': False,
                                  'submissionId': 'SUB1', 'timeTrackingSessionId': 'TIME-1'}]
        actor = types.SimpleNamespace(id=11, display_name='Course Coach', email='coach@example.invalid')
        result = ns['decide'](self.state, 'SUB1', {'decision': 'accepted', 'feedback': 'Well done', 'version': 1}, actor, {'id': 9})
        self.assertEqual(result['status'], 'accepted')
        self.assertTrue(self.state['progress'][0]['passed'])
        submission = self.state['submissions']['reading:C1']
        self.assertEqual(submission['reviewHistory'][0]['reviewerAccountId'], 11)
        self.assertEqual(submission['reviewHistory'][0]['submission']['learningReflection'], 'Original answer')
        with self.assertRaisesRegex(ValueError, 'changed'):
            ns['decide'](self.state, 'SUB1', {'decision': 'referred', 'feedback': 'Stale', 'version': 1}, actor, {'id': 9})
        self.assertTrue(self.state['progress'][0]['passed'])
        self.assertEqual(len(submission['reviewHistory']), 1)

    def test_referral_requires_feedback_and_allows_a_new_attempt_without_erasing_history(self):
        ns = self.review_namespace()
        self.state['submissions']['reading:C1'] = {'id': 'SUB1', 'activityId': 'C1', 'version': 1,
            'status': 'submitted_for_tutor_review', 'learningReflection': 'Original answer'}
        self.state['progress'] = [{'kind': 'component', 'componentId': 'C1', 'passed': False, 'submissionId': 'SUB1'}]
        with self.assertRaisesRegex(ValueError, 'feedback'):
            ns['decide'](self.state, 'SUB1', {'decision': 'referred', 'version': 1}, self.account, {'id': 9})
        ns['decide'](self.state, 'SUB1', {'decision': 'referred', 'version': 1, 'feedback': 'Explain your example'}, self.account, {'id': 9})
        activities = self.activity_namespace()
        saved = activities['save_submission'](self.context, self.account, self.detail,
            {'activityId': 'C1', 'submissionMode': 'draft', 'learningReflection': 'Revised answer'})
        self.assertNotEqual(saved['id'], 'SUB1')
        self.assertEqual(len(self.state['submissions']['reading:C1']['reviewHistory']), 1)
        self.assertFalse(self.state['progress'][0]['passed'])

    def test_review_does_not_accept_a_draft_or_work_without_a_completed_activity(self):
        ns = self.review_namespace()
        self.state['submissions']['reading:C1'] = {'id': 'SUB1', 'status': 'draft'}
        with self.assertRaises(LookupError):
            ns['decide'](self.state, 'SUB1', {'decision': 'accepted', 'version': 1}, self.account, {'id': 9})
        self.state['submissions']['reading:C1']['status'] = 'submitted_for_tutor_review'
        with self.assertRaisesRegex(ValueError, 'not finished'):
            ns['decide'](self.state, 'SUB1', {'decision': 'accepted', 'version': 1}, self.account, {'id': 9})

    def test_submission_referral_resubmission_and_acceptance_unlock_certificate(self):
        self.detail['components'][0]['tutorValidationRequired'] = True
        self.ns['course_detail'] = lambda *args: (
            policy.progress_detail(self.detail, self.state['progress'], self.state['submissions']), {})
        activities = self.activity_namespace()
        reviews = self.review_namespace()
        coach = types.SimpleNamespace(id=11, display_name='Course Coach', email='coach@example.invalid')
        self.cursor.fetchone.return_value = None
        for attempt, decision in [(1, 'referred'), (2, 'accepted')]:
            self.modules['learner_api.time_tracking'].verify_tracking_session.return_value['sessionId'] = f'TIME-{attempt}'
            answer = f'Reflection attempt {attempt}'
            activities['save_submission'](self.context, self.account, self.detail,
                {'activityId': 'C1', 'submissionMode': 'draft', 'learningReflection': answer})
            self.ns['complete_activity'](self.context, self.account, self.detail, 'C1', 'component', {'feedback': answer})
            with self.assertRaises(PermissionError):
                self.ns['certificate'](self.context, self.account, self.detail, self.request, issue=True)
            current = self.state['submissions']['reading:C1']
            reviews['decide'](self.state, current['id'],
                {'decision': decision, 'feedback': f'Coach response {attempt}', 'version': current['version']}, coach, {'id': 9})
        self.assertEqual([row['passed'] for row in self.state['progress']], [False, True])
        history = self.state['submissions']['reading:C1']['reviewHistory']
        self.assertEqual([entry['submission']['learningReflection'] for entry in history], ['Reflection attempt 1', 'Reflection attempt 2'])
        self.cursor.fetchone.side_effect = [None, (12,)]
        issued = self.ns['certificate'](self.context, self.account, self.detail, self.request, issue=True)
        self.assertTrue(issued['issued'])
        self.assertEqual(issued['certificate']['progressPercent'], 100)


if __name__ == '__main__':
    unittest.main()
