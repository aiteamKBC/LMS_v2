"""Two-part marking of monthly reports, without a database.

The saving path is driven through a mocked cursor so the order and content of
the writes can be asserted: one part alone must only record that part, and the
second part must set the report row the learner sees.
"""
from contextlib import nullcontext
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from coach_api import marking_parts as parts
from coach_api.views import ASSIGNMENT_ACTIVITY_TYPES, MARKING_QUEUE_COLUMNS

SUBMITTED = datetime(2026, 11, 18, 15, 46, 1, 123456, tzinfo=timezone.utc)


def monthly_row(status="submitted_for_tutor_review", marking_parts=None, **monthly):
    full = {
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
    }
    if marking_parts is not None:
        full["markingParts"] = marking_parts
    return {
        "id": "00000000-0000-0000-0000-000000000001",
        "activity_type": "assignment",
        "status": status,
        "submitted_at": SUBMITTED,
        "full_submission": full,
    }


def review(decision, submitted_at=SUBMITTED, feedback="Well done.", reviewer="Coach A"):
    return {
        "decision": decision, "feedback": feedback, "reviewedBy": reviewer,
        "reviewedAt": "2026-11-20T10:00:00+00:00", "submittedAt": parts.submission_token(submitted_at),
    }


class SplitRulesTests(SimpleTestCase):
    def test_a_pending_monthly_report_is_split(self):
        self.assertTrue(parts.is_split(monthly_row()))

    def test_a_report_decided_before_the_split_keeps_its_single_decision(self):
        self.assertFalse(parts.is_split(monthly_row(status="accepted")))

    def test_a_report_decided_through_its_parts_stays_split(self):
        row = monthly_row(status="accepted", marking_parts={
            "assignment": review("accepted"), "reflection": review("accepted"),
        })
        self.assertTrue(parts.is_split(row))

    def test_extra_activities_and_older_assignment_forms_are_not_split(self):
        self.assertFalse(parts.is_split({**monthly_row(), "activity_type": "extra_activity"}))
        older = monthly_row()
        older["full_submission"]["monthlyAssignment"]["version"] = 1
        self.assertFalse(parts.is_split(older))

    def test_a_resubmission_makes_earlier_part_decisions_stale(self):
        stale = review("accepted", submitted_at=SUBMITTED - timedelta(days=3))
        row = monthly_row(marking_parts={"assignment": stale})
        self.assertEqual(parts.current_parts(row), {})
        self.assertEqual(parts.part_row(row, "assignment")["status"], "submitted_for_tutor_review")

    def test_a_json_string_payload_is_read_the_same_way(self):
        import json

        row = monthly_row()
        row["full_submission"] = json.dumps(row["full_submission"])
        self.assertTrue(parts.is_split(row))


class CombinationTests(SimpleTestCase):
    def test_the_report_is_accepted_only_when_both_parts_are(self):
        self.assertEqual(parts.combined_decision("accepted", "accepted"), "accepted")
        self.assertEqual(parts.combined_decision("accepted", "rejected"), "rejected")
        self.assertEqual(parts.combined_decision("referred", "accepted"), "referred")
        self.assertEqual(parts.combined_decision("partial", "accepted"), "partial")

    def test_combined_feedback_names_the_steps_each_section_covers(self):
        html = parts.combined_feedback({
            "assignment": {"feedback": "<p>Strong answer.</p>"},
            "reflection": {"feedback": "Add more on EPA.\nGood plan."},
        })
        self.assertIn("<h3>Assignment feedback (Steps 2–4: Assignment answer, Evidence &amp; cross-referencing, KSBs &amp; hours claimed)</h3><p>Strong answer.</p>", html)
        self.assertIn("<h3>Reflection feedback (Steps 5–8: Full-month reflection, Impact &amp; employer benefit, Action plan &amp; EPA, Coaching &amp; presentation)</h3>", html)
        self.assertIn("<p>Add more on EPA.</p><p>Good plan.</p>", html)
        self.assertLess(html.index("Assignment feedback"), html.index("Reflection feedback"))

    def test_plain_feedback_is_escaped(self):
        html = parts.combined_feedback({
            "assignment": {"feedback": "Use < and > carefully"},
            "reflection": {"feedback": ""},
        })
        self.assertNotIn("<script", html)
        self.assertIn("No additional feedback.", html)


class SectionTests(SimpleTestCase):
    def test_the_assignment_part_holds_steps_two_to_four(self):
        sections = parts.part_sections(monthly_row()["full_submission"], "assignment")
        self.assertEqual([s["step"] for s in sections], [2, 3, 4])
        formats = {e["label"]: e["format"] for s in sections for e in s["entries"]}
        self.assertEqual(formats["Assignment answer"], "text")
        self.assertEqual(formats["Evidence attached"], "evidence")
        self.assertEqual(formats["Time entries"], "time")
        self.assertEqual(formats["KSB claims"], "ksbs")
        self.assertEqual(formats["Confirmations"], "checks")
        texts = " ".join(e["text"] for s in sections for e in s["entries"])
        self.assertNotIn("The month tied together.", texts)

    def test_the_reflection_part_holds_steps_five_to_eight(self):
        sections = parts.part_sections(monthly_row()["full_submission"], "reflection")
        self.assertEqual([s["step"] for s in sections], [5, 6, 7, 8])
        texts = " ".join(e["text"] for s in sections for e in s["entries"])
        self.assertIn("The month tied together.", texts)
        self.assertNotIn("The budget came from quotations.", texts)
        # The booking key itself is not shown, only whether a meeting was booked.
        self.assertNotIn("booking-1", texts)

    def test_the_ai_draft_sees_only_its_part(self):
        row = monthly_row()
        item = parts.apply_part({"learningReflection": "Estimating methods.", "actualTimeHours": "2"}, row, "reflection")
        submission = parts.ai_submission(item)
        self.assertIn("Step 5 — Full-month reflection", submission["learningReflection"])
        self.assertNotIn("Step 2", submission["learningReflection"])
        self.assertEqual(submission["actualTimeHours"], "")

    def test_the_expanded_query_lists_split_rows_once_per_part(self):
        sql = parts.expanded_queue_sql(MARKING_QUEUE_COLUMNS, ASSIGNMENT_ACTIVITY_TYPES)
        self.assertIn("union all", sql)
        self.assertIn("('assignment'), ('reflection')", sql)
        self.assertNotIn("%", sql)  # would collide with psycopg placeholders


class SaveDecisionTests(SimpleTestCase):
    def _save(self, row, part, decision="accepted"):
        from coach_api import views

        cursor = MagicMock()
        cursor.fetchone.side_effect = [
            tuple(row[key] for key in ("id", "activity_type", "status", "submitted_at", "full_submission")),
            (row["id"], "apprenticeship", "42", row["status"], None, None, None, SUBMITTED),
        ]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        audit_columns = ("id", "learner_kind", "learner_id", "status", "coach_feedback", "reviewed_by", "reviewed_at", "submitted_at")
        with patch.object(views, "connections", {"enrolment": connection}), \
                patch.object(views.transaction, "atomic", return_value=nullcontext()), \
                patch.object(views, "SUBMISSION_AUDIT_COLUMNS", audit_columns), \
                patch.object(views, "record_submission_row"), \
                patch("learner_api.marking_tally.refresh_tally_for_submission"):
            response = views.save_marking_part_decision(
                MagicMock(), row["id"], ["42"], part,
                decision=decision, feedback="<p>Clear.</p>", reviewed_by="Coach B",
                pending_ksb_review_sql="false",
            )
        update_sql, update_params = cursor.execute.call_args_list[1].args
        return response, update_sql, update_params

    def test_the_first_part_records_only_that_part(self):
        response, sql, params = self._save(monthly_row(), "assignment")
        self.assertEqual(response.status_code, 200)
        set_clause = sql.split("returning", 1)[0]
        self.assertIn("jsonb_set(full_submission, '{markingParts}'", set_clause)
        self.assertNotIn("status =", set_clause)
        self.assertNotIn("coach_feedback", set_clause)
        self.assertIn('"assignment"', params[0])

    def test_the_second_part_sets_the_report_outcome_and_combined_feedback(self):
        row = monthly_row(marking_parts={"assignment": review("accepted", reviewer="Coach A")})
        response, sql, params = self._save(row, "reflection", decision="rejected")
        self.assertEqual(response.status_code, 200)
        self.assertIn("status = %s, coach_feedback = %s", sql)
        self.assertEqual(params[1], "rejected")
        self.assertIn("Assignment feedback (Steps 2–4", params[2])
        self.assertIn("Reflection feedback (Steps 5–8", params[2])
        self.assertEqual(params[3], "Coach A & Coach B")

    def test_a_report_that_is_not_split_cannot_be_marked_by_part(self):
        from coach_api import views

        cursor = MagicMock()
        row = monthly_row(status="accepted")
        cursor.fetchone.return_value = tuple(row[k] for k in ("id", "activity_type", "status", "submitted_at", "full_submission"))
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(views, "connections", {"enrolment": connection}), \
                patch.object(views.transaction, "atomic", return_value=nullcontext()):
            response = views.save_marking_part_decision(
                MagicMock(), row["id"], ["42"], "assignment",
                decision="accepted", feedback="", reviewed_by="Coach", pending_ksb_review_sql="false",
            )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(cursor.execute.call_count, 1)
