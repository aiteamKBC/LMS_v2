"""Pure checks for the Progress Review template update; no database access."""
import unittest

from curriculum_api.next_review_booking_question import (
    QUESTION, plan_sections, with_next_booking_question,
    plan_mcm_participant_access, with_mcm_participant_access,
)


class NextBookingTemplateTests(unittest.TestCase):
    def test_adds_only_the_booking_question_without_changing_existing_fields(self):
        original = [{"id": "section-1", "title": "Existing", "estimatedMinutes": 5,
                     "fields": [{"id": "field-1", "title": "Existing question", "fieldType": "text"}]}]
        updated = with_next_booking_question(original)
        self.assertEqual(plan_sections(original), "add")
        self.assertEqual(original[0]["fields"], [{"id": "field-1", "title": "Existing question", "fieldType": "text"}])
        self.assertEqual(updated[0], original[0])
        self.assertEqual(updated[-1]["fields"][0]["title"], QUESTION)
        self.assertEqual(plan_sections(updated), "already_present")
        self.assertEqual(with_next_booking_question(updated), updated)

    def test_reuses_single_existing_closing_section(self):
        sections = [{"title": "Confirm Next Meeting & Close (5 minutes)", "fields": []}]
        updated = with_next_booking_question(sections)
        self.assertEqual(len(updated), 1)
        self.assertEqual(updated[0]["fields"][0]["title"], QUESTION)

    def test_conflicting_non_boolean_question_is_not_overwritten(self):
        sections = [{"title": "Closing", "fields": [{"title": QUESTION, "fieldType": "text"}]}]
        self.assertEqual(plan_sections(sections), "conflict")
        self.assertEqual(with_next_booking_question(sections), sections)

    def test_progress_review_existing_question_grants_learner_access(self):
        sections = [{"title": "Closing", "fields": [{"id": "field-1", "title": QUESTION,
                     "fieldType": "boolean", "configuration": {}}]}]
        self.assertEqual(plan_sections(sections), "add_participant")
        updated = with_next_booking_question(sections)
        self.assertEqual(updated[0]["fields"][0]["configuration"]["respondentRoles"], ["participant"])
        self.assertEqual(plan_sections(updated), "already_present")

    def test_mcm_question_allows_learner_answer_without_changing_other_roles(self):
        sections = [{"title": "Closing", "fields": [{"id": "field-1", "title": QUESTION,
                     "fieldType": "boolean_case_block", "configuration": {"respondentRoles": ["employer"]},
                     "yesFields": [], "noFields": []}]}]
        self.assertEqual(plan_mcm_participant_access(sections), "add_participant")
        updated = with_mcm_participant_access(sections)
        self.assertEqual(sections[0]["fields"][0]["configuration"]["respondentRoles"], ["employer"])
        self.assertEqual(updated[0]["fields"][0]["configuration"]["respondentRoles"], ["employer", "participant"])
        self.assertEqual(updated[0]["fields"][0]["fieldType"], "boolean_case_block")
        self.assertEqual(plan_mcm_participant_access(updated), "already_present")
        self.assertEqual(with_mcm_participant_access(updated), updated)


if __name__ == "__main__":
    unittest.main()
