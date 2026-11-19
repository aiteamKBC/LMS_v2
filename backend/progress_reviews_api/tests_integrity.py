import io
import json
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase


def _report(*, ok):
    count = 0 if ok else 1
    return {
        "ok": ok,
        "checks": {
            "completed_runs_without_pptx": {"count": count, "run_ids": []},
            "draft_runs_without_pptx": {"count": 0, "run_ids": []},
            "orphan_pptx_records": {"count": 0, "records": []},
            "invalid_canonical_learner_references": {"count": 0, "runs": []},
            "duplicate_pptx_records_per_run": {"count": 0, "runs": []},
            "missing_or_invalid_file_metadata": {"count": 0, "records": []},
        },
    }


class ProgressReviewIntegrityCommandTests(SimpleTestCase):
    @patch(
        "progress_reviews_api.management.commands.check_progress_review_integrity.build_integrity_report",
        return_value=_report(ok=True),
    )
    def test_clean_restore_report_exits_successfully(self, mock_report):
        stdout = io.StringIO()

        call_command("check_progress_review_integrity", stdout=stdout)

        self.assertIn("PASS completed_runs_without_pptx: 0", stdout.getvalue())
        self.assertIn("Progress Review integrity check passed.", stdout.getvalue())

    @patch(
        "progress_reviews_api.management.commands.check_progress_review_integrity.build_integrity_report",
        return_value=_report(ok=False),
    )
    def test_integrity_failure_returns_nonzero_and_json_details(self, mock_report):
        stdout = io.StringIO()

        with self.assertRaises(CommandError):
            call_command("check_progress_review_integrity", "--json", stdout=stdout)

        payload = json.loads(stdout.getvalue())
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["checks"]["completed_runs_without_pptx"]["count"], 1)

