"""Tests for the login app's security-relevant behaviour.

These run against the real Neon database (the `login` schema), because the
models are unmanaged and the test runner cannot create them on SQLite — the
same constraint every other Neon-backed app in this project has. Each test
cleans up the rows it creates.

Run (the custom runner is required — it creates the unmanaged tables in the
test database, which Django's own runner cannot do for managed = False models):

    python manage.py test login --testrunner=login.test_runner.EnrolmentTestRunner

Neon keeps pooled connections open briefly after a run, so the final "destroying
test database" step sometimes reports that the database is still in use. That
happens after the results line and does not affect them; the next run recreates
the database anyway.

The focus is deliberately narrow: the things that would be a security bug if
they regressed. Not covered here are the HTML of the emails and the exact
wording of messages, which are allowed to change.
"""
import json
import uuid
from unittest import mock

from django.test import Client, TestCase
from django.utils import timezone

from learner_api.models import StaffUser

from . import identity
from .invitations import accept_invitation, create_invitation, create_reset, complete_reset
from .models import Invitation, LoginAccount, LoginAudit, LoginSession, PasswordReset
from .security import (
    LOCKOUT_THRESHOLD,
    PasswordPolicyError,
    hash_password,
    hash_token,
    normalize_email,
    validate_password_strength,
    verify_password,
)

XHR = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}


class LoginTestBase(TestCase):
    # These models live on the Neon connection, not `default`.
    databases = {"default", "enrolment"}

    def setUp(self):
        super().setUp()
        self.client = Client(SERVER_NAME="localhost")
        # A unique address per test so parallel/repeat runs cannot collide.
        self.email = f"qa-{uuid.uuid4().hex[:12]}@kbc.invalid"
        # Deliberately shares no word with the account's display name or email
        # local part — validate_password_strength rejects passwords that do,
        # and a fixture that trips its own policy tests nothing useful.
        self.password = "Vaulted-Harbour-92!"
        self._staff = None
        self._accounts = []

    def tearDown(self):
        for account in self._accounts:
            LoginSession.objects.filter(account_id=account.id).delete()
            Invitation.objects.filter(account_id=account.id).delete()
            PasswordReset.objects.filter(account_id=account.id).delete()
            LoginAccount.objects.filter(pk=account.id).delete()
        LoginAudit.objects.filter(email=self.email).delete()
        if self._staff is not None:
            StaffUser.objects.filter(pk=self._staff.id).delete()
        super().tearDown()

    def make_account(self, *, position="Admin", with_password=True, active=True):
        self._staff = StaffUser.objects.create(
            username="Test Person", email=self.email, position=position,
            type="Admin", status="FullUser",
        )
        account, _ = identity.ensure_account("staff", self._staff.id, subject=self._staff)
        if with_password:
            account.password_hash = hash_password(self.password)
            account.password_set_at = timezone.now()
        account.is_active = active
        account.save()
        self._accounts.append(account)
        return account

    def post(self, url, payload, **extra):
        return self.client.post(
            url, data=json.dumps(payload), content_type="application/json", **{**XHR, **extra}
        )


class PasswordPolicyTests(TestCase):
    def test_rejects_short_password(self):
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength("Ab1!x")

    def test_rejects_common_password(self):
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength("password123")

    def test_rejects_password_containing_email_local_part(self):
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength("jsmith-is-here", email="jsmith@example.com")

    def test_rejects_single_repeated_character(self):
        with self.assertRaises(PasswordPolicyError):
            validate_password_strength("aaaaaaaaaaaa")

    def test_accepts_a_reasonable_passphrase(self):
        self.assertTrue(validate_password_strength("correct-horse-battery"))

    def test_hash_is_not_the_password_and_verifies(self):
        hashed = hash_password("correct-horse-battery")
        self.assertNotIn("correct-horse-battery", hashed)
        self.assertTrue(verify_password("correct-horse-battery", hashed))
        self.assertFalse(verify_password("wrong", hashed))

    def test_empty_hash_never_verifies(self):
        """An invited-but-not-onboarded account must not be signable-into."""
        self.assertFalse(verify_password("", ""))
        self.assertFalse(verify_password("anything", ""))


class LoginEndpointTests(LoginTestBase):
    def test_successful_login_sets_session_cookie(self):
        self.make_account()
        response = self.post("/login_api/login/", {"email": self.email, "password": self.password})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["user"]["role"], "admin")

        cookie = response.cookies.get("kbc_session")
        self.assertIsNotNone(cookie)
        # HttpOnly is the control that stops an XSS bug becoming account theft.
        self.assertTrue(cookie["httponly"])
        self.assertEqual(cookie["samesite"], "Lax")

    def test_session_token_is_not_stored_in_plaintext(self):
        self.make_account()
        response = self.post("/login_api/login/", {"email": self.email, "password": self.password})
        token = response.cookies["kbc_session"].value

        self.assertFalse(LoginSession.objects.filter(token_hash=token).exists())
        self.assertTrue(LoginSession.objects.filter(token_hash=hash_token(token)).exists())

    def test_wrong_password_and_unknown_account_are_indistinguishable(self):
        self.make_account()
        wrong = self.post("/login_api/login/", {"email": self.email, "password": "not-it"})
        unknown = self.post(
            "/login_api/login/",
            {"email": f"absent-{uuid.uuid4().hex[:8]}@kbc.invalid", "password": "not-it"},
        )
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(unknown.status_code, 401)
        # Identical body: anything else is an account-enumeration oracle.
        self.assertEqual(wrong.json(), unknown.json())

    def test_login_without_xhr_header_is_refused(self):
        """The CSRF defence: a cross-origin form post cannot set this header."""
        self.make_account()
        response = self.client.post(
            "/login_api/login/",
            data=json.dumps({"email": self.email, "password": self.password}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "csrf")

    def test_account_without_password_cannot_sign_in(self):
        self.make_account(with_password=False)
        response = self.post("/login_api/login/", {"email": self.email, "password": ""})
        self.assertEqual(response.status_code, 400)
        response = self.post("/login_api/login/", {"email": self.email, "password": "guess"})
        self.assertEqual(response.status_code, 401)

    def test_inactive_account_cannot_sign_in(self):
        self.make_account(active=False)
        response = self.post("/login_api/login/", {"email": self.email, "password": self.password})
        self.assertEqual(response.status_code, 401)

    def test_repeated_failures_lock_the_account(self):
        account = self.make_account()
        for _ in range(LOCKOUT_THRESHOLD):
            self.post("/login_api/login/", {"email": self.email, "password": "wrong"})

        account.refresh_from_db()
        self.assertGreaterEqual(account.failed_attempts, LOCKOUT_THRESHOLD)
        self.assertIsNotNone(account.locked_until)

        # The correct password is refused while the lock is in force.
        response = self.post("/login_api/login/", {"email": self.email, "password": self.password})
        self.assertEqual(response.status_code, 423)
        self.assertEqual(response.json()["code"], "locked")

    def test_successful_login_clears_failure_count(self):
        account = self.make_account()
        self.post("/login_api/login/", {"email": self.email, "password": "wrong"})
        self.post("/login_api/login/", {"email": self.email, "password": self.password})
        account.refresh_from_db()
        self.assertEqual(account.failed_attempts, 0)
        self.assertIsNone(account.locked_until)

    def test_me_requires_a_session_and_logout_ends_it(self):
        self.make_account()
        self.assertEqual(self.client.get("/login_api/me/").status_code, 401)

        self.post("/login_api/login/", {"email": self.email, "password": self.password})
        self.assertEqual(self.client.get("/login_api/me/").status_code, 200)

        self.assertEqual(self.client.post("/login_api/logout/", **XHR).status_code, 200)
        self.assertEqual(self.client.get("/login_api/me/").status_code, 401)

    def test_me_never_exposes_the_password_hash(self):
        self.make_account()
        self.post("/login_api/login/", {"email": self.email, "password": self.password})
        body = self.client.get("/login_api/me/").content.decode()
        self.assertNotIn("password_hash", body)
        self.assertNotIn("passwordHash", body)
        self.assertNotIn("argon2", body)
        self.assertNotIn("pbkdf2", body)

    def test_login_is_audited(self):
        self.make_account()
        self.post("/login_api/login/", {"email": self.email, "password": "wrong"})
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        events = LoginAudit.objects.filter(email=self.email, event="login")
        self.assertTrue(events.filter(succeeded=False, reason="bad_password").exists())
        self.assertTrue(events.filter(succeeded=True).exists())


class RoleTests(LoginTestBase):
    def test_admin_position_grants_admin_role(self):
        account = self.make_account(position="Admin")
        self.assertEqual(account.role, "admin")

    def test_other_positions_are_staff_not_admin(self):
        account = self.make_account(position="Enrolment")
        self.assertEqual(account.role, "staff")
        self.assertNotIn("accounts.manage", identity.permissions_for(account.role))

    def test_role_follows_a_position_change(self):
        """Demotion must take effect without the account being recreated."""
        account = self.make_account(position="Admin")
        self._staff.position = "Enrolment"
        self._staff.save(update_fields=["position"])

        refreshed, created = identity.ensure_account("staff", self._staff.id)
        self.assertFalse(created)
        self.assertEqual(refreshed.role, "staff")


class InvitationTests(LoginTestBase):
    def test_invitation_token_is_stored_only_as_a_hash(self):
        account = self.make_account(with_password=False)
        invitation, token = create_invitation(account)
        self.assertNotEqual(invitation.token_hash, token)
        self.assertEqual(invitation.token_hash, hash_token(token))

    def test_accepting_an_invitation_sets_the_first_password(self):
        account = self.make_account(with_password=False)
        _, token = create_invitation(account)

        response = self.client.get(f"/login_api/invitation/?token={token}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], normalize_email(self.email))

        response = self.post(
            "/login_api/accept-invitation/", {"token": token, "password": self.password}
        )
        self.assertEqual(response.status_code, 200)

        account.refresh_from_db()
        self.assertTrue(account.has_password)
        self.assertEqual(
            self.post("/login_api/login/", {"email": self.email, "password": self.password}).status_code,
            200,
        )

    def test_an_invitation_cannot_be_used_twice(self):
        account = self.make_account(with_password=False)
        _, token = create_invitation(account)
        accept_invitation(token, self.password)

        # Through the endpoint rather than the service: accept_invitation is
        # @transaction.atomic, and letting it raise inside TestCase's own atomic
        # block would poison the transaction for the assertions that follow.
        response = self.post(
            "/login_api/accept-invitation/",
            {"token": token, "password": "A-Different-Passphrase!9"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_token")

    def test_a_weak_password_is_refused_on_acceptance(self):
        account = self.make_account(with_password=False)
        _, token = create_invitation(account)
        response = self.post("/login_api/accept-invitation/", {"token": token, "password": "short"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "weak_password")
        account.refresh_from_db()
        self.assertFalse(account.has_password)

    def test_reissuing_supersedes_the_previous_invitation(self):
        account = self.make_account(with_password=False)
        _, first = create_invitation(account)
        _, second = create_invitation(account)

        # The first link must stop working the moment a replacement is issued.
        self.assertEqual(self.client.get(f"/login_api/invitation/?token={first}").status_code, 400)
        self.assertEqual(self.client.get(f"/login_api/invitation/?token={second}").status_code, 200)

    def test_expired_invitation_is_refused(self):
        account = self.make_account(with_password=False)
        invitation, token = create_invitation(account)
        invitation.expires_at = timezone.now() - timezone.timedelta(minutes=1)
        invitation.save(update_fields=["expires_at"])
        self.assertEqual(self.client.get(f"/login_api/invitation/?token={token}").status_code, 400)


class PasswordResetTests(LoginTestBase):
    def test_forgot_password_does_not_disclose_whether_an_account_exists(self):
        self.make_account()
        known = self.post("/login_api/forgot-password/", {"email": self.email})
        unknown = self.post(
            "/login_api/forgot-password/",
            {"email": f"absent-{uuid.uuid4().hex[:8]}@kbc.invalid"},
        )
        self.assertEqual(known.status_code, 200)
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(known.json(), unknown.json())

    def test_completing_a_reset_changes_the_password(self):
        account = self.make_account()
        _, token = create_reset(account)
        new_password = "Replacement-Passphrase!7"

        response = self.post(
            "/login_api/reset-password/", {"token": token, "password": new_password}
        )
        self.assertEqual(response.status_code, 200)

        self.assertEqual(
            self.post("/login_api/login/", {"email": self.email, "password": self.password}).status_code,
            401,
        )
        self.assertEqual(
            self.post("/login_api/login/", {"email": self.email, "password": new_password}).status_code,
            200,
        )

    def test_reset_revokes_existing_sessions(self):
        """A password change must not leave sessions opened with the old one."""
        account = self.make_account()
        self.post("/login_api/login/", {"email": self.email, "password": self.password})
        self.assertEqual(self.client.get("/login_api/me/").status_code, 200)

        _, token = create_reset(account)
        complete_reset(token, "Replacement-Passphrase!7")

        self.assertEqual(self.client.get("/login_api/me/").status_code, 401)

    def test_reset_clears_a_lockout(self):
        account = self.make_account()
        for _ in range(LOCKOUT_THRESHOLD):
            self.post("/login_api/login/", {"email": self.email, "password": "wrong"})

        _, token = create_reset(account)
        complete_reset(token, "Replacement-Passphrase!7")

        account.refresh_from_db()
        self.assertEqual(account.failed_attempts, 0)
        self.assertIsNone(account.locked_until)

    def test_a_reset_token_cannot_be_reused(self):
        account = self.make_account()
        _, token = create_reset(account)
        complete_reset(token, "Replacement-Passphrase!7")

        # Via the endpoint — see the note in test_an_invitation_cannot_be_used_twice.
        response = self.post(
            "/login_api/reset-password/",
            {"token": token, "password": "Yet-Another-Passphrase!8"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_token")


class ChangePasswordTests(LoginTestBase):
    def test_change_requires_the_current_password(self):
        self.make_account()
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        response = self.post(
            "/login_api/change-password/",
            {"currentPassword": "not-the-current-one", "newPassword": "Replacement-Passphrase!7"},
        )
        self.assertEqual(response.status_code, 403)

    def test_change_password_succeeds_and_keeps_the_caller_signed_in(self):
        self.make_account()
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        response = self.post(
            "/login_api/change-password/",
            {"currentPassword": self.password, "newPassword": "Replacement-Passphrase!7"},
        )
        self.assertEqual(response.status_code, 200)
        # The session used to make the change survives; others are revoked.
        self.assertEqual(self.client.get("/login_api/me/").status_code, 200)

    def test_change_password_requires_authentication(self):
        response = self.post(
            "/login_api/change-password/",
            {"currentPassword": "x", "newPassword": "Replacement-Passphrase!7"},
        )
        self.assertEqual(response.status_code, 401)


class InvitePrivilegeTests(LoginTestBase):
    """Nobody can mint themselves a credential through the creation forms.

    The three `learner_api` creation endpoints are @csrf_exempt and carry no
    auth decorator. Hooking invitations into them turned "anyone can create a
    junk staff row" into "anyone can create an *admin login* and have the
    set-password link emailed to an address they chose". These tests pin the
    authorisation that closes that.
    """

    def _create_staff(self, email, position, client=None, invite=True):
        client = client or Client(SERVER_NAME="localhost")
        return client.post(
            "/learner_api/staff-users/",
            data=json.dumps({
                "username": "Created Person",
                "email": email,
                "position": position,
                "inviteToPlatform": invite,
            }),
            content_type="application/json",
        )

    def test_anonymous_caller_cannot_mint_an_admin_account(self):
        """Two independent defences stop this; here the outer one fires first.

        The endpoint gate now refuses the request outright, so it never reaches
        the invite logic. ``test_disabling_the_gate_still_does_not_allow_minting_an_admin``
        in LearnerApiGateTests covers the inner defence with the gate switched
        off — both must hold, because either could be relaxed independently.
        """
        target = f"anon-{uuid.uuid4().hex[:10]}@kbc.invalid"
        try:
            response = self._create_staff(target, "Admin")

            self.assertEqual(response.status_code, 401)
            # The decisive assertion: no credential exists to be redeemed, and
            # no staff record was created to hang one off later.
            self.assertFalse(LoginAccount.objects.filter(email=target).exists())
            self.assertFalse(StaffUser.objects.filter(email=target).exists())
        finally:
            LoginAccount.objects.filter(email=target).delete()
            StaffUser.objects.filter(email=target).delete()

    def test_staff_cannot_invite_an_admin(self):
        """Otherwise any staff member could promote themselves."""
        self.make_account(position="Enrolment")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        target = f"esc-{uuid.uuid4().hex[:10]}@kbc.invalid"
        try:
            response = self._create_staff(target, "Admin", client=self.client)
            invitation = response.json().get("invitation")

            self.assertTrue(invitation["forbidden"])
            self.assertFalse(LoginAccount.objects.filter(email=target).exists())
        finally:
            LoginAccount.objects.filter(email=target).delete()
            StaffUser.objects.filter(email=target).delete()

    def test_staff_may_invite_a_non_admin(self):
        """The gate must not break the ordinary case it exists to protect."""
        self.make_account(position="Enrolment")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        target = f"ok-{uuid.uuid4().hex[:10]}@kbc.invalid"
        try:
            response = self._create_staff(target, "Enrolment", client=self.client)
            invitation = response.json().get("invitation")

            self.assertFalse(invitation["forbidden"])
            self.assertTrue(invitation["invited"])
            self.assertTrue(LoginAccount.objects.filter(email=target).exists())
        finally:
            LoginAccount.objects.filter(email=target).delete()
            StaffUser.objects.filter(email=target).delete()

    def test_admin_may_invite_an_admin(self):
        self.make_account(position="Admin")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        target = f"adm-{uuid.uuid4().hex[:10]}@kbc.invalid"
        try:
            response = self._create_staff(target, "Admin", client=self.client)
            invitation = response.json().get("invitation")

            self.assertFalse(invitation["forbidden"])
            self.assertTrue(invitation["invited"])
            minted = LoginAccount.objects.get(email=target)
            self.assertEqual(minted.role, "admin")
        finally:
            LoginAccount.objects.filter(email=target).delete()
            StaffUser.objects.filter(email=target).delete()

    def test_invite_endpoint_also_refuses_staff_inviting_an_admin(self):
        """The same rule holds on /login_api/accounts/invite/."""
        admin_target = StaffUser.objects.create(
            username="Some Admin",
            email=f"tgt-{uuid.uuid4().hex[:10]}@kbc.invalid",
            position="Admin", type="Admin", status="FullUser",
        )
        self.make_account(position="Enrolment")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        try:
            response = self.post(
                "/login_api/accounts/invite/",
                {"subjectType": "staff", "subjectId": admin_target.id},
            )
            self.assertEqual(response.status_code, 403)
            self.assertFalse(
                LoginAccount.objects.filter(
                    subject_type="staff", subject_id=admin_target.id
                ).exists()
            )
        finally:
            LoginAccount.objects.filter(
                subject_type="staff", subject_id=admin_target.id
            ).delete()
            StaffUser.objects.filter(pk=admin_target.id).delete()

    def test_anonymous_learner_creation_does_not_mint_an_account(self):
        """The learner form is the same shape, with a lower-privileged role."""
        from learner_api.models import EnrolmentUser

        target = f"lrn-{uuid.uuid4().hex[:10]}@kbc.invalid"
        try:
            response = Client(SERVER_NAME="localhost").post(
                "/learner_api/enrolment-users/",
                data=json.dumps({
                    "username": "Anon Learner", "email": target,
                    "inviteToPlatform": True, "learnerType": "apprenticeship",
                }),
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 401)
            self.assertFalse(LoginAccount.objects.filter(email=target).exists())
            self.assertFalse(EnrolmentUser.all_learners.filter(email=target).exists())
        finally:
            LoginAccount.objects.filter(email=target).delete()
            EnrolmentUser.all_learners.filter(email=target).delete()


class LearnerApiGateTests(LoginTestBase):
    """The `learner_api` write endpoints require an authenticated staff session.

    These endpoints had no authentication at all. Writes are now gated by
    ``login.permissions.staff_only(writes_only=True)``; reads are deliberately
    still open while the remaining unauthenticated frontend fetches are moved
    over, so the read assertions below pin *current* behaviour rather than the
    desired end state.
    """

    #: (label, url, payload) for every gated write path.
    WRITE_PATHS = (
        ("staff", "/learner_api/staff-users/",
         {"username": "X", "email": "gate-staff@kbc.invalid", "position": "Enrolment"}),
        ("learner", "/learner_api/enrolment-users/",
         {"username": "X", "email": "gate-learner@kbc.invalid"}),
        ("employer", "/learner_api/employers/",
         {"firstName": "X", "surname": "Y", "email": "gate-emp@kbc.invalid",
          "employerGroupIds": []}),
        ("organisation", "/learner_api/organisations/", {"name": "Gate Test Ltd"}),
    )

    def _anon_post(self, url, payload):
        return Client(SERVER_NAME="localhost").post(
            url, data=json.dumps(payload), content_type="application/json"
        )

    def test_anonymous_writes_are_refused(self):
        for label, url, payload in self.WRITE_PATHS:
            with self.subTest(endpoint=label):
                response = self._anon_post(url, payload)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["code"], "unauthenticated")

    def test_anonymous_writes_create_nothing(self):
        """A refused request must not leave a partial record behind."""
        before = {
            "staff": StaffUser.objects.count(),
            "accounts": LoginAccount.objects.count(),
        }
        for _, url, payload in self.WRITE_PATHS:
            self._anon_post(url, payload)

        self.assertEqual(StaffUser.objects.count(), before["staff"])
        self.assertEqual(LoginAccount.objects.count(), before["accounts"])

    def test_a_learner_session_cannot_write(self):
        """Being signed in is not enough — the role has to be staff or admin."""
        account = self.make_account(position="Enrolment")
        account.role = "learner"
        account.save(update_fields=["role"])
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        for label, url, payload in self.WRITE_PATHS:
            with self.subTest(endpoint=label):
                response = self.client.post(
                    url, data=json.dumps(payload), content_type="application/json", **XHR
                )
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json()["code"], "forbidden")

    def test_a_staff_session_may_write(self):
        self.make_account(position="Enrolment")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

        target = f"gate-ok-{uuid.uuid4().hex[:8]}@kbc.invalid"
        try:
            response = self.client.post(
                "/learner_api/staff-users/",
                data=json.dumps({
                    "username": "Allowed", "email": target, "position": "Enrolment",
                }),
                content_type="application/json", **XHR,
            )
            self.assertEqual(response.status_code, 201)
        finally:
            StaffUser.objects.filter(email=target).delete()

    def test_reads_remain_open(self):
        """Documents current behaviour: only writes are gated so far."""
        anon = Client(SERVER_NAME="localhost")
        for url in ("/learner_api/staff-users/", "/learner_api/enrolment-users/"):
            with self.subTest(url=url):
                self.assertEqual(anon.get(url).status_code, 200)

    def test_the_gate_can_be_disabled_for_local_development(self):
        """LEARNER_API_REQUIRE_AUTH=0 is the documented escape hatch."""
        target = f"gate-off-{uuid.uuid4().hex[:8]}@kbc.invalid"
        try:
            with mock.patch.dict(
                "os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}, clear=False
            ):
                response = self._anon_post(
                    "/learner_api/staff-users/",
                    {"username": "Local", "email": target, "position": "Enrolment"},
                )
            self.assertEqual(response.status_code, 201)
        finally:
            StaffUser.objects.filter(email=target).delete()

    def test_disabling_the_gate_still_does_not_allow_minting_an_admin(self):
        """The invite authorisation is independent of the endpoint gate.

        Turning the gate off for local development must not re-open the
        privilege-escalation path — invite_subject checks the caller itself.
        """
        target = f"gate-esc-{uuid.uuid4().hex[:8]}@kbc.invalid"
        try:
            with mock.patch.dict(
                "os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}, clear=False
            ):
                response = self._anon_post(
                    "/learner_api/staff-users/",
                    {"username": "Local", "email": target,
                     "position": "Admin", "inviteToPlatform": True},
                )
            self.assertEqual(response.status_code, 201)
            self.assertTrue(response.json()["invitation"]["forbidden"])
            self.assertFalse(LoginAccount.objects.filter(email=target).exists())
        finally:
            LoginAccount.objects.filter(email=target).delete()
            StaffUser.objects.filter(email=target).delete()


class PermissionTests(LoginTestBase):
    def test_invite_endpoint_rejects_anonymous_callers(self):
        response = self.post(
            "/login_api/accounts/invite/", {"subjectType": "staff", "subjectId": 1}
        )
        self.assertEqual(response.status_code, 401)

    def test_invite_endpoint_rejects_a_learner_session(self):
        """Role enforcement is server-side, not just hidden in the UI."""
        account = self.make_account(position="Enrolment")
        account.role = "learner"
        account.save(update_fields=["role"])

        self.post("/login_api/login/", {"email": self.email, "password": self.password})
        response = self.post(
            "/login_api/accounts/invite/", {"subjectType": "staff", "subjectId": self._staff.id}
        )
        self.assertEqual(response.status_code, 403)
