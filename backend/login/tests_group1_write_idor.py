"""Group 1 write-path IDOR tests — SECURITY_AUDIT.md findings A1, A2, A3, A7.

These are written BEFORE the fix and are expected to FAIL against the current
code (the four endpoints have no ownership guard). After the Group 1 fix they
must pass. Run with the custom runner that provisions the unmanaged Neon tables:

    python manage.py test login.tests_group1_write_idor \
        --testrunner=login.test_runner.EnrolmentTestRunner

(Neon keeps pooled sessions briefly, so a from-scratch run is: drop the test
databases, then run once with ``--keepdb`` — see A17.)

Coverage per finding:
- A1  reviews sign/complete  — real-DB-row (assert the review row is unchanged),
      including the party-must-match-caller rules and employer linkage.
- A2  learning-plan PATCH    — real-DB-row (assert learning_plan unchanged). The
      curriculum catalogue the view validates against does not exist in the test
      build, so ``_all_modules`` is mocked to a fixed catalogue — that is the one
      table that "fought" us; the ownership behaviour under test is unaffected.
- A3  calendar connect/disc  — real-DB-row for disconnect (assert the row still
      exists) and connect (assert no row written). ``oauth_start`` is a GET and
      is deliberately NOT covered here (see the note in the A3 class).
- A7  absence-reports POST   — decision-level with a spy (the standard
      ``learner_self_only`` decorator), per the agreed plan.

Every test pins ``LEARNER_API_REQUIRE_AUTH=1`` so a stray environment value
cannot silently disable the gate and make the result meaningless.
"""
from __future__ import annotations

import json
import os
import uuid
from unittest import mock

from django.core import signing
from django.core.cache import cache
from django.http import JsonResponse
from django.test import Client, RequestFactory, SimpleTestCase
from django.utils import timezone

from learner_api.models import Employer, EnrolmentReview, EnrolmentUser

from . import identity, permissions
from .security import hash_password
from .tests import LoginTestBase

XHR = {"HTTP_X_REQUESTED_WITH": "XMLHttpRequest"}
SIGNATURE = "data:image/png;base64,AAAABBBBCCCC"


class Group1Base(LoginTestBase):
    """Real accounts, real sessions, real Neon rows — with explicit cleanup."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        from django.core.management import call_command

        # Provision only the tables these findings touch, locally to this suite
        # (not in the shared runner SETUP_COMMANDS). Idempotent (CREATE ... IF
        # NOT EXISTS), so re-running against a kept database is safe.
        for command in (
            "apply_enrolment_reviews_table",   # A1: enrolment."Enrolment_reviews"
            "apply_review_detail_tables",       # A1: review detail tables (delete cascade)
            "apply_employer_signing",           # A1: Employers/reviews signature columns
            "apply_learning_plan_jsonb",       # A2: Created_users."Learning_plan"
            "create_calendar_connections_table",  # A3: Learner."calendar_connections"
        ):
            call_command(command, verbosity=0)

    def setUp(self):
        super().setUp()
        # Pin the gate ON regardless of the ambient environment (addition #2).
        patcher = mock.patch.dict(
            os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"}, clear=False
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    # ── account / session helpers ────────────────────────────────────────

    def _new_learner(self, label):
        email = f"qa-{label}-{uuid.uuid4().hex[:8]}@kbc.invalid"
        learner = EnrolmentUser.objects.create(
            username=label, email=email, learner_type="apprenticeship",
        )
        self.addCleanup(
            lambda pk=learner.pk: EnrolmentUser.all_learners.filter(pk=pk).delete()
        )
        account, _ = identity.ensure_account("learner", learner.id, subject=learner)
        account.password_hash = hash_password(self.password)
        account.password_set_at = timezone.now()
        account.save()
        self._accounts.append(account)
        return learner, email

    def _new_employer(self, label):
        email = f"qa-emp-{label}-{uuid.uuid4().hex[:8]}@kbc.invalid"
        employer = Employer.objects.create(first_name=label, surname="Emp", email=email)
        self.addCleanup(lambda pk=employer.pk: Employer.objects.filter(pk=pk).delete())
        account, _ = identity.ensure_account("employer", employer.id, subject=employer)
        account.password_hash = hash_password(self.password)
        account.password_set_at = timezone.now()
        account.save()
        self._accounts.append(account)
        return employer, email

    def _login(self, email):
        client = Client(SERVER_NAME="localhost")
        resp = client.post(
            "/login_api/login/",
            data=json.dumps({"email": email, "password": self.password}),
            content_type="application/json",
            **XHR,
        )
        self.assertIn(
            "kbc_session", client.cookies,
            f"login for {email} failed: {resp.status_code} {resp.content[:200]!r}",
        )
        return client

    def _django_only_client(self):
        """A Django-auth session with NO kbc_session — i.e. login_account = None.

        Simulates the chat-bootstrap vector (addition #5): request.user is
        authenticated but authenticate_request returns None.
        """
        from django.contrib.auth.models import User

        user = User.objects.create(username=f"dj-{uuid.uuid4().hex[:8]}")
        self.addCleanup(user.delete)
        client = Client(SERVER_NAME="localhost")
        client.force_login(user)
        return client


class SubjectIdInvariantTests(Group1Base):
    """Addition #4: every guard here assumes subject_id == EnrolmentUser pk."""

    def test_learner_account_subject_id_equals_enrolment_user_pk(self):
        learner, _ = self._new_learner("invariant")
        account = self._accounts[-1]
        self.assertEqual(account.role, "learner")
        self.assertEqual(
            account.subject_id, learner.pk,
            "learner_self_only/​learner_self_or_staff compare subject_id to the "
            "URL learner id; if these ever differ the guards fail open.",
        )


class A1ReviewSignTests(Group1Base):
    """A1 — a review may be completed/signed only by its owner or authorised staff,
    and the sign `party` must match the caller's real identity."""

    def setUp(self):
        super().setUp()
        self.victim, self.victim_email = self._new_learner("a1-victim")
        self.attacker, self.attacker_email = self._new_learner("a1-attacker")
        self.event_key = f"evt-{uuid.uuid4().hex[:10]}"
        self.review = EnrolmentReview.objects.create(
            event_key=self.event_key,
            review_type="progress",
            review_label="Progress review",
            learner_kind="apprenticeship",
            learner_id=self.victim.pk,
            form_completed=True,
            status=EnrolmentReview.STATUS_COMPLETED,
        )
        self.addCleanup(
            lambda: EnrolmentReview.objects.filter(pk=self.review.pk).delete()
        )
        self.sign_url = (
            f"/learner_api/reviews/apprenticeship/{self.victim.pk}/{self.event_key}/sign/"
        )

    def _sign(self, client, party, name="Someone"):
        return client.post(
            self.sign_url,
            data=json.dumps({"party": party, "signature": SIGNATURE, "name": name}),
            content_type="application/json",
        )

    # ---- exploit: attacker learner (real-DB-row, non-negotiable) ----

    def test_attacker_learner_cannot_sign_victims_review(self):
        resp = self._sign(self._login(self.attacker_email), "learner", "Mallory")
        self.assertEqual(resp.status_code, 404)
        self.review.refresh_from_db()
        self.assertEqual(self.review.learner_signature, "")
        self.assertIsNone(self.review.learner_signed_at)

    def test_none_account_cannot_sign_victims_review(self):
        resp = self._sign(self._django_only_client(), "learner", "Anon")
        self.assertEqual(resp.status_code, 401)
        self.review.refresh_from_db()
        self.assertEqual(self.review.learner_signature, "")
        self.assertIsNone(self.review.learner_signed_at)

    # ---- party must match the caller's identity ----

    def test_owner_cannot_sign_as_admin_party(self):
        resp = self._sign(self._login(self.victim_email), "admin", "Vera")
        self.assertEqual(resp.status_code, 403)
        self.review.refresh_from_db()
        self.assertEqual(self.review.admin_signature, "")

    def test_staff_cannot_sign_as_learner_party(self):
        self.make_account(position="Enrolment")
        resp = self._sign(self._login(self.email), "learner", "Sam")
        self.assertEqual(resp.status_code, 403)
        self.review.refresh_from_db()
        self.assertEqual(self.review.learner_signature, "")

    def test_unlinked_employer_cannot_sign(self):
        # employer not linked to this learner -> existence-hiding 404
        _, emp_email = self._new_employer("a1-unlinked")
        resp = self._sign(self._login(emp_email), "employer", "Elsewhere Ltd")
        self.assertEqual(resp.status_code, 404)
        self.review.refresh_from_db()
        self.assertEqual(self.review.employer_signature, "")

    # ---- legitimate paths still work (promotion side effect mocked out) ----

    @mock.patch("learner_api.learning_plan.promote_to_delivery_if_ready", return_value=None)
    def test_owner_learner_can_sign_as_learner(self, _promote):
        resp = self._sign(self._login(self.victim_email), "learner", "Vera")
        self.assertEqual(resp.status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.learner_signature, SIGNATURE)
        self.assertEqual(self.review.learner_signed_name, "Vera")

    @mock.patch("learner_api.learning_plan.promote_to_delivery_if_ready", return_value=None)
    def test_staff_can_sign_as_admin(self, _promote):
        self.make_account(position="Enrolment")
        resp = self._sign(self._login(self.email), "admin", "Sam")
        self.assertEqual(resp.status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.admin_signature, SIGNATURE)

    @mock.patch("learner_api.learning_plan.promote_to_delivery_if_ready", return_value=None)
    def test_linked_employer_can_sign_as_employer(self, _promote):
        employer, emp_email = self._new_employer("a1-linked")
        self.victim.employer_id = employer.pk
        self.victim.save(update_fields=["employer_id"])
        resp = self._sign(self._login(emp_email), "employer", "Acme Ltd")
        self.assertEqual(resp.status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.employer_signature, SIGNATURE)


class A2LearningPlanTests(Group1Base):
    """A2 — a learner's training plan may be rewritten only by its owner or staff.

    The view validates posted modules against the whole curriculum catalogue
    (``_all_modules``), whose tables are not provisioned in the test build, so it
    is mocked to a fixed catalogue. That is the only table that fell back to a
    mock; the ownership behaviour and the learning_plan row assertions are real.
    """

    # Full module-payload shape (see learning_plan._module_payload), so the
    # view's response serialization succeeds after a write.
    CATALOGUE = [{
        "moduleId": "M1", "moduleTitle": "Module One", "groupName": "G",
        "programmeId": "P1", "programmeName": "Programme One", "hours": 10,
        "startDate": None, "endDate": None,
    }]
    KEPT_PLAN = [{
        "moduleId": "KEEP-ME", "moduleTitle": "Kept", "groupName": "",
        "programmeId": "P0", "programmeName": "Kept Programme", "hours": 0,
        "startDate": None, "endDate": None,
    }]

    def setUp(self):
        super().setUp()
        self.victim, self.victim_email = self._new_learner("a2-victim")
        self.attacker, self.attacker_email = self._new_learner("a2-attacker")
        self.victim.learning_plan = self.KEPT_PLAN
        self.victim.save(update_fields=["learning_plan"])
        self.url = f"/learner_api/learning-plan/{self.victim.pk}/"

    def _patch(self, client, modules):
        with mock.patch("learner_api.learning_plan._all_modules", return_value=self.CATALOGUE):
            return client.patch(
                self.url, data=json.dumps({"modules": modules}),
                content_type="application/json",
            )

    def test_attacker_cannot_overwrite_victims_plan(self):
        resp = self._patch(self._login(self.attacker_email), ["M1"])
        self.assertEqual(resp.status_code, 404)
        self.victim.refresh_from_db()
        self.assertEqual(self.victim.learning_plan, self.KEPT_PLAN)

    def test_none_account_cannot_overwrite_victims_plan(self):
        resp = self._patch(self._django_only_client(), ["M1"])
        self.assertEqual(resp.status_code, 401)
        self.victim.refresh_from_db()
        self.assertEqual(self.victim.learning_plan, self.KEPT_PLAN)

    def test_owner_can_edit_own_plan(self):
        resp = self._patch(self._login(self.victim_email), ["M1"])
        self.assertEqual(resp.status_code, 200)
        self.victim.refresh_from_db()
        self.assertEqual([m["moduleId"] for m in self.victim.learning_plan], ["M1"])

    def test_staff_can_edit_a_learners_plan(self):
        self.make_account(position="Enrolment")
        resp = self._patch(self._login(self.email), ["M1"])
        self.assertEqual(resp.status_code, 200)
        self.victim.refresh_from_db()
        self.assertEqual([m["moduleId"] for m in self.victim.learning_plan], ["M1"])


class A3CalendarConnectionsTests(Group1Base):
    """A3 — calendar credentials are learner-self-only; staff must NOT touch them.

    Covers ``credential_connect`` (POST) and ``disconnect`` (POST). ``oauth_start``
    is intentionally excluded: it is a GET, and ``learner_self_only`` lets GETs
    through (reads stay open). ``oauth_start`` is a GET, so it is gated by an
    inline ownership check rather than the decorator; ``oauth_callback`` binds
    the flow to a single-use server-side nonce and, opportunistically, to the
    session where present. All four are covered here.
    """

    def setUp(self):
        super().setUp()
        # A per-process cache is fine here: single-use is enforced by an actual
        # cache.delete in-process, so consuming a nonce genuinely removes it.
        # Clearing between tests stops one test's nonce leaking into another.
        cache.clear()
        self.addCleanup(cache.clear)
        self.victim, self.victim_email = self._new_learner("a3-victim")
        self.attacker, self.attacker_email = self._new_learner("a3-attacker")
        self._insert_connection(self.victim.pk, "ics")
        self.disconnect_url = (
            f"/learner_api/calendar-connections/apprenticeship/{self.victim.pk}/ics/disconnect/"
        )
        self.connect_url = (
            f"/learner_api/calendar-connections/apprenticeship/{self.victim.pk}/ics/connect/"
        )
        self.oauth_start_url = (
            f"/learner_api/calendar-connections/apprenticeship/{self.victim.pk}/google/oauth/"
        )
        self.callback_url = "/api/calendar/google/callback"

    def _signed_state(self, learner_id, nonce, provider="google"):
        """A server-signed OAuth state, as oauth_start would mint (for replay tests)."""
        from learner_api.calendar_connections import STATE_SALT

        return signing.dumps(
            {"kind": "apprenticeship", "learnerId": learner_id, "provider": provider, "nonce": nonce},
            salt=STATE_SALT, compress=True,
        )

    def _insert_connection(self, learner_id, provider):
        from django.db import connections

        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'INSERT INTO "Learner"."calendar_connections" '
                "(learner_kind, learner_id, provider, credential_ciphertext) "
                "VALUES (%s, %s, %s, %s)",
                ["apprenticeship", learner_id, provider, "dummy-ciphertext"],
            )
        self.addCleanup(lambda: self._delete_connections(learner_id))

    def _delete_connections(self, learner_id):
        from django.db import connections

        with connections["enrolment"].cursor() as cur:
            cur.execute(
                'DELETE FROM "Learner"."calendar_connections" WHERE learner_id = %s',
                [learner_id],
            )

    def _count_connections(self, learner_id, provider=None):
        from django.db import connections

        sql = 'SELECT count(*) FROM "Learner"."calendar_connections" WHERE learner_id = %s'
        params = [learner_id]
        if provider is not None:
            sql += " AND provider = %s"
            params.append(provider)
        with connections["enrolment"].cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()[0]

    # ---- disconnect: real-DB-row tamper demonstration ----

    def test_attacker_cannot_disconnect_victims_calendar(self):
        resp = self._login(self.attacker_email).post(self.disconnect_url)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(self._count_connections(self.victim.pk), 1)

    def test_none_account_cannot_disconnect_victims_calendar(self):
        resp = self._django_only_client().post(self.disconnect_url)
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(self._count_connections(self.victim.pk), 1)

    def test_staff_cannot_disconnect_a_learners_calendar(self):
        self.make_account(position="Enrolment")
        resp = self._login(self.email).post(self.disconnect_url)
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self._count_connections(self.victim.pk), 1)

    def test_owner_can_disconnect_own_calendar(self):
        resp = self._login(self.victim_email).post(self.disconnect_url)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(self._count_connections(self.victim.pk), 0)

    # ---- connect: rejected before any credential write (no network reached) ----

    def test_attacker_cannot_connect_to_victims_calendar(self):
        before = self._count_connections(self.victim.pk)
        resp = self._login(self.attacker_email).post(
            self.connect_url, data=json.dumps({}), content_type="application/json",
        )
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(self._count_connections(self.victim.pk), before)

    def test_staff_cannot_connect_a_learners_calendar(self):
        self.make_account(position="Enrolment")
        before = self._count_connections(self.victim.pk)
        resp = self._login(self.email).post(
            self.connect_url, data=json.dumps({}), content_type="application/json",
        )
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(self._count_connections(self.victim.pk), before)

    def test_none_account_cannot_connect_to_victims_calendar(self):
        before = self._count_connections(self.victim.pk)
        resp = self._django_only_client().post(
            self.connect_url, data=json.dumps({}), content_type="application/json",
        )
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(self._count_connections(self.victim.pk), before)

    def test_owner_can_connect_own_calendar(self):
        # ICS connect fetches the calendar over the network; mock that so the
        # owner's request reaches _save and a row is actually written.
        ics_body = "BEGIN:VCALENDAR\nEND:VCALENDAR"
        fake = mock.Mock(status_code=200, content=ics_body.encode(), text=ics_body)
        fake.raise_for_status = mock.Mock()
        before = self._count_connections(self.victim.pk, "ics")
        with mock.patch("learner_api.calendar_connections.httpx.get", return_value=fake), \
                mock.patch.dict(os.environ, {"CREDENTIAL_ENCRYPTION_KEY": "test-key"}, clear=False):
            resp = self._login(self.victim_email).post(
                self.connect_url,
                data=json.dumps({"url": "https://cal.example.com/feed.ics"}),
                content_type="application/json",
            )
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(self._count_connections(self.victim.pk, "ics"), before)  # upsert, same row

    # ---- oauth_start: GET gated by the inline ownership check ----

    def test_attacker_cannot_oauth_start_for_victim(self):
        # Directly prove the ownership check runs BEFORE the nonce is minted:
        # pin the (real) nonce generator to a known value, and assert no
        # calendar-oauth-nonce: key exists after the rejected request. If a
        # rejected caller could still write, this would be an unauthenticated
        # cache-fill primitive with a 600s TTL.
        from learner_api.calendar_connections import _OAUTH_NONCE_PREFIX

        known = "known-test-nonce-value"
        with mock.patch(
            "learner_api.calendar_connections.secrets.token_urlsafe", return_value=known
        ):
            resp = self._login(self.attacker_email).get(self.oauth_start_url)
        self.assertEqual(resp.status_code, 404)
        self.assertIsNone(cache.get(_OAUTH_NONCE_PREFIX + known))   # no cache write on rejection

    def test_staff_cannot_oauth_start(self):
        self.make_account(position="Enrolment")
        with mock.patch("learner_api.calendar_connections._issue_oauth_nonce") as mint:
            resp = self._login(self.email).get(self.oauth_start_url)
        self.assertEqual(resp.status_code, 403)
        mint.assert_not_called()

    def test_none_account_cannot_oauth_start(self):
        with mock.patch("learner_api.calendar_connections._issue_oauth_nonce") as mint:
            resp = self._django_only_client().get(self.oauth_start_url)
        self.assertEqual(resp.status_code, 401)
        mint.assert_not_called()

    def test_owner_can_oauth_start(self):
        with mock.patch.dict(
            os.environ,
            {"GOOGLE_CLIENT_ID": "cid", "GOOGLE_CALLBACK_URI": "https://app.example.com/cb"},
            clear=False,
        ):
            resp = self._login(self.victim_email).get(self.oauth_start_url)
        self.assertEqual(resp.status_code, 200)
        self.assertIn("authorizationUrl", resp.json())

    # ---- oauth_callback: single-use nonce + opportunistic session binding ----

    def _callback(self, client, state, code="auth-code"):
        return client.get(self.callback_url, {"state": state, "code": code})

    def test_callback_rejects_replayed_state_for_victim(self):
        """A state whose nonce has already been consumed cannot attach anything."""
        from learner_api.calendar_connections import _consume_oauth_nonce, _issue_oauth_nonce

        nonce = _issue_oauth_nonce("apprenticeship", self.victim.pk, "google")
        state = self._signed_state(self.victim.pk, nonce)
        # Simulate the victim's own flow having already completed: nonce consumed.
        self.assertIsNotNone(_consume_oauth_nonce(nonce))

        with mock.patch("learner_api.calendar_connections._save") as saver:
            resp = self._callback(Client(SERVER_NAME="localhost"), state)
        self.assertEqual(resp.status_code, 302)
        self.assertIn("calendar_error", resp["Location"])
        saver.assert_not_called()
        self.assertEqual(self._count_connections(self.victim.pk, "google"), 0)

    def test_callback_rejects_mismatched_session(self):
        """Session present and not this learner -> rejected (closes the replay race)."""
        from learner_api.calendar_connections import _issue_oauth_nonce

        nonce = _issue_oauth_nonce("apprenticeship", self.victim.pk, "google")
        state = self._signed_state(self.victim.pk, nonce)
        attacker_client = self._login(self.attacker_email)   # real session, wrong learner

        with mock.patch("learner_api.calendar_connections._save") as saver:
            resp = self._callback(attacker_client, state)
        self.assertEqual(resp.status_code, 302)
        self.assertIn("calendar_error", resp["Location"])
        saver.assert_not_called()
        self.assertEqual(self._count_connections(self.victim.pk, "google"), 0)

    def test_callback_absent_session_proceeds_via_nonce(self):
        """No session on the callback host -> the nonce alone carries the flow."""
        from learner_api.calendar_connections import _issue_oauth_nonce

        nonce = _issue_oauth_nonce("apprenticeship", self.victim.pk, "google")
        state = self._signed_state(self.victim.pk, nonce)
        token_resp = mock.Mock(status_code=200)
        token_resp.raise_for_status = mock.Mock()
        token_resp.json = mock.Mock(return_value={"access_token": "tok"})

        with mock.patch("learner_api.calendar_connections.httpx.post", return_value=token_resp), \
                mock.patch("learner_api.calendar_connections._oauth_identity", return_value="cal@x.y"), \
                mock.patch("learner_api.calendar_connections._save") as saver:
            resp = self._callback(Client(SERVER_NAME="localhost"), state)

        self.assertEqual(resp.status_code, 302)
        self.assertIn("calendar_connected", resp["Location"])
        saver.assert_called_once()
        # authoritative learner id comes from the nonce record, not the state
        self.assertEqual(saver.call_args.args[1], self.victim.pk)


# ── A7: decision-level with a spy (no database) ──────────────────────────


class _Account:
    """Minimal stand-in for a resolved login account (see tests_learner_progress_gate)."""

    def __init__(self, role, subject_id, subject_type="learner"):
        self.role = role
        self.subject_id = subject_id
        self.subject_type = subject_type


class A7AbsenceReportsGuardTests(SimpleTestCase):
    """A7 — filing an absence report is learner-self-only (staff use coach_api).

    Decision-level: the real view is exercised for the rejection paths (the guard
    returns before the body, so no database is touched), and the owner-allowed
    path is proven with a spy wrapped in the same decorator.
    """

    def setUp(self):
        self.factory = RequestFactory()
        self.url = "/learner_api/absence-reports/apprenticeship/500/"
        # Pin the gate ON so the ambient environment cannot make these vacuous.
        patcher = mock.patch.dict(
            os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"}, clear=False
        )
        patcher.start()
        self.addCleanup(patcher.stop)

    def _call_real_view(self, account):
        """Call the real endpoint with an empty POST body.

        ``_source_learner`` is mocked so no database is touched: with the guard
        absent (pre-fix) the body runs and returns 400 (missing required fields),
        proving the request reached the view; with the guard present (post-fix)
        it returns 404/403/401 *before* the body, which is what each test asserts.
        The status therefore distinguishes guarded from unguarded cleanly.
        """
        from learner_api import absence_reports

        request = self.factory.post(self.url)
        with mock.patch.object(permissions, "authenticate_request", return_value=account), \
                mock.patch.object(
                    absence_reports, "_source_learner",
                    return_value=mock.Mock(email="x@y.z", username="X"),
                ):
            return absence_reports.learner_absence_reports(
                request, kind="apprenticeship", learner_id=500
            )

    def test_real_view_rejects_another_learner(self):
        resp = self._call_real_view(_Account("learner", 999))
        self.assertEqual(resp.status_code, 404)

    def test_real_view_rejects_none_account(self):
        resp = self._call_real_view(None)
        self.assertEqual(resp.status_code, 401)

    def test_real_view_rejects_staff(self):
        resp = self._call_real_view(_Account("staff", 3, subject_type="staff"))
        self.assertEqual(resp.status_code, 403)

    def test_guard_allows_the_owning_learner(self):
        calls = []

        def spy(request, *args, **kwargs):
            calls.append(True)
            return JsonResponse({"ok": True})

        gated = permissions.learner_self_only(kwarg="learner_id")(spy)
        request = self.factory.post(self.url)
        with mock.patch.object(
            permissions, "authenticate_request", return_value=_Account("learner", 500)
        ):
            resp = gated(request, kind="apprenticeship", learner_id=500)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(calls, [True])
