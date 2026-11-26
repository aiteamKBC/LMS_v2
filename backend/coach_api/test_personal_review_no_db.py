"""Real Django views/auth/CSRF, synthetic repositories, no database or network.

Run directly with python -I; no project settings, migrations or test DB setup.
"""
import copy
import json
import sys
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch


class PersonalReviewHttpTests(unittest.TestCase):
    def setUp(self):
        from django.test import RequestFactory
        from learner_api.models import StaffUser
        from learner_api import personal_learning_review as rules
        from coach_api import personal_learning as views
        self.views = views
        self.factory = RequestFactory()
        self.coach = SimpleNamespace(id=9, uuid='staff-9', username='Course Coach', email='coach@example.invalid',
                                     access='coach', access_extra='', status='active')
        self.actor = SimpleNamespace(id=11, role='staff', subject_type='staff', subject_id=9,
                                     display_name='Course Coach', email='coach@example.invalid')
        self.submission_id = '00000000-0000-4000-8000-000000000001'
        self.state = {'submissions': {'reading:C1': {'id': self.submission_id, 'activityId': 'C1', 'activityType': 'reading',
            'version': 1, 'status': 'submitted_for_tutor_review', 'submittedAt': '2026-09-18T10:00:00+00:00'}},
            'progress': [{'submissionId': self.submission_id, 'passed': False}], 'evidence': {}}
        self.group = {'coach_name': 'Course Coach'}
        self.owner_id = 7
        self.owner_email = 'admin@example.invalid'
        self.cursor = Mock()
        self.cursor.__enter__ = Mock(return_value=self.cursor)
        self.cursor.__exit__ = Mock(return_value=False)
        self.cursor.fetchall.side_effect = lambda: [(self.owner_id, 'MOD-A', self.state['submissions'],
                                                    'Synthetic Admin', self.owner_email, self.group)]
        self.manager = Mock()
        self.manager.only.return_value = [self.coach]
        self.manager.filter.return_value.only.return_value.first.side_effect = lambda: self.staff
        self.staff = self.coach
        def authenticate(request):
            request.login_account = self.actor
            return self.actor
        @contextmanager
        def edit(owner, module):
            self.assertEqual((owner, module), (self.owner_id, 'MOD-A'))
            pending = copy.deepcopy(self.state)
            yield pending
            self.state = pending
        patches = [patch.object(StaffUser, 'objects', self.manager),
            patch('login.permissions.authenticate_request', side_effect=authenticate),
            patch.object(rules, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: self.cursor)}),
            patch.object(views.store, 'edit', side_effect=edit),
            patch.object(views.store, 'load', side_effect=lambda *_: copy.deepcopy(self.state))]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    def request(self, method='get', body=None, query=''):
        return getattr(self.factory, method)('/coach_api/coach/personal-marking/' + self.submission_id + query,
            data=json.dumps(body or {}) if method != 'get' else {}, content_type='application/json')

    def test_real_access_gate_refuses_no_session_learner_and_non_coach(self):
        original = self.actor
        for actor, status in [(None, 401), (SimpleNamespace(role='learner'), 403)]:
            self.actor = actor
            self.assertEqual(self.views.marking(self.request(), self.submission_id).status_code, status)
        self.actor = original
        self.staff = SimpleNamespace(access='tutor', access_extra='')
        self.assertEqual(self.views.marking(self.request(), self.submission_id).status_code, 403)
        self.cursor.execute.assert_not_called()

    def test_wrong_coach_and_spoofed_owner_cannot_review(self):
        self.group['coach_name'] = 'Another Coach'
        self.assertEqual(self.views.marking(self.request(), self.submission_id).status_code, 404)
        self.group['coach_name'] = 'Course Coach'
        self.assertEqual(self.views.marking(self.request(query='?owner_email=other@example.invalid'), self.submission_id).status_code, 403)
        self.assertFalse(self.state['progress'][0]['passed'])

    def test_coach_can_review_but_client_cannot_choose_attribution(self):
        request = self.request('patch', {'decision': 'accepted', 'feedback': 'Approved', 'version': 1, 'reviewedBy': 'Forged name'})
        response = self.views.marking(request, self.submission_id)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.state['progress'][0]['passed'])
        self.assertEqual(self.state['submissions']['reading:C1']['reviewedBy'], 'Course Coach')
        self.assertEqual(self.views.marking(request, self.submission_id).status_code, 400)

    def test_admin_viewing_course_coach_cannot_accept_own_work(self):
        self.actor = SimpleNamespace(id=7, role='admin', subject_type='staff', subject_id=20,
                                    display_name='Synthetic Admin', email=self.owner_email)
        self.staff = SimpleNamespace(id=20, access='super-admin', access_extra='')
        with patch('coach_api.auth._find_coach_staff', return_value=self.coach):
            response = self.views.marking(self.request('patch', {'decision': 'accepted', 'version': 1},
                                         '?viewAsCoach=coach@example.invalid'), self.submission_id)
        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.state['progress'][0]['passed'])

    def test_real_csrf_middleware_refuses_missing_token_and_accepts_matching_token(self):
        from django.middleware.csrf import CsrfViewMiddleware, get_token
        middleware = CsrfViewMiddleware(lambda _: None)
        request = self.request('patch', {'decision': 'accepted', 'version': 1})
        self.assertEqual(middleware.process_view(request, self.views.marking, (), {}).status_code, 403)
        self.assertFalse(getattr(self.views.marking, 'csrf_exempt', False))
        request.META['HTTP_X_CSRFTOKEN'] = get_token(request)
        request.COOKIES['csrftoken'] = request.META['CSRF_COOKIE']
        self.assertIsNone(middleware.process_view(request, self.views.marking, (), {}))
        self.assertEqual(self.views.marking(request, self.submission_id).status_code, 200)

    def test_evidence_is_limited_to_the_submission_activity_and_approved_files(self):
        self.state['evidence'] = {
            'ours': {'id': 'ours', 'activityId': 'C1', 'sectionRef': 'C1', 'status': 'approved',
                     'container': 'synthetic', 'blobName': 'synthetic-file', 'filename': 'work.pdf'},
            'other': {'id': 'other', 'activityId': 'C2', 'sectionRef': 'C2', 'status': 'approved'},
            'deleted': {'id': 'deleted', 'activityId': 'C1', 'sectionRef': 'C1', 'deletedAt': '2026-09-18'},
        }
        response = self.views.evidence(self.request(), self.submission_id)
        self.assertEqual([row['id'] for row in json.loads(response.content)['results']], ['ours'])
        storage = ModuleType('learner_api.evidence_storage')
        storage.get_download_sas = Mock(return_value='https://example.invalid/synthetic')
        with patch.dict(sys.modules, {'learner_api.evidence_storage': storage}):
            self.assertEqual(self.views.evidence(self.request(), self.submission_id, 'other').status_code, 404)
            storage.get_download_sas.assert_not_called()
            self.assertEqual(self.views.evidence(self.request(), self.submission_id, 'ours').status_code, 200)
            storage.get_download_sas.assert_called_once_with('synthetic', 'synthetic-file', 'work.pdf')
            self.state['evidence']['ours']['status'] = 'rejected'
            self.assertEqual(self.views.evidence(self.request(), self.submission_id, 'ours').status_code, 403)
            self.assertEqual(storage.get_download_sas.call_count, 1)


if __name__ == '__main__':
    if not sys.flags.isolated:
        raise RuntimeError('Run with python -I backend/coach_api/test_personal_review_no_db.py')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from django.conf import settings
    settings.configure(INSTALLED_APPS=['learner_api', 'login'], SECRET_KEY='synthetic-review-tests', USE_TZ=True,
        DATABASES={alias: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'} for alias in ('default', 'enrolment')})
    with (patch('socket.socket.connect', side_effect=AssertionError('Network forbidden')),
          patch('django.db.backends.base.base.BaseDatabaseWrapper.ensure_connection', side_effect=AssertionError('Database forbidden'))):
        import django
        django.setup()
        unittest.main()
