from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase, override_settings

from learner_api import aptem_review_pdf as resolver


def imported_review(review_type="Monthly Coaching Meeting"):
    return {
        "id": "3195",
        "learnerId": 422,
        "aptemLearnerId": "6320",
        "aptemReviewId": "8671",
        "type": review_type,
    }


def direct_row(**overrides):
    row = {
        "learner_id": 422,
        "aptem_learner_id": 6320,
        "document_type": "Monthly Coaching Meeting",
        "status": "uploaded",
        "mapping_status": "aptem_id",
        "review_match_status": "matched_pdf_type_dates",
        "original_filename": "Review.pdf",
        "source_url": "https://kentbusinesscollege.aptem.co.uk/document/54801",
        "source_hash": "source-hash",
        "verified_at": datetime(2026, 10, 1, tzinfo=timezone.utc),
        "azure_account_url": "https://kbcdocs.blob.core.windows.net",
        "azure_container": "reviews",
        "azure_blob_name": "original-review-pdfs/8671.pdf",
        "file_size": 104633,
    }
    row.update(overrides)
    return tuple(row[key] for key in (
        "learner_id", "aptem_learner_id", "document_type", "status",
        "mapping_status", "review_match_status", "original_filename", "source_url", "source_hash",
        "verified_at", "azure_account_url", "azure_container",
        "azure_blob_name", "file_size",
    ))


class DirectReviewDocumentTests(SimpleTestCase):
    @override_settings(AZURE_STORAGE_ACCOUNT="kbcdocs")
    def test_8671_direct_document_is_validated_and_duplicate_rows_collapse(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            direct_row(),
            direct_row(),
        ]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch.object(resolver, "connections") as connections:
            connections.__getitem__.return_value = connection
            locations = resolver._direct_pdf_locations(imported_review())

        self.assertEqual(locations, {("reviews", "original-review-pdfs/8671.pdf")})
        cursor.execute.assert_called_once()

    @override_settings(AZURE_STORAGE_ACCOUNT="kbcdocs")
    def test_direct_document_identity_and_provenance_are_rechecked(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [
            direct_row(learner_id=999),
            direct_row(document_type="Progress Review"),
            direct_row(review_match_status="ambiguous_review"),
            direct_row(source_hash=""),
            direct_row(file_size="not-a-size"),
        ]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor

        with patch.object(resolver, "connections") as connections:
            connections.__getitem__.return_value = connection
            locations = resolver._direct_pdf_locations(imported_review())

        self.assertEqual(locations, set())

    def test_direct_unique_is_used_before_probe(self):
        with (
            patch.object(resolver, "_direct_pdf_locations", return_value={("reviews", "direct.pdf")}),
            patch.object(resolver, "_read_verified_pdf", return_value=b"%PDF-direct") as read_pdf,
            patch.object(resolver, "_probe_pdf_locations") as probe,
        ):
            content = resolver.original_review_pdf(imported_review())

        self.assertEqual(content, b"%PDF-direct")
        read_pdf.assert_called_once_with(("reviews", "direct.pdf"))
        probe.assert_not_called()

    def test_direct_blob_missing_falls_back_to_probe(self):
        with (
            patch.object(resolver, "_direct_pdf_locations", return_value={("reviews", "direct.pdf")}),
            patch.object(resolver, "_probe_pdf_locations", return_value={("reviews", "probe.pdf")}),
            patch.object(resolver, "_read_verified_pdf", side_effect=[None, b"%PDF-probe"]),
        ):
            content = resolver.original_review_pdf(imported_review())

        self.assertEqual(content, b"%PDF-probe")

    def test_ambiguous_direct_mapping_falls_back_to_unique_probe(self):
        with (
            patch.object(resolver, "_direct_pdf_locations", return_value={
                ("reviews", "first.pdf"), ("reviews", "second.pdf"),
            }),
            patch.object(resolver, "_probe_pdf_locations", return_value={("reviews", "probe.pdf")}),
            patch.object(resolver, "_read_verified_pdf", return_value=b"%PDF-probe"),
        ):
            content = resolver.original_review_pdf(imported_review())

        self.assertEqual(content, b"%PDF-probe")

    def test_ambiguous_direct_mapping_without_probe_is_unavailable(self):
        with (
            patch.object(resolver, "_direct_pdf_locations", return_value={
                ("reviews", "first.pdf"), ("reviews", "second.pdf"),
            }),
            patch.object(resolver, "_probe_pdf_locations", return_value=set()),
            patch.object(resolver, "_read_verified_pdf") as read_pdf,
        ):
            content = resolver.original_review_pdf(imported_review())

        self.assertIsNone(content)
        read_pdf.assert_not_called()

    def test_progress_review_families_use_the_same_direct_resolver(self):
        for review_type in ("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"):
            with self.subTest(review_type=review_type):
                with (
                    patch.object(resolver, "_direct_pdf_locations", return_value={("reviews", "direct.pdf")}),
                    patch.object(resolver, "_read_verified_pdf", return_value=b"%PDF-direct"),
                    patch.object(resolver, "_probe_pdf_locations") as probe,
                ):
                    content = resolver.original_review_pdf(imported_review(review_type))

                self.assertEqual(content, b"%PDF-direct")
                probe.assert_not_called()

    def test_probe_only_review_remains_supported(self):
        with (
            patch.object(resolver, "_direct_pdf_locations", return_value=set()),
            patch.object(resolver, "_probe_pdf_locations", return_value={("reviews", "probe.pdf")}),
            patch.object(resolver, "_read_verified_pdf", return_value=b"%PDF-probe"),
        ):
            content = resolver.original_review_pdf(imported_review())

        self.assertEqual(content, b"%PDF-probe")
