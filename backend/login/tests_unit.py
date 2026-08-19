"""Unit tests for the login app's pure logic.

Separate from ``tests.py``, which drives the HTTP endpoints and needs the Neon
tables. Almost everything here runs without touching a database, so it is the
fast suite: run it while working on ``security.py``, ``sessions.py`` or
``email_azure.py`` and get an answer in about a second.

    python manage.py test login.tests_unit

The two classes that do need the database (session issue/revoke, and the
throttle counters that read the audit table) are marked with ``databases`` and
are still cheap — they touch one table each.

What is being pinned here is behaviour that is easy to break silently: the exact
backoff schedule, the fact that a token hash is not the token, which settings
count as "mail is configured", and that the fallback never prints a live link in
production.
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from unittest import mock

from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from . import email_azure, identity, invitations
from .models import (
    ROLE_ADMIN,
    ROLE_EMPLOYER,
    ROLE_LEARNER,
    ROLE_STAFF,
    LoginAccount,
    LoginAudit,
    LoginSession,
)
from .security import (
    INVITATION_TTL,
    LOCKOUT_BASE_MINUTES,
    LOCKOUT_MAX_MINUTES,
    LOCKOUT_THRESHOLD,
    MIN_PASSWORD_LENGTH,
    RESET_TTL,
    SESSION_TTL,
    SESSION_TTL_REMEMBER,
    THROTTLE_MAX_FAILURES_PER_IP,
    PasswordPolicyError,
    client_ip,
    generate_token,
    hash_password,
    hash_token,
    lock_duration_for,
    looks_like_email,
    normalize_email,
    tokens_equal,
    user_agent,
    validate_password_strength,
    verify_password,
)
from .services import InvitePermissionError, _authorise


# ---------------------------------------------------------------------------
# Pure helpers — no database
# ---------------------------------------------------------------------------

class NormalisationTests(SimpleTestCase):
    def test_email_is_lowercased_and_trimmed(self):
        self.assertEqual(normalize_email("  Person@KBC.Test \n"), "person@kbc.test")

    def test_email_normalisation_handles_none_and_empty(self):
        self.assertEqual(normalize_email(None), "")
        self.assertEqual(normalize_email(""), "")

    def test_dots_and_plus_tags_are_preserved(self):
        """Provider-specific aliasing must not be collapsed — see normalize_email.

        Treating a.b@ and ab@ as one identity would be wrong for the corporate
        mail systems this deployment uses.
        """
        self.assertEqual(normalize_email("A.B+tag@Kbc.test"), "a.b+tag@kbc.test")

    def test_looks_like_email_accepts_ordinary_addresses(self):
        for address in ("a@b.co", "first.last@sub.domain.org", " Person@KBC.Test "):
            self.assertTrue(looks_like_email(address), address)

    def test_looks_like_email_rejects_malformed_input(self):
        for address in ("", None, "no-at-sign", "@nolocal.test", "a@b", "a b@c.test"):
            self.assertFalse(looks_like_email(address), repr(address))


class TokenPrimitiveTests(SimpleTestCase):
    def test_tokens_are_unique_and_url_safe(self):
        tokens = {generate_token() for _ in range(500)}
        self.assertEqual(len(tokens), 500)
        for token in list(tokens)[:20]:
            # token_urlsafe output must survive being pasted into a query string.
            self.assertNotIn("+", token)
            self.assertNotIn("/", token)
            self.assertNotIn("=", token)

    def test_token_is_long_enough_to_be_unguessable(self):
        # 32 bytes base64url-encoded ≈ 43 characters.
        self.assertGreaterEqual(len(generate_token()), 40)

    def test_hash_is_a_sha256_hex_digest_and_not_the_token(self):
        token = generate_token()
        digest = hash_token(token)
        self.assertEqual(len(digest), 64)
        self.assertNotEqual(digest, token)
        self.assertNotIn(token, digest)

    def test_hashing_is_deterministic(self):
        token = generate_token()
        self.assertEqual(hash_token(token), hash_token(token))

    def test_different_tokens_hash_differently(self):
        self.assertNotEqual(hash_token(generate_token()), hash_token(generate_token()))

    def test_tokens_equal_compares_correctly(self):
        digest = hash_token("abc")
        self.assertTrue(tokens_equal(digest, hash_token("abc")))
        self.assertFalse(tokens_equal(digest, hash_token("abd")))
        self.assertFalse(tokens_equal(digest, None))
        self.assertFalse(tokens_equal(None, digest))


class PasswordHashingTests(SimpleTestCase):
    def test_hash_does_not_contain_the_password(self):
        hashed = hash_password("Vaulted-Harbour-92!")
        self.assertNotIn("Vaulted-Harbour-92!", hashed)

    def test_same_password_hashes_differently_each_time(self):
        """Per-hash salt: two users with the same password must not collide."""
        a = hash_password("Vaulted-Harbour-92!")
        b = hash_password("Vaulted-Harbour-92!")
        self.assertNotEqual(a, b)
        self.assertTrue(verify_password("Vaulted-Harbour-92!", a))
        self.assertTrue(verify_password("Vaulted-Harbour-92!", b))

    def test_uses_a_recognised_strong_algorithm(self):
        algorithm = hash_password("Vaulted-Harbour-92!").split("$")[0]
        self.assertIn(algorithm, {"argon2", "pbkdf2_sha256", "bcrypt_sha256"})

    def test_wrong_password_is_rejected(self):
        hashed = hash_password("Vaulted-Harbour-92!")
        for wrong in ("", "vaulted-harbour-92!", "Vaulted-Harbour-92", "x"):
            self.assertFalse(verify_password(wrong, hashed), wrong)

    def test_no_password_set_means_no_password_works(self):
        """An invited-but-not-onboarded account must never authenticate."""
        for candidate in ("", "anything", "None"):
            self.assertFalse(verify_password(candidate, ""))


class PasswordPolicyEdgeTests(SimpleTestCase):
    def test_minimum_length_boundary(self):
        just_under = "Ab1!" + "x" * (MIN_PASSWORD_LENGTH - 5)
        just_over = "Ab1!" + "x" * (MIN_PASSWORD_LENGTH - 4)
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength(just_under)
        self.assertTrue(validate_password_strength(just_over))

    def test_absurdly_long_password_is_refused(self):
        """Bounds the work handed to the KDF."""
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength("a1B!" * 40)  # 160 chars

    def test_non_string_input_is_refused_not_crashed(self):
        for value in (None, 12345678, [], {}):
            with self.assertRaises(PasswordPolicyError):
                validate_password_strength(value)

    def test_name_check_is_case_insensitive(self):
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength("XxSMITHxx-2026", display_name="John Smith")

    def test_short_name_fragments_do_not_block_a_good_password(self):
        """"Jo" is too short to be a meaningful match — see the >= 4 guard."""
        self.assertTrue(
            validate_password_strength("Vaulted-Harbour-92!", display_name="Jo Ng")
        )

    def test_email_check_ignores_the_domain(self):
        """Only the local part is checked; everyone shares the domain."""
        self.assertTrue(
            validate_password_strength("Vaulted-Harbour-92!", email="pat@kbc.test")
        )

    def test_password_equal_to_email_local_part_is_refused(self):
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength("jsmith-jsmith", email="jsmith@kbc.test")


class LockoutScheduleTests(SimpleTestCase):
    def test_no_lock_below_the_threshold(self):
        for attempts in range(0, LOCKOUT_THRESHOLD):
            self.assertEqual(lock_duration_for(attempts), 0, attempts)

    def test_first_lock_at_the_threshold(self):
        self.assertEqual(lock_duration_for(LOCKOUT_THRESHOLD), LOCKOUT_BASE_MINUTES)

    def test_backoff_grows_with_further_failures(self):
        first = lock_duration_for(LOCKOUT_THRESHOLD)
        second = lock_duration_for(LOCKOUT_THRESHOLD + 1)
        self.assertGreater(second, first)

    def test_backoff_is_capped(self):
        """An attacker cannot lock an account out for a week."""
        self.assertEqual(lock_duration_for(LOCKOUT_THRESHOLD + 10_000), LOCKOUT_MAX_MINUTES)

    def test_schedule_is_monotonic(self):
        durations = [lock_duration_for(n) for n in range(0, 40)]
        self.assertEqual(durations, sorted(durations))


class LifetimeTests(SimpleTestCase):
    """The TTLs are security parameters; pin their relative ordering."""

    def test_reset_is_the_shortest_lived_token(self):
        self.assertLess(RESET_TTL, INVITATION_TTL)
        self.assertLessEqual(RESET_TTL, timedelta(hours=24))

    def test_remember_me_extends_but_does_not_remove_expiry(self):
        self.assertGreater(SESSION_TTL_REMEMBER, SESSION_TTL)
        self.assertLess(SESSION_TTL_REMEMBER, timedelta(days=400))

    def test_invitation_window_is_workable_but_finite(self):
        self.assertGreaterEqual(INVITATION_TTL, timedelta(days=1))
        self.assertLessEqual(INVITATION_TTL, timedelta(days=30))


class ClientIpTests(SimpleTestCase):
    """X-Forwarded-For feeds throttling, so it must not be believed by default."""

    def setUp(self):
        self.factory = RequestFactory()

    def _request(self, **meta):
        request = self.factory.get("/")
        request.META.update(meta)
        return request

    @override_settings(TRUST_PROXY_IP_HEADER=False)
    def test_forwarded_header_is_ignored_by_default(self):
        request = self._request(
            HTTP_X_FORWARDED_FOR="1.2.3.4", REMOTE_ADDR="10.0.0.1"
        )
        self.assertEqual(client_ip(request), "10.0.0.1")

    @override_settings(TRUST_PROXY_IP_HEADER=True)
    def test_forwarded_header_is_used_when_explicitly_trusted(self):
        request = self._request(
            HTTP_X_FORWARDED_FOR="1.2.3.4, 5.6.7.8", REMOTE_ADDR="10.0.0.1"
        )
        self.assertEqual(client_ip(request), "1.2.3.4")

    @override_settings(TRUST_PROXY_IP_HEADER=True)
    def test_malformed_forwarded_header_falls_back_to_remote_addr(self):
        """A spoofed header must not become the throttle key."""
        request = self._request(
            HTTP_X_FORWARDED_FOR="not-an-ip", REMOTE_ADDR="10.0.0.1"
        )
        self.assertEqual(client_ip(request), "10.0.0.1")

    def test_missing_remote_addr_yields_none(self):
        request = self._request()
        # RequestFactory always supplies 127.0.0.1; drop it to model a request
        # that arrived with no usable source address.
        request.META.pop("REMOTE_ADDR", None)
        self.assertIsNone(client_ip(request))

    def test_user_agent_is_truncated(self):
        request = self._request(HTTP_USER_AGENT="A" * 5000)
        self.assertLessEqual(len(user_agent(request)), 400)

    def test_absent_user_agent_is_none(self):
        self.assertIsNone(user_agent(self._request()))


# ---------------------------------------------------------------------------
# Role mapping and payload shape — no database
# ---------------------------------------------------------------------------

class RoleMappingTests(SimpleTestCase):
    def test_only_super_admin_access_grants_admin(self):
        self.assertEqual(identity.role_for_staff("Admin", "super-admin"), ROLE_ADMIN)
        for access in ("enrolment", "curriculum", "coach"):
            self.assertEqual(identity.role_for_staff("Admin", access), ROLE_STAFF, access)

    def test_access_match_is_case_and_whitespace_insensitive(self):
        for spelling in ("super-admin", "SUPER-ADMIN", "  Super-Admin  "):
            self.assertEqual(identity.role_for_staff("Caseowner", spelling), ROLE_ADMIN, spelling)

    def test_position_alone_never_grants_admin(self):
        """The heart of the access model: every account the console creates is
        Position='Admin', so a Position-based grant would make all of them
        platform administrators. Only an explicit access does that."""
        for position in ("Admin", "admin", "  Admin  ", "Caseowner", None, ""):
            self.assertEqual(identity.role_for_staff(position), ROLE_STAFF, repr(position))

    def test_missing_access_is_staff_not_admin(self):
        """Fail closed: an unset Access must never mean administrator."""
        for value in (None, "", "   ", "wizard"):
            self.assertEqual(identity.role_for_staff("Admin", value), ROLE_STAFF, repr(value))

    def test_admin_holds_every_other_role_permission(self):
        admin = set(identity.permissions_for(ROLE_ADMIN))
        for role in (ROLE_STAFF, ROLE_EMPLOYER, ROLE_LEARNER):
            # Employer/learner permissions are their own; only check staff is a
            # subset, which is the escalation path that matters.
            if role == ROLE_STAFF:
                self.assertTrue(set(identity.permissions_for(role)).issubset(admin))

    def test_learner_and_employer_cannot_manage_accounts(self):
        for role in (ROLE_LEARNER, ROLE_EMPLOYER, ROLE_STAFF):
            self.assertNotIn("accounts.manage", identity.permissions_for(role), role)
        self.assertIn("accounts.manage", identity.permissions_for(ROLE_ADMIN))

    def test_unknown_role_gets_no_permissions(self):
        self.assertEqual(identity.permissions_for("wizard"), [])

    def test_permissions_list_is_a_copy(self):
        """A caller mutating the result must not edit the shared table."""
        first = identity.permissions_for(ROLE_ADMIN)
        first.append("everything")
        self.assertNotIn("everything", identity.permissions_for(ROLE_ADMIN))


class InviteAuthorisationTests(SimpleTestCase):
    """The rules that closed the privilege-escalation hole. See services._authorise."""

    def _account(self, role, is_active=True):
        return LoginAccount(
            email="someone@kbc.test", role=role, is_active=is_active,
            subject_type="staff", subject_id=1,
        )

    def test_anonymous_cannot_invite_anyone(self):
        for target in (ROLE_LEARNER, ROLE_EMPLOYER, ROLE_STAFF, ROLE_ADMIN):
            with self.assertRaises(InvitePermissionError):
                _authorise(None, target)

    def test_learner_and_employer_cannot_invite(self):
        for role in (ROLE_LEARNER, ROLE_EMPLOYER):
            with self.assertRaises(InvitePermissionError):
                _authorise(self._account(role), ROLE_LEARNER)

    def test_inactive_staff_cannot_invite(self):
        with self.assertRaises(InvitePermissionError):
            _authorise(self._account(ROLE_STAFF, is_active=False), ROLE_LEARNER)

    def test_staff_may_invite_non_admins(self):
        for target in (ROLE_LEARNER, ROLE_EMPLOYER, ROLE_STAFF):
            self.assertTrue(_authorise(self._account(ROLE_STAFF), target), target)

    def test_staff_may_not_invite_an_admin(self):
        """The self-promotion path: staff creating an "Admin" colleague."""
        with self.assertRaises(InvitePermissionError):
            _authorise(self._account(ROLE_STAFF), ROLE_ADMIN)

    def test_admin_may_invite_anyone(self):
        for target in (ROLE_LEARNER, ROLE_EMPLOYER, ROLE_STAFF, ROLE_ADMIN):
            self.assertTrue(_authorise(self._account(ROLE_ADMIN), target), target)


# ---------------------------------------------------------------------------
# Email transport — no network, no database
# ---------------------------------------------------------------------------

_MAIL_ENV = {
    "AZURE_MAIL_TENANT_ID": "tenant-id",
    "AZURE_MAIL_CLIENT_ID": "client-id",
    "AZURE_MAIL_CLIENT_SECRET": "secret-value",
    "AZURE_MAIL_SENDER": "noreply@kbc.test",
    "AZURE_MAIL_ENABLED": "true",
}

#: The alternate spellings each setting also accepts. Blanked in tests that
#: assert a setting is *missing* — this project's real .env defines them, and
#: os.environ is not cleared, so an unblanked alternate silently satisfies the
#: setting under test.
_BLANKED_ALTERNATES = {
    "AZURE_LOGIN_APP_TENANT_ID": "",
    "AZURE_LOGIN_APP_CLIENT_ID": "",
    "AZURE_LOGIN_APP_CLIENT_SECRET": "",
    "AZURE_EMAIL": "",
}


class MailConfigurationTests(SimpleTestCase):
    def test_fully_configured_is_reported_ready(self):
        with mock.patch.dict("os.environ", _MAIL_ENV, clear=False):
            self.assertTrue(email_azure.is_configured())
            self.assertEqual(email_azure.missing_settings(), [])

    def test_each_missing_setting_is_named(self):
        # Every setting accepts a second spelling (see _SETTING_SOURCES), and
        # this project's .env defines those — blank them too, or the alternate
        # masks the missing setting and the assertion passes for the wrong
        # reason.
        for key in _MAIL_ENV:
            if key == "AZURE_MAIL_ENABLED":
                continue
            env = dict(_MAIL_ENV, **_BLANKED_ALTERNATES, **{key: ""})
            with mock.patch.dict("os.environ", env, clear=False):
                self.assertFalse(email_azure.is_configured(), key)
                # The report names both accepted spellings for the setting.
                self.assertTrue(
                    any(key in entry for entry in email_azure.missing_settings()), key
                )

    def test_accepts_the_azure_login_app_spelling(self):
        """This deployment's .env names the mail app AZURE_LOGIN_APP_* and its
        sender AZURE_EMAIL. Both must resolve without the AZURE_MAIL_* names."""
        env = {
            "AZURE_MAIL_TENANT_ID": "", "AZURE_MAIL_CLIENT_ID": "",
            "AZURE_MAIL_CLIENT_SECRET": "", "AZURE_MAIL_SENDER": "",
            "AZURE_LOGIN_APP_TENANT_ID": "login-tenant",
            "AZURE_LOGIN_APP_CLIENT_ID": "login-client",
            "AZURE_LOGIN_APP_CLIENT_SECRET": "login-secret",
            "AZURE_EMAIL": "lms@kbc.test",
            "AZURE_MAIL_ENABLED": "true",
        }
        with mock.patch.dict("os.environ", env, clear=False):
            config = email_azure.mail_config()
            self.assertTrue(email_azure.is_configured())
        self.assertEqual(config["tenant_id"], "login-tenant")
        self.assertEqual(config["client_id"], "login-client")
        self.assertEqual(config["client_secret"], "login-secret")
        self.assertEqual(config["sender"], "lms@kbc.test")

    def test_azure_mail_names_win_over_the_login_app_names(self):
        """AZURE_MAIL_* is the documented primary; the alternate is a fallback."""
        env = dict(
            _MAIL_ENV,
            AZURE_LOGIN_APP_TENANT_ID="ignored",
            AZURE_LOGIN_APP_CLIENT_ID="ignored",
            AZURE_LOGIN_APP_CLIENT_SECRET="ignored",
            AZURE_EMAIL="ignored@kbc.test",
        )
        with mock.patch.dict("os.environ", env, clear=False):
            config = email_azure.mail_config()
        self.assertEqual(config["tenant_id"], "tenant-id")
        self.assertEqual(config["sender"], "noreply@kbc.test")

    def test_never_falls_back_to_the_calendar_app_credentials(self):
        """MICROSOFT_* belongs to the calendar app, which has no Mail.Send.
        Using it would report configured and then 403 on every send."""
        env = {
            "AZURE_MAIL_TENANT_ID": "", "AZURE_MAIL_CLIENT_ID": "",
            "AZURE_MAIL_CLIENT_SECRET": "", "AZURE_MAIL_SENDER": "",
            "AZURE_LOGIN_APP_TENANT_ID": "", "AZURE_LOGIN_APP_CLIENT_ID": "",
            "AZURE_LOGIN_APP_CLIENT_SECRET": "", "AZURE_EMAIL": "",
            "MICROSOFT_TENANT_ID": "calendar-tenant",
            "MICROSOFT_CLIENT_ID": "calendar-client",
            "MICROSOFT_CLIENT_SECRET": "calendar-secret",
        }
        with mock.patch.dict("os.environ", env, clear=False):
            config = email_azure.mail_config()
            self.assertFalse(email_azure.is_configured())
        self.assertEqual(config["tenant_id"], "")
        self.assertEqual(config["client_id"], "")

    def test_sender_has_no_implicit_default(self):
        """There is no sensible default mailbox to send as."""
        env = dict(_MAIL_ENV, AZURE_MAIL_SENDER="", AZURE_EMAIL="")
        with mock.patch.dict("os.environ", env, clear=False):
            self.assertEqual(email_azure.mail_config()["sender"], "")
            self.assertTrue(
                any("AZURE_MAIL_SENDER" in e for e in email_azure.missing_settings())
            )

    def test_explicitly_disabled_reports_not_configured(self):
        env = dict(_MAIL_ENV, AZURE_MAIL_ENABLED="false")
        with mock.patch.dict("os.environ", env, clear=False):
            self.assertFalse(email_azure.is_configured())

    def test_missing_settings_reports_names_only_never_values(self):
        """The health endpoint publishes this list — it must leak no secrets."""
        env = dict(_MAIL_ENV, AZURE_MAIL_CLIENT_SECRET="")
        with mock.patch.dict("os.environ", env, clear=False):
            reported = " ".join(email_azure.missing_settings())
        self.assertNotIn("secret-value", reported)
        self.assertNotIn("tenant-id", reported)


class MailFallbackTests(SimpleTestCase):
    """When Azure is absent, a live token must not reach production logs."""

    _LINK = "https://host/set-password?token=LIVE-TOKEN-VALUE"

    def _send(self):
        return email_azure.send_mail(
            to="person@kbc.test", subject="Subject",
            html_body="<b>x</b>", text_body=self._LINK,
        )

    def test_unconfigured_send_reports_failure_with_a_reason(self):
        with mock.patch.dict("os.environ", {"AZURE_MAIL_SENDER": ""}, clear=False):
            sent, detail = self._send()
        self.assertFalse(sent)
        self.assertIn("not-configured", detail)

    @override_settings(DEBUG=True)
    def test_link_is_logged_in_development(self):
        with mock.patch.dict("os.environ", {"AZURE_MAIL_SENDER": ""}, clear=False):
            with self.assertLogs("login.email", level="WARNING") as captured:
                self._send()
        self.assertIn("LIVE-TOKEN-VALUE", "\n".join(captured.output))

    @override_settings(DEBUG=False)
    def test_link_is_never_logged_in_production(self):
        with mock.patch.dict("os.environ", {"AZURE_MAIL_SENDER": ""}, clear=False):
            with self.assertLogs("login.email", level="ERROR") as captured:
                self._send()
        output = "\n".join(captured.output)
        self.assertNotIn("LIVE-TOKEN-VALUE", output)
        # Still says something actionable, so the misconfiguration is visible.
        self.assertIn("not configured", output)

    def test_graph_failure_is_reported_not_raised(self):
        """A mail outage must not turn a learner's creation into a 500."""
        with mock.patch.dict("os.environ", _MAIL_ENV, clear=False):
            with mock.patch.object(email_azure, "_access_token", return_value="tok"):
                response = mock.Mock(status_code=503, text="upstream unavailable")
                with mock.patch("httpx.post", return_value=response):
                    sent, detail = self._send()
        self.assertFalse(sent)
        self.assertIn("503", detail)

    def test_graph_202_is_treated_as_sent(self):
        """202 Accepted is sendMail's documented success."""
        with mock.patch.dict("os.environ", _MAIL_ENV, clear=False):
            with mock.patch.object(email_azure, "_access_token", return_value="tok"):
                response = mock.Mock(status_code=202, text="")
                with mock.patch("httpx.post", return_value=response) as posted:
                    sent, detail = self._send()
        self.assertTrue(sent)
        self.assertIsNone(detail)
        # Sends as the configured mailbox, and does not fill Sent Items.
        url, kwargs = posted.call_args[0][0], posted.call_args[1]
        self.assertIn("noreply@kbc.test", url)
        self.assertFalse(kwargs["json"]["saveToSentItems"])

    def test_network_error_is_caught(self):
        import httpx

        with mock.patch.dict("os.environ", _MAIL_ENV, clear=False):
            with mock.patch.object(email_azure, "_access_token", return_value="tok"):
                with mock.patch("httpx.post", side_effect=httpx.ConnectError("down")):
                    sent, detail = self._send()
        self.assertFalse(sent)
        self.assertTrue(detail)


class MessageTemplateTests(SimpleTestCase):
    def test_invitation_message_carries_the_link(self):
        subject, html, text = email_azure.invitation_message(
            display_name="Pat Jones", link="https://host/set-password?token=T", expires_days=7
        )
        self.assertTrue(subject)
        for body in (html, text):
            self.assertIn("https://host/set-password?token=T", body)
        self.assertIn("Pat Jones", html)
        self.assertIn("7", text)

    def test_reset_message_carries_the_link(self):
        subject, html, text = email_azure.reset_message(
            display_name=None, link="https://host/reset-password?token=T", expires_hours=1
        )
        self.assertTrue(subject)
        for body in (html, text):
            self.assertIn("https://host/reset-password?token=T", body)
        # No name available — must still greet without rendering "None".
        self.assertNotIn("None", html)

    def test_templates_are_self_contained_html(self):
        """Mail clients strip <style> blocks and block remote assets."""
        _, html, _ = email_azure.invitation_message(
            display_name="A", link="https://h/x", expires_days=7
        )
        self.assertNotIn("<style", html.lower())
        self.assertNotIn("<script", html.lower())


class LinkBuildingTests(SimpleTestCase):
    def test_links_point_at_the_configured_frontend(self):
        with mock.patch.dict("os.environ", {"FRONTEND_URL": "https://lms.example.net"}):
            self.assertTrue(
                invitations.invitation_link("TOK").startswith(
                    "https://lms.example.net/set-password?token="
                )
            )
            self.assertTrue(
                invitations.reset_link("TOK").startswith(
                    "https://lms.example.net/reset-password?token="
                )
            )

    def test_trailing_slash_does_not_produce_a_double_slash(self):
        with mock.patch.dict("os.environ", {"FRONTEND_URL": "https://lms.example.net/"}):
            self.assertNotIn("//set-password", invitations.invitation_link("T"))

    def test_the_two_flows_use_different_paths(self):
        """A reset token pasted into the invitation page must not resolve."""
        with mock.patch.dict("os.environ", {"FRONTEND_URL": "https://h"}):
            self.assertNotEqual(invitations.invitation_link("T"), invitations.reset_link("T"))


# ---------------------------------------------------------------------------
# Sessions — needs the database, but only the two session tables
# ---------------------------------------------------------------------------

class SessionLifecycleTests(TestCase):
    databases = {"default", "enrolment"}

    def setUp(self):
        super().setUp()
        self.account = LoginAccount.objects.create(
            subject_type="staff",
            subject_id=900_000 + (uuid.uuid4().int % 90_000),
            email=f"sess-{uuid.uuid4().hex[:10]}@kbc.invalid",
            display_name="Session Tester",
            role=ROLE_STAFF,
            password_hash=hash_password("Vaulted-Harbour-92!"),
        )

    def tearDown(self):
        LoginSession.objects.filter(account=self.account).delete()
        LoginAccount.objects.filter(pk=self.account.pk).delete()
        super().tearDown()

    def test_issue_stores_only_the_hash(self):
        from .sessions import issue_session

        token, session, ttl = issue_session(self.account)
        self.assertEqual(session.token_hash, hash_token(token))
        self.assertNotEqual(session.token_hash, token)
        self.assertEqual(ttl, SESSION_TTL)

    def test_remember_me_lengthens_the_session(self):
        from .sessions import issue_session

        _, plain, _ = issue_session(self.account, remember=False)
        _, remembered, _ = issue_session(self.account, remember=True)
        self.assertGreater(remembered.expires_at, plain.expires_at)

    def test_resolve_returns_the_session_for_a_valid_token(self):
        from .sessions import issue_session, resolve_session

        token, session, _ = issue_session(self.account)
        resolved = resolve_session(token)
        self.assertIsNotNone(resolved)
        self.assertEqual(resolved.pk, session.pk)

    def test_resolve_rejects_unknown_empty_and_expired_tokens(self):
        from .sessions import issue_session, resolve_session

        self.assertIsNone(resolve_session(None))
        self.assertIsNone(resolve_session(""))
        self.assertIsNone(resolve_session(generate_token()))

        token, session, _ = issue_session(self.account)
        session.expires_at = timezone.now() - timedelta(seconds=1)
        session.save(update_fields=["expires_at"])
        self.assertIsNone(resolve_session(token))

    def test_revoked_session_stops_resolving(self):
        from .sessions import issue_session, resolve_session, revoke_session

        token, session, _ = issue_session(self.account)
        revoke_session(session)
        self.assertIsNone(resolve_session(token))

    def test_deactivating_the_account_kills_live_sessions(self):
        """No wait for expiry — a disabled account loses access immediately."""
        from .sessions import issue_session, resolve_session

        token, _, _ = issue_session(self.account)
        self.account.is_active = False
        self.account.save(update_fields=["is_active"])
        self.assertIsNone(resolve_session(token))

    def test_revoke_all_ends_every_session(self):
        from .sessions import issue_session, resolve_session, revoke_all_for_account

        tokens = [issue_session(self.account)[0] for _ in range(3)]
        revoke_all_for_account(self.account)
        for token in tokens:
            self.assertIsNone(resolve_session(token))

    def test_revoke_all_can_spare_the_current_session(self):
        """Used by change-password: sign out elsewhere, stay signed in here."""
        from .sessions import issue_session, resolve_session, revoke_all_for_account

        keep_token, keep, _ = issue_session(self.account)
        other_token, _, _ = issue_session(self.account)

        revoke_all_for_account(self.account, except_session_id=keep.pk)

        self.assertIsNotNone(resolve_session(keep_token))
        self.assertIsNone(resolve_session(other_token))

    def test_sessions_of_other_accounts_are_untouched(self):
        from .sessions import issue_session, resolve_session, revoke_all_for_account

        other = LoginAccount.objects.create(
            subject_type="staff",
            subject_id=800_000 + (uuid.uuid4().int % 90_000),
            email=f"other-{uuid.uuid4().hex[:10]}@kbc.invalid",
            role=ROLE_STAFF,
        )
        try:
            other_token, _, _ = issue_session(other)
            revoke_all_for_account(self.account)
            self.assertIsNotNone(resolve_session(other_token))
        finally:
            LoginSession.objects.filter(account=other).delete()
            LoginAccount.objects.filter(pk=other.pk).delete()


class ThrottleCounterTests(TestCase):
    """The sliding window is read from the audit table, so it needs rows."""

    databases = {"default", "enrolment"}

    def setUp(self):
        super().setUp()
        self.ip = f"203.0.113.{uuid.uuid4().int % 200}"
        self.email = f"thr-{uuid.uuid4().hex[:10]}@kbc.invalid"

    def tearDown(self):
        LoginAudit.objects.filter(ip_address=self.ip).delete()
        LoginAudit.objects.filter(email=self.email).delete()
        super().tearDown()

    def _fail(self, when=None):
        row = LoginAudit.objects.create(
            event="login", email=self.email, succeeded=False,
            reason="bad_password", ip_address=self.ip,
        )
        if when is not None:
            LoginAudit.objects.filter(pk=row.pk).update(created_at=when)
        return row

    def test_a_quiet_ip_is_not_throttled(self):
        from .security import ip_is_throttled

        self.assertFalse(ip_is_throttled(self.ip))

    def test_ip_is_throttled_after_enough_recent_failures(self):
        from .security import ip_is_throttled

        for _ in range(THROTTLE_MAX_FAILURES_PER_IP):
            self._fail()
        self.assertTrue(ip_is_throttled(self.ip))

    def test_old_failures_fall_out_of_the_window(self):
        from .security import ip_is_throttled

        stale = timezone.now() - timedelta(days=1)
        for _ in range(THROTTLE_MAX_FAILURES_PER_IP + 5):
            self._fail(when=stale)
        self.assertFalse(ip_is_throttled(self.ip))

    def test_successful_logins_do_not_count_towards_the_limit(self):
        from .security import ip_is_throttled

        for _ in range(THROTTLE_MAX_FAILURES_PER_IP + 5):
            LoginAudit.objects.create(
                event="login", email=self.email, succeeded=True, ip_address=self.ip,
            )
        self.assertFalse(ip_is_throttled(self.ip))

    def test_no_ip_is_never_throttled(self):
        """A missing REMOTE_ADDR must not lock every anonymous caller out."""
        from .security import ip_is_throttled

        self.assertFalse(ip_is_throttled(None))
