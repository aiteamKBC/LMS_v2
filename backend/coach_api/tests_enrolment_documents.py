"""The case file's Enrolment Documents tab: a coach views and signs their own
learners' enrolment review documents with their saved signature.

SimpleTestCase with the database layer mocked: no query reaches a database.
The views are called beneath coach_access_required (see ``_view``), with the
identity it installs set on the request, so what is tested is the tab's own
rules: caseload scoping, and when a document may be signed.
"""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import enrolment_documents as docs

COACH = "coach@example.test"
STAFF = SimpleNamespace(id=7, username="Casey Coach")
PROFILE = SimpleNamespace(id=31, enrolment_id=125, learner_type="apprenticeship")
SOURCE = SimpleNamespace(learner_type="apprenticeship")


def _view(decorated):
    """The view beneath coach_access_required (sign-in, then coach gate), still
    under its require_GET / require_POST."""
    return decorated.__wrapped__.__wrapped__


def _request(method="get"):
    request = getattr(RequestFactory(), method)("/", data="{}", content_type="application/json") if method == "post" \
        else RequestFactory().get("/")
    request.coach_email = COACH
    return request


def _review(**overrides):
    fields = dict(form_completed=True, admin_signature="", event_key="eligibility-review:31:1:2026-08-03")
    fields.update(overrides)
    return SimpleNamespace(**fields)


class CaseloadScopingTests(SimpleTestCase):
    def test_a_learner_outside_the_caseload_is_not_found(self):
        with patch("coach_api.views.fetch_case_file_shell", return_value=(None, None)) as shell:
            response = _view(docs.coach_enrolment_documents)(_request(), learner_id=99)
        self.assertEqual(response.status_code, 404)
        shell.assert_called_once_with(COACH, 99)

    def test_signing_outside_the_caseload_is_not_found_and_writes_nothing(self):
        with patch("coach_api.views.fetch_case_file_shell", return_value=(None, None)), \
                patch.object(docs, "record_signature") as record:
            response = _view(docs.coach_sign_enrolment_document)(_request("post"), learner_id=99, event_key="k")
        self.assertEqual(response.status_code, 404)
        record.assert_not_called()


class ListTests(SimpleTestCase):
    def test_lists_the_learners_review_documents_and_whether_the_coach_can_sign(self):
        rows = MagicMock()
        rows.exclude.return_value.order_by.return_value = ["row"]
        with patch("coach_api.views.fetch_case_file_shell", return_value=(PROFILE, SOURCE)), \
                patch.object(docs.EnrolmentReview.objects, "filter", return_value=rows) as filt, \
                patch.object(docs, "review_document_rows", return_value=[{"eventKey": "k"}]), \
                patch.object(docs, "_coach_staff", return_value=STAFF), \
                patch.object(docs, "_saved_signature", return_value="data:image/png;base64,AAAA"):
            response = _view(docs.coach_enrolment_documents)(_request(), learner_id=31)

        self.assertEqual(response.status_code, 200)
        filt.assert_called_once_with(learner_id=125)  # the enrolment record, not the profile id
        payload = json.loads(response.content)
        self.assertEqual(payload["documents"], [{"eventKey": "k"}])
        # Whether a signature exists — never the image itself.
        self.assertEqual(payload["signature"], {"saved": True, "name": "Casey Coach"})


class SignTests(SimpleTestCase):
    def sign(self, review, signature="data:image/png;base64,AAAA"):
        with patch("coach_api.views.fetch_case_file_shell", return_value=(PROFILE, SOURCE)), \
                patch.object(docs, "lookup_review", return_value=("learner", review, None, None)) as lookup, \
                patch.object(docs, "_coach_staff", return_value=STAFF), \
                patch.object(docs, "_saved_signature", return_value=signature), \
                patch.object(docs, "record_signature", return_value=None) as record, \
                patch.object(docs, "serialize_review_form", return_value={"ok": True}):
            response = _view(docs.coach_sign_enrolment_document)(_request("post"), learner_id=31, event_key="k")
        return response, record, lookup

    def test_signs_the_college_sign_off_with_the_saved_signature(self):
        response, record, lookup = self.sign(_review())

        self.assertEqual(response.status_code, 200, response.content)
        lookup.assert_called_once_with("apprenticeship", 125, "k")
        record.assert_called_once()
        review, party, signature, name = record.call_args.args
        self.assertEqual((party, signature, name), ("admin", "data:image/png;base64,AAAA", "Casey Coach"))

    def test_an_unfinished_review_cannot_be_signed(self):
        response, record, _ = self.sign(_review(form_completed=False))
        self.assertEqual(response.status_code, 400)
        record.assert_not_called()

    def test_an_existing_college_signature_is_never_replaced(self):
        response, record, _ = self.sign(_review(admin_signature="data:image/png;base64,EARLIER"))
        self.assertEqual(response.status_code, 409)
        record.assert_not_called()

    def test_needs_a_saved_signature_first(self):
        response, record, _ = self.sign(_review(), signature="")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Create your signature", json.loads(response.content)["error"])
        record.assert_not_called()

    def test_only_accepts_post(self):
        request = RequestFactory().get("/")
        request.coach_email = COACH
        response = _view(docs.coach_sign_enrolment_document)(request, learner_id=31, event_key="k")
        self.assertEqual(response.status_code, 405)


class RecordSignatureTests(SimpleTestCase):
    """The shared write path the board, the learner and the coach all use."""

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
