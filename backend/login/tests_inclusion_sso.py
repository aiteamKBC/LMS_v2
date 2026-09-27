from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.core import signing
from django.test import RequestFactory, SimpleTestCase, override_settings

from .inclusion_sso import authorize


@override_settings(INCLUSION_SSO_SECRET="test-secret-longer-than-32-characters", INCLUSION_SSO_CALLBACK_URL="https://inclusion.example.test/auth/lms/callback")
class InclusionSSOTests(SimpleTestCase):
    def request(self, account, state="a" * 64):
        with patch("login.inclusion_sso.authenticate_request", return_value=account):
            with patch("login.inclusion_sso._accesses_of", return_value={"super-admin"}):
                return authorize(RequestFactory().get("/", {"state": state, "redirect_uri": "https://attacker.example"}))

    def test_requires_active_session(self):
        self.assertEqual(self.request(None).status_code, 401)
        self.assertEqual(self.request(SimpleNamespace(is_active=False)).status_code, 401)

    def test_valid_assertion_and_fixed_destination(self):
        response = self.request(SimpleNamespace(is_active=True, pk=3, email="learner@example.test", display_name="Learner"))
        url = urlsplit(response["Location"])
        self.assertEqual(url.netloc, "inclusion.example.test")
        token = parse_qs(url.fragment)["assertion"][0]
        claims = signing.loads(token, key="test-secret-longer-than-32-characters", salt="kbc-inclusion-sso-v1", max_age=60)
        self.assertEqual(claims["account_id"], 3)
        self.assertEqual(claims["state"], "a" * 64)
        self.assertEqual(claims["aud"], "inclusion-dashboard")

    def test_invalid_state(self):
        self.assertEqual(self.request(None, "bad-state").status_code, 400)

    @override_settings(INCLUSION_SSO_SECRET="")
    def test_unconfigured(self):
        self.assertEqual(self.request(None).status_code, 503)

    def test_coach_and_denied_access(self):
        account = SimpleNamespace(is_active=True, pk=4, email="coach@example.test", display_name="Coach")
        for accesses, expected in [({"coach"}, 302), ({"enrolment"}, 403), (set(), 403)]:
            with patch("login.inclusion_sso.authenticate_request", return_value=account), patch("login.inclusion_sso._accesses_of", return_value=accesses):
                response = authorize(RequestFactory().get("/", {"state": "a" * 64}))
            self.assertEqual(response.status_code, expected)
            if expected == 302:
                claims = signing.loads(parse_qs(urlsplit(response["Location"]).fragment)["assertion"][0], key="test-secret-longer-than-32-characters", salt="kbc-inclusion-sso-v1")
                self.assertEqual(claims["role"], "coach")
