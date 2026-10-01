import json
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api.review_pdf import coach_mcm_pdf


class ImportedReviewPdfTests(SimpleTestCase):
    def test_imported_review_pdf_uses_the_definition_learner_id(self):
        definition = {
            "instance": {"id": "imported-review:A-4399", "learnerId": 42},
            "historicalReview": {
                "aptemLearnerId": "A-learner",
                "aptemReviewId": "A-4399",
                "name": "Progress Review",
                "type": "Progress Review",
                "learnerName": "Imported learner",
                "sections": [],
            },
        }
        profile = SimpleNamespace(
            enrolment_id=142,
            username="Imported learner",
            programme="Sample programme",
        )
        source = SimpleNamespace(username="Imported learner", programme="Sample programme")

        with (
            patch("coach_api.views._imported_review_definition", return_value=definition),
            patch("coach_api.auth.authenticated_coach_email", return_value="coach@example.test"),
            patch("learner_api.models.LearnerProfile.objects.filter") as profile_filter,
            patch("learner_api.models.EnrolmentUser.all_learners.filter") as source_filter,
            patch("learner_api.aptem_review_pdf.original_review_pdf", return_value=b"%PDF-original"),
        ):
            profile_filter.return_value.first.return_value = profile
            source_filter.return_value.first.return_value = source

            response = unwrap(coach_mcm_pdf)(
                RequestFactory().get("/coach/reviews/imported-review:A-4399/pdf"),
                "imported-review:A-4399",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["X-Review-PDF-Source"], "aptem-original")
        self.assertEqual(response.content, b"%PDF-original")
        profile_filter.assert_called_once_with(pk=42)

    def test_imported_review_pdf_does_not_regenerate_when_the_original_is_missing(self):
        definition = {
            "instance": {"id": "imported-review:A-4399", "learnerId": 42},
            "historicalReview": {"aptemReviewId": "A-4399", "sections": []},
        }

        with (
            patch("coach_api.views._imported_review_definition", return_value=definition),
            patch("coach_api.auth.authenticated_coach_email", return_value="coach@example.test"),
            patch("learner_api.models.LearnerProfile.objects.filter") as profile_filter,
            patch("learner_api.aptem_review_pdf.original_review_pdf", return_value=None),
        ):
            profile_filter.return_value.first.return_value = None

            response = unwrap(coach_mcm_pdf)(
                RequestFactory().get("/coach/reviews/imported-review:A-4399/pdf"),
                "imported-review:A-4399",
            )

        self.assertEqual(response.status_code, 404)
        self.assertIn(
            "original Aptem PDF is unavailable",
            json.loads(response.content.decode("utf-8"))["detail"],
        )
