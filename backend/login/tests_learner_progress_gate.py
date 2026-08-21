"""Unit tests for the learner-progress gates in ``permissions.py``.

    python manage.py test login.tests_learner_progress_gate

These run without a database: ``authenticate_request`` is patched, so what is
under test is the decision the decorator makes, not session resolution (which
``tests_unit.SessionTests`` already covers).

What is being pinned is the one rule that inverts this module's usual shape —
**staff and admin are refused here** — plus the details that are easy to lose in
a later refactor: reads stay open, the learner id can arrive from three
different places, a learner poking at another learner's id gets 404 rather than
a 403 that would confirm it exists, and booking a session is the single write a
staff viewer keeps.
"""
from __future__ import annotations

import json
from unittest import mock

from django.http import JsonResponse
from django.test import RequestFactory, SimpleTestCase

from . import permissions


class _Account:
    """The two fields the gates read off a resolved account."""

    def __init__(self, role, subject_id, subject_type="learner"):
        self.role = role
        self.subject_id = subject_id
        self.subject_type = subject_type


LEARNER_56 = _Account("learner", 56)
LEARNER_19 = _Account("learner", 19)
STAFF = _Account("staff", 3, subject_type="staff")
ADMIN = _Account("admin", 1, subject_type="staff")
EMPLOYER = _Account("employer", 7, subject_type="employer")


def _view(request, *args, **kwargs):
    """A stand-in for a progress endpoint: 200 means the gate let it through."""
    return JsonResponse({"ok": True})


class LearnerProgressGateTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    # ── helpers ──────────────────────────────────────────────────────────

    def _call(self, gated, request, account, **kwargs):
        with mock.patch.object(permissions, "authenticate_request", return_value=account):
            return gated(request, **kwargs)

    def _post(self, path="/learner_api/videos/abc/complete/", **params):
        query = "&".join(f"{k}={v}" for k, v in params.items())
        return self.factory.post(f"{path}?{query}" if query else path)

    # ── the query-param shape (quiz / video / component completion) ───────

    def test_the_learner_may_record_their_own_progress(self):
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        response = self._call(gated, self._post(learnerId=56), LEARNER_56)
        self.assertEqual(response.status_code, 200)

    def test_staff_are_refused_and_told_why(self):
        """The inversion: staff read a learner's plan, they do not progress it."""
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        response = self._call(gated, self._post(learnerId=56), STAFF)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "read_only_learner_view")

    def test_admins_are_refused_too(self):
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        response = self._call(gated, self._post(learnerId=56), ADMIN)
        self.assertEqual(response.status_code, 403)

    def test_an_employer_is_refused(self):
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        response = self._call(gated, self._post(learnerId=56), EMPLOYER)
        self.assertEqual(response.status_code, 403)

    def test_another_learner_gets_404_not_403(self):
        """A 403 would confirm learner 56 exists; collapse it to 404."""
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        response = self._call(gated, self._post(learnerId=56), LEARNER_19)
        self.assertEqual(response.status_code, 404)

    def test_no_session_is_401(self):
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        response = self._call(gated, self._post(learnerId=56), None)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)["code"], "unauthenticated")

    def test_a_missing_learner_id_is_rejected_not_waved_through(self):
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        response = self._call(gated, self._post(), LEARNER_56)
        self.assertEqual(response.status_code, 400)

    # ── reads stay open ──────────────────────────────────────────────────

    def test_staff_may_still_read(self):
        """Staff review a learner's plan constantly; only writing is gated."""
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        request = self.factory.get("/learner_api/reflection/submissions/?learnerId=56")
        response = self._call(gated, request, STAFF)
        self.assertEqual(response.status_code, 200)

    # ── the URL-kwarg shape (evidence upload) ────────────────────────────

    def test_the_kwarg_shape_reads_the_url(self):
        gated = permissions.learner_self_only(kwarg="pk")(_view)
        request = self.factory.post("/learner_api/evidence/commercial/56/upload/")
        self.assertEqual(self._call(gated, request, LEARNER_56, kind="commercial", pk=56).status_code, 200)
        self.assertEqual(self._call(gated, request, LEARNER_19, kind="commercial", pk=56).status_code, 404)
        self.assertEqual(self._call(gated, request, STAFF, kind="commercial", pk=56).status_code, 403)

    # ── the body shape (reflection submissions) ──────────────────────────

    def test_the_body_shape_reads_the_json_payload(self):
        gated = permissions.learner_self_only(body_field="learnerId")(_view)
        request = self.factory.post(
            "/learner_api/reflection/submissions/",
            data=json.dumps({"learnerId": "56", "learnerKind": "commercial"}),
            content_type="application/json",
        )
        self.assertEqual(self._call(gated, request, LEARNER_56).status_code, 200)
        self.assertEqual(self._call(gated, request, LEARNER_19).status_code, 404)

    def test_reading_the_body_in_the_gate_leaves_it_readable_by_the_view(self):
        """Django caches ``request.body``, so the view's own json.loads still works.

        Pinned because it is the assumption that lets the body shape exist at
        all: if the gate consumed the stream, every reflection submission would
        reach the view with an empty payload.
        """
        seen = {}

        def view(request, *args, **kwargs):
            seen["payload"] = json.loads(request.body)
            return JsonResponse({"ok": True})

        gated = permissions.learner_self_only(body_field="learnerId")(view)
        request = self.factory.post(
            "/learner_api/reflection/submissions/",
            data=json.dumps({"learnerId": 56, "learningReflection": "went well"}),
            content_type="application/json",
        )
        self.assertEqual(self._call(gated, request, LEARNER_56).status_code, 200)
        self.assertEqual(seen["payload"]["learningReflection"], "went well")

    # ── the booking carve-out ────────────────────────────────────────────

    def test_staff_may_book_a_session_for_a_learner(self):
        """The one write a staff viewer keeps on a learner's page."""
        gated = permissions.learner_self_or_staff(kwarg="pk")(_view)
        request = self.factory.post("/learner_api/calendar/commercial/56/book/")
        self.assertEqual(self._call(gated, request, STAFF, kind="commercial", pk=56).status_code, 200)
        self.assertEqual(self._call(gated, request, ADMIN, kind="commercial", pk=56).status_code, 200)

    def test_booking_still_refuses_another_learner_and_anonymous_callers(self):
        gated = permissions.learner_self_or_staff(kwarg="pk")(_view)
        request = self.factory.post("/learner_api/calendar/commercial/56/book/")
        self.assertEqual(self._call(gated, request, LEARNER_56, kind="commercial", pk=56).status_code, 200)
        self.assertEqual(self._call(gated, request, LEARNER_19, kind="commercial", pk=56).status_code, 404)
        self.assertEqual(self._call(gated, request, None, kind="commercial", pk=56).status_code, 401)

    # ── the development escape hatch ─────────────────────────────────────

    def test_the_escape_hatch_disables_the_gate(self):
        """LEARNER_API_REQUIRE_AUTH=0 turns every gate in the module off.

        Documented for local development and must never be set in a deployment:
        with it set, a staff viewer can write learner progress again.
        """
        gated = permissions.learner_self_only(query_param="learnerId")(_view)
        with mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}, clear=False):
            response = self._call(gated, self._post(learnerId=56), STAFF)
        self.assertEqual(response.status_code, 200)
