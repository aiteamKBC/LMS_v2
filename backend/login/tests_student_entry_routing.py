"""Exercise SSO home routing, including old saved paths, without services."""
from types import SimpleNamespace
from unittest.mock import patch

from django.core import signing
from django.test import RequestFactory, SimpleTestCase

from . import microsoft_sso as sso


class StudentEntryRoutingTests(SimpleTestCase):
    def callback(self, role, requested, download=None, staff_allowed=False):
        nonce = "test-browser-nonce"
        state = signing.dumps(
            {"next": requested, "n": sso.hash_token(nonce), "download": download}, salt=sso.STATE_SALT,
        )
        request = RequestFactory().get("/login_api/microsoft/callback/", {
            "code": "test-code", "state": state,
        })
        request.COOKIES[sso.NONCE_COOKIE] = nonce
        account = SimpleNamespace(id=42, role=role)
        with (
            patch.object(sso, "config", return_value={}),
            patch.object(sso, "missing_settings", return_value=[]),
            patch.object(sso, "_exchange_code", return_value="test-token"),
            patch.object(sso, "_graph_email", return_value="learner@example.test"),
            patch.object(sso.identity, "account_for_email", return_value=account),
            patch.object(sso, "is_locked", return_value=False),
            patch.object(sso, "register_success"),
            patch.object(sso, "issue_session", return_value=("test-session", None, 3600)),
            patch.object(sso, "record"),
            patch.object(sso, "frontend_base_url", return_value="http://localhost:3000"),
            patch.object(sso, "staff_download_allowed", return_value=staff_allowed),
        ):
            return sso.callback(request)

    def test_learners_start_at_home_even_with_a_saved_destination(self):
        for requested in ("", "/workspace/learner", "/learner/my-learning", "/old-otjh/months"):
            with self.subTest(requested=requested):
                response = self.callback("learner", requested)
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response["Location"], "http://localhost:3000/learner/home")
                self.assertIn("kbc_session", response.cookies)

    def test_other_roles_resolve_their_home_instead_of_restoring_a_saved_page(self):
        for role in ("staff", "admin", "employer"):
            for requested in ("", "/coach/timetable", "/users?tab=archived",
                              "/learner/monthly-coaching?kind=commercial&learner=19",
                              "//other.example/path"):
                with self.subTest(role=role, requested=requested):
                    response = self.callback(role, requested)
                    self.assertEqual(response.status_code, 302)
                    self.assertEqual(response["Location"], "http://localhost:3000/")
                    self.assertIn("kbc_session", response.cookies)

    def test_explicit_android_download_returns_a_learner_to_the_download_page(self):
        response = self.callback("learner", "https://evil.test", "android")
        self.assertEqual(response["Location"], "http://localhost:3000/login?download=android")
        self.assertIn("kbc_session", response.cookies)

    def test_download_intent_cannot_redirect_other_roles_or_choose_a_url(self):
        for role, intent, destination in (
            ("staff", "android", "/"), ("employer", "android", "/"),
            ("learner", "https://evil.test", "/learner/home"),
            ("learner", "//evil.test", "/learner/home"),
        ):
            with self.subTest(role=role, intent=intent):
                self.assertEqual(self.callback(role, "", intent)["Location"],
                                 "http://localhost:3000" + destination)

    def test_explicit_download_returns_authorised_admins_and_coaches_only(self):
        for role in ("admin", "staff"):
            with self.subTest(role=role):
                response = self.callback(role, "//evil.test", "android", staff_allowed=True)
                self.assertEqual(response["Location"], "http://localhost:3000/login?download=android")
                self.assertIn("kbc_session", response.cookies)
                self.assertEqual(self.callback(role, "", staff_allowed=True)["Location"],
                                 "http://localhost:3000/")
