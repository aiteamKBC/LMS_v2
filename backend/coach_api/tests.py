from types import SimpleNamespace

from django.test import RequestFactory, SimpleTestCase, override_settings

from .views import (
    DEFAULT_COACH_EMAIL,
    build_attendance_metrics_from_detail_rows,
    resolve_attendance_owner_email,
    serialize_attendance_learner,
)


class AttendanceMetricTests(SimpleTestCase):
    def test_absence_authorisation_uses_review_status_not_reason_presence(self):
        metrics = build_attendance_metrics_from_detail_rows([
            {
                "attendance_status": "absent",
                "absence_reason": "Work commitment",
                "authorisation_status": "approved",
                "session_date": "2026-07-03",
            },
            {
                "attendance_status": "absent",
                "absence_reason": "",
                "authorisation_status": "declined",
                "session_date": "2026-07-02",
            },
            {
                "attendance_status": "absent",
                "absence_reason": "Technical issue",
                "authorisation_status": "pending",
                "session_date": "2026-07-01",
            },
        ])

        self.assertEqual(metrics["authorisedAbsent"], 1)
        self.assertEqual(metrics["unauthorisedAbsent"], 1)
        self.assertEqual(metrics["authorisationUnknown"], 1)
        self.assertEqual(metrics["absenceReasons"]["Work commitment"], 1)
        self.assertEqual(metrics["absenceReasons"]["No Reason Provided"], 1)

    def test_pending_and_completed_catchups_are_kept_separate(self):
        learner = {
            "id": "7",
            "name": "Example Learner",
            "initials": "EL",
            "email": "learner@example.com",
            "programmeName": "Programme",
            "cohortName": "Cohort",
            "group": "Group",
            "rawProgramStatus": "Active",
            "enrollmentStatus": "active",
            "employer": "Employer",
            "overallProgress": 0,
            "otjhCompleted": 0,
            "otjhPlanned": 0,
            "otjhTarget": 1,
            "ksbProgress": 0,
        }
        metrics = {
            "sessions": 2,
            "present": 1,
            "absent": 1,
            "catchup": 2,
            "risk": "red",
        }

        result = serialize_attendance_learner(
            learner,
            metrics,
            completed_calendar_catchups=1,
            pending_catchups=3,
        )

        self.assertEqual(result["catchupCompleted"], 2)
        self.assertEqual(result["catchupPending"], 3)


class AttendanceOwnerSecurityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @override_settings(DEBUG=True)
    def test_development_anonymous_access_is_limited_to_default_owner(self):
        request = self.factory.get("/coach/attendance", {"owner_email": "other@example.com"})

        owner, error = resolve_attendance_owner_email(request)

        self.assertIsNone(owner)
        self.assertEqual(error.status_code, 403)

    @override_settings(DEBUG=True)
    def test_development_default_owner_remains_available(self):
        request = self.factory.get("/coach/attendance")

        owner, error = resolve_attendance_owner_email(request)

        self.assertEqual(owner, DEFAULT_COACH_EMAIL)
        self.assertIsNone(error)

    @override_settings(DEBUG=False)
    def test_production_requires_authentication(self):
        request = self.factory.get("/coach/attendance")

        owner, error = resolve_attendance_owner_email(request)

        self.assertIsNone(owner)
        self.assertEqual(error.status_code, 401)

    @override_settings(DEBUG=False)
    def test_authenticated_coach_is_scoped_to_own_email(self):
        request = self.factory.get("/coach/attendance")
        request.user = SimpleNamespace(
            is_authenticated=True,
            is_staff=False,
            email="coach@example.com",
        )

        owner, error = resolve_attendance_owner_email(request)

        self.assertEqual(owner, "coach@example.com")
        self.assertIsNone(error)
