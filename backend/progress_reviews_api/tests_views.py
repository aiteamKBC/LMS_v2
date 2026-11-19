import json
import os
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import Client, SimpleTestCase, override_settings

from .identity import LearnerIdentity, LearnerIdentityError
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


def _identity(profile_id=501, enrolment_id=42, *, learner_type="apprenticeship"):
    profile = MagicMock(start_date=date(2025, 1, 1), end_date=date(2026, 6, 30))
    profile.pk = profile_id
    profile.enrolment_id = enrolment_id
    source = MagicMock(
        id=enrolment_id,
        pk=enrolment_id,
        start_date="2020-01-01",
        end_date="2020-12-31",
        learner_type=learner_type,
    )
    kind = "commercial" if learner_type == "commercial" else "apprenticeship"
    return LearnerIdentity(profile_id, enrolment_id, kind, profile, source)


class SlugifyTests(SimpleTestCase):
    def test_collapses_punctuation_to_single_hyphens(self):
        self.assertEqual(_slugify("Bethanie Taylor-Grenfell!!"), "bethanie-taylor-grenfell")

    def test_blank_name_falls_back_to_learner(self):
        self.assertEqual(_slugify(""), "learner")
        self.assertEqual(_slugify(None), "learner")


class ProgrammeWindowTests(SimpleTestCase):
    def test_the_learners_own_start_date_beats_the_cohort_stamped_profile(self):
        """enrolment."Created_users"."Start_date" is the learner's OWN date;
        LearnerProfile.start_date is the profile mirror, which
        active_users.mirror_learner_placement stamps with the COHORT window on
        every placement edit. Review periods must anchor on the same date the
        coach calendar anchors its Progress Review occurrences on, or the pack
        covers a window the review it belongs to never had."""
        identity = _identity()

        start, end, kind, resolved_source = _programme_window(identity)

        self.assertEqual(start, date(2020, 1, 1))
        # End date keeps its existing preference: the profile's real DateField
        # first, since that is the delivery window the learner is measured to.
        self.assertEqual(end, date(2026, 6, 30))
        self.assertEqual(kind, "apprenticeship")
        self.assertIs(resolved_source, identity.source)

    def test_the_profile_still_fills_in_when_the_learner_has_no_date(self):
        identity = _identity(learner_type="commercial")
        identity.source.start_date = ""
        identity.source.end_date = ""

        start, _end, _kind, _source = _programme_window(identity)

        self.assertEqual(start, date(2025, 1, 1))


class GenerateForLearnerTests(SimpleTestCase):
    def setUp(self):
        self.identity = _identity()
        patcher = patch(
            "progress_reviews_api.views.identity_from_enrolment_id",
            return_value=self.identity,
        )
        self.mock_identity = patcher.start()
        self.addCleanup(patcher.stop)

        patcher = patch("progress_reviews_api.views._programme_window")
        self.mock_window = patcher.start()
        self.addCleanup(patcher.stop)
        self.mock_window.return_value = (date(2025, 1, 1), date(2026, 6, 30), "apprenticeship", MagicMock())

        for name in ("create_run", "insert_snapshot", "save_warnings", "mark_run_completed", "mark_run_draft", "mark_run_failed", "insert_pptx_file"):
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
        self.mock_create_run.assert_called_once()
        create_kwargs = self.mock_create_run.call_args.kwargs
        self.assertEqual(create_kwargs["learner_id"], 501)
        self.assertNotIn("learner_profile_id", create_kwargs)
        self.assertNotIn("legacy_learner_id", create_kwargs)
        self.mock_insert_pptx_file.assert_called_once()
        self.mock_mark_run_completed.assert_called_once()
        self.mock_mark_run_failed.assert_not_called()

    def test_no_programme_start_date_raises_422(self):
        self.mock_window.return_value = (None, None, "apprenticeship", MagicMock())
        with self.assertRaises(GenerationError) as ctx:
            _generate_for_learner(42)
        self.assertEqual(ctx.exception.status, 422)

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.generate_progress_review_pptx", return_value=b"PPTX-BYTES")
    @patch("progress_reviews_api.views.build_review_pack", return_value=SUCCESS_PACK)
    def test_draft_generation_stores_the_deck_without_publishing_it(self, mock_build_pack, mock_generate_pptx, mock_storage):
        mock_storage.storage_configured.return_value = True

        result = _generate_for_learner(42, generated_by="coach@kbc.example", save_as_draft=True)

        self.assertEqual(result["generationStatus"], "draft")
        self.mock_mark_run_draft.assert_called_once()
        self.mock_mark_run_completed.assert_not_called()

    def test_unresolvable_learner_raises_404(self):
        self.mock_identity.side_effect = LearnerIdentityError("missing")
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
        self.identity = _identity()
        for target in (
            "progress_reviews_api.permissions.identity_from_enrolment_id",
            "progress_reviews_api.views.identity_from_enrolment_id",
        ):
            patcher = patch(target, return_value=self.identity)
            patcher.start()
            self.addCleanup(patcher.stop)
        patcher = patch("progress_reviews_api.views.identity_for_run", return_value=self.identity)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.env_patcher = _disable_auth()
        self.env_patcher.start()
        self.addCleanup(self.env_patcher.stop)

    @patch("progress_reviews_api.views._generate_for_learner")
    def test_generate_endpoint_returns_201_on_success(self, mock_generate):
        mock_generate.return_value = {"reviewId": "run-1", "generationStatus": "completed"}
        response = self.client.post("/progress_reviews_api/42/generate/", data={}, content_type="application/json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(json.loads(response.content)["reviewId"], "run-1")
        mock_generate.assert_called_once_with(42, review_date=None, generated_by="system", save_as_draft=True)

    @patch("progress_reviews_api.views._generate_for_learner", side_effect=GenerationError("Not active.", 409))
    def test_generate_endpoint_surfaces_generation_error_status(self, mock_generate):
        response = self.client.post("/progress_reviews_api/42/generate/", data={}, content_type="application/json")
        self.assertEqual(response.status_code, 409)

    def test_generate_endpoint_rejects_invalid_json(self):
        response = self.client.post("/progress_reviews_api/42/generate/", data=b"not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.runs")
    def test_download_endpoint_returns_a_url_for_a_completed_run(self, mock_runs, mock_storage):
        mock_runs.get_run.return_value = {
            "id": "run-1", "learner_id": 501, "generation_status": "completed",
        }
        mock_runs.get_pptx_file_for_run.return_value = {
            "container": "progress-review-decks", "blob_name": "a/b/c.pptx", "original_filename": "deck.pptx",
        }
        mock_storage.storage_configured.return_value = True
        mock_storage.download_sas_for.return_value = "https://example.blob.core.windows.net/deck.pptx?sig=..."

        response = self.client.get("/progress_reviews_api/run-1/download/")

        self.assertEqual(response.status_code, 200)
        self.assertIn("url", json.loads(response.content))

    def _preview_run(self, mock_runs, mock_storage):
        mock_runs.get_run.return_value = {
            "id": "run-1", "learner_id": 501, "generation_status": "completed",
        }
        mock_runs.get_pptx_file_for_run.return_value = {
            "container": "progress-review-decks", "blob_name": "a/b/c.pptx", "original_filename": "deck.pptx",
        }
        mock_storage.storage_configured.return_value = True

    @patch("progress_reviews_api.views.pdf_preview.convert_pptx_to_pdf", return_value=b"%PDF-new")
    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.runs")
    def test_preview_converts_once_and_caches_the_pdf(self, mock_runs, mock_storage, mock_convert):
        self._preview_run(mock_runs, mock_storage)
        mock_storage.blob_exists.return_value = False
        mock_storage.download_bytes.return_value = b"PPTX"

        response = self.client.get("/progress_reviews_api/run-1/preview/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertEqual(response.content, b"%PDF-new")
        mock_convert.assert_called_once_with(b"PPTX")
        self.assertEqual(mock_storage.upload_pdf.call_args[0][1], "a/b/c.pptx.pdf")

    @patch("progress_reviews_api.views.pdf_preview.convert_pptx_to_pdf")
    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.runs")
    def test_preview_serves_the_cached_pdf_without_converting(self, mock_runs, mock_storage, mock_convert):
        self._preview_run(mock_runs, mock_storage)
        mock_storage.blob_exists.return_value = True
        mock_storage.download_bytes.return_value = b"%PDF-cached"

        response = self.client.get("/progress_reviews_api/run-1/preview/")

        self.assertEqual(response.content, b"%PDF-cached")
        mock_convert.assert_not_called()

    @patch("progress_reviews_api.views.pdf_preview.convert_pptx_to_pdf")
    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.runs")
    def test_preview_reports_a_missing_converter(self, mock_runs, mock_storage, mock_convert):
        from .pdf_preview import PreviewUnavailable

        self._preview_run(mock_runs, mock_storage)
        mock_storage.blob_exists.return_value = False
        mock_convert.side_effect = PreviewUnavailable("PDF preview needs LibreOffice installed on the server.")

        response = self.client.get("/progress_reviews_api/run-1/preview/")

        self.assertEqual(response.status_code, 503)
        self.assertIn("LibreOffice", json.loads(response.content)["error"])

    @patch("progress_reviews_api.views.runs")
    def test_preview_404s_for_an_unknown_run(self, mock_runs):
        mock_runs.get_run.return_value = None
        self.assertEqual(self.client.get("/progress_reviews_api/nope/preview/").status_code, 404)

    @patch("progress_reviews_api.views.runs")
    def test_download_endpoint_404s_for_an_unknown_run(self, mock_runs):
        mock_runs.get_run.return_value = None
        response = self.client.get("/progress_reviews_api/does-not-exist/download/")
        self.assertEqual(response.status_code, 404)

    def test_latest_run_endpoint_requires_a_review_date(self):
        response = self.client.get("/progress_reviews_api/42/runs/latest/")
        self.assertEqual(response.status_code, 400)

    @patch("progress_reviews_api.views.runs")
    def test_latest_run_endpoint_reports_no_existing_deck(self, mock_runs):
        mock_runs.get_latest_completed_run_for_period.return_value = None
        response = self.client.get("/progress_reviews_api/42/runs/latest/?review_date=2026-10-26")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"exists": False})
        mock_runs.get_latest_completed_run_for_period.assert_called_once_with(501, date(2026, 10, 26))

    @patch("progress_reviews_api.views.runs")
    def test_latest_run_endpoint_reports_an_existing_deck(self, mock_runs):
        mock_runs.get_latest_completed_run_for_period.return_value = {
            "id": "run-1", "generation_status": "completed",
            "generated_at": datetime(2026, 10, 26, 9, 0, tzinfo=timezone.utc), "created_at": None,
        }
        response = self.client.get("/progress_reviews_api/42/runs/latest/?review_date=2026-10-26")
        body = json.loads(response.content)
        self.assertEqual(body["exists"], True)
        self.assertEqual(body["reviewId"], "run-1")
        self.assertEqual(body["generationStatus"], "completed")

    @patch("progress_reviews_api.views.runs")
    def test_publish_endpoint_promotes_a_draft(self, mock_runs):
        draft = {
            "id": "draft-1", "learner_id": 501, "generation_status": "draft",
            "review_number": 1, "review_date": date(2026, 10, 26),
            "review_period_start": date(2026, 8, 4), "review_period_end": date(2026, 10, 26),
            "revision_source": "generated", "source_warnings": [],
        }
        saved = {**draft, "generation_status": "completed"}
        mock_runs.get_run.side_effect = [draft, saved]
        mock_runs.publish_run.return_value = True
        mock_runs.get_snapshot.return_value = {"source_warnings": []}

        response = self.client.post("/progress_reviews_api/draft-1/publish/", data=b"{}", content_type="application/json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["generationStatus"], "completed")
        mock_runs.publish_run.assert_called_once_with("draft-1")

    @patch("progress_reviews_api.views.runs")
    def test_latest_run_endpoint_scopes_strictly_to_the_requested_review_date(self, mock_runs):
        """Regression guard: a learner's second review must never show as
        already generated just because their first review's deck exists."""
        mock_runs.get_latest_completed_run_for_period.return_value = None
        self.client.get("/progress_reviews_api/42/runs/latest/?review_date=2027-01-18")
        mock_runs.get_latest_completed_run_for_period.assert_called_once_with(501, date(2027, 1, 18))

    @patch("progress_reviews_api.views.authenticate_request", return_value=SimpleNamespace(role="coach", is_staff=True))
    @patch("progress_reviews_api.views.runs")
    def test_staff_can_request_the_owner_only_draft(self, mock_runs, mock_auth):
        mock_runs.get_latest_run_for_period.return_value = {
            "id": "draft-1", "generation_status": "draft", "generated_at": None,
            "revision_source": "generated",
        }

        response = self.client.get("/progress_reviews_api/42/runs/latest/?review_date=2026-10-26&include_draft=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["generationStatus"], "draft")
        mock_runs.get_latest_run_for_period.assert_called_once_with(501, date(2026, 10, 26))

    @patch("progress_reviews_api.views.authenticate_request", return_value=SimpleNamespace(role="learner", subject_id=42))
    @patch("progress_reviews_api.views.runs")
    def test_progress_review_draft_is_hidden_from_the_learner(self, mock_runs, mock_auth):
        mock_runs.get_latest_completed_run_for_period.return_value = None

        response = self.client.get("/progress_reviews_api/42/runs/latest/?review_date=2026-10-26")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"exists": False})
        mock_runs.get_latest_completed_run_for_period.assert_called_once_with(501, date(2026, 10, 26))

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.runs")
    @patch("progress_reviews_api.views.authenticate_request", return_value=SimpleNamespace(role="learner", subject_id=42))
    def test_progress_review_draft_cannot_be_downloaded_by_its_learner(self, mock_auth, mock_runs, mock_storage):
        mock_runs.get_run.return_value = {
            "id": "draft-1", "learner_id": 501,
            "review_kind": "progress_review", "generation_status": "draft",
        }
        with patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"}):
            response = self.client.get("/progress_reviews_api/draft-1/download/")

        self.assertEqual(response.status_code, 404)
        mock_runs.get_pptx_file_for_run.assert_not_called()
        mock_storage.download_sas_for.assert_not_called()

    @patch("progress_reviews_api.views.storage")
    @patch("progress_reviews_api.views.runs")
    @patch("progress_reviews_api.views.authenticate_request", return_value=SimpleNamespace(role="learner", subject_id=42))
    def test_run_id_cannot_leak_another_canonical_learners_pptx(
        self, mock_auth, mock_runs, mock_storage,
    ):
        mock_runs.get_run.return_value = {
            "id": "other-run",
            "learner_id": 777,
            "review_kind": "mcm",
            "generation_status": "completed",
        }
        with patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"}):
            response = self.client.get("/progress_reviews_api/other-run/download/")

        self.assertEqual(response.status_code, 403)
        mock_runs.get_pptx_file_for_run.assert_not_called()
        mock_storage.download_sas_for.assert_not_called()

    @patch("progress_reviews_api.views._generate_for_learner")
    def test_bulk_generate_isolates_one_learner_failure_from_the_rest(self, mock_generate):
        def side_effect(learner_id, **kwargs):
            if learner_id == 2:
                raise GenerationError("Only active learners.", 409)
            return {"reviewId": f"run-{learner_id}", "learnerId": learner_id, "generationStatus": "completed"}

        mock_generate.side_effect = side_effect
        response = self.client.post(
            "/progress_reviews_api/bulk-generate/",
            data=json.dumps({"learner_ids": [1, 2, 3]}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        results = json.loads(response.content)["results"]
        statuses = {r["learnerId"]: r["generationStatus"] for r in results}
        self.assertEqual(statuses, {1: "completed", 2: "failed", 3: "completed"})
