"""Real Django role/method/CSRF boundary for the imported meeting editor.

SimpleTestCase forbids database queries. Microsoft discovery is mocked.
Run only through verified isolated settings, like other Teams endpoint suites.
"""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.middleware.csrf import get_token
from django.test import Client, RequestFactory, SimpleTestCase, override_settings
from django.urls import path

from .teams_imported_calendar_update import imported_calendar_update

urlpatterns = [path('meeting/<str:live_session_id>/', imported_calendar_update, {'stage': 'edit-read'})]


@override_settings(ROOT_URLCONF=__name__, MIDDLEWARE=['django.middleware.csrf.CsrfViewMiddleware'],
                   ALLOWED_HOSTS=['testserver'], CSRF_COOKIE_SECURE=False)
class ImportedMeetingEditorHttpTests(SimpleTestCase):
    def setUp(self):
        self.actor = SimpleNamespace(pk=7, role='staff')
        def authenticate(request):
            request.login_account = self.actor
            return self.actor
        self.auth = patch('login.permissions.authenticate_request', side_effect=authenticate)
        self.auth.start()
        self.addCleanup(self.auth.stop)
        self.access = patch('curriculum_api.teams_imported_calendar_update.access_for', return_value={'mode': 'application'})
        self.access_mock = self.access.start()
        self.addCleanup(self.access.stop)
        self.read = patch('curriculum_api.teams_imported_meeting_edit.read_edit', return_value={'status': 'editable', 'message': 'Verified'})
        self.read_mock = self.read.start()
        self.addCleanup(self.read.stop)
        self.client = Client(enforce_csrf_checks=True)
        request = RequestFactory().get('/')
        self.token = get_token(request)
        self.client.cookies['csrftoken'] = request.META['CSRF_COOKIE']

    def post(self, csrf=True):
        return self.client.post('/meeting/ORIGINAL/', json.dumps({'liveId': 'FOREIGN'}), content_type='application/json',
                                **({'HTTP_X_CSRFTOKEN': self.token} if csrf else {}))

    def test_staff_edit_uses_url_identity_and_authenticated_actor(self):
        self.assertEqual(self.post().status_code, 200)
        self.read_mock.assert_called_once_with('ORIGINAL', '7', {'mode': 'application'})

    def test_admin_can_open_editor(self):
        self.actor.role = 'admin'
        self.assertEqual(self.post().status_code, 200)

    def test_learner_cannot_read_or_modify_original_calendar(self):
        self.actor.role = 'learner'
        self.assertEqual(self.post().status_code, 403)
        self.read_mock.assert_not_called()
        self.access_mock.assert_not_called()

    def test_coach_and_employer_do_not_receive_staff_calendar_access(self):
        for role in ('coach', 'employer'):
            with self.subTest(role=role):
                self.actor.role = role
                self.assertEqual(self.post().status_code, 403)
        self.read_mock.assert_not_called()

    def test_missing_csrf_never_reads_microsoft(self):
        self.assertEqual(self.post(csrf=False).status_code, 403)
        self.access_mock.assert_not_called()

    def test_get_never_opens_write_capable_editor(self):
        self.assertEqual(self.client.get('/meeting/ORIGINAL/').status_code, 405)
        self.access_mock.assert_not_called()

    def test_unreadable_calendar_is_not_reported_as_success(self):
        from .teams_imported_calendar_update import Blocked
        self.read_mock.side_effect = Blocked('organizer_calendar_unavailable', 'Original calendar unavailable.')
        result = self.post()
        self.assertEqual(result.json()['status'], 'blocked')
        self.assertEqual(result.json()['code'], 'organizer_calendar_unavailable')
