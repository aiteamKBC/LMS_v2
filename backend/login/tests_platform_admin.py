"""Tests for the Super Admin console endpoints (``login.platform_admin``).

Same constraints as ``login.tests``: the models are unmanaged, so these run
against the test Neon database provisioned by the custom runner.

    python manage.py test login.tests_platform_admin \
        --testrunner=login.test_runner.EnrolmentTestRunner --noinput

If a previous run's teardown failed (Neon holds pooled connections open briefly,
so "database is being accessed by other users" is common), the leftover
``test_neondb`` blocks the next run until it is dropped.

The focus is the authorisation boundary and the behaviours that would be bugs if
they regressed — a staff session reaching an admin-only read, an admin locking
themselves out, a suspension leaving live sessions usable, and a missing table
poisoning the connection for the rest of the request. The exact value of every
count is not asserted: those are SQL over tables this suite does not populate,
and pinning them would test the fixture rather than the code.
"""
import json
import uuid
from unittest import mock

from django.utils import timezone

from learner_api.models import StaffUser

from . import email_azure, identity
from .models import Invitation, LoginAudit, LoginSession
from .security import hash_password
from .tests import XHR, LoginTestBase

ADMIN_ENDPOINTS = (
    "/login_api/admin/overview/",
    "/login_api/admin/accounts/",
    "/login_api/admin/audit/",
    "/login_api/admin/roles/",
    "/login_api/admin/email-log/",
    "/login_api/admin/system/",
    "/login_api/admin/documents/",
    "/login_api/admin/curriculum/",
)


class PlatformAdminAccessTests(LoginTestBase):
    """The gate. These endpoints read across every learner and the whole auth
    trail, so anything short of an admin session must be refused."""

    def sign_in(self):
        response = self.post(
            "/login_api/login/", {"email": self.email, "password": self.password}
        )
        self.assertEqual(response.status_code, 200)

    def test_all_endpoints_reject_anonymous_callers(self):
        for url in ADMIN_ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, **XHR).status_code, 401)

    def test_all_endpoints_reject_a_staff_session(self):
        """staff_only is not the boundary here — staff must not read this."""
        self.make_account(position="Caseowner")
        self.sign_in()
        for url in ADMIN_ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, **XHR).status_code, 403)

    def test_admin_session_is_allowed(self):
        """Also a regression test for connection poisoning: a missing optional
        table must not abort the transaction and turn later reads into 401s."""
        self.make_account(position="Admin")
        self.sign_in()
        for url in ADMIN_ENDPOINTS:
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url, **XHR).status_code, 200)

    def test_account_write_rejects_a_staff_session(self):
        account = self.make_account(position="Caseowner")
        self.sign_in()
        response = self.post(
            f"/login_api/admin/accounts/{account.id}/", {"action": "unlock"}
        )
        self.assertEqual(response.status_code, 403)


class PlatformAdminReadTests(LoginTestBase):
    def setUp(self):
        super().setUp()
        self.account = self.make_account(position="Admin")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

    def get(self, url):
        response = self.client.get(url, **XHR)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_overview_reports_this_account_and_its_session(self):
        data = self.get("/login_api/admin/overview/")
        self.assertTrue(data["accounts"]["available"])
        self.assertGreaterEqual(data["accounts"]["total"], 1)
        self.assertGreaterEqual(data["accounts"]["byRole"]["admin"], 1)
        # Signing in during setUp created one.
        self.assertGreaterEqual(data["accounts"]["liveSessions"], 1)

    def test_overview_marks_a_section_unavailable_rather_than_reporting_zero(self):
        """Absent tables must not be reported as empty ones."""
        data = self.get("/login_api/admin/overview/")
        for section in ("people", "documents", "curriculum", "delivery"):
            self.assertIn("available", data[section], msg=section)

    def test_accounts_lists_the_signed_in_account(self):
        data = self.get("/login_api/admin/accounts/")
        self.assertIn(self.email, [r["email"] for r in data["results"]])

    def test_accounts_never_exposes_the_password_hash(self):
        data = self.get("/login_api/admin/accounts/")
        row = next(r for r in data["results"] if r["email"] == self.email)
        self.assertNotIn("passwordHash", row)
        self.assertNotIn("password_hash", row)
        self.assertTrue(row["hasPassword"])

    def test_accounts_status_filter_separates_invited_from_active(self):
        active = self.get("/login_api/admin/accounts/?status=active")
        self.assertIn(self.email, [r["email"] for r in active["results"]])
        invited = self.get("/login_api/admin/accounts/?status=invited")
        self.assertNotIn(self.email, [r["email"] for r in invited["results"]])

    def test_accounts_role_filter_applies(self):
        data = self.get("/login_api/admin/accounts/?role=learner")
        self.assertTrue(all(r["role"] == "learner" for r in data["results"]))

    def test_audit_records_the_sign_in_from_setup(self):
        data = self.get(f"/login_api/admin/audit/?q={self.email}")
        self.assertIn("login", [r["event"] for r in data["results"]])
        self.assertIn("login", data["eventTypes"])

    def test_audit_outcome_filter_applies(self):
        data = self.get("/login_api/admin/audit/?outcome=failure")
        self.assertTrue(all(r["succeeded"] is False for r in data["results"]))

    def test_roles_report_the_four_real_roles_with_permissions(self):
        data = self.get("/login_api/admin/roles/")
        self.assertEqual(
            [r["id"] for r in data["results"]], ["admin", "staff", "employer", "learner"]
        )
        admin = next(r for r in data["results"] if r["id"] == "admin")
        # Mirrors identity._PERMISSIONS — the map the API itself checks.
        self.assertIn("accounts.manage", admin["permissions"])
        learner = next(r for r in data["results"] if r["id"] == "learner")
        self.assertNotIn("accounts.manage", learner["permissions"])

    def test_email_log_reports_delivery_rate_as_null_when_nothing_sent(self):
        """A 100% rate off zero sends would be a lie."""
        data = self.get("/login_api/admin/email-log/?kind=reset")
        if data["stats"]["sent"] == 0:
            self.assertIsNone(data["stats"]["deliveryRate"])

    def test_system_reports_setting_names_but_never_values(self):
        data = self.get("/login_api/admin/system/")
        self.assertIn("database", {c["id"] for c in data["checks"]})
        self.assertEqual(data["totalCount"], len(data["checks"]))
        blob = json.dumps(data)
        # A detail string may name a setting; it must not carry a secret.
        self.assertNotIn("postgres://", blob)
        self.assertNotIn("AccountKey=", blob)

    def test_unprovisioned_sources_answer_200_not_502(self):
        """A table this deployment has not provisioned is a deployment fact,
        not a request failure — the console should say so, not show an error."""
        for url in ("/login_api/admin/documents/", "/login_api/admin/curriculum/"):
            with self.subTest(url=url):
                data = self.get(url)
                self.assertIn("available", data)


class PlatformAdminWriteTests(LoginTestBase):
    def setUp(self):
        super().setUp()
        self.account = self.make_account(position="Admin")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

    def make_other_account(self):
        """A second account to act on, since an admin cannot suspend itself."""
        email = f"qa-other-{uuid.uuid4().hex[:10]}@kbc.invalid"
        staff = StaffUser.objects.create(
            username="Other Person", email=email, position="Caseowner",
            type="Admin", status="FullUser",
        )
        account, _ = identity.ensure_account("staff", staff.id, subject=staff)
        account.password_hash = hash_password("Vaulted-Harbour-92!")
        account.password_set_at = timezone.now()
        account.save()
        # Registered for the base class's teardown, plus the staff row.
        self._accounts.append(account)
        self.addCleanup(lambda: StaffUser.objects.filter(pk=staff.id).delete())
        self.addCleanup(lambda: LoginAudit.objects.filter(email=email).delete())
        return account

    def test_admin_cannot_suspend_their_own_account(self):
        """Otherwise the console locks its own door with no way back."""
        response = self.post(
            f"/login_api/admin/accounts/{self.account.id}/", {"action": "suspend"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "self_suspend")
        self.account.refresh_from_db()
        self.assertTrue(self.account.is_active)

    def test_suspend_revokes_live_sessions(self):
        other = self.make_other_account()
        LoginSession.objects.create(
            account_id=other.id,
            token_hash=uuid.uuid4().hex + uuid.uuid4().hex,
            expires_at=timezone.now() + timezone.timedelta(days=1),
        )
        self.assertEqual(
            LoginSession.objects.filter(account_id=other.id, revoked_at__isnull=True).count(), 1
        )

        response = self.post(f"/login_api/admin/accounts/{other.id}/", {"action": "suspend"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["account"]["status"], "suspended")

        other.refresh_from_db()
        self.assertFalse(other.is_active)
        self.assertEqual(
            LoginSession.objects.filter(account_id=other.id, revoked_at__isnull=True).count(), 0
        )

    def test_restore_clears_lockout_state(self):
        other = self.make_other_account()
        other.is_active = False
        other.failed_attempts = 5
        other.locked_until = timezone.now() + timezone.timedelta(hours=1)
        other.save()

        response = self.post(f"/login_api/admin/accounts/{other.id}/", {"action": "restore"})
        self.assertEqual(response.status_code, 200)

        other.refresh_from_db()
        self.assertTrue(other.is_active)
        self.assertEqual(other.failed_attempts, 0)
        self.assertIsNone(other.locked_until)

    def test_action_is_recorded_in_the_audit_trail(self):
        other = self.make_other_account()
        self.post(f"/login_api/admin/accounts/{other.id}/", {"action": "unlock"})
        entry = LoginAudit.objects.filter(
            account_id=other.id, event="admin_unlock"
        ).order_by("-id").first()
        self.assertIsNotNone(entry)
        self.assertTrue(entry.succeeded)
        # Attribution: who did it, not just that it happened.
        self.assertIn(self.email, entry.reason or "")

    def test_unknown_action_is_rejected(self):
        other = self.make_other_account()
        response = self.post(f"/login_api/admin/accounts/{other.id}/", {"action": "delete"})
        self.assertEqual(response.status_code, 400)

    def test_write_requires_the_csrf_header(self):
        other = self.make_other_account()
        response = self.client.post(
            f"/login_api/admin/accounts/{other.id}/",
            data=json.dumps({"action": "unlock"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "csrf")

    def test_missing_account_is_a_404(self):
        response = self.post("/login_api/admin/accounts/999999999/", {"action": "unlock"})
        self.assertEqual(response.status_code, 404)

    def test_role_cannot_be_changed_through_this_endpoint(self):
        """Role is recomputed from the enrolment row; accepting it here would
        write a value that the next request silently reverts."""
        other = self.make_other_account()
        self.post(f"/login_api/admin/accounts/{other.id}/", {"action": "unlock", "role": "admin"})
        other.refresh_from_db()
        self.assertEqual(other.role, "staff")


class ResendInvitationTests(LoginTestBase):
    """Re-sending an invitation whose delivery failed.

    The case this exists for: a transient DNS or mail outage leaves an
    "Invitation sent — failed" row in the access log and an account nobody can
    reach. The administrator needs to retry from where they noticed it.
    """

    def setUp(self):
        super().setUp()
        self.account = self.make_account(access="super-admin")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

    def make_invitee(self):
        """A staff account that has been invited but never set a password."""
        email = f"qa-invitee-{uuid.uuid4().hex[:10]}@kbc.invalid"
        staff = StaffUser.objects.create(
            username="Invitee", email=email, position="Admin",
            access="enrolment", type="Admin", status="FullUser",
        )
        account, _ = identity.ensure_account("staff", staff.id, subject=staff)
        self._accounts.append(account)
        self.addCleanup(lambda: StaffUser.objects.filter(pk=staff.id).delete())
        self.addCleanup(lambda: LoginAudit.objects.filter(email=email).delete())
        return account

    def test_resend_issues_a_fresh_invitation(self):
        invitee = self.make_invitee()
        with mock.patch.object(email_azure, "send_mail", return_value=(True, None)):
            response = self.post(
                f"/login_api/admin/accounts/{invitee.id}/", {"action": "resend-invitation"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["resent"])
        self.assertTrue(
            Invitation.objects.filter(account_id=invitee.id, used_at__isnull=True).exists()
        )

    def test_resend_supersedes_the_previous_link(self):
        """Two live invitations for one account would mean two working links."""
        invitee = self.make_invitee()
        with mock.patch.object(email_azure, "send_mail", return_value=(True, None)):
            self.post(f"/login_api/admin/accounts/{invitee.id}/", {"action": "resend-invitation"})
            self.post(f"/login_api/admin/accounts/{invitee.id}/", {"action": "resend-invitation"})
        live = Invitation.objects.filter(account_id=invitee.id, used_at__isnull=True).count()
        self.assertEqual(live, 1)

    def test_a_failed_send_is_reported_not_swallowed(self):
        invitee = self.make_invitee()
        with mock.patch.object(email_azure, "send_mail", return_value=(False, "smtp exploded")):
            response = self.post(
                f"/login_api/admin/accounts/{invitee.id}/", {"action": "resend-invitation"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["code"], "send_failed")

    def test_an_onboarded_account_is_refused(self):
        """They have a password — a reset is the right tool, not a new invitation."""
        response = self.post(
            f"/login_api/admin/accounts/{self.account.id}/", {"action": "resend-invitation"}
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "already_onboarded")

    def test_a_staff_session_cannot_resend(self):
        """Issuing a credential is an admin act, like every other account action."""
        invitee = self.make_invitee()
        self.client.post("/login_api/logout/", **XHR)

        staff_email = f"qa-staff-{uuid.uuid4().hex[:8]}@kbc.invalid"
        staff = StaffUser.objects.create(
            username="Plain Staff", email=staff_email, position="Admin",
            access="enrolment", type="Admin", status="FullUser",
        )
        staff_account, _ = identity.ensure_account("staff", staff.id, subject=staff)
        staff_account.password_hash = hash_password(self.password)
        staff_account.password_set_at = timezone.now()
        staff_account.save()
        self._accounts.append(staff_account)
        self.addCleanup(lambda: StaffUser.objects.filter(pk=staff.id).delete())
        self.addCleanup(lambda: LoginAudit.objects.filter(email=staff_email).delete())

        self.post("/login_api/login/", {"email": staff_email, "password": self.password})
        response = self.post(
            f"/login_api/admin/accounts/{invitee.id}/", {"action": "resend-invitation"}
        )
        self.assertEqual(response.status_code, 403)


class EmailAcknowledgementTests(LoginTestBase):
    """Closing the alert a failed invitation raises.

    A send failure keeps its ``Send_error`` for ever, so before this existed the
    Super Admin dashboard's "1 invitation email failed to send" could not be
    cleared by any amount of fixing it. Acknowledging is how that ends — and the
    two things it must NOT do are the point of most of these: it must not delete
    the row, and it must not rewrite the delivery-rate history.
    """

    def setUp(self):
        super().setUp()
        self.account = self.make_account(access="super-admin")
        self.post("/login_api/login/", {"email": self.email, "password": self.password})

    def make_failed_invitation(self):
        """An invitation whose email the transport refused."""
        invitation = Invitation.objects.create(
            account_id=self.account.id,
            token_hash=uuid.uuid4().hex + uuid.uuid4().hex[:32],
            email=self.account.email,
            expires_at=timezone.now() + timezone.timedelta(days=7),
            send_error="[Errno 11001] getaddrinfo failed",
        )
        self.addCleanup(lambda: Invitation.objects.filter(pk=invitation.pk).delete())
        return invitation

    def ack(self, invitation, acknowledged=True):
        return self.post(
            f"/login_api/admin/email-log/invitation/{invitation.pk}/acknowledge/",
            {"acknowledged": acknowledged},
        )

    def test_acknowledging_marks_the_row_without_deleting_it(self):
        invitation = self.make_failed_invitation()
        response = self.ack(invitation)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "acknowledged")
        invitation.refresh_from_db()
        self.assertIsNotNone(invitation.acknowledged_at)
        self.assertEqual(invitation.acknowledged_by, self.account.email)
        # The failure itself is still on the record.
        self.assertEqual(invitation.send_error, "[Errno 11001] getaddrinfo failed")

    def test_acknowledging_clears_it_from_the_dashboard_alert(self):
        invitation = self.make_failed_invitation()
        before = self.client.get("/login_api/admin/overview/", **XHR).json()
        self.ack(invitation)
        after = self.client.get("/login_api/admin/overview/", **XHR).json()

        self.assertEqual(
            after["invitations"]["failed"], before["invitations"]["failed"] - 1
        )

    def test_undo_puts_it_back(self):
        invitation = self.make_failed_invitation()
        self.ack(invitation)
        response = self.ack(invitation, acknowledged=False)

        self.assertEqual(response.json()["status"], "failed")
        invitation.refresh_from_db()
        self.assertIsNone(invitation.acknowledged_at)
        self.assertIsNone(invitation.acknowledged_by)

    def test_the_delivery_rate_still_counts_the_failure(self):
        """Otherwise one click would turn 90.9% delivery into 100%."""
        invitation = self.make_failed_invitation()
        before = self.client.get("/login_api/admin/email-log/", **XHR).json()["stats"]
        self.ack(invitation)
        after = self.client.get("/login_api/admin/email-log/", **XHR).json()["stats"]

        self.assertEqual(after["failed"], before["failed"])
        self.assertEqual(after["deliveryRate"], before["deliveryRate"])
        # What does change is how much still needs attention.
        self.assertEqual(after["outstanding"], before["outstanding"] - 1)
        self.assertEqual(after["acknowledged"], before["acknowledged"] + 1)

    def test_the_log_moves_it_between_the_two_filters(self):
        invitation = self.make_failed_invitation()
        self.ack(invitation)

        failed = self.client.get("/login_api/admin/email-log/?status=failed", **XHR).json()
        acked = self.client.get("/login_api/admin/email-log/?status=acknowledged", **XHR).json()
        row_id = f"invitation-{invitation.pk}"

        self.assertNotIn(row_id, [r["id"] for r in failed["results"]])
        self.assertIn(row_id, [r["id"] for r in acked["results"]])

    def test_a_delivered_email_cannot_be_acknowledged(self):
        """Recording a decision about a problem that never happened."""
        delivered = Invitation.objects.create(
            account_id=self.account.id,
            token_hash=uuid.uuid4().hex + uuid.uuid4().hex[:32],
            email=self.account.email,
            expires_at=timezone.now() + timezone.timedelta(days=7),
            sent_at=timezone.now(),
        )
        self.addCleanup(lambda: Invitation.objects.filter(pk=delivered.pk).delete())

        response = self.ack(delivered)
        self.assertEqual(response.status_code, 400)

    def test_it_is_recorded_against_whoever_did_it(self):
        invitation = self.make_failed_invitation()
        self.ack(invitation)
        self.assertTrue(
            LoginAudit.objects.filter(
                event="admin_email_ack", email=invitation.email
            ).exists()
        )

    def test_a_staff_session_cannot_acknowledge(self):
        """Suppressing a platform alert is an administrator's decision."""
        invitation = self.make_failed_invitation()
        self.client.post("/login_api/logout/", **XHR)

        staff_email = f"qa-staff-{uuid.uuid4().hex[:8]}@kbc.invalid"
        staff = StaffUser.objects.create(
            username="Plain Staff", email=staff_email, position="Admin",
            access="enrolment", type="Admin", status="FullUser",
        )
        staff_account, _ = identity.ensure_account("staff", staff.id, subject=staff)
        staff_account.password_hash = hash_password(self.password)
        staff_account.password_set_at = timezone.now()
        staff_account.save()
        self._accounts.append(staff_account)
        self.addCleanup(lambda: StaffUser.objects.filter(pk=staff.id).delete())
        self.addCleanup(lambda: LoginAudit.objects.filter(email=staff_email).delete())

        self.post("/login_api/login/", {"email": staff_email, "password": self.password})
        self.assertEqual(self.ack(invitation).status_code, 403)
