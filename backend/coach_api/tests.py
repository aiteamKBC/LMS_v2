from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from coach_api.models import CoachAbsenceReport
from coach_api.views import build_monthly_activity_learner, route_absence_report_evidence


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
