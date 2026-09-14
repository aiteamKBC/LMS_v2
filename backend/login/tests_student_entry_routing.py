"""Exercise the SSO callback's student destination without external services."""
from types import SimpleNamespace
from unittest.mock import patch

from django.core import signing
from django.test import RequestFactory, SimpleTestCase

from . import microsoft_sso as sso


class StudentEntryRoutingTests(SimpleTestCase):
    def callback(self, role, requested):
        nonce = "test-browser-nonce"
        state = signing.dumps(
            {"next": requested, "n": sso.hash_token(nonce)}, salt=sso.STATE_SALT,
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
        ):
            return sso.callback(request)

    def test_learners_start_at_home_even_with_a_saved_destination(self):
        for requested in ("", "/workspace/learner", "/learner/my-learning", "/old-otjh/months"):
            with self.subTest(requested=requested):
                response = self.callback("learner", requested)
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response["Location"], "http://localhost:3000/learner/home")
                self.assertIn("kbc_session", response.cookies)

    def test_other_roles_keep_their_requested_destination(self):
        for role, requested in (("staff", "/workspace/coach"), ("admin", "/workspace/admin"),
                                ("employer", "/workspace/employer")):
            with self.subTest(role=role):
                response = self.callback(role, requested)
                self.assertEqual(response["Location"], f"http://localhost:3000{requested}")
