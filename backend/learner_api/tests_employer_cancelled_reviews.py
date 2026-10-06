"""The employer's documents list leaves out reviews whose booking was cancelled.

A learner who cancels a review and books it again has two rows; only the new one
is theirs to sign. The board and the coach already drop cancelled reviews — the
employer page listed both, so a signed review sat beside a dead "awaiting" copy.

SimpleTestCase with the database layer mocked: no query reaches a database.
"""
from unittest.mock import MagicMock, patch
from types import SimpleNamespace

from django.test import SimpleTestCase

from learner_api import employer_portal
from learner_api.models import EnrolmentReview


class CancelledReviewTests(SimpleTestCase):
    def test_the_query_excludes_cancelled_reviews(self):
        queryset = MagicMock()
        queryset.exclude.return_value.order_by.return_value = []
        with patch.object(EnrolmentReview.objects, "filter", return_value=queryset) as filt, \
                patch.object(employer_portal, "SOURCE_MODELS", {}), \
                patch.object(employer_portal.review_instances, "list_review_instances_for_learner", return_value=[]), \
                patch.object(employer_portal.ImportedReviewInstance.objects, "select_related") as migrated:
            migrated.return_value.filter.return_value = []
            employer_portal._review_signing_rows("apprenticeship", 670)

        filt.assert_called_once_with(learner_kind="apprenticeship", learner_id=670)
        queryset.exclude.assert_called_once_with(status=EnrolmentReview.STATUS_CANCELLED)
        queryset.exclude.return_value.order_by.assert_called_once_with("scheduled_date", "id")

    def test_synthetic_migrated_pr_is_listed_for_its_employer_only(self):
        queryset = MagicMock()
        queryset.exclude.return_value.order_by.return_value = []
        overlay = SimpleNamespace(
            migrated_template_id=3, migrated_template=SimpleNamespace(review_family="PR"),
            event_key="imported-review:C5-TEST-PR", template_snapshot={"name": "Test PR", "sections": [{}]},
            status="awaiting-signature",
        )
        states = {
            "advisor": {"signed": True}, "participant": {"signed": False},
            "employer": {"signed": False, "signedName": None, "signedAt": None},
        }
        with patch.object(EnrolmentReview.objects, "filter", return_value=queryset), \
                patch.object(employer_portal, "SOURCE_MODELS", {}), \
                patch.object(employer_portal.review_instances, "list_review_instances_for_learner", return_value=[]), \
                patch.object(employer_portal.ImportedReviewInstance.objects, "select_related") as migrated, \
                patch.object(employer_portal, "signature_states", return_value=states):
            migrated.return_value.filter.return_value = [overlay]
            rows = employer_portal._review_signing_rows("apprenticeship", 670)
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["migratedForm"])
        self.assertEqual(rows[0]["eventKey"], overlay.event_key)
        self.assertTrue(rows[0]["signable"])
        self.assertFalse(rows[0]["signed"])
