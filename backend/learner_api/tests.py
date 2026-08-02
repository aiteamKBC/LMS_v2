from datetime import date, datetime, timezone
from io import BytesIO
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .attendance import _summarize_attendance
from .evidence_storage import (
    blob_url,
    parse_blob_url,
    resolve_read_url,
    upload_to_quarantine,
)
from .models import _serialise_quiz_ref


class LearnerQuizReferenceTests(SimpleTestCase):
    def test_serialises_numeric_quiz_reference_without_breaking_text_ids(self):
        self.assertEqual(_serialise_quiz_ref("42"), 42)
        self.assertEqual(_serialise_quiz_ref("quiz-42"), "quiz-42")
        self.assertIsNone(_serialise_quiz_ref(None))


class AttendanceSummaryTests(SimpleTestCase):
    def test_summarizes_session_rows_for_the_learner_page(self):
        updated_at = datetime(2026, 7, 21, 14, 28, tzinfo=timezone.utc)
        common = {
            'learner_id': 2,
            'learner_name': 'Test Learner',
            'learner_email': 'learner@example.com',
            'catchup_completed': False,
            'updated_at': updated_at,
        }
        rows = [
            {**common, 'session_date': date(2026, 7, 15), 'attendance_status': 'absent', 'minutes_late': 0},
            {**common, 'session_date': date(2026, 7, 8), 'attendance_status': 'absent', 'minutes_late': 0, 'catchup_completed': True},
            {**common, 'session_date': date(2026, 7, 1), 'attendance_status': 'present', 'minutes_late': 12},
            {**common, 'session_date': date(2026, 6, 24), 'attendance_status': 'present', 'minutes_late': 0},
            {**common, 'session_date': date(2026, 6, 17), 'attendance_status': 'present', 'minutes_late': 0},
        ]

        summary = _summarize_attendance(rows)

        self.assertEqual(summary['sessions'], 5)
        self.assertEqual(summary['present'], 3)
        self.assertEqual(summary['absent'], 2)
        self.assertEqual(summary['late'], 1)
        self.assertEqual(summary['catchup'], 1)
        self.assertEqual(summary['attendanceRate'], 60)
        self.assertEqual(summary['risk'], 'red')
        self.assertEqual(summary['consecutiveMissed'], 2)
        self.assertEqual(summary['lastSessionDate'], '2026-07-15')
        self.assertEqual(summary['updatedAt'], '2026-07-21T14:28:00+00:00')

    def test_returns_none_without_session_rows(self):
        self.assertIsNone(_summarize_attendance([]))


@override_settings(
    AZURE_STORAGE_ACCOUNT="lmsstorage",
    AZURE_STORAGE_KEY="test-key",
    AZURE_QUARANTINE_CONTAINER="evidence-quarantine",
    AZURE_APPROVED_CONTAINER="evidence-approved",
    AZURE_REJECTED_CONTAINER="evidence-rejected",
    AZURE_SAS_TTL_MINUTES=15,
)
class EvidenceStorageUrlTests(SimpleTestCase):
    @patch("learner_api.evidence_storage._service_client")
    def test_upload_rewinds_file_before_sending_it_to_azure(self, service_client):
        upload = BytesIO(b"complete-file-content")
        upload.read()
        blob_client = (
            service_client.return_value
            .get_blob_client.return_value
        )

        upload_to_quarantine(upload, "absence-reports/file.png", "image/png")

        uploaded_stream = blob_client.upload_blob.call_args.args[0]
        self.assertEqual(b"complete-file-content", uploaded_stream.read())

    def test_canonical_url_round_trips_container_and_blob_name(self):
        url = blob_url(
            "evidence-quarantine",
            "absence-reports/apprenticeship/42/file name.pdf",
        )

        self.assertEqual(
            parse_blob_url(url),
            (
                "evidence-quarantine",
                "absence-reports/apprenticeship/42/file name.pdf",
            ),
        )
        self.assertIn("file%20name.pdf", url)

    def test_rejects_urls_from_another_storage_account(self):
        self.assertIsNone(
            parse_blob_url(
                "https://otheraccount.blob.core.windows.net/"
                "evidence-quarantine/file.pdf"
            )
        )

    @patch("learner_api.evidence_storage.generate_blob_sas", return_value="signed-token")
    def test_resolves_allowed_blob_to_short_lived_sas(self, generate_sas):
        stored_url = blob_url("evidence-quarantine", "absence-reports/file.pdf")

        result = resolve_read_url(stored_url, {"evidence-quarantine"})

        self.assertEqual(f"{stored_url}?signed-token", result)
        generate_sas.assert_called_once()

    def test_does_not_sign_blob_from_disallowed_container(self):
        stored_url = blob_url("evidence-rejected", "absence-reports/file.pdf")

        self.assertEqual("", resolve_read_url(stored_url, {"evidence-approved"}))

    def test_preserves_legacy_local_evidence_url(self):
        self.assertEqual(
            "/media/absence-evidence/legacy.pdf",
            resolve_read_url(
                "/media/absence-evidence/legacy.pdf",
                {"evidence-approved"},
            ),
        )
