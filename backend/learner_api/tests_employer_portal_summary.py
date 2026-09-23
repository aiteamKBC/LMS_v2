import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from curriculum_api import review_instances, review_types

from . import employer_portal
from . import employer_portal_summary as summary
from .employer_portal_access import EmployerAccessResult


def learner(pk=101, *, employer_id=1, learner_type="apprenticeship"):
    return SimpleNamespace(
        pk=pk,
        id=pk,
        employer_id=employer_id,
        learner_type=learner_type,
        username="Learner One",
        email="learner@example.test",
        programme="Programme A",
        programme_status="Active",
        cohort="Cohort A",
        group="Group A",
        start_date="2026-01-01",
        end_date="2026-12-31",
        coach_name="Source Coach",
        coach_email="source.coach@example.test",
        case_owner="",
        aptem_id="4176",
    )


def profile(pk=201, *, enrolment_id=101):
    return SimpleNamespace(
        pk=pk,
        id=pk,
        enrolment_id=enrolment_id,
        coach_name="Profile Coach",
        coach_email="profile.coach@example.test",
        programme="Programme A",
        programme_status="Active",
        cohort="Cohort A",
        group_name="Group A",
        start_date="2026-01-01",
        end_date="2026-12-31",
    )


def learning_modules():
    return {
        "modules": [
            {"id": "M1", "title": "Current One", "programme_name": "Programme A", "cohort_name": "Cohort A",
             "group_name": "Group A", "start_date": "2026-09-01", "end_date": "2026-09-30", "weeks_number": 4},
            {"id": "M2", "title": "Current Two", "programme_name": "Programme A", "cohort_name": "Cohort A",
             "group_name": "Group A", "start_date": "2026-09-10", "end_date": "2026-09-28", "weeks_number": 3},
        ]
    }


def week_payload():
    return {
        "planSubjects": [
            {"id": "current:M1", "moduleIds": ["M1"], "completed": 3, "total": 4, "percent": 75.0},
            {"id": "current:M2", "moduleIds": ["M2"], "completed": 1, "total": 2, "percent": 50.0},
        ],
        "metrics": {
            "otjh": {"actual": 61, "planned": 278},
            "ksb": {
                "status": "ready",
                "completed": 3,
                "total": 4,
                "percent": 75.0,
                "codes": [
                    {"code": "K1", "completed": 1, "total": 1},
                    {"code": "S1", "completed": 1, "total": 2},
                    {"code": "B1", "completed": 1, "total": 1},
                ],
            },
        },
        "homeProgress": {"otjh": {"submitted": 2.5}},
    }


class EmployerPortalSummaryTests(SimpleTestCase):
    def setUp(self):
        self.employer = SimpleNamespace(pk=1)
        self.learner = learner()
        self.profile = profile()

    def _patch_summary(self, *, access=None, profile_result=None, lectures=None, metrics=None, reviews=None):
        access = access if access is not None else EmployerAccessResult(self.employer, self.learner)
        profile_result = profile_result if profile_result is not None else (self.profile, "")
        lectures = lectures if lectures is not None else [
            {"status": "completed", "date": "2026-09-01", "startTime": "09:00", "catchupStatus": None},
            {"status": "absent", "date": "2026-09-08", "startTime": "09:00", "catchupStatus": None},
        ]
        week = week_payload()
        if metrics is not None:
            week["metrics"] = metrics

        def review_definition(row):
            return {
                "template": {
                    "reviewTypeCode": row["type"],
                    "visibleTo": {"employer": True},
                },
                "signatures": {"employer": {"required": True, "signed": row.get("signed", False)}},
            }

        review_rows = reviews if reviews is not None else [
            {"id": "PR-1", "learner_id": "201", "target_date": "2026-08-01", "type": review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW},
            {"id": "MCM-1", "learner_id": "201", "target_date": "2026-09-01", "type": review_types.REVIEW_TYPE_CODE_MCM},
            {"id": "PR-2", "learner_id": "201", "target_date": "2026-10-01", "type": review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW},
        ]

        return patch.multiple(
            summary,
            resolve_employer_owned_learner=lambda *_args, **_kwargs: access,
            resolve_single_profile_for_source=lambda *_args, **_kwargs: profile_result,
            read_dashboard=lambda *_args, **_kwargs: learning_modules(),
            read_week=lambda *_args, **_kwargs: week,
            lecture_register=lambda *_args, **_kwargs: lectures,
            read_metrics=lambda *_args, **_kwargs: week["metrics"],
            _last_submission_at=lambda *_args, **_kwargs: None,
            _activity=lambda *_args, **_kwargs: {
                "lastLmsActivityAt": "2026-09-12T10:00:00+00:00",
                "lastSubmissionAt": None,
                "lastLiveSessionAt": None,
            },
            _today=lambda: __import__("datetime").date(2026, 9, 17),
            review_instances=SimpleNamespace(
                STATUS_AWAITING_SIGNATURE=review_instances.STATUS_AWAITING_SIGNATURE,
                STATUS_COMPLETED=review_instances.STATUS_COMPLETED,
                list_review_instances_for_learner=lambda *_args, **_kwargs: review_rows,
                review_instance_form_definition=review_definition,
            ),
        )

    def test_employer_can_read_summary_for_their_learner(self):
        with self._patch_summary():
            payload, error, status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertEqual(status, 200, error)
        self.assertEqual(payload["learner"]["id"], "101")
        self.assertEqual(payload["programme"]["cohort"], "Cohort A")

    def test_employer_cannot_read_another_employers_learner_summary(self):
        denied = EmployerAccessResult(None, None, error="That learner does not belong to this employer.", status=403)
        with self._patch_summary(access=denied):
            payload, error, status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 102)
        self.assertIsNone(payload)
        self.assertEqual(status, 403)
        self.assertIn("does not belong", error)

    def test_wrong_learner_kind_is_rejected(self):
        denied = EmployerAccessResult(None, None, error="Learner not found.", status=404)
        with self._patch_summary(access=denied):
            payload, error, status = summary.build_employer_learner_summary(self.employer, "commercial", 101)
        self.assertIsNone(payload)
        self.assertEqual(status, 404)
        self.assertEqual(error, "Learner not found.")

    def test_staff_read_access_uses_same_summary_without_signing_permissions(self):
        with patch.object(employer_portal, "_employer_or_404", return_value=(self.employer, None)), \
                patch.object(employer_portal, "build_employer_learner_summary", return_value=({"ok": True}, "", 200)):
            request = SimpleNamespace(method="GET", login_account=SimpleNamespace(role="staff"))
            response = employer_portal.employer_portal_learner_summary.__wrapped__.__wrapped__(
                request, 1, "apprenticeship", 101,
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"ok": True})

    def test_missing_attendance_returns_unavailable_not_zero(self):
        with self._patch_summary(lectures=[]):
            payload, _error, _status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertFalse(payload["attendance"]["available"])
        self.assertIsNone(payload["attendance"]["ratePercent"])
        self.assertEqual(payload["attendance"]["classification"], "unavailable")

    def test_attendance_normalises_raw_register_rows_before_calculating_totals(self):
        raw_rows = [
            {
                "session_id": "att-1", "session_date": __import__("datetime").date(2026, 9, 1),
                "session_start_time": __import__("datetime").time(9), "session_end_time": __import__("datetime").time(10),
                "session_title": "Live session", "module_title": "Module A", "attendance_status": "present",
                "source": "kbc-attendance", "learner_id": 101, "catchup_completed": False,
            },
            {
                "session_id": "att-2", "session_date": __import__("datetime").date(2026, 9, 8),
                "session_start_time": __import__("datetime").time(9), "session_end_time": __import__("datetime").time(10),
                "session_title": "Live session", "module_title": "Module A", "attendance_status": "absent",
                "source": "kbc-attendance", "learner_id": 101, "catchup_completed": False,
            },
        ]
        with self._patch_summary(lectures=raw_rows):
            payload, error, status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertEqual(status, 200, error)
        self.assertTrue(payload["attendance"]["available"])
        self.assertEqual(payload["attendance"]["ratePercent"], 50)
        self.assertEqual(payload["attendance"]["sessionsAttended"], 1)
        self.assertEqual(payload["attendance"]["absences"], 1)

    def test_missing_ksb_mapping_returns_unavailable_not_zero(self):
        metrics = {"otjh": {"actual": 0, "planned": 278}, "ksb": {"status": "unavailable", "reason": "activity_points_missing"}}
        with self._patch_summary(metrics=metrics):
            payload, _error, _status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertFalse(payload["ksb"]["available"])
        self.assertIsNone(payload["ksb"]["achieved"])
        self.assertEqual(payload["ksb"]["reason"], "activity_points_missing")

    def test_otj_planned_total_is_not_exposed_as_planned_to_date(self):
        """The programme total must never be passed off as the to-date figure.

        Planned-to-date is now derived (pro-rata across the programme dates), so
        it is no longer null — but it must still be a smaller, separately
        computed number, never a copy of the 278-hour programme total.
        """
        with self._patch_summary():
            payload, _error, _status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertEqual(payload["otj"]["plannedTotalHours"], 278)
        self.assertNotEqual(payload["otj"]["plannedToDateHours"], 278)
        self.assertLess(payload["otj"]["plannedToDateHours"], 278)

    def test_planned_to_date_is_pro_rated_across_the_programme_dates(self):
        """Half-way through the programme, half of the planned hours are due."""
        self.assertEqual(
            summary._planned_to_date(278, "2026-01-01", "2026-12-31", today=date(2026, 7, 1)),
            round(278 * ((date(2026, 7, 1) - date(2026, 1, 1)).days / (date(2026, 12, 31) - date(2026, 1, 1)).days), 2),
        )

    def test_planned_to_date_is_unavailable_without_programme_dates(self):
        """A missing date yields no figure rather than one pro-rated from a guess."""
        self.assertIsNone(summary._planned_to_date(278, "", "2026-12-31"))
        self.assertIsNone(summary._planned_to_date(278, "2026-01-01", ""))
        self.assertIsNone(summary._planned_to_date(None, "2026-01-01", "2026-12-31"))

    def test_planned_to_date_is_clamped_to_the_programme_window(self):
        """Nothing is due before the start, and the whole total after the end."""
        self.assertEqual(summary._planned_to_date(278, "2026-01-01", "2026-12-31", today=date(2025, 6, 1)), 0.0)
        self.assertEqual(summary._planned_to_date(278, "2026-01-01", "2026-12-31", today=date(2027, 6, 1)), 278.0)

    def test_variance_is_unavailable_when_actual_hours_are_missing(self):
        """A missing actual must not read as a full shortfall against the plan."""
        metrics = {"otjh": {"actual": None, "planned": 278}, "ksb": {"status": "unavailable"}}
        with self._patch_summary(metrics=metrics):
            payload, _error, _status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertIsNone(payload["otj"]["varianceToDateHours"])
        self.assertIsNone(payload["otj"]["behindPlan"])

    def test_module_percent_is_derived_from_the_plan_activity_counts(self):
        """The learning plan reports counts but no percentage; 3 of 4 is 75%."""
        self.assertEqual(summary._module_percent(3, 4), 75.0)

    def test_module_with_no_planned_activities_is_unavailable_not_zero(self):
        """Nothing planned is not the same as nothing done."""
        self.assertIsNone(summary._module_percent(0, 0))
        self.assertIsNone(summary._module_percent(None, 4))

    def test_current_week_counts_from_the_module_start_and_clamps_to_its_length(self):
        module = {"start_date": "2026-09-01", "weeks_number": 4}
        self.assertEqual(summary._current_week(module, today=date(2026, 9, 1)), 1)
        self.assertEqual(summary._current_week(module, today=date(2026, 9, 8)), 2)
        # A module running past its end reports its final week, not week 6.
        self.assertEqual(summary._current_week(module, today=date(2026, 10, 10)), 4)
        # Before it starts, and without dates or a length, there is no week.
        self.assertIsNone(summary._current_week(module, today=date(2026, 8, 1)))
        self.assertIsNone(summary._current_week({"weeks_number": 4}))
        self.assertIsNone(summary._current_week({"start_date": "2026-09-01"}))

    def test_mcm_is_not_counted_as_pending_employer_progress_review_signing(self):
        with self._patch_summary():
            payload, _error, _status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertEqual(payload["reviews"]["pendingEmployerSignatureCount"], 2)

    def test_module_progress_matches_learning_plan_subject_percent(self):
        with self._patch_summary():
            payload, _error, _status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        first = payload["currentLearning"]["modules"][0]
        self.assertEqual(first["moduleId"], "M1")
        self.assertEqual(first["completedActivities"], 3)
        self.assertEqual(first["totalActivities"], 4)
        self.assertEqual(first["progressPercent"], 75.0)

    def test_multiple_current_modules_are_represented(self):
        with self._patch_summary():
            payload, _error, _status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertEqual(payload["currentLearning"]["selectionState"], "multiple")
        self.assertEqual([row["moduleId"] for row in payload["currentLearning"]["modules"]], ["M1", "M2"])

    def test_get_summary_does_not_invoke_known_write_side_effect_helpers(self):
        with self._patch_summary(), \
                patch.object(employer_portal, "_employer_or_404", return_value=(self.employer, None)), \
                patch("learner_api.employer_portal.learner_profile_for_source") as repair, \
                patch("enrolment_api.document_tables.ensure_enrolment_documents_table") as provision, \
                patch("learner_api.learner_detail.build_learner_detail") as detail:
            request = SimpleNamespace(method="GET", login_account=SimpleNamespace(role="employer"))
            response = employer_portal.employer_portal_learner_summary.__wrapped__.__wrapped__(
                request, 1, "apprenticeship", 101,
            )
        self.assertEqual(response.status_code, 200)
        repair.assert_not_called()
        provision.assert_not_called()
        detail.assert_not_called()

    def test_profile_source_collision_is_still_rejected_by_access_layer(self):
        denied = EmployerAccessResult(self.employer, self.learner, error="Review instance not found.", status=404)
        with self._patch_summary(access=denied):
            payload, error, status = summary.build_employer_learner_summary(self.employer, "apprenticeship", 101)
        self.assertIsNone(payload)
        self.assertEqual(status, 404)
        self.assertEqual(error, "Review instance not found.")
