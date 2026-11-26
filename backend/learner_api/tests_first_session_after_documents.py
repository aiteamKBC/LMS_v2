"""A Delivery apprentice may book their first learning session once they have
signed all four compliance documents — their own signatures only.

SimpleTestCase with the database layer mocked: no query reaches a database.
"""
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from learner_api import calendar, learner_progression as progression

SIGNED = "data:image/png;base64,AAAA"


def _documents(**signatures):
    """Patch each document model to return a document with the given learner signature (None = not issued)."""
    stack = ExitStack()
    for name, model in progression.COMPLIANCE_DOCUMENT_MODELS:
        field = progression.LEARNER_SIGNATURE_FIELDS[name]
        value = signatures.get(name, SIGNED)
        document = None if value is None else SimpleNamespace(**{field: value})
        manager = stack.enter_context(patch.object(model, "objects"))
        manager.filter.return_value.only.return_value.first.return_value = document
    return stack


class LearnerSignedTests(SimpleTestCase):
    def test_all_four_signed_by_the_learner(self):
        with _documents():
            self.assertTrue(progression.learner_signed_compliance_documents("apprenticeship", 670))

    def test_one_unsigned_document_keeps_it_closed(self):
        with _documents(writtenAgreement=""):
            self.assertFalse(progression.learner_signed_compliance_documents("apprenticeship", 670))

    def test_a_document_not_yet_issued_keeps_it_closed(self):
        with _documents(trainingPlan=None):
            self.assertFalse(progression.learner_signed_compliance_documents("apprenticeship", 670))


class EarlyBookingTests(SimpleTestCase):
    def learner(self, status):
        return SimpleNamespace(pk=670, learner_type="apprenticeship", programme_status=status, aptem_id=None,
                               _aptem_programme_status=None)

    def test_a_delivery_apprentice_who_has_signed_may_book(self):
        with patch("learner_api.learner_progression.learner_signed_compliance_documents", return_value=True):
            self.assertTrue(calendar._may_book_first_session_early("apprenticeship", self.learner("Delivery")))

    def test_not_before_they_have_signed(self):
        with patch("learner_api.learner_progression.learner_signed_compliance_documents", return_value=False):
            self.assertFalse(calendar._may_book_first_session_early("apprenticeship", self.learner("Delivery")))

    def test_not_before_delivery(self):
        with patch("learner_api.learner_progression.learner_signed_compliance_documents", return_value=True) as signed:
            self.assertFalse(calendar._may_book_first_session_early("apprenticeship", self.learner("Onboarding")))
        signed.assert_not_called()
