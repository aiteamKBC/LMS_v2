"""No-database checks for the employer's read of a legacy enrolment review."""
from __future__ import annotations

import inspect
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.test import RequestFactory

from learner_api import employer_portal

EMPLOYER = SimpleNamespace(pk=7)
LEARNER = SimpleNamespace(pk=499, employer_id=7)
REVIEW = SimpleNamespace(event_key="enrol-eligibility-1")


class EmployerEnrolmentReviewTests(unittest.TestCase):
    view = staticmethod(inspect.unwrap(employer_portal.employer_enrolment_review))

    def call(self, *, method="get", learner=LEARNER, required=True, lookup_error=None):
        request = getattr(RequestFactory(), method)("/review/")
        lookup = (None, None, None, lookup_error) if lookup_error else (learner, REVIEW, None, None)
        with patch.object(employer_portal, "_employer_or_404", return_value=(EMPLOYER, None)), \
                patch.object(employer_portal, "_lookup_enrolment_review", return_value=lookup) as looked_up, \
                patch.object(employer_portal, "employer_signature_required", return_value=required), \
                patch.object(employer_portal, "_serialize_enrolment_review", return_value={"eventKey": REVIEW.event_key}):
            response = self.view(request, 7, "apprenticeship", 499, "enrol-eligibility-1")
        return response, looked_up

    def test_returns_the_review_for_the_employers_own_learner(self):
        response, looked_up = self.call()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"eventKey": "enrol-eligibility-1"})
        # Looked up scoped to the learner named in the URL.
        looked_up.assert_called_once_with("apprenticeship", 499, "enrol-eligibility-1")

    def test_refuses_another_employers_learner(self):
        response, _ = self.call(learner=SimpleNamespace(pk=499, employer_id=8))
        self.assertEqual(response.status_code, 403)

    def test_hides_a_review_that_wants_no_employer_signature(self):
        response, _ = self.call(required=False)
        self.assertEqual(response.status_code, 404)

    def test_passes_through_a_missing_review(self):
        missing = employer_portal._error("Review not found.", 404)
        response, _ = self.call(lookup_error=missing)
        self.assertEqual(response.status_code, 404)

    def test_is_read_only(self):
        response, looked_up = self.call(method="post")
        self.assertEqual(response.status_code, 405)
        looked_up.assert_not_called()


class EmployerEnrolmentReviewGateTests(unittest.TestCase):
    """The portal gate: an employer reaches only their own employer id."""

    def call_as(self, account, employer_id):
        request = RequestFactory().get("/review/")
        with patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"}), \
                patch("login.permissions.authenticate_request", return_value=account), \
                patch.object(employer_portal, "_employer_or_404", return_value=(EMPLOYER, None)), \
                patch.object(employer_portal, "_lookup_enrolment_review", return_value=(LEARNER, REVIEW, None, None)), \
                patch.object(employer_portal, "employer_signature_required", return_value=True), \
                patch.object(employer_portal, "_serialize_enrolment_review", return_value={}):
            return employer_portal.employer_enrolment_review(
                request, employer_id=employer_id, kind="apprenticeship", learner_id=499, event_key="k",
            )

    def test_employer_reads_their_own(self):
        account = SimpleNamespace(role="employer", subject_id=7)
        self.assertEqual(self.call_as(account, 7).status_code, 200)

    def test_employer_cannot_read_another_employers(self):
        account = SimpleNamespace(role="employer", subject_id=8)
        self.assertEqual(self.call_as(account, 7).status_code, 404)

    def test_learner_is_refused(self):
        account = SimpleNamespace(role="learner", subject_id=499)
        self.assertEqual(self.call_as(account, 7).status_code, 403)

    def test_signed_out_is_refused(self):
        self.assertEqual(self.call_as(None, 7).status_code, 401)


if __name__ == "__main__":
    unittest.main()
