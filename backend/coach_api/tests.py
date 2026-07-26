from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from coach_api.models import CoachAbsenceReport
from coach_api.views import route_absence_report_evidence


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
