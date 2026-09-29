"""The employer's documents list leaves out reviews whose booking was cancelled.

A learner who cancels a review and books it again has two rows; only the new one
is theirs to sign. The board and the coach already drop cancelled reviews — the
employer page listed both, so a signed review sat beside a dead "awaiting" copy.

SimpleTestCase with the database layer mocked: no query reaches a database.
"""
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api import employer_portal
from learner_api.models import EnrolmentReview


class CancelledReviewTests(SimpleTestCase):
    def test_the_query_excludes_cancelled_reviews(self):
        queryset = MagicMock()
        queryset.exclude.return_value.order_by.return_value = []
        with patch.object(EnrolmentReview.objects, "filter", return_value=queryset) as filt, \
                patch.object(employer_portal, "SOURCE_MODELS", {}), \
                patch.object(employer_portal.review_instances, "list_review_instances_for_learner", return_value=[]):
            employer_portal._review_signing_rows("apprenticeship", 670)

        filt.assert_called_once_with(learner_kind="apprenticeship", learner_id=670)
        queryset.exclude.assert_called_once_with(status=EnrolmentReview.STATUS_CANCELLED)
        queryset.exclude.return_value.order_by.assert_called_once_with("scheduled_date", "id")
