"""D02: real route guards, synthetic records and zero external side effects."""
import inspect
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.middleware.csrf import CsrfViewMiddleware, get_token
from django.conf import settings
from django.test import RequestFactory, SimpleTestCase

from . import views
from .models import CoachCalendarEvent


class MeetingReadSecurityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.record = CoachCalendarEvent(id=7, event_key='mcr:42:1:2026-10-24',
            owner_email='coach@example.invalid', learner_id=42, event_type='mcr', status='scheduled')
        self.snapshot = dict(attendance={'records': []}, artifacts=[], attendanceReports=[],
                             attendanceTracker={}, errors=[], partial=False, storage={'stored': True})
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        def mock(name, **kwargs):
            return self.stack.enter_context(patch.object(views, name, **kwargs))
        self.lookup = mock('coach_meeting_artifact_record', return_value=self.record)
        self.graph = mock('fetch_coach_meeting_graph_snapshot', return_value=(self.snapshot, None, 200))
        self.persist = mock('persist_coach_meeting_snapshots', return_value={'stored': True})
        self.transition = mock('apply_teams_attendance_status_transition', return_value=False)
        self.generate = mock('ensure_coach_meeting_summary', return_value=None)
        mock('stored_coach_meeting_snapshot', return_value=self.snapshot)
        mock('stored_coach_meeting_summary', return_value=None)

    def assert_no_effects(self):
        for mock in (self.graph, self.persist, self.transition, self.generate):
            mock.assert_not_called()

    def call(self, view, method='get', suffix='', **kwargs):
        request = getattr(self.factory, method)('/'+suffix)
        request.coach_email = self.record.owner_email
        return inspect.unwrap(view)(request, self.record.event_key, **kwargs)

    def test_get_and_legacy_refresh_are_stored_only(self):
        for suffix in ('', '?refresh=1', '?refresh=true'):
            with self.subTest(suffix=suffix):
                response = self.call(views.coach_timetable_event_artifacts, suffix=suffix)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content)['artifacts'], [])
                self.assert_no_effects()

    def test_summary_get_does_not_generate_missing_cache(self):
        self.assertEqual(self.call(views.coach_timetable_event_summary).status_code, 200)
        self.assert_no_effects()

    def test_post_refresh_once(self):
        self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 200)
        self.graph.assert_called_once_with(self.record)
        self.persist.assert_called_once()
        self.generate.assert_called_once_with(self.record, retry_failed=True)

    def test_read_only_calendar_and_imported_routes_cannot_refresh(self):
        for status in ('completed', 'awaiting-signature', 'cancelled', 'not-scheduled'):
            self.record.status = status
            self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.record.status = 'scheduled'
        self.record.event_key = 'imported-review:synthetic'
        self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.assert_no_effects()

    def test_native_review_lifecycle_and_reverse_association_checked(self):
        self.record.review_instance_id = 'REVI-synthetic'
        self.record.review_template_id = 'REV-template'
        row = dict(id='REVI-synthetic', coach_email=self.record.owner_email, learner_id=42,
                   calendar_event_id=7, review_template_id='REV-template', status='completed')
        with patch.object(views.curriculum_review_instances, 'get_review_instance', return_value=row), \
             patch('coach_api.reconciliation_links.for_native', return_value=None):
            self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
            row.update(status='scheduled', calendar_event_id=999)
            self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.assert_no_effects()

    def test_unowned_event_is_not_refreshed(self):
        self.lookup.return_value = None
        self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 404)
        self.lookup.assert_called_once_with(self.record.owner_email, self.record.event_key)
        self.assert_no_effects()

    def test_view_as_get_is_passive_and_post_is_forbidden_through_real_guard(self):
        account = SimpleNamespace(role='admin', subject_type='staff', subject_id=99)
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch('login.permissions._accesses_of', return_value=frozenset({'super-admin'})), \
             patch('coach_api.auth.StaffUser.objects.filter') as staff, \
             patch('coach_api.auth._staff_access', return_value='super-admin'), \
             patch('coach_api.auth._find_coach_staff', return_value=SimpleNamespace(id=1, email=self.record.owner_email)):
            staff.return_value.only.return_value.first.return_value = SimpleNamespace(id=99)
            for view in (views.coach_timetable_event_artifacts, views.coach_timetable_event_summary):
                get = self.factory.get('/?viewAsCoach=coach%40example.invalid&refresh=1')
                get.login_account = account
                self.assertEqual(view(get, self.record.event_key).status_code, 200)
            post = self.factory.post('/?viewAsCoach=coach%40example.invalid')
            post.login_account = account
            self.assertEqual(views.coach_timetable_event_artifacts(post, self.record.event_key).status_code, 403)
            self.assertEqual(views.coach_review_instance_local_status(post, 'imported-review:synthetic').status_code, 403)
        self.assert_no_effects()

    def test_refresh_post_retains_csrf(self):
        view = views.coach_timetable_event_artifacts
        middleware = CsrfViewMiddleware(lambda request: None)
        rejected = middleware.process_view(self.factory.post('/'), view, (), {})
        self.assertEqual(rejected.status_code, 403)
        request = self.factory.post('/')
        request.META['HTTP_X_CSRFTOKEN'] = get_token(request)
        request.COOKIES[settings.CSRF_COOKIE_NAME] = request.META['CSRF_COOKIE']
        self.assertIsNone(middleware.process_view(request, view, (), {}))
        self.assert_no_effects()

    def test_imported_join_start_retains_csrf_and_has_no_get_transition(self):
        view = views.coach_review_instance_local_status
        middleware = CsrfViewMiddleware(lambda request: None)
        self.assertEqual(middleware.process_view(self.factory.post('/'), view, (), {}).status_code, 403)
        self.assertEqual(inspect.unwrap(view)(self.factory.get('/'), 'imported-review:synthetic').status_code, 405)
        self.assert_no_effects()

    def test_legacy_imported_refresh_requires_the_source_aware_route(self):
        for family in ('mcm', 'progress-review'):
            for key in (f'learner-book:{family}:apprenticeship:200:2026-10',
                        f'learner-book:{family}:apprenticeship:200:2026-10:3000'):
                self.record.idempotency_key = key
                self.assertEqual(self.call(views.coach_timetable_event_artifacts, 'post').status_code, 409)
        self.assert_no_effects()

    def test_real_guard_rejects_missing_session_and_non_coach_roles(self):
        with patch('login.permissions.authenticate_request', return_value=None):
            self.assertEqual(views.coach_timetable_event_artifacts(self.factory.post('/'), self.record.event_key).status_code, 401)
        for role in ('learner', 'employer', 'tutor'):
            account = SimpleNamespace(role=role, subject_type=role, subject_id=99)
            with patch('login.permissions.authenticate_request', return_value=account), \
                    patch('login.permissions._accesses_of', return_value=frozenset({role})):
                request = self.factory.post('/')
                request.login_account = account
                self.assertEqual(views.coach_timetable_event_artifacts(request, self.record.event_key).status_code, 403)
        self.assert_no_effects()
