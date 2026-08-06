from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from coach_api.models import CoachAbsenceReport
from coach_api.views import (
    build_otjh_completed_entries,
    build_monthly_activity_learner,
    coach_caseload,
    completed_ksb_codes,
    fetch_source_schedule_rows,
    iterate_generated_schedule_dates,
    reported_minutes,
    route_absence_report_evidence,
    serialize_caseload_learner,
)


class SourceProfileIdentityTests(SimpleTestCase):
    @patch("coach_api.views.EnrolmentUser.all_learners.annotate")
    def test_source_rows_are_keyed_by_profile_id_after_email_match(self, annotate):
        source = SimpleNamespace(
            id=19,
            email="Mahmoud.Fouda@kentbusinesscollege.com",
            learner_type="commercial",
        )
        annotate.return_value.filter.return_value = [source]
        profile = SimpleNamespace(
            id=2,
            email="mahmoud.fouda@kentbusinesscollege.com",
        )

        commercial, apprenticeship = fetch_source_schedule_rows([profile])

        self.assertEqual(commercial, {2: source})
        self.assertEqual(apprenticeship, {})
        annotate.return_value.filter.assert_called_once_with(
            source_email_key__in={"mahmoud.fouda@kentbusinesscollege.com": 2}
        )


class CoachKsbEvidenceTests(SimpleTestCase):
    def test_failed_quiz_codes_do_not_count_as_completed_ksbs(self):
        completed = completed_ksb_codes(
            [
                {"kind": "quiz", "passed": False, "ksbs": ["K1", "K2", "S1"]},
                {"kind": "video", "ksbs": ["K3.1", "B2.2"]},
            ],
            [],
        )

        self.assertEqual(completed, {"K3", "B2"})


class CoachCaseloadViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("coach_api.views.serialize_caseload_dashboard_learner")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_coach_caseload_can_return_dashboard_summary_snapshots(
        self,
        fetch_rows,
        serialize_learner,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"id": "2", "coachName": "Med Maher"}

        response = coach_caseload(
            self.factory.get(
                "/coach_api/coach/caseload",
                {"owner_email": "coach@example.com", "summary": "1"},
            )
        )

        self.assertEqual(response.status_code, 200)
        fetch_rows.assert_called_once_with("coach@example.com")
        serialize_learner.assert_called_once_with(row)

    @patch("coach_api.views.serialize_caseload_learner")
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_coach_caseload_uses_cached_snapshots_by_default(
        self,
        fetch_rows,
        serialize_learner,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"id": "2", "coachName": "Med Maher"}

        response = coach_caseload(
            self.factory.get(
                "/coach_api/coach/caseload",
                {"owner_email": "coach@example.com"},
            )
        )

        self.assertEqual(response.status_code, 200)
        serialize_learner.assert_called_once_with(row, refresh_live_snapshots=False)

    @patch("coach_api.views.serialize_caseload_learner")
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_coach_caseload_allows_live_snapshot_refresh_when_requested(
        self,
        fetch_rows,
        serialize_learner,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"id": "2", "coachName": "Med Maher"}

        response = coach_caseload(
            self.factory.get(
                "/coach_api/coach/caseload",
                {"owner_email": "coach@example.com", "live": "1"},
            )
        )

        self.assertEqual(response.status_code, 200)
        serialize_learner.assert_called_once_with(row, refresh_live_snapshots=True)


class CoachTimetableWindowTests(SimpleTestCase):
    def test_generated_schedule_dates_respect_requested_window(self):
        generated_dates = list(
            iterate_generated_schedule_dates(
                date(2026, 1, 1),
                date(2026, 2, 28),
                timedelta(days=7),
                range_start=date(2026, 1, 20),
                range_end=date(2026, 2, 2),
            )
        )

        self.assertEqual(
            generated_dates,
            [
                (3, date(2026, 1, 22)),
                (4, date(2026, 1, 29)),
            ],
        )


@override_settings(
    AZURE_STORAGE_ACCOUNT="lmsstorage",
    AZURE_STORAGE_KEY="test-key",
    AZURE_QUARANTINE_CONTAINER="evidence-quarantine",
    AZURE_APPROVED_CONTAINER="evidence-approved",
    AZURE_REJECTED_CONTAINER="evidence-rejected",
)
class AbsenceEvidenceRoutingTests(SimpleTestCase):
    @patch("coach_api.views.move_blob")
    def test_approval_moves_quarantine_blob_to_approved(self, move_blob):
        report = SimpleNamespace(
            evidence_image_url=(
                "https://lmsstorage.blob.core.windows.net/"
                "evidence-quarantine/absence-reports/42/file.pdf"
            )
        )

        moved = route_absence_report_evidence(
            report,
            CoachAbsenceReport.STATUS_APPROVED,
        )

        self.assertEqual(
            (
                "evidence-quarantine",
                "evidence-approved",
                "absence-reports/42/file.pdf",
            ),
            moved,
        )
        move_blob.assert_called_once_with(
            "evidence-quarantine",
            "evidence-approved",
            "absence-reports/42/file.pdf",
        )
        self.assertIn("/evidence-approved/", report.evidence_image_url)

    @patch("coach_api.views.move_blob")
    def test_decline_moves_quarantine_blob_to_rejected(self, move_blob):
        report = SimpleNamespace(
            evidence_image_url=(
                "https://lmsstorage.blob.core.windows.net/"
                "evidence-quarantine/absence-reports/42/file.pdf"
            )
        )

        route_absence_report_evidence(
            report,
            CoachAbsenceReport.STATUS_DECLINED,
        )

        move_blob.assert_called_once_with(
            "evidence-quarantine",
            "evidence-rejected",
            "absence-reports/42/file.pdf",
        )
        self.assertIn("/evidence-rejected/", report.evidence_image_url)

    @patch("coach_api.views.move_blob")
    def test_legacy_local_evidence_is_left_untouched(self, move_blob):
        report = SimpleNamespace(
            evidence_image_url="/media/absence-evidence/legacy.pdf",
        )

        moved = route_absence_report_evidence(
            report,
            CoachAbsenceReport.STATUS_APPROVED,
        )

        self.assertIsNone(moved)
        self.assertEqual(
            "/media/absence-evidence/legacy.pdf",
            report.evidence_image_url,
        )
        move_blob.assert_not_called()


class MonthlyActivityTests(SimpleTestCase):
    def test_reported_minutes_treats_small_bare_numbers_as_hours_and_large_values_as_minutes(self):
        self.assertEqual(reported_minutes("2"), 120.0)
        self.assertEqual(reported_minutes("2h"), 120.0)
        self.assertEqual(reported_minutes("1.5"), 90.0)
        self.assertEqual(reported_minutes("120"), 120.0)
        self.assertEqual(reported_minutes("90 min"), 90.0)

    def test_build_monthly_activity_learner_dedupes_duplicate_feed_items(self):
        row = SimpleNamespace(
            programme="Marketing",
            training_plan_progress=[],
            activity_feed=[
                {
                    "kind": "quiz",
                    "quizId": "quiz-1",
                    "attempt": "1",
                    "date": "2026-07-15",
                    "quizName": "Quiz A",
                    "detail": "Score 8/10",
                },
                {
                    "kind": "quiz",
                    "quizId": "quiz-1",
                    "attempt": "1",
                    "date": "2026-07-15",
                    "quizName": "Quiz A",
                    "detail": "Score 8/10",
                },
                {
                    "kind": "quiz",
                    "quizId": "quiz-1",
                    "attempt": "2",
                    "date": "2026-07-15",
                    "quizName": "Quiz A",
                    "detail": "Score 9/10",
                },
            ],
        )

        learner = {
            "id": "42",
            "name": "Test Learner",
            "initials": "TL",
            "email": "learner@example.com",
            "cohortName": "Cohort A",
            "group": "Group 1",
            "otjhStatus": "On Track",
            "otjhTarget": 120,
            "otjhCompleted": 40,
        }

        result = build_monthly_activity_learner(
            row,
            learner,
            events=[],
            start_date=date(2026, 7, 1),
            end_date=date(2026, 7, 31),
        )

        self.assertEqual(len(result["activities"]), 2)
        self.assertEqual(
            [activity["id"] for activity in result["activities"]],
            [
                "feed:quiz|quiz-1|1|2026-07-15|Quiz A",
                "feed:quiz|quiz-1|2|2026-07-15|Quiz A",
            ],
        )

    @patch("coach_api.views.curriculum_expected_otjh_by_component_id", return_value={"component-1": 1.5})
    def test_build_otjh_completed_entries_prefers_curriculum_expected_otjh(self, expected_lookup):
        entries = build_otjh_completed_entries(
            [
                {
                    "kind": "video",
                    "componentId": "component-1",
                    "componentTitle": "Pre-recorded video",
                    "reportedTime": "120",
                    "submittedAt": "2026-07-18T08:05:37Z",
                }
            ],
            [],
            [{
                "moduleTitle": "Module A",
                "weeks": [{
                    "weekTitle": "Week 1",
                    "components": [{
                        "componentId": "component-1",
                        "componentTitle": "Pre-recorded video",
                    }],
                }],
            }],
        )

        expected_lookup.assert_called_once_with(["component-1"])
        self.assertEqual(entries[0]["hours"], 1.5)
        self.assertEqual(entries[0]["reportedTime"], "120")


class CaseloadOtjhSnapshotTests(SimpleTestCase):
    @patch("coach_api.views.learner_activity_feed_entries", return_value=[])
    @patch("coach_api.views.refresh_caseload_learner_ksb_snapshot")
    @patch("coach_api.views.refresh_learner_otjh_snapshot")
    def test_serialize_caseload_learner_uses_live_otjh_snapshot(
        self,
        refresh_snapshot,
        refresh_ksb_snapshot,
        learner_activity_feed_entries,
    ):
        row = SimpleNamespace(
            id=2,
            username="mahmopud fouda",
            full_name="mahmopud fouda",
            email="learner@example.com",
            coach_name="Med Maher",
            coach_email="Med.Maher@kentbusinesscollege.com",
            programme_status="Active",
            lifecycle_status="active",
            cohort="Cohort A",
            group="Group 1",
            start_date=None,
            end_date=None,
            gateway_review_date=None,
            coach_rag="",
            minimum_hours=Decimal("0"),
            planned_hours=Decimal("111"),
            completed_hours=Decimal("3.4"),
            target_hours=Decimal("16"),
            progress_hours=Decimal("-12.6"),
            progress_variance=Decimal("-0.79"),
            otjh_status="At risk",
            training_plan=[],
            training_plan_progress=[],
            ksbs=[],
            save=lambda **kwargs: None,
        )

        def apply_live_snapshot(learner, *, source=None, detail=None):
            learner.completed_hours = Decimal("29")
            learner.target_hours = Decimal("41.5")
            learner.planned_hours = Decimal("111")
            learner.progress_hours = Decimal("-12.5")
            learner.progress_variance = Decimal("-0.30")
            learner.otjh_status = "At risk"
            return {}

        refresh_snapshot.side_effect = apply_live_snapshot

        payload = serialize_caseload_learner(row)

        refresh_ksb_snapshot.assert_called_once_with(row)
        refresh_snapshot.assert_called_once_with(row)
        learner_activity_feed_entries.assert_called_once_with(row)
        self.assertEqual(payload["otjhCompleted"], 29.0)
        self.assertEqual(payload["otjhTarget"], 41.5)
        self.assertEqual(payload["otjhPlanned"], 111.0)
        self.assertEqual(float(payload["progressVariance"]), -0.3)

    @patch("coach_api.views.learner_activity_feed_entries", return_value=[])
    @patch("coach_api.views.refresh_learner_ksb_snapshot")
    @patch("coach_api.views.refresh_learner_otjh_snapshot", return_value={})
    def test_serialize_caseload_learner_uses_live_ksb_snapshot(
        self,
        refresh_otjh_snapshot,
        refresh_ksb_snapshot,
        learner_activity_feed_entries,
    ):
        row = SimpleNamespace(
            id=5,
            username="mahmopud fouda",
            full_name="mahmopud fouda",
            email="learner@example.com",
            coach_name="Med Maher",
            coach_email="Med.Maher@kentbusinesscollege.com",
            programme="Project Management",
            programme_status="Active",
            lifecycle_status="active",
            cohort="Cohort A",
            group="Group 1",
            start_date=None,
            end_date=None,
            gateway_review_date=None,
            coach_rag="",
            minimum_hours=Decimal("0"),
            planned_hours=Decimal("111"),
            completed_hours=Decimal("29"),
            target_hours=Decimal("41.5"),
            progress_hours=Decimal("-12.5"),
            progress_variance=Decimal("-0.30"),
            otjh_status="At risk",
            training_plan=[{"moduleId": "mod-1"}],
            training_plan_progress=[
                {"ksbs": [{"code": "K1"}, {"code": "S1"}]},
            ],
            ksbs=[],
            _prefetched_objects_cache={"assigned_ksbs": ["stale"]},
            _caseload_source=SimpleNamespace(id=5, programme="Project Management"),
            save=lambda **kwargs: None,
        )

        def apply_live_ksb_snapshot(learner, source, training_plan=None):
            learner.ksbs = [{"code": "K1"}, {"code": "S1"}, {"code": "B1"}]
            return learner.ksbs

        refresh_ksb_snapshot.side_effect = apply_live_ksb_snapshot

        payload = serialize_caseload_learner(row)

        refresh_ksb_snapshot.assert_called_once_with(
            row,
            row._caseload_source,
            training_plan=row.training_plan,
        )
        refresh_otjh_snapshot.assert_called_once_with(row)
        learner_activity_feed_entries.assert_called_once_with(row)
        self.assertEqual(row._prefetched_objects_cache, {})
        self.assertEqual(payload["ksbCompleted"], 2)
        self.assertEqual(payload["ksbTarget"], 3)
        self.assertEqual(payload["ksbProgress"], 67)
        self.assertEqual(payload["knowledgeCompleted"], 1)
        self.assertEqual(payload["knowledgeTarget"], 1)
        self.assertEqual(payload["skillsCompleted"], 1)
        self.assertEqual(payload["skillsTarget"], 1)
        self.assertEqual(payload["behavioursCompleted"], 0)
        self.assertEqual(payload["behavioursTarget"], 1)

    @patch("coach_api.views.learner_activity_feed_entries", return_value=[])
    @patch("coach_api.views.refresh_learner_ksb_snapshot")
    @patch("coach_api.views.refresh_learner_otjh_snapshot", return_value={})
    @patch("coach_api.views.curriculum_expected_otjh_by_component_id", return_value={})
    def test_serialize_caseload_learner_rolls_subcodes_up_to_parent_ksbs(
        self,
        curriculum_expected_lookup,
        refresh_otjh_snapshot,
        refresh_ksb_snapshot,
        learner_activity_feed_entries,
    ):
        row = SimpleNamespace(
            id=6,
            username="test learner",
            full_name="test learner",
            email="learner@example.com",
            coach_name="Med Maher",
            coach_email="Med.Maher@kentbusinesscollege.com",
            programme="Project Management",
            programme_status="Active",
            lifecycle_status="active",
            cohort="Cohort A",
            group="Group 1",
            start_date=None,
            end_date=None,
            gateway_review_date=None,
            coach_rag="",
            minimum_hours=Decimal("0"),
            planned_hours=Decimal("111"),
            completed_hours=Decimal("29"),
            target_hours=Decimal("41.5"),
            progress_hours=Decimal("-12.5"),
            progress_variance=Decimal("-0.30"),
            otjh_status="At risk",
            training_plan=[{
                "moduleId": "mod-1",
                "moduleTitle": "Module A",
                "weeks": [{
                    "weekId": "week-1",
                    "weekTitle": "Week 1",
                    "components": [{
                        "componentId": "component-1",
                        "componentTitle": "Stakeholder Workshop",
                    }],
                }],
            }],
            training_plan_progress=[
                {
                    "kind": "component",
                    "componentId": "component-1",
                    "reportedTime": "2h",
                    "submittedAt": "2026-08-02T10:00:00Z",
                    "ksbs": ["K3.1", "S1.2", "B2.2"],
                },
                {
                    "kind": "component",
                    "componentId": "component-1",
                    "reportedTime": "2h",
                    "submittedAt": "2026-08-02T11:00:00Z",
                    "ksbs": ["K3.1", "S1.2", "B2.2"],
                },
            ],
            ksbs=[],
            _prefetched_objects_cache={"assigned_ksbs": ["stale"]},
            _caseload_source=SimpleNamespace(id=6, programme="Project Management"),
            save=lambda **kwargs: None,
        )

        def apply_live_ksb_snapshot(learner, source, training_plan=None):
            learner.ksbs = [
                {"code": "K3", "type": "Knowledge", "description": "Stakeholder mapping"},
                {"code": "S1", "type": "Skills", "description": "Stakeholder communication"},
                {"code": "B2", "type": "Behaviours", "description": "Professional ownership"},
            ]
            return learner.ksbs

        refresh_ksb_snapshot.side_effect = apply_live_ksb_snapshot

        payload = serialize_caseload_learner(row)

        refresh_ksb_snapshot.assert_called_once_with(
            row,
            row._caseload_source,
            training_plan=row.training_plan,
        )
        refresh_otjh_snapshot.assert_called_once_with(row)
        learner_activity_feed_entries.assert_called_once_with(row)
        self.assertEqual(payload["ksbCompleted"], 3)
        self.assertEqual(payload["ksbTarget"], 3)
        self.assertEqual(payload["ksbProgress"], 100)
        self.assertEqual(payload["knowledgeCompleted"], 1)
        self.assertEqual(payload["knowledgeTarget"], 1)
        self.assertEqual(payload["skillsCompleted"], 1)
        self.assertEqual(payload["skillsTarget"], 1)
        self.assertEqual(payload["behavioursCompleted"], 1)
        self.assertEqual(payload["behavioursTarget"], 1)
        self.assertEqual(len(payload["otjhCompletedEntries"]), 1)
        self.assertEqual(payload["otjhCompletedEntries"][0]["title"], "Stakeholder Workshop")
        self.assertEqual(payload["otjhCompletedEntries"][0]["hours"], 2.0)
        self.assertEqual(payload["otjhCompletedEntries"][0]["completedDate"], "02 Aug 2026")
        self.assertEqual(payload["otjhCompletedEntries"][0]["ksbs"], ["B2", "K3", "S1"])
        self.assertEqual(payload["ksbCompletedDetailCount"], 3)
        self.assertEqual(
            [item["code"] for item in payload["ksbCompletedDetails"]],
            ["K3", "S1", "B2"],
        )
        for item in payload["ksbCompletedDetails"]:
            self.assertEqual(len(item["sources"]), 1)
            self.assertEqual(item["sources"][0]["title"], "Stakeholder Workshop")
            self.assertEqual(item["sources"][0]["module"], "Module A")
            self.assertEqual(item["sources"][0]["week"], "Week 1")
            self.assertEqual(item["sources"][0]["completedDate"], "02 Aug 2026")
