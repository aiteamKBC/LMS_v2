import json
import os
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

from django.test import Client, SimpleTestCase, override_settings

from .views import GenerationError, _generate_for_learner, _programme_window, _slugify

SUCCESS_PACK = {
    "learner": {"full_name": "Jordan Example", "active_status": True},
    "source_warnings": ["Attendance register could not be reached."],
}
INACTIVE_PACK = {
    "learner": {"full_name": "Jordan Example", "active_status": False},
    "source_warnings": [],
}


def _disable_auth():
    return patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "0"})


class SlugifyTests(SimpleTestCase):
    def test_collapses_punctuation_to_single_hyphens(self):
        self.assertEqual(_slugify("Bethanie Taylor-Grenfell!!"), "bethanie-taylor-grenfell")

    def test_blank_name_falls_back_to_learner(self):
        self.assertEqual(_slugify(""), "learner")
        self.assertEqual(_slugify(None), "learner")


class ProgrammeWindowTests(SimpleTestCase):
    @patch("learner_api.identity.learner_profile_for_source")
    @patch("learner_api.models.EnrolmentUser")
    def test_missing_learner_returns_all_none(self, mock_model, mock_profile_lookup):
        mock_model.DoesNotExist = Exception
        mock_model.all_learners.get.side_effect = mock_model.DoesNotExist
        start, end, kind, source = _programme_window(999)
        self.assertEqual((start, end, kind, source), (None, None, None, None))

    @patch("learner_api.identity.learner_profile_for_source")
    @patch("learner_api.models.EnrolmentUser")
    def test_profile_dates_take_priority_over_enrolment_user_dates(self, mock_model, mock_profile_lookup):
        source = MagicMock(start_date="2020-01-01", end_date="2020-12-31", learner_type="apprenticeship")
        mock_model.DoesNotExist = Exception
        mock_model.all_learners.get.return_value = source
        mock_profile_lookup.return_value = MagicMock(start_date=date(2025, 1, 1), end_date=date(2026, 6, 30))

        start, end, kind, resolved_source = _programme_window(1)

        self.assertEqual(start, date(2025, 1, 1))
        self.assertEqual(end, date(2026, 6, 30))
        self.assertEqual(kind, "apprenticeship")
        self.assertIs(resolved_source, source)


class GenerateForLearnerTests(SimpleTestCase):
    def setUp(self):
        patcher = patch("progress_reviews_api.views._programme_window")
        self.mock_window = patcher.start()
        self.addCleanup(patcher.stop)
        self.mock_window.return_value = (date(2025, 1, 1), date(2026, 6, 30), "apprenticeship", MagicMock())

        for name in ("create_run", "insert_snapshot", "save_warnings", "mark_run_completed", "mark_run_failed", "insert_pptx_file"):
            patcher = patch(f"progress_reviews_api.views.runs.{name}")
            setattr(self, f"mock_{name}", patcher.start())
            self.addCleanup(patcher.stop)

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.generate_progress_review_pptx", return_value=b"PPTX-BYTES")
    @patch("progress_reviews_api.views.build_review_pack", return_value=SUCCESS_PACK)
    def test_happy_path_returns_a_completed_result(self, mock_build_pack, mock_generate_pptx, mock_storage):
        mock_storage.storage_configured.return_value = True

        result = _generate_for_learner(42, generated_by="coach@kbc.example")

        self.assertEqual(result["generationStatus"], "completed")
        self.assertEqual(result["learnerId"], 42)
        self.assertIn("downloadUrl", result)
        self.mock_insert_pptx_file.assert_called_once()
        self.mock_mark_run_completed.assert_called_once()
        self.mock_mark_run_failed.assert_not_called()

    def test_no_programme_start_date_raises_422(self):
        self.mock_window.return_value = (None, None, "apprenticeship", MagicMock())
        with self.assertRaises(GenerationError) as ctx:
            _generate_for_learner(42)
        self.assertEqual(ctx.exception.status, 422)

    def test_unresolvable_learner_raises_404(self):
        self.mock_window.return_value = (None, None, None, None)
        with self.assertRaises(GenerationError) as ctx:
            _generate_for_learner(999)
        self.assertEqual(ctx.exception.status, 404)

    @patch("progress_reviews_api.views.build_review_pack", return_value=INACTIVE_PACK)
    def test_inactive_learner_raises_409_and_never_creates_a_run(self, mock_build_pack):
        with self.assertRaises(GenerationError) as ctx:
            _generate_for_learner(42)
        self.assertEqual(ctx.exception.status, 409)
        self.mock_create_run.assert_not_called()

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.build_review_pack", return_value=SUCCESS_PACK)
    def test_storage_not_configured_marks_the_run_failed(self, mock_build_pack, mock_storage):
        mock_storage.storage_configured.return_value = False
        with self.assertRaises(GenerationError) as ctx:
            _generate_for_learner(42)
        self.assertEqual(ctx.exception.status, 503)
        self.mock_mark_run_failed.assert_called_once()

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.generate_progress_review_pptx", side_effect=RuntimeError("boom"))
    @patch("progress_reviews_api.views.build_review_pack", return_value=SUCCESS_PACK)
    def test_pptx_generation_failure_marks_the_run_failed(self, mock_build_pack, mock_generate_pptx, mock_storage):
        with self.assertRaises(GenerationError) as ctx:
            _generate_for_learner(42)
        self.assertEqual(ctx.exception.status, 500)
        self.mock_mark_run_failed.assert_called_once()

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.generate_progress_review_pptx", return_value=b"PPTX-BYTES")
    @patch("progress_reviews_api.views.build_review_pack", return_value=SUCCESS_PACK)
    def test_upload_failure_marks_the_run_failed(self, mock_build_pack, mock_generate_pptx, mock_storage):
        mock_storage.storage_configured.return_value = True
        mock_storage.upload_pptx.side_effect = RuntimeError("azure unreachable")
        with self.assertRaises(GenerationError) as ctx:
            _generate_for_learner(42)
        self.assertEqual(ctx.exception.status, 502)
        self.mock_mark_run_failed.assert_called_once()


@override_settings(ROOT_URLCONF="config.urls")
class EndpointTests(SimpleTestCase):
    def setUp(self):
        self.client = Client()
        self.env_patcher = _disable_auth()
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    @patch("progress_reviews_api.views._generate_for_learner")
    def test_generate_endpoint_returns_201_on_success(self, mock_generate):
        mock_generate.return_value = {"reviewId": "run-1", "generationStatus": "completed"}
        response = self.client.post("/api/progress-reviews/42/generate/", data={}, content_type="application/json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(json.loads(response.content)["reviewId"], "run-1")

    @patch("progress_reviews_api.views._generate_for_learner", side_effect=GenerationError("Not active.", 409))
    def test_generate_endpoint_surfaces_generation_error_status(self, mock_generate):
        response = self.client.post("/api/progress-reviews/42/generate/", data={}, content_type="application/json")
        self.assertEqual(response.status_code, 409)

    def test_generate_endpoint_rejects_invalid_json(self):
        response = self.client.post("/api/progress-reviews/42/generate/", data=b"not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.runs")
    def test_download_endpoint_returns_a_url_for_a_completed_run(self, mock_runs, mock_storage):
        mock_runs.get_run.return_value = {"id": "run-1", "generation_status": "completed"}
        mock_runs.get_pptx_file_for_run.return_value = {
            "container": "progress-review-decks", "blob_name": "a/b/c.pptx", "original_filename": "deck.pptx",
        }
        mock_storage.storage_configured.return_value = True
        mock_storage.download_sas_for.return_value = "https://example.blob.core.windows.net/deck.pptx?sig=..."

        response = self.client.get("/api/progress-reviews/run-1/download/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("url", json.loads(response.content))

    @patch("progress_reviews_api.views.runs")
    def test_download_endpoint_404s_for_an_unknown_run(self, mock_runs):
        mock_runs.get_run.return_value = None
        response = self.client.get("/api/progress-reviews/does-not-exist/download/")
        self.assertEqual(response.status_code, 404)

    def test_latest_run_endpoint_requires_a_review_date(self):
        response = self.client.get("/api/progress-reviews/42/runs/latest/")
        self.assertEqual(response.status_code, 400)

    @patch("progress_reviews_api.views.runs")
    def test_latest_run_endpoint_reports_no_existing_deck(self, mock_runs):
        mock_runs.get_latest_run_for_period.return_value = None
        response = self.client.get("/api/progress-reviews/42/runs/latest/?review_date=2026-10-26")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"exists": False})
        mock_runs.get_latest_run_for_period.assert_called_once_with(42, date(2026, 10, 26))

    @patch("progress_reviews_api.views.runs")
    def test_latest_run_endpoint_reports_an_existing_deck(self, mock_runs):
        mock_runs.get_latest_run_for_period.return_value = {
            "id": "run-1", "generation_status": "completed",
            "generated_at": datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc), "created_at": None,
        }
        response = self.client.get("/api/progress-reviews/42/runs/latest/?review_date=2026-10-26")
        body = json.loads(response.content)
        self.assertEqual(body["exists"], True)
        self.assertEqual(body["reviewId"], "run-1")
        self.assertEqual(body["generationStatus"], "completed")

    @patch("progress_reviews_api.views.runs")
    def test_latest_run_endpoint_scopes_strictly_to_the_requested_review_date(self, mock_runs):
        """Regression guard: a learner's second review must never show as
        already generated just because their first review's deck exists."""
        mock_runs.get_latest_run_for_period.return_value = None
        self.client.get("/api/progress-reviews/42/runs/latest/?review_date=2027-01-18")
        mock_runs.get_latest_run_for_period.assert_called_once_with(42, date(2027, 1, 18))

    @patch("progress_reviews_api.views._generate_for_learner")
    def test_bulk_generate_isolates_one_learner_failure_from_the_rest(self, mock_generate):
        def side_effect(learner_id, **kwargs):
            if learner_id == 2:
                raise GenerationError("Only active learners.", 409)
            return {"reviewId": f"run-{learner_id}", "learnerId": learner_id, "generationStatus": "completed"}

        mock_generate.side_effect = side_effect
        response = self.client.post(
            "/api/progress-reviews/bulk-generate/",
            data=json.dumps({"learner_ids": [1, 2, 3]}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        results = json.loads(response.content)["results"]
        statuses = {r["learnerId"]: r["generationStatus"] for r in results}
        self.assertEqual(statuses, {1: "completed", 2: "failed", 3: "completed"})
