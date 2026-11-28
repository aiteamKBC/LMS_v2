"""No-database regression checks for migrated next-meeting template changes."""

from copy import deepcopy
from unittest import TestCase

from coach_api.migrated_next_review_booking import FIELD_KEY, QUESTION, SECTION_TITLE, with_next_review_booking


def definition(*fields):
    return {"sections": [{"key": "original", "title": "Meeting Summary", "order": 0, "fields": list(fields)}]}


class MigratedNextReviewBookingTests(TestCase):
    def test_pr_adds_required_learner_question_without_changing_existing_fields(self):
        original = definition({"key": "summary", "title": "Meeting Summary", "aptemType": 13, "order": 0})
        before = deepcopy(original)
        action, updated = with_next_review_booking(original, "PR")
        self.assertEqual(action, "add_question")
        self.assertEqual(original, before)
        self.assertEqual(updated["sections"][0], before["sections"][0])
        self.assertEqual(updated["sections"][1]["title"], SECTION_TITLE)
        field = updated["sections"][1]["fields"][0]
        self.assertEqual((field["key"], field["title"]), (FIELD_KEY, QUESTION))
        self.assertEqual(field["respondentRoles"], ["participant"])
        self.assertTrue(field["mandatory"])

    def test_mcm_grants_learner_access_to_existing_question(self):
        original = definition({"key": "booking", "title": QUESTION, "aptemType": 6, "order": 0, "mandatory": True})
        action, updated = with_next_review_booking(original, "MCM")
        self.assertEqual(action, "add_learner_access")
        self.assertNotIn("respondentRoles", original["sections"][0]["fields"][0])
        self.assertEqual(updated["sections"][0]["fields"][0]["respondentRoles"], ["participant"])
        self.assertEqual(with_next_review_booking(updated, "MCM")[0], "already_present")

    def test_rejects_duplicate_question(self):
        original = definition(*[{"key": key, "title": QUESTION, "aptemType": 6} for key in ("a", "b")])
        with self.assertRaisesRegex(ValueError, "more than one"):
            with_next_review_booking(original, "PR")
