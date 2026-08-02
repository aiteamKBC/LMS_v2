from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from coach_api.models import CoachAbsenceReport
from coach_api.views import (
    build_monthly_activity_learner,
    reported_minutes,
    route_absence_report_evidence,
    serialize_caseload_learner,
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
    def test_reported_minutes_treats_bare_numbers_as_hours(self):
        self.assertEqual(reported_minutes("2"), 120.0)
        self.assertEqual(reported_minutes("2h"), 120.0)
        self.assertEqual(reported_minutes("1.5"), 90.0)
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
    def test_serialize_caseload_learner_rolls_subcodes_up_to_parent_ksbs(
        self,
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
