"""Read-only Case File documents; database and shared writes are mocked."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from django.test import RequestFactory, SimpleTestCase
from django.urls import Resolver404, resolve
from coach_api import enrolment_documents as docs

COACH = "coach@example.test"
PROFILE = SimpleNamespace(id=31, enrolment_id=125, learner_type="apprenticeship")
SOURCE = SimpleNamespace(learner_type="apprenticeship")

def _view(decorated):
    return decorated.__wrapped__.__wrapped__

def _request(method="GET"):
    request = RequestFactory().generic(method, "/")
    request.coach_email = COACH
    return request

class ReadOnlyDocumentTests(SimpleTestCase):
    def test_both_reads_reject_mutations_before_lookup(self):
        with patch.object(docs, "_enrolment_learner") as lookup, patch("learner_api.review_form.record_signature") as write:
            for method in ("POST", "PUT", "PATCH", "DELETE"):
                for view, args in ((docs.coach_enrolment_documents, {"learner_id": 31}),
                                   (docs.coach_enrolment_document, {"learner_id": 31, "event_key": "k"})):
                    with self.subTest(method=method, view=view.__name__):
                        self.assertEqual(_view(view)(_request(method), **args).status_code, 405)
            lookup.assert_not_called()
            write.assert_not_called()

    def test_case_file_signing_route_is_removed(self):
        with self.assertRaises(Resolver404):
            resolve("/coach_api/coach/learners/31/enrolment-documents/k/sign")

    def test_unauthorized_list_and_detail_are_not_found(self):
        with patch("coach_api.views.fetch_case_file_shell", return_value=(None, None)), patch.object(docs, "lookup_review") as lookup:
            self.assertEqual(_view(docs.coach_enrolment_documents)(_request(), learner_id=99).status_code, 404)
            self.assertEqual(_view(docs.coach_enrolment_document)(_request(), learner_id=99, event_key="k").status_code, 404)
            lookup.assert_not_called()

    def test_list_returns_documents_without_editing_account_metadata(self):
        rows = MagicMock()
        rows.exclude.return_value.order_by.return_value = ["row"]
        with patch("coach_api.views.fetch_case_file_shell", return_value=(PROFILE, SOURCE)), \
             patch.object(docs.EnrolmentReview.objects, "filter", return_value=rows) as filt, \
             patch.object(docs, "review_document_rows", return_value=[{"eventKey": "k"}]):
            response = _view(docs.coach_enrolment_documents)(_request(), learner_id=31)
        self.assertEqual(response.status_code, 200)
        filt.assert_called_once_with(learner_id=125)
        self.assertEqual(json.loads(response.content), {"documents": [{"eventKey": "k"}]})

    def test_detail_preserves_read_only_document_and_historical_signatures(self):
        document = {"eventKey": "k", "signatures": {"admin": {"signed": True}}}
        with patch("coach_api.views.fetch_case_file_shell", return_value=(PROFILE, SOURCE)), \
             patch.object(docs, "lookup_review", return_value=("learner", "review", "event", None)) as lookup, \
             patch.object(docs, "serialize_review_form", return_value=document), \
             patch("learner_api.review_form.record_signature") as write:
            response = _view(docs.coach_enrolment_document)(_request(), learner_id=31, event_key="k")
        self.assertEqual(json.loads(response.content), document)
        lookup.assert_called_once_with("apprenticeship", 125, "k")
        write.assert_not_called()


class RecordSignatureTests(SimpleTestCase):
    """The shared write path outside Case File remains available."""

    def test_writes_the_college_sign_off_and_checks_for_delivery(self):
        from learner_api import review_form

        review = MagicMock()
        with patch("learner_api.learning_plan.promote_to_delivery_if_ready", return_value="Delivery") as promote:
            promoted = review_form.record_signature(review, "admin", "data:image/png;base64,AAAA", "Casey Coach")

        self.assertEqual(review.admin_signature, "data:image/png;base64,AAAA")
        self.assertEqual(review.admin_signed_name, "Casey Coach")
        self.assertIsNotNone(review.admin_signed_at)
        review.save.assert_called_once()
        promote.assert_called_once_with(review)
        self.assertEqual(promoted, "Delivery")
