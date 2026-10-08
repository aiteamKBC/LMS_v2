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

    def test_approved_learners_receive_qa_without_changing_lms_role(self):
        for email in ["Emma.Leavey@ofsted.gov.uk", "rowaneltash2@gmail.com"]:
            for learner_type in ["commercial", "apprenticeship"]:
                with self.subTest(email=email, learner_type=learner_type):
                    account = SimpleNamespace(is_active=True, pk=7, email=f" {email.upper()} ",
                                              display_name="Test QA", role="learner", learner_type=learner_type)
                    with patch("login.inclusion_sso.authenticate_request", return_value=account), patch(
                        "login.inclusion_sso._accesses_of", return_value=set()
                    ):
                        response = authorize(RequestFactory().get("/", {"state": "a" * 64}))
                    self.assertEqual(response.status_code, 302)
                    claims = signing.loads(
                        parse_qs(urlsplit(response["Location"]).fragment)["assertion"][0],
                        key="test-secret-longer-than-32-characters", salt="kbc-inclusion-sso-v1",
                    )
                    self.assertEqual(claims["role"], "qa")
                    self.assertEqual(claims["account_id"], account.pk)
                    self.assertEqual(claims["email"], account.email)
                    self.assertEqual(account.role, "learner")

    def test_other_learners_cannot_claim_an_exception_via_query_string(self):
        for email in ["learner@example.test", "emma.leavey@ofsted.gov.uk.attacker.test", ""]:
            with self.subTest(email=email):
                account = SimpleNamespace(is_active=True, pk=8, email=email, display_name="Learner")
                with patch("login.inclusion_sso.authenticate_request", return_value=account), patch(
                    "login.inclusion_sso._accesses_of", return_value=set()
                ):
                    response = authorize(RequestFactory().get("/", {
                        "state": "a" * 64, "email": "rowaneltash2@gmail.com", "role": "qa",
                    }))
                self.assertEqual(response.status_code, 403)

    def test_exception_still_requires_active_account_and_valid_state(self):
        account = SimpleNamespace(is_active=False, email="rowaneltash2@gmail.com")
        self.assertEqual(self.request(account).status_code, 401)
        account.is_active = True
        self.assertEqual(self.request(account, "bad-state").status_code, 400)

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
