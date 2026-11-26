"""Monthly assignment reports on the coach marking page, without a database.

The review page shows a report in two tabs (steps 2-4 and steps 5-8) and one
feedback for the whole report, drafted by AI from both tabs.
"""
import json

from django.test import SimpleTestCase

from coach_api import marking_parts as parts


def monthly_row(**monthly):
    return {
        "activity_type": "assignment",
        "status": "submitted_for_tutor_review",
        "full_submission": {
            "assignmentQuestion": "Explain the budget.",
            "assignmentAnswer": "E1\nThe budget came from quotations.",
            "whatYouLearned": "Estimating methods.",
            "monthlyAssignment": {
                "version": 2,
                "understood": "Cost baselines.",
                "gainedSkills": "Variance analysis.",
                "evidence": [{"id": "f1", "name": "Plan.pdf", "points": "1"}],
                "timeEntries": [{"date": "2026-11-04", "topic": "Planning", "hours": "2"}],
                "claims": [{"code": "K7", "explanation": "Tracked budgets."}],
                "paidHours": True,
                "lmsReflection": "The month tied together.",
                "careerImpact": "Ready for a PM role.",
                "employerBenefit": True,
                "actionPlan": "Learn EVM.",
                "meetingKey": "booking-1",
                "slides": [{"title": "Overview", "body": "Scope"}],
                **monthly,
            },
        },
    }


class MonthlySectionsTests(SimpleTestCase):
    def test_a_monthly_report_has_an_assignment_tab_and_a_reflection_tab(self):
        sections = parts.monthly_sections(monthly_row())
        self.assertEqual([s["step"] for s in sections["assignment"]], [2, 3, 4])
        self.assertEqual([s["step"] for s in sections["reflection"]], [5, 6, 7, 8])

    def test_other_submissions_have_no_tabs(self):
        self.assertIsNone(parts.monthly_sections({**monthly_row(), "activity_type": "extra_activity"}))
        self.assertIsNone(parts.monthly_sections({"activity_type": "video", "full_submission": {}}))
        older = monthly_row()
        older["full_submission"]["monthlyAssignment"]["version"] = 1
        self.assertIsNone(parts.monthly_sections(older))

    def test_a_json_string_payload_is_read_the_same_way(self):
        row = monthly_row()
        row["full_submission"] = json.dumps(row["full_submission"])
        self.assertIsNotNone(parts.monthly_sections(row))

    def test_each_answer_says_how_it_should_be_laid_out(self):
        sections = parts.monthly_sections(monthly_row())["assignment"]
        formats = {e["label"]: e["format"] for s in sections for e in s["entries"]}
        self.assertEqual(formats["Assignment answer"], "text")
        self.assertEqual(formats["Evidence attached"], "evidence")
        self.assertEqual(formats["Time entries"], "time")
        self.assertEqual(formats["KSB claims"], "ksbs")
        self.assertEqual(formats["Confirmations"], "checks")

    def test_steps_stay_in_their_own_tab(self):
        sections = parts.monthly_sections(monthly_row())
        assignment = " ".join(e["text"] for s in sections["assignment"] for e in s["entries"])
        reflection = " ".join(e["text"] for s in sections["reflection"] for e in s["entries"])
        self.assertIn("The budget came from quotations.", assignment)
        self.assertNotIn("The month tied together.", assignment)
        self.assertIn("The month tied together.", reflection)
        self.assertNotIn("The budget came from quotations.", reflection)
        # The booking key itself is not shown, only whether a meeting was booked.
        self.assertNotIn("booking-1", reflection)


class AiDraftTests(SimpleTestCase):
    def test_the_one_feedback_draft_is_written_from_both_tabs(self):
        item = {"learningReflection": "Estimating methods.", "applicationText": "x", "actualTimeHours": "2",
                "monthlySections": parts.monthly_sections(monthly_row())}
        submission = parts.ai_submission(item)
        text = submission["learningReflection"]
        self.assertIn("ASSIGNMENT, KSBs & EVIDENCE (Steps 2-4)", text)
        self.assertIn("REFLECTION (Steps 5-8)", text)
        self.assertIn("Step 2 — Assignment answer", text)
        self.assertIn("Step 8 — Coaching & presentation", text)
        self.assertLess(text.index("Step 4"), text.index("Step 5"))
        self.assertEqual(submission["applicationText"], "")
        self.assertEqual(submission["actualTimeHours"], "2")
