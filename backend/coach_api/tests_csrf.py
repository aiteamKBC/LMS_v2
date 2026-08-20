"""CSRF integration coverage for session-authenticated Coach mutations."""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import Client, TestCase

from learner_api.models import StaffUser
from login.identity import ensure_account
from login.models import LoginAccount, LoginSession
from login.sessions import COOKIE_NAME, issue_session

from .models import CoachAbsenceReport, CoachCalendarEvent


class CoachCsrfIntegrationTests(TestCase):
    databases = {"default", "enrolment"}

    def setUp(self):
        self.client = Client(enforce_csrf_checks=True, SERVER_NAME="localhost")
        self._accounts: list[LoginAccount] = []
        self._staff: list[StaffUser] = []

    def tearDown(self):
        account_ids = [account.id for account in self._accounts]
        if account_ids:
            LoginSession.objects.filter(account_id__in=account_ids).delete()
            LoginAccount.objects.filter(id__in=account_ids).delete()
        staff_ids = [staff.id for staff in self._staff]
        if staff_ids:
            StaffUser.objects.filter(id__in=staff_ids).delete()
        super().tearDown()

    def _authenticate_coach(self, email="coach-a@example.com"):
        staff = StaffUser.objects.create(
            username=email.split("@", 1)[0],
            email=email,
            position="Caseowner",
            access="coach",
            type="Admin",
            status="FullUser",
        )
        account, _ = ensure_account("staff", staff.id, subject=staff)
        token, _session, _ttl = issue_session(account)
        self.client.cookies[COOKIE_NAME] = token
        self._staff.append(staff)
        self._accounts.append(account)

    def _json(self, method, path, payload, *, csrf_token=None):
        headers = {"HTTP_X_CSRFTOKEN": csrf_token} if csrf_token else {}
        return self.client.generic(
            method,
            path,
            data=json.dumps(payload),
            content_type="application/json",
            **headers,
        )

    def _csrf_token(self):
        response = self.client.get("/coach_api/csrf")
        self.assertEqual(response.status_code, 200)
        return response.json()["csrfToken"]

    @patch("coach_api.views.ensure_learning_reflection_submissions_table")
    @patch("coach_api.views.sync_calendar_event_to_graph")
    @patch("coach_api.views.fetch_owner_active_learner_profiles")
    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_authenticated_coach_mutations_without_csrf_are_rejected_before_side_effects(
        self, learner_annotate, fetch_active_learners, sync_graph, ensure_table
    ):
        self._authenticate_coach()
        calendar_count = CoachCalendarEvent.objects.count()
        report = CoachAbsenceReport.objects.create(
            attendance_id=7000,
            owner_email="coach-a@example.com",
            owner_name="Coach A",
            learner_id=101,
            learner_name="Learner A",
            learner_email="learner-a@example.com",
            session_title="Session",
            session_date="2099-01-01",
            reason="Test",
        )
        cases = (
            ("PATCH", "/coach_api/coach/caseload/101/coach-rag", {"coachRag": "red"}),
            ("PATCH", "/coach_api/coach/absence-reports", {"id": report.id, "status": "approved"}),
            (
                "PATCH",
                "/coach_api/coach/marking-queue/00000000-0000-0000-0000-000000000001",
                {"decision": "accepted"},
            ),
            (
                "POST",
                "/coach_api/coach/timetable/events/book",
                {
                    "learnerId": 101,
                    "sessionType": "catch-up",
                    "scheduledDate": "2099-01-01",
                    "scheduledTime": "10:00",
                },
            ),
            (
                "POST",
                "/coach_api/coach/timetable/events/schedule",
                {
                    "eventKey": "mcr:101:1",
                    "scheduledDate": "2099-01-01",
                    "scheduledTime": "10:00",
                },
            ),
            (
                "POST",
                "/coach_api/coach/timetable/events/action",
                {"eventKey": "mcr:101:1", "action": "start"},
            ),
        )

        for method, path, payload in cases:
            with self.subTest(method=method, path=path):
                self.assertEqual(self._json(method, path, payload).status_code, 403)

        self.assertEqual(CoachCalendarEvent.objects.count(), calendar_count)
        report.refresh_from_db()
        self.assertEqual(report.status, CoachAbsenceReport.STATUS_PENDING)
        learner_annotate.assert_not_called()
        fetch_active_learners.assert_not_called()
        ensure_table.assert_not_called()
        sync_graph.assert_not_called()

    def test_authenticated_coach_with_invalid_csrf_token_is_rejected(self):
        self._authenticate_coach()
        self._csrf_token()
        response = self._json(
            "PATCH",
            "/coach_api/coach/caseload/101/coach-rag",
            {"coachRag": "red"},
            csrf_token="invalid-token",
        )
        self.assertEqual(response.status_code, 403)

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_authenticated_coach_with_valid_csrf_token_can_update_owned_rag(self, annotate):
        self._authenticate_coach()
        csrf_token = self._csrf_token()
        owned_queryset = MagicMock()
        owned_queryset.update.return_value = 1
        annotate.return_value.filter.return_value = owned_queryset

        response = self._json(
            "PATCH",
            "/coach_api/coach/caseload/101/coach-rag",
            {"coachRag": "green"},
            csrf_token=csrf_token,
        )

        self.assertEqual(response.status_code, 200)
        owned_queryset.update.assert_called_once_with(coach_rag="green")

    def test_valid_csrf_token_does_not_replace_authentication(self):
        csrf_token = self._csrf_token()
        response = self._json(
            "PATCH",
            "/coach_api/coach/caseload/101/coach-rag",
            {"coachRag": "green"},
            csrf_token=csrf_token,
        )
        self.assertEqual(response.status_code, 401)

    @patch("coach_api.views.fetch_owner_active_learner_profiles", return_value=[])
    def test_valid_csrf_token_does_not_bypass_coach_ownership(self, _active_rows):
        self._authenticate_coach()
        csrf_token = self._csrf_token()
        report = CoachAbsenceReport.objects.create(
            attendance_id=7001,
            owner_email="coach-b@example.com",
            owner_name="Coach B",
            learner_id=202,
            learner_name="Learner B",
            learner_email="learner-b@example.com",
            session_title="Session",
            session_date="2099-01-01",
            reason="Test",
        )

        response = self._json(
            "PATCH",
            "/coach_api/coach/absence-reports",
            {"id": report.id, "status": "approved"},
            csrf_token=csrf_token,
        )

        self.assertEqual(response.status_code, 404)
        report.refresh_from_db()
        self.assertEqual(report.status, CoachAbsenceReport.STATUS_PENDING)

    @patch("coach_api.views.coach_staff_display_name", return_value="Coach A")
    @patch("coach_api.views.collect_tracked_live_session_events", return_value=[])
    @patch(
        "coach_api.views.collect_generated_timetable",
        return_value={"events": [], "summary": {}, "owner_name": "Coach A"},
    )
    @patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[])
    def test_authenticated_coach_get_does_not_require_csrf_header(
        self, _profiles, _timetable, _live_events, _display_name
    ):
        self._authenticate_coach()
        self.assertEqual(self.client.get("/coach_api/coach/dashboard").status_code, 200)
