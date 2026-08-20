"""Integration tests for the Coach authentication and ownership boundary.

These tests deliberately use Django's Client and the real ``kbc_session``
records.  Calling the view functions directly would skip the middleware and
permission decorators that this suite exists to pin down.

Run with the enrolment test runner because login/staff tables are unmanaged::

    python manage.py test coach_api.tests_security \
        --testrunner=login.test_runner.EnrolmentTestRunner
"""

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


COACH_ENDPOINTS = (
    ("GET", "/coach_api/coach/dashboard", None),
    ("GET", "/coach_api/coach/caseload", None),
    ("GET", "/coach_api/coach/caseload/101/coach-rag", None),
    ("PATCH", "/coach_api/coach/caseload/101/coach-rag", {"coachRag": "green"}),
    ("GET", "/coach_api/coach/attendance", None),
    ("GET", "/coach_api/coach/attendance/details?learner_id=101", None),
    ("GET", "/coach_api/coach/absence-reports", None),
    ("PATCH", "/coach_api/coach/absence-reports", {"id": 1, "status": "approved"}),
    ("GET", "/coach_api/coach/evidence-awaiting-review", None),
    ("GET", "/coach_api/coach/marking-queue", None),
    (
        "PATCH",
        "/coach_api/coach/marking-queue/00000000-0000-0000-0000-000000000001",
        {"decision": "accepted"},
    ),
    ("GET", "/coach_api/coach/monthly-activity", None),
    ("GET", "/coach_api/coach/timetable", None),
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


class CoachAuthorizationSecurityTests(TestCase):
    databases = {"default", "enrolment"}

    def setUp(self):
        self.client = Client(SERVER_NAME="localhost")
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

    def _make_staff_account(self, *, email: str, access: str) -> LoginAccount:
        staff = StaffUser.objects.create(
            username=email.split("@", 1)[0],
            email=email,
            position="Caseowner",
            access=access,
            type="Admin",
            status="FullUser",
        )
        account, _ = ensure_account("staff", staff.id, subject=staff)
        self._staff.append(staff)
        self._accounts.append(account)
        return account

    def _make_non_staff_account(self, *, role: str) -> LoginAccount:
        account = LoginAccount.objects.create(
            subject_type=role,
            subject_id=9_000_000 + len(self._accounts),
            email=f"{role}-{uuid.uuid4().hex[:10]}@kbc.invalid",
            display_name=f"Test {role}",
            role=role,
            is_active=True,
        )
        self._accounts.append(account)
        return account

    def _authenticate(self, account: LoginAccount) -> None:
        token, _session, _ttl = issue_session(account)
        self.client.cookies[COOKIE_NAME] = token

    def _request(self, method: str, path: str, payload=None):
        if payload is None:
            return self.client.generic(method, path)
        return self.client.generic(
            method,
            path,
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_every_coach_route_rejects_anonymous_requests_before_view_work(self):
        for method, path, payload in COACH_ENDPOINTS:
            with self.subTest(method=method, path=path):
                response = self._request(method, path, payload)
                self.assertEqual(response.status_code, 401)

    def test_every_coach_route_rejects_a_learner_session(self):
        self._authenticate(self._make_non_staff_account(role="learner"))
        for method, path, payload in COACH_ENDPOINTS:
            with self.subTest(method=method, path=path):
                response = self._request(method, path, payload)
                self.assertEqual(response.status_code, 403)

    def test_removed_coach_message_routes_return_not_found(self):
        self.assertEqual(self.client.get("/coach_api/coach/messages").status_code, 404)
        self.assertEqual(self.client.get("/coach_api/coach/messages/101").status_code, 404)
        self.assertEqual(
            self._request(
                "POST", "/coach_api/coach/messages/101", {"body": "Hello"}
            ).status_code,
            404,
        )

    @patch("coach_api.views.coach_staff_display_name", return_value="Coach A")
    @patch("coach_api.views.collect_tracked_live_session_events", return_value=[])
    @patch(
        "coach_api.views.collect_generated_timetable",
        return_value={"events": [], "summary": {}, "owner_name": "Coach A"},
    )
    @patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[])
    def test_coach_identity_comes_from_session_and_legacy_match_is_accepted(
        self,
        _profiles,
        _timetable,
        _live_events,
        _display_name,
    ):
        account = self._make_staff_account(email="coach-a@example.com", access="coach")
        self._authenticate(account)

        without_legacy = self.client.get("/coach_api/coach/dashboard")
        matching_legacy = self.client.get(
            "/coach_api/coach/dashboard", {"owner_email": "  COACH-A@example.com  "}
        )

        self.assertEqual(without_legacy.status_code, 200)
        self.assertEqual(without_legacy.json()["owner"]["email"], "coach-a@example.com")
        self.assertEqual(matching_legacy.status_code, 200)
        self.assertEqual(matching_legacy.json()["owner"]["email"], "coach-a@example.com")

    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_query_owner_email_tampering_is_rejected_before_data_access(self, profiles):
        self._authenticate(
            self._make_staff_account(email="coach-a@example.com", access="coach")
        )

        response = self.client.get(
            "/coach_api/coach/dashboard", {"owner_email": "coach-b@example.com"}
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "coach_identity_mismatch")
        profiles.assert_not_called()

    @patch("coach_api.views.sync_calendar_event_to_graph")
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_json_owner_email_tampering_cannot_create_calendar_data(
        self, fetch_caseload, sync_graph
    ):
        self._authenticate(
            self._make_staff_account(email="coach-a@example.com", access="coach")
        )
        before = CoachCalendarEvent.objects.count()

        response = self._request(
            "POST",
            "/coach_api/coach/timetable/events/book",
            {
                "ownerEmail": "coach-b@example.com",
                "learnerId": 202,
                "sessionType": "catch-up",
                "scheduledDate": "2099-01-01",
                "scheduledTime": "10:00",
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(CoachCalendarEvent.objects.count(), before)
        fetch_caseload.assert_not_called()
        sync_graph.assert_not_called()

    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_super_admin_cannot_impersonate_a_coach_on_normal_endpoints(self, profiles):
        self._authenticate(
            self._make_staff_account(email="admin@example.com", access="super-admin")
        )

        response = self.client.get(
            "/coach_api/coach/dashboard", {"owner_email": "coach-a@example.com"}
        )

        self.assertEqual(response.status_code, 403)
        profiles.assert_not_called()

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_coach_cannot_update_another_coachs_learner_rag(self, annotate):
        self._authenticate(
            self._make_staff_account(email="coach-a@example.com", access="coach")
        )
        owned_queryset = MagicMock()
        owned_queryset.update.return_value = 0
        annotate.return_value.filter.return_value = owned_queryset

        response = self._request(
            "PATCH",
            "/coach_api/coach/caseload/202/coach-rag",
            {"coachRag": "red"},
        )

        self.assertEqual(response.status_code, 404)
        annotate.return_value.filter.assert_called_once_with(
            id=202,
            coach_email_key="coach-a@example.com",
        )
        owned_queryset.update.assert_called_once_with(coach_rag="red")

    @patch("coach_api.views.LearnerProfile.objects.annotate")
    def test_coach_cannot_review_another_coachs_marking_submission(
        self, annotate
    ):
        self._authenticate(
            self._make_staff_account(email="coach-a@example.com", access="coach")
        )
        annotate.return_value.filter.return_value.values_list.return_value = [101]
        cursor = MagicMock()
        cursor.fetchone.return_value = (202,)
        enrolment_connection = MagicMock()
        enrolment_connection.cursor.return_value.__enter__.return_value = cursor
        submission_id = "00000000-0000-0000-0000-000000000001"

        with patch("coach_api.views.connections", {"enrolment": enrolment_connection}):
            response = self._request(
                "PATCH",
                f"/coach_api/coach/marking-queue/{submission_id}",
                {"decision": "accepted"},
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertNotIn("update", cursor.execute.call_args.args[0].lower())

    @patch("coach_api.views.sync_calendar_event_to_graph")
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_coach_cannot_book_for_another_coachs_learner(self, fetch_caseload, sync_graph):
        self._authenticate(
            self._make_staff_account(email="coach-a@example.com", access="coach")
        )
        fetch_caseload.return_value = [SimpleNamespace(id=101)]
        before = CoachCalendarEvent.objects.count()

        response = self._request(
            "POST",
            "/coach_api/coach/timetable/events/book",
            {
                "learnerId": 202,
                "sessionType": "catch-up",
                "scheduledDate": "2099-01-01",
                "scheduledTime": "10:00",
            },
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(CoachCalendarEvent.objects.count(), before)
        sync_graph.assert_not_called()

    @patch("coach_api.views.fetch_owner_active_learner_profiles", return_value=[])
    def test_coach_cannot_update_another_coachs_absence_report(self, _active_rows):
        self._authenticate(
            self._make_staff_account(email="coach-a@example.com", access="coach")
        )
        report = CoachAbsenceReport.objects.create(
            attendance_id=5001,
            owner_email="coach-b@example.com",
            owner_name="Coach B",
            learner_id=202,
            learner_name="Learner B",
            learner_email="learner-b@example.com",
            session_title="Session",
            session_date="2099-01-01",
            reason="Test",
        )

        response = self._request(
            "PATCH",
            "/coach_api/coach/absence-reports",
            {"id": report.id, "status": "approved"},
        )

        self.assertEqual(response.status_code, 404)
        report.refresh_from_db()
        self.assertEqual(report.status, CoachAbsenceReport.STATUS_PENDING)

    def test_batch_transport_cannot_bypass_the_coach_authentication_boundary(self):
        response = self._request(
            "POST",
            "/coach_api/_batch/",
            {
                "requests": [
                    {"id": "caseload", "url": "/coach_api/coach/caseload"}
                ]
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["responses"][0]["status"], 401)
