"""Exercise the real conversion view's CSRF/role gates without touching data."""
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import Client, SimpleTestCase, override_settings
from django.urls import path

from coach_api.csrf import coach_csrf_token
from .free_course_conversion import convert_free_course

urlpatterns = [
    path('coach_api/csrf', coach_csrf_token),
    path('curriculum_api/curriculum/modules/<str:module_catalogue_id>/convert-free-course/', convert_free_course),
]


@override_settings(ROOT_URLCONF=__name__, MIDDLEWARE=['django.middleware.csrf.CsrfViewMiddleware'],
                   ALLOWED_HOSTS=['testserver'], CSRF_COOKIE_SECURE=False, CSRF_TRUSTED_ORIGINS=[])
class FreeCourseConversionCsrfTests(SimpleTestCase):
    url = '/curriculum_api/curriculum/modules/FREE-TEST/convert-free-course/'

    def setUp(self):
        self.client = Client(enforce_csrf_checks=True)
        self.auth = self.enterContext(patch('login.permissions.authenticate_request',
                                           return_value=SimpleNamespace(role='staff')))
        self.token = self.client.get('/coach_api/csrf').json()['csrfToken']

    def post(self, token=None, **headers):
        # A list deliberately reaches the real handler's validation and returns
        # 400 before any database work. Missing CSRF must be rejected before it.
        return self.client.post(self.url, json.dumps([]), content_type='application/json',
                                **({'HTTP_X_CSRFTOKEN': token} if token else {}), **headers)

    def test_missing_or_invalid_csrf_reproduces_403_before_auth_or_conversion(self):
        for token in (None, 'invalid-token'):
            self.assertEqual(self.post(token).status_code, 403)
        self.auth.assert_not_called()

    def test_valid_csrf_reaches_conversion_validation_for_staff_and_admin(self):
        for role in ('staff', 'admin'):
            self.auth.return_value = SimpleNamespace(role=role)
            response = self.post(self.token)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()['error'], 'Invalid JSON body.')

    def test_valid_csrf_does_not_authorize_other_roles_or_signed_out_users(self):
        for role in ('learner', 'coach', 'tutor', 'employer', None):
            with self.subTest(role=role):
                self.auth.return_value = SimpleNamespace(role=role) if role else None
                self.assertEqual(self.post(self.token).status_code, 403 if role else 401)

    def test_untrusted_origin_is_rejected_even_with_a_valid_token(self):
        self.assertEqual(self.post(self.token, HTTP_ORIGIN='https://untrusted.example.invalid').status_code, 403)
        self.auth.assert_not_called()
