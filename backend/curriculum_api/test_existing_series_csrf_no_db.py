"""HTTP regression for existing-series discovery/apply; no DB or Graph calls."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import Client, SimpleTestCase, override_settings

from curriculum_api import teams_existing_series as service


@override_settings(MIDDLEWARE=['django.middleware.csrf.CsrfViewMiddleware'],
                   ALLOWED_HOSTS=['testserver'], CSRF_COOKIE_SECURE=False)
class ExistingSeriesCsrfTests(SimpleTestCase):
    url = '/curriculum_api/curriculum/modules/MOD-TEST/teams-existing-series/'

    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.actor = SimpleNamespace(role='staff')
        for target, kwargs in (
            ('curriculum_api.teams_endpoint_guard._gate_enabled', {'return_value': True}),
            ('login.sessions.authenticate_request', {'side_effect': lambda request: self.actor}),
        ):
            patcher = patch(target, **kwargs)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.preview = self.enterContext(patch.object(service, 'preview', return_value={'matched': 1}))
        self.apply = self.enterContext(patch.object(service, 'apply', return_value={'matched': 1}))
        response = self.client.get('/coach_api/csrf')
        self.assertEqual(response.status_code, 200)
        self.token = response.json()['csrfToken']

    def post(self, action, token=None):
        return self.client.post(self.url, json.dumps({'action': action}), content_type='application/json',
                                **({'HTTP_X_CSRFTOKEN': token} if token else {}))

    def test_missing_or_invalid_csrf_reproduces_403_before_either_service_runs(self):
        for action in ('preview', 'apply'):
            for token in (None, 'invalid-token'):
                with self.subTest(action=action, token=token):
                    self.assertEqual(self.post(action, token).status_code, 403)
        self.preview.assert_not_called()
        self.apply.assert_not_called()

    def test_session_csrf_allows_staff_and_admin_to_preview_and_apply(self):
        for role in ('staff', 'admin'):
            self.actor.role = role
            for action, service_mock in (('preview', self.preview), ('apply', self.apply)):
                with self.subTest(role=role, action=action):
                    response = self.post(action, self.token)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), {'matched': 1})
                    service_mock.assert_called_with('MOD-TEST', {'action': action})

    def test_csrf_does_not_grant_non_staff_or_signed_out_callers_access(self):
        for role in ('learner', 'tutor', 'coach', 'employer', None):
            self.actor = SimpleNamespace(role=role) if role else None
            for action in ('preview', 'apply'):
                with self.subTest(role=role, action=action):
                    self.assertEqual(self.post(action, self.token).status_code, 403 if role else 401)
        self.preview.assert_not_called()
        self.apply.assert_not_called()

    def test_get_cannot_discover_or_link_a_series(self):
        self.assertEqual(self.client.get(self.url).status_code, 405)
        self.preview.assert_not_called()
        self.apply.assert_not_called()
