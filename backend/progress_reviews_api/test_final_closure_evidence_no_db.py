"""Database-free regression coverage for final F05-F07 closure.

The Progress Review projection must reuse Evidence's canonical batch marking
resolver without changing its public pack fields, ordering, or fail-closed
behavior.
"""

from datetime import date
from unittest.mock import patch

from django.test import SimpleTestCase

from .period import build_review_period
from .review_pack import NOT_AVAILABLE, _build_evidence_sections
from .tests_review_pack import EVIDENCE_COLUMNS, _FakeConnection, _FakeCursor


class ProgressReviewEvidenceBatchingTests(SimpleTestCase):
    def setUp(self):
        self.period = build_review_period(date(2026, 6, 15), review_number=1)

    @staticmethod
    def _row(
        evidence_id,
        *,
        section_ref,
        uploaded_at,
        filename="brief.pdf",
        content_type="application/pdf",
        status="approved",
        details=None,
        component_ref=None,
        progress_entry_id=None,
    ):
        return (
            evidence_id,
            filename,
            content_type,
            1024,
            status,
            "clean",
            section_ref,
            uploaded_at,
            details or {},
            component_ref,
            progress_entry_id,
            "evidence-approved",
            f"42/{filename}",
        )

    @patch("learner_api.evidence_storage.azure_configured", return_value=False)
    @patch(
        "learner_api.evidence._marking_statuses",
        return_value={"comp-1": "accepted", "comp-2": "submitted_for_tutor_review"},
    )
    def test_uses_one_bulk_marking_lookup_and_preserves_exact_projection(
        self, mock_statuses, mock_azure_configured,
    ):
        rows = [
            self._row(
                "ev-1",
                section_ref="comp-1",
                uploaded_at=date(2026, 5, 1),
                filename="photo.png",
                content_type="image/png",
                details={"componentTitle": "Site photo", "ksbCodes": ["K1"]},
                component_ref="comp-1",
                progress_entry_id=10,
            ),
            self._row(
                "ev-2",
                section_ref="comp-1",
                uploaded_at=date(2026, 5, 2),
                filename="notes.pdf",
                status="pending",
                details={"componentTitle": "Project notes"},
            ),
            self._row(
                "ev-3",
                section_ref="comp-2",
                uploaded_at=date(2026, 5, 3),
                filename="report.pdf",
                details='{"componentTitle":"Final report","ksbCodes":["S2"]}',
                component_ref="comp-2",
            ),
            self._row(
                "outside",
                section_ref="comp-old",
                uploaded_at=date(2025, 1, 1),
            ),
        ]
        cursor = _FakeCursor(EVIDENCE_COLUMNS, rows)

        with patch("django.db.connections", {"enrolment": _FakeConnection(cursor)}):
            warnings = []
            evidence, assignments, workplace = _build_evidence_sections(
                "apprenticeship", 42, self.period, warnings,
            )

        mock_statuses.assert_called_once_with("apprenticeship", 42, ["comp-1", "comp-2"])
        self.assertEqual(len(cursor.statements), 1)
        self.assertEqual(
            evidence,
            [
                {
                    "evidence_title": "photo.png",
                    "evidence_date": "2026-05-01",
                    "evidence_type": "image/png",
                    "evidence_status": "approved",
                    "evidence_summary": "Site photo",
                    "evidence_file_link": NOT_AVAILABLE,
                    "image_or_screenshot_link": "blob:evidence-approved/42/photo.png",
                    "manager_verification_status": "accepted",
                    "ai_classification_summary": NOT_AVAILABLE,
                    "ksb_mappings": ["K1"],
                    "evidence_strength": "strong",
                },
                {
                    "evidence_title": "notes.pdf",
                    "evidence_date": "2026-05-02",
                    "evidence_type": "application/pdf",
                    "evidence_status": "pending",
                    "evidence_summary": "Project notes",
                    "evidence_file_link": NOT_AVAILABLE,
                    "image_or_screenshot_link": NOT_AVAILABLE,
                    "manager_verification_status": "accepted",
                    "ai_classification_summary": NOT_AVAILABLE,
                    "ksb_mappings": [],
                    "evidence_strength": "strong",
                },
                {
                    "evidence_title": "report.pdf",
                    "evidence_date": "2026-05-03",
                    "evidence_type": "application/pdf",
                    "evidence_status": "approved",
                    "evidence_summary": "Final report",
                    "evidence_file_link": NOT_AVAILABLE,
                    "image_or_screenshot_link": NOT_AVAILABLE,
                    "manager_verification_status": "submitted_for_tutor_review",
                    "ai_classification_summary": NOT_AVAILABLE,
                    "ksb_mappings": ["S2"],
                    "evidence_strength": "unverified",
                },
            ],
        )
        self.assertEqual([item["evidence_title"] for item in assignments], ["photo.png", "report.pdf"])
        self.assertEqual([item["evidence_title"] for item in workplace], ["notes.pdf"])
        self.assertNotIn("outside", str(evidence))
        self.assertEqual(warnings, [])

    @patch("learner_api.evidence_storage.azure_configured", return_value=False)
    @patch("learner_api.evidence._marking_statuses", side_effect=RuntimeError("synthetic failure"))
    def test_bulk_lookup_failure_remains_fail_closed(
        self, mock_statuses, mock_azure_configured,
    ):
        row = self._row(
            "ev-1",
            section_ref="comp-1",
            uploaded_at=date(2026, 5, 1),
            status="pending",
        )
        cursor = _FakeCursor(EVIDENCE_COLUMNS, [row])

        with patch("django.db.connections", {"enrolment": _FakeConnection(cursor)}):
            evidence, _assignments, _workplace = _build_evidence_sections(
                "apprenticeship", 42, self.period, [],
            )

        mock_statuses.assert_called_once()
        self.assertEqual(evidence[0]["manager_verification_status"], "unknown")
        self.assertEqual(evidence[0]["evidence_strength"], "pending")

    @patch("learner_api.evidence_storage.azure_configured", return_value=False)
    @patch("learner_api.evidence._marking_statuses")
    def test_no_lookup_when_no_evidence_survives_period_filter(
        self, mock_statuses, mock_azure_configured,
    ):
        row = self._row(
            "outside",
            section_ref="comp-old",
            uploaded_at=date(2025, 1, 1),
        )
        cursor = _FakeCursor(EVIDENCE_COLUMNS, [row])
        warnings = []

        with patch("django.db.connections", {"enrolment": _FakeConnection(cursor)}):
            result = _build_evidence_sections("apprenticeship", 42, self.period, warnings)

        mock_statuses.assert_not_called()
        self.assertEqual(result, ([], [], []))
        self.assertEqual(warnings, ["No evidence was uploaded inside this review period."])
