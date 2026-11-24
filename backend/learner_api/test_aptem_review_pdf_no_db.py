import hashlib
import json
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
        "file_size": len(b"%PDF-verified"),
        "sha256": hashlib.sha256(b"%PDF-verified").hexdigest(),
        "pdf_metadata": {},
        "aptem_document_id": 54801,
        "review_id": 3195,
    }
    row.update(overrides)
    return tuple(row[key] for key in (
        "learner_id", "aptem_learner_id", "document_type", "status",
        "mapping_status", "review_match_status", "original_filename", "source_url", "source_hash",
        "verified_at", "azure_account_url", "azure_container",
        "azure_blob_name", "file_size", "sha256", "pdf_metadata", "aptem_document_id", "review_id",
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

        self.assertEqual(locations, {("reviews", "original-review-pdfs/8671.pdf",
                                     hashlib.sha256(b"%PDF-verified").hexdigest(), len(b"%PDF-verified"))})
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


@override_settings(AZURE_STORAGE_ACCOUNT="kbcdocs")
class VerifiedArchiveTests(SimpleTestCase):
    content = b"%PDF-verified"

    def proof(self, **overrides):
        proof = {
            "method": "aptem_review_document_sha256_v1",
            "learner_id": 422, "aptem_learner_id": 6320,
            "review_id": 3195, "aptem_review_id": "8671",
            "aptem_document_id": 54801,
            "sha256": hashlib.sha256(self.content).hexdigest(),
            "file_size": len(self.content), "checked_at": "2026-10-01T12:00:00Z",
        }
        proof.update(overrides)
        return proof

    def resolve(self, rows):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = rows
        with patch.object(resolver, "connections") as connections:
            connections.__getitem__.return_value = connection
            result = resolver._direct_pdf_locations(imported_review())
        self.assertEqual(cursor.execute.call_args.args[1], [3195])
        return result

    def sha_row(self, proof=None, **overrides):
        return direct_row(
            review_match_status="matched_aptem_document_sha256",
            pdf_metadata={"review_link_proof": self.proof() if proof is None else proof},
            **overrides,
        )

    def test_both_matching_statuses_resolve_and_verify_actual_bytes(self):
        for row in (direct_row(), self.sha_row()):
            with self.subTest(row=row):
                locations = self.resolve([row])
                self.assertEqual(len(locations), 1)
                with patch("learner_api.evidence_storage.download_blob_bytes", return_value=self.content):
                    self.assertEqual(resolver._read_verified_pdf(next(iter(locations))), self.content)

    def test_raw_postgresql_jsonb_provenance_is_verified(self):
        # Django's raw PostgreSQL cursor returns JSONB text, unlike ORM JSONField.
        metadata = json.dumps({"review_link_proof": self.proof()})
        row = direct_row(review_match_status="matched_aptem_document_sha256",
                         pdf_metadata=metadata)
        self.assertEqual(len(self.resolve([row])), 1)

    def test_json_metadata_requires_an_object_and_valid_provenance(self):
        invalid = [None, [], {}, 1, True, "nested string",
                   {"review_link_proof": []}, {"review_link_proof": "invalid"}]
        for field in self.proof():
            proof = self.proof()
            del proof[field]
            invalid.append({"review_link_proof": proof})
        for field, value in {
            "learner_id": 999, "aptem_learner_id": 999, "review_id": 999,
            "aptem_review_id": "999", "aptem_document_id": 999,
            "sha256": "0" * 64, "file_size": 999, "method": "unverified",
        }.items():
            invalid.append({"review_link_proof": self.proof(**{field: value})})
        for metadata in ["{broken", "", "[" * 2000] + [json.dumps(item) for item in invalid]:
            with self.subTest(metadata=metadata[:80]):
                row = direct_row(review_match_status="matched_aptem_document_sha256",
                                 pdf_metadata=metadata)
                self.assertEqual(self.resolve([row]), set())

    def test_sha_proof_rejects_each_missing_field(self):
        for field in self.proof():
            with self.subTest(field=field):
                proof = self.proof()
                del proof[field]
                self.assertEqual(self.resolve([self.sha_row(proof)]), set())

    def test_sha_proof_rejects_wrong_associations_and_invalid_values(self):
        invalid = {
            "method": "unverified", "learner_id": 999, "aptem_learner_id": 999,
            "review_id": 999, "aptem_review_id": "999", "aptem_document_id": 999,
            "sha256": "0" * 64, "file_size": 999, "checked_at": "invalid",
        }
        for field, value in invalid.items():
            with self.subTest(field=field):
                self.assertEqual(self.resolve([self.sha_row(self.proof(**{field: value}))]), set())
        for metadata in (None, [], {}, {"review_link_proof": "invalid"}):
            self.assertEqual(self.resolve([direct_row(
                review_match_status="matched_aptem_document_sha256", pdf_metadata=metadata)]), set())

    def test_existing_security_checks_apply_to_both_statuses(self):
        invalid = {
            "learner_id": 999, "aptem_learner_id": 999, "review_id": 999,
            "document_type": "Other", "status": "pending", "mapping_status": "name",
            "original_filename": "not.pdf.exe", "source_url": "file:///private",
            "source_hash": "", "verified_at": None, "file_size": 0,
            "azure_account_url": "https://other.blob.core.windows.net",
            "azure_container": "", "azure_blob_name": "", "sha256": "invalid",
        }
        for factory in (direct_row, self.sha_row):
            for field, value in invalid.items():
                with self.subTest(factory=factory.__name__, field=field):
                    self.assertEqual(self.resolve([factory(**{field: value})]), set())
        self.assertEqual(self.resolve([self.sha_row(aptem_document_id=999)]), set())

    def test_missing_or_corrupt_downloads_fail_closed(self):
        location = next(iter(self.resolve([self.sha_row()])))
        for data in (None, b"", b"not a pdf", b"%PDF-tampered", self.content + b"extra"):
            with self.subTest(data=data):
                with patch("learner_api.evidence_storage.download_blob_bytes", return_value=data):
                    self.assertIsNone(resolver._read_verified_pdf(location))
        with patch("learner_api.evidence_storage.download_blob_bytes", side_effect=FileNotFoundError):
            self.assertIsNone(resolver._read_verified_pdf(location))

    def test_checksum_and_size_are_independently_enforced(self):
        for digest, size in (("0" * 64, len(self.content)),
                             (hashlib.sha256(self.content).hexdigest(), len(self.content) + 1)):
            with self.subTest(digest=digest, size=size):
                with patch("learner_api.evidence_storage.download_blob_bytes", return_value=self.content):
                    self.assertIsNone(resolver._read_verified_pdf(("reviews", "a.pdf", digest, size)))

    def test_legacy_missing_checksum_still_enforces_size(self):
        locations = self.resolve([direct_row(sha256=None)])
        self.assertEqual(len(locations), 1)
        with patch("learner_api.evidence_storage.download_blob_bytes", return_value=self.content):
            self.assertEqual(resolver._read_verified_pdf(next(iter(locations))), self.content)
        self.assertEqual(self.resolve([self.sha_row(sha256=None)]), set())

    def test_multiple_distinct_verified_documents_remain_ambiguous(self):
        locations = self.resolve([direct_row(), self.sha_row(azure_blob_name="other.pdf")])
        self.assertEqual(len(locations), 2)
        with (patch.object(resolver, "_direct_pdf_locations", return_value=locations),
              patch.object(resolver, "_probe_pdf_locations", return_value=set()),
              patch("learner_api.evidence_storage.download_blob_bytes") as download):
            self.assertIsNone(resolver.original_review_pdf(imported_review()))
            download.assert_not_called()

    def test_probe_cannot_bypass_same_blob_checksum_failure(self):
        locations = self.resolve([self.sha_row()])
        probe = {next(iter(locations))[:2]}
        with (patch.object(resolver, "_direct_pdf_locations", return_value=locations),
              patch.object(resolver, "_probe_pdf_locations", return_value=probe),
              patch("learner_api.evidence_storage.download_blob_bytes", return_value=b"%PDF-tampered")):
            self.assertIsNone(resolver.original_review_pdf(imported_review()))

    def test_conflicting_archive_checksums_cannot_be_bypassed_by_probe(self):
        locations = self.resolve([direct_row(), direct_row(sha256="0" * 64)])
        with (patch.object(resolver, "_direct_pdf_locations", return_value=locations),
              patch.object(resolver, "_probe_pdf_locations", return_value={next(iter(locations))[:2]}),
              patch("learner_api.evidence_storage.download_blob_bytes") as download):
            self.assertIsNone(resolver.original_review_pdf(imported_review()))
            download.assert_not_called()
