"""Scope, isolation and authorization tests for the Actual Hours endpoints.

Every case here is refused *before* any query runs, so the tests need no
database — which is also the point: an out-of-scope or unauthenticated request
must never reach the data in the first place.
"""

import json
import os
from unittest import mock

from django.test import SimpleTestCase
from django.test.client import RequestFactory
from django.urls import Resolver404, resolve

from .actual_hours import auth, service
from .actual_hours import views as actual_hours_views
from .actual_hours.service import ServiceError
from .db_source import clone_view


PREFIX = "/hours_test_api/last-audit/actual-hours"


def _as_clone(view):
    """Run a view exactly as the HOURS-TEST mount does."""
    return clone_view(view)


class MountIsolationTests(SimpleTestCase):
    def test_clone_mount_exposes_the_endpoints(self):
        for name in ("summary", "validate", "propose", "approve", "reject", "analytics"):
            match = resolve(f"{PREFIX}/{name}")
            self.assertEqual(match.url_name, f"hours-test-actual-hours-{name}")

    def test_live_mount_has_no_route_to_them(self):
        for name in ("summary", "validate", "propose", "approve", "reject", "analytics"):
            with self.assertRaises(Resolver404):
                resolve(f"/audit_api/last-audit/actual-hours/{name}")

    def test_views_refuse_to_run_outside_clone_context(self):
        request = RequestFactory().get(f"{PREFIX}/summary", {"aptem_id": "1", "month": "2026-01"})
        response = actual_hours_views.summary(request)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "not_clone")

    def test_write_views_refuse_outside_clone_context(self):
        factory = RequestFactory()
        for view, path in ((actual_hours_views.validate, "validate"),
                           (actual_hours_views.propose, "propose"),
                           (actual_hours_views.approve, "approve"),
                           (actual_hours_views.reject, "reject")):
            request = factory.post(f"{PREFIX}/{path}", data="{}", content_type="application/json")
            self.assertEqual(view(request).status_code, 409, path)


class JournalHoursEndpointTests(SimpleTestCase):
    """The Activity-log endpoints: clone-only, scoped, and named."""

    def setUp(self):
        self.factory = RequestFactory()

    def test_both_workspaces_expose_them(self):
        # The Activity-log calculation runs in Automatic and in HOURS-TEST. The
        # mount decides the database; nothing in the request does.
        for name in ("summary", "calculate", "approve", "reject"):
            self.assertEqual(resolve(f"/hours_test_api/last-audit/journal-hours/{name}").url_name,
                             f"hours-test-journal-hours-{name}")
            self.assertEqual(resolve(f"/audit_api/last-audit/journal-hours/{name}").url_name,
                             f"journal-hours-{name}")

    def test_the_last_audit_review_stays_clone_only(self):
        for name in ("summary", "validate", "propose", "approve", "reject", "analytics"):
            with self.assertRaises(Resolver404):
                resolve(f"/audit_api/last-audit/actual-hours/{name}")

    def test_the_guard_lets_them_run_off_the_clone(self):
        # Reaching the live branch is the point of the Automatic mount, so the
        # journal views pass clone_only=False while the review views do not.
        # (Checked on the guard itself: going further would need a database.)
        request = self.factory.post("/x", data="{}", content_type="application/json")
        self.assertIsNone(actual_hours_views._guard(request, write=True, clone_only=False))
        blocked = actual_hours_views._guard(request, write=True)
        self.assertEqual(blocked.status_code, 409)
        self.assertEqual(json.loads(blocked.content)["code"], "not_clone")

    def test_the_journal_views_ask_for_the_non_clone_guard(self):
        import inspect
        for view in (actual_hours_views.journal_summary, actual_hours_views.journal_calculate,
                     actual_hours_views._journal_decide):
            self.assertIn("clone_only=False", inspect.getsource(view), view.__name__)

    def test_scope_is_required(self):
        for payload in ({"month": "2025-08"}, {"aptem_id": 92}, {"aptem_id": 92, "month": "2025-8"}):
            request = self.factory.post("/x", data=json.dumps(payload),
                                        content_type="application/json",
                                        HTTP_X_AUDIT_ACTOR="Auditor A")
            self.assertEqual(_as_clone(actual_hours_views.journal_calculate)(request).status_code, 400)

    def test_an_invalid_offset_is_refused(self):
        request = self.factory.post("/x", data=json.dumps(
            {"aptem_id": 92, "month": "2025-08", "offset_minutes": 7}),
            content_type="application/json", HTTP_X_AUDIT_ACTOR="Auditor A")
        response = _as_clone(actual_hours_views.journal_calculate)(request)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)["code"], "invalid_offset")

    def test_an_invalid_offset_mode_is_refused(self):
        request = self.factory.post("/x", data=json.dumps(
            {"aptem_id": 92, "month": "2025-08", "offset_mode": "random"}),
            content_type="application/json", HTTP_X_AUDIT_ACTOR="Auditor A")
        response = _as_clone(actual_hours_views.journal_calculate)(request)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)["code"], "invalid_offset_mode")

    def test_no_identity_is_needed_and_the_run_is_stamped_as_the_workspace(self):
        # The Activity-log page carries no auditor box, so a run with no header
        # must be accepted and attributed to the workspace itself.
        request = self.factory.post("/x", data=json.dumps({"aptem_id": 92, "month": "2025-08"}),
                                    content_type="application/json")
        actor = auth.resolve_journal_actor(request)
        self.assertEqual(actor.key, auth.WORKSPACE_ACTOR_KEY)
        self.assertEqual(actor.source, auth.WORKSPACE_ACTOR_SOURCE)
        self.assertTrue(actor.may_decide)
        self.assertFalse(actor.enforces_two_person)

    def test_a_supplied_name_still_outranks_the_workspace_actor(self):
        request = self.factory.post("/x", data="{}", content_type="application/json",
                                    HTTP_X_AUDIT_ACTOR="Auditor A")
        actor = auth.resolve_journal_actor(request)
        self.assertEqual(actor.key, "named:auditor a")
        self.assertTrue(actor.enforces_two_person)

    def test_an_account_outranks_both(self):
        user = FakeUser(pk=3, username="alice", permissions={auth.APPROVE_PERMISSION})
        request = self.factory.post("/x", data="{}", content_type="application/json",
                                    HTTP_X_AUDIT_ACTOR="Someone Else")
        request.user = user
        actor = auth.resolve_journal_actor(request, approving=True)
        self.assertEqual(actor.key, "user:3")
        self.assertTrue(actor.enforces_two_person)


class ScopeTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _post(self, view, payload, actor="Auditor A"):
        request = self.factory.post(f"{PREFIX}/validate", data=json.dumps(payload),
                                    content_type="application/json",
                                    HTTP_X_AUDIT_ACTOR=actor)
        return _as_clone(view)(request)

    def test_missing_month_does_no_work(self):
        response = self._post(actual_hours_views.validate, {"aptem_id": 16456})
        self.assertEqual(response.status_code, 400)
        self.assertIn("month", json.loads(response.content)["error"])

    def test_missing_learner_does_no_work(self):
        response = self._post(actual_hours_views.validate, {"month": "2026-01"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("aptem_id", json.loads(response.content)["error"])

    def test_invalid_month_format_is_rejected(self):
        for month in ("2026-1", "2026-13", "202601", "2026-00", "all"):
            response = self._post(actual_hours_views.validate, {"aptem_id": 1, "month": month})
            self.assertEqual(response.status_code, 400, month)

    def test_non_numeric_learner_is_rejected(self):
        for aptem in ("all", "-1", "0", "1 or 1=1"):
            response = self._post(actual_hours_views.validate, {"aptem_id": aptem, "month": "2026-01"})
            self.assertEqual(response.status_code, 400, aptem)

    def test_summary_requires_both_scope_values(self):
        request = self.factory.get(f"{PREFIX}/summary", {"aptem_id": "16456"})
        response = _as_clone(actual_hours_views.summary)(request)
        self.assertEqual(response.status_code, 400)


class FakeUser:
    """A duck-typed Django user, so identity rules are testable without a
    database (the default alias points at a live Neon branch)."""

    def __init__(self, pk=1, username="auditor-a", permissions=(), authenticated=True):
        self.pk = pk
        self._username = username
        self._permissions = set(permissions)
        self.is_authenticated = authenticated
        self.is_staff = False
        self.is_superuser = False

    def get_username(self):
        return self._username

    def has_perm(self, permission):
        return permission in self._permissions


class ActorTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _validate(self, **extra):
        request = self.factory.post(f"{PREFIX}/validate",
                                    data=json.dumps({"aptem_id": 1, "month": "2026-01"}),
                                    content_type="application/json", **extra)
        return request

    def test_write_without_a_named_auditor_is_refused(self):
        response = _as_clone(actual_hours_views.validate)(self._validate())
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "actor_required")

    def test_malformed_auditor_name_is_refused(self):
        response = _as_clone(actual_hours_views.validate)(
            self._validate(HTTP_X_AUDIT_ACTOR="<script>alert(1)</script>"))
        self.assertEqual(response.status_code, 400)

    def test_django_mode_ignores_the_header(self):
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "django"}):
            response = _as_clone(actual_hours_views.validate)(self._validate(HTTP_X_AUDIT_ACTOR="Auditor A"))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "authentication_required")

    def test_actor_in_the_body_is_ignored(self):
        request = self.factory.post(f"{PREFIX}/validate",
                                    data=json.dumps({"aptem_id": 1, "month": "2026-01",
                                                     "updated_by": "Auditor A", "actor": "Auditor A"}),
                                    content_type="application/json")
        self.assertEqual(_as_clone(actual_hours_views.validate)(request).status_code, 403)

    def test_authenticated_account_without_the_permission_is_refused_in_django_mode(self):
        request = self._validate()
        request.user = FakeUser(permissions=())
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "django"}):
            response = _as_clone(actual_hours_views.validate)(request)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "missing_permission")

    def test_get_endpoints_reject_posts_and_vice_versa(self):
        request = self.factory.get(f"{PREFIX}/validate")
        self.assertEqual(_as_clone(actual_hours_views.validate)(request).status_code, 405)
        request = self.factory.post(f"{PREFIX}/summary")
        self.assertEqual(_as_clone(actual_hours_views.summary)(request).status_code, 405)


class ContextResetTests(SimpleTestCase):
    def test_clone_context_does_not_leak_after_the_response(self):
        from .db_source import is_clone, resolve
        request = RequestFactory().get(f"{PREFIX}/summary")
        _as_clone(actual_hours_views.summary)(request)
        self.assertFalse(is_clone())
        self.assertNotEqual(resolve("audit"), "audit_clone")


class AuditorIdentityTests(SimpleTestCase):
    """resolve_auditor in isolation — the production identity rules."""

    def setUp(self):
        self.factory = RequestFactory()

    def _request(self, user=None, **extra):
        request = self.factory.post(f"{PREFIX}/propose", **extra)
        if user is not None:
            request.user = user
        return request

    def test_authenticated_proposer_identity_is_the_account(self):
        user = FakeUser(pk=17, username="alice", permissions={auth.PROPOSE_PERMISSION})
        actor = auth.resolve_auditor(self._request(user))
        self.assertEqual(actor.key, "user:17")
        self.assertEqual(actor.label, "alice")
        self.assertEqual(actor.source, "django")
        self.assertTrue(actor.is_authenticated_identity)

    def test_propose_permission_does_not_grant_approval(self):
        user = FakeUser(permissions={auth.PROPOSE_PERMISSION})
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "django"}):
            with self.assertRaises(ServiceError) as caught:
                auth.resolve_auditor(self._request(user), approving=True)
        self.assertEqual(caught.exception.code, "missing_permission")

    def test_named_mode_ignores_an_account_lacking_the_permission(self):
        # It falls through to the named identity rather than 403-ing, because
        # there is no login in front of this workspace in named mode.
        user = FakeUser(permissions={auth.PROPOSE_PERMISSION})
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "named"}):
            actor = auth.resolve_auditor(self._request(user, HTTP_X_AUDIT_ACTOR="Auditor B"),
                                         approving=True)
        self.assertEqual(actor.key, "named:auditor b")

    def test_approver_needs_the_approve_permission(self):
        user = FakeUser(pk=8, permissions={auth.APPROVE_PERMISSION})
        actor = auth.resolve_auditor(self._request(user), approving=True)
        self.assertEqual(actor.key, "user:8")

    def test_named_identity_is_used_when_there_is_no_login(self):
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "named"}):
            actor = auth.resolve_auditor(self._request(HTTP_X_AUDIT_ACTOR="Auditor A"))
        self.assertEqual(actor.key, "named:auditor a")
        self.assertEqual(actor.label, "Auditor A")
        self.assertEqual(actor.source, "named-header")
        self.assertFalse(actor.is_authenticated_identity)

    def test_named_identity_may_decide_only_in_named_mode(self):
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "named"}):
            actor = auth.resolve_auditor(self._request(HTTP_X_AUDIT_ACTOR="Auditor B"), approving=True)
            self.assertTrue(actor.may_decide)
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "django"}):
            self.assertFalse(actor.may_decide)

    def test_named_mode_still_requires_a_name_to_decide(self):
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "named"}):
            with self.assertRaises(ServiceError) as caught:
                auth.resolve_auditor(self._request(), approving=True)
        self.assertEqual(caught.exception.code, "actor_required")

    def test_an_account_with_the_permission_beats_the_header(self):
        user = FakeUser(pk=5, username="alice", permissions={auth.APPROVE_PERMISSION})
        with mock.patch.dict(os.environ, {auth.IDENTITY_MODE_ENV: "named"}):
            actor = auth.resolve_auditor(self._request(user, HTTP_X_AUDIT_ACTOR="Someone Else"),
                                         approving=True)
        self.assertEqual(actor.key, "user:5")
        self.assertEqual(actor.source, "django")

    def test_mode_defaults_to_django_when_auth_is_required(self):
        with mock.patch.dict(os.environ, {"AUDIT_API_REQUIRE_AUTH": "1"}):
            os.environ.pop(auth.IDENTITY_MODE_ENV, None)
            self.assertEqual(auth.identity_mode(), auth.MODE_DJANGO)

    def test_service_checks_the_identity_may_decide(self):
        # Defence in depth inside the service, independent of the view layer.
        import inspect
        source = inspect.getsource(service._decide)
        self.assertIn("may_decide", source)


class TimestampSemanticsTests(SimpleTestCase):
    def test_timestamp_derived_values_are_proposals_never_direct_writes(self):
        # The flag is on (product decision, 2026-08-15). What it must NOT do is
        # let a timestamp-derived value reach actual_hours without approval.
        import inspect
        source = inspect.getsource(service.run_scan)
        self.assertIn("_insert_revision(", source)
        self.assertNotIn("set actual_hours", source)
        self.assertIn("update {BASE_TABLE} set actual_hours", inspect.getsource(service._decide))
