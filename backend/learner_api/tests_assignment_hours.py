"""Daily claim regressions with synthetic in-memory rows and mocked writes."""
import json
import sqlite3
from decimal import Decimal
from inspect import unwrap
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from .assignment_hours import daily_totals, daily_limit_error, saved_daily_totals, validate_saved_daily_hours
from .monthly_assignment import assignment_checks, complete_saved_assignment, valid_time_entries


def entry(hours, day="2026-09-01"):
    return {"topic": "Research", "hours": str(hours), "date": day}


class AssignmentHoursTests(SimpleTestCase):
    def test_same_day_rows_share_eight_hours_and_different_days_do_not(self):
        self.assertEqual(daily_limit_error([entry(5), entry(3)]), "")
        self.assertIn("maximum 8 hours per day", daily_limit_error([entry(5), entry("3.01")]))
        self.assertEqual(daily_limit_error([entry(8), entry(8, "2026-09-02")]), "")
        self.assertFalse(valid_time_entries({"month": "2026-09", "timeEntries": [entry(5), entry(4)]}, 9, daily_limit=True))

    def test_exact_decimal_limit_and_partial_drafts(self):
        self.assertEqual(daily_limit_error([entry("0.1")] * 80), "")
        self.assertTrue(daily_limit_error([entry("0.1")] * 81))
        self.assertEqual(daily_totals([{}, None, entry("NaN"), entry("Infinity"), entry(-1), entry(8, "")]), {})
        self.assertEqual(daily_totals([{**entry(2), "topic": ""}]), {"2026-09-01": Decimal(2)})
        self.assertEqual(daily_limit_error([entry(2)], {"2026-09-01": Decimal(6)}), "")
        self.assertIn("up to 1.5 hours", daily_limit_error([entry(2)], {"2026-09-01": Decimal("6.5")}))

    def test_saved_totals_include_drafts_other_topics_and_other_assignments_only_for_same_learner(self):
        with sqlite3.connect(":memory:") as db:
            db.execute('ATTACH DATABASE \':memory:\' AS "Learner"')
            db.execute('CREATE TABLE "Learner".learning_reflection_submissions (learner_kind TEXT, learner_id TEXT, activity_type TEXT, activity_id TEXT, assignment_topic_id TEXT, status TEXT, full_submission TEXT)')
            rows = [
                ("commercial", "1", "assignment", "A", "1", "draft", [entry(2)]),
                ("commercial", "1", "assignment", "A", "2", "draft", [entry(1)]),
                ("commercial", "1", "assignment", "B", "1", "submitted_for_tutor_review", [entry(3)]),
                ("commercial", "1", "assignment", "C", "", "accepted", [entry(1), entry(8, "2026-09-02")]),
                ("commercial", "2", "assignment", "B", "1", "draft", [entry(8)]),
                ("apprenticeship", "1", "assignment", "B", "1", "draft", [entry(8)]),
                ("commercial", "1", "reading", "D", "", "accepted", [entry(8)]),
                ("commercial", "1", "extra_activity", "extra:1", "", "draft", [entry(8)]),
                ("commercial", "1", "assignment", "OLD", "", "accepted", None),
            ]
            for *identity, entries in rows:
                db.execute('INSERT INTO "Learner".learning_reflection_submissions VALUES (?, ?, ?, ?, ?, ?, ?)',
                           [*identity, json.dumps({"monthlyAssignment": {"timeEntries": entries}})])
            cursor = db.cursor()

            class ReadCursor:
                def execute(self, sql, params):
                    sql = sql.replace("full_submission #> '{monthlyAssignment,timeEntries}'", "json_extract(full_submission, '$.monthlyAssignment.timeEntries')")
                    cursor.execute(sql.replace("%s", "?"), params)

                def fetchall(self):
                    return cursor.fetchall()

            # Editing A/1 replaces its two hours, while A/2 still counts.
            totals = saved_daily_totals(ReadCursor(), "commercial", "1", "A", "1")
            self.assertEqual(totals, {"2026-09-01": Decimal(5), "2026-09-02": Decimal(8)})
            self.assertEqual(saved_daily_totals(ReadCursor(), "apprenticeship", "1", "NEW"),
                             {"2026-09-01": Decimal(8)})

    def test_quality_check_rejects_cross_assignment_totals_and_preserves_check_contract(self):
        payload = {"learnerKind": "commercial", "learnerId": "1", "activityType": "assignment", "activityId": "A",
                   "assignmentTopicId": "2", "actualTimeHours": "3",
                   "monthlyAssignment": {"month": "2026-09", "timeEntries": [entry(3)]}}
        with patch("learner_api.monthly_assignment.valid_presentation", return_value=False):
            checks = assignment_checks(payload, evidence_ids=set(), meeting_booked=False, allowed_ksbs=set(),
                                       claimed_hours={"2026-09-01": Decimal(6)})
        self.assertEqual(len(checks), 13)
        hours = next(check for check in checks if check["key"] == "hours")
        self.assertFalse(hours["passed"])
        self.assertIn("Other topics and assignments use 6 hours", hours["label"])
        self.assertIn("up to 2 hours", hours["label"])

    def test_extra_activity_keeps_existing_per_row_rule_without_assignment_lookup(self):
        payload = {"learnerKind": "commercial", "learnerId": "1", "activityType": "extra_activity", "actualTimeHours": "16",
                   "monthlyAssignment": {"month": "2026-09", "timeEntries": [entry(8), entry(8)]}}
        with patch("learner_api.monthly_assignment.valid_presentation", return_value=False), patch("learner_api.monthly_assignment.connections") as connections:
            checks = assignment_checks(payload, evidence_ids=set(), meeting_booked=False, allowed_ksbs=set())
        self.assertTrue(next(check["passed"] for check in checks if check["key"] == "hours"))
        connections.__getitem__.assert_not_called()

    def test_legacy_aggregate_time_has_no_invented_work_date(self):
        self.assertTrue(valid_time_entries({"month": "2026-09"}, 16, daily_limit=True))
        cur = MagicMock()
        validate_saved_daily_hours(cur, {"monthlyAssignment": {"month": "2026-09"}})
        cur.execute.assert_not_called()


class AssignmentHoursPersistenceTests(SimpleTestCase):
    def post(self, hours, saved=(), kind="commercial", mode="draft", day="2026-09-01"):
        from .reflection_submissions import _submit_reflection
        payload = {"learnerKind": kind, "learnerId": "1", "activityType": "assignment", "activityId": "A",
                   "submissionMode": mode, "assignmentAnswer": "Answer", "whatYouLearned": "Learned",
                   "businessImpact": "Impact", "actualTimeHours": str(hours),
                   "monthlyAssignment": {"month": "2026-09", "timeEntries": [entry(hours, day)]}}
        cur = MagicMock()
        cur.fetchone.side_effect = [None, ("saved",)]
        cur.fetchall.return_value = [(items,) for items in saved]
        with patch("learner_api.reflection_submissions.connections") as conn, patch("learner_api.reflection_submissions.transaction.atomic"), patch("learner_api.reflection_submissions._reflection_lineage", return_value={}), patch("learner_api.reflection_submissions.record_submission_row"), patch("learner_api.programme_access.submission_refusal", return_value=None), patch("learner_api.monthly_assignment.assignment_checks", return_value=[{"passed": True}]):
            conn.__getitem__.return_value.cursor.return_value.__enter__.return_value = cur
            response = unwrap(_submit_reflection)(RequestFactory().post("/", json.dumps(payload), content_type="application/json"))
        return response, cur

    def test_draft_and_direct_submit_cannot_exceed_other_saved_assignment_hours(self):
        for kind in ("commercial", "apprenticeship"):
            for mode in ("draft", "submit"):
                with self.subTest(kind=kind, mode=mode):
                    response, cur = self.post(3, [[entry(6)]], kind, mode)
                    self.assertEqual(response.status_code, 409)
                    self.assertIn("maximum 8 hours per day", json.loads(response.content)["error"])
                    self.assertFalse(any("insert into" in call.args[0].lower() for call in cur.execute.call_args_list))

    def test_eight_hours_total_saves_draft_and_different_dates_are_independent(self):
        for hours, day in ((2, "2026-09-01"), (8, "2026-09-02")):
            response, cur = self.post(hours, [[entry(6)]], day=day)
            self.assertEqual(response.status_code, 201)
            self.assertIn("pg_advisory_xact_lock", cur.execute.call_args_list[0].args[0])
            self.assertIn("for update", cur.execute.call_args_list[1].args[0].lower())
            self.assertEqual(cur.execute.call_args_list[0].args[1], [json.dumps(["assignment-daily-hours", "commercial", "1"])])

    def test_reducing_saved_hours_releases_the_allowance_and_current_row_is_excluded(self):
        response, cur = self.post(1, [[entry(6)]])
        self.assertEqual(response.status_code, 201)
        lookup = next(call for call in cur.execute.call_args_list if "SELECT full_submission #>" in call.args[0])
        self.assertEqual(lookup.args[1], ["commercial", "1", "A", ""])
        self.assertIn("AND NOT (activity_id = %s AND assignment_topic_id = %s)", lookup.args[0])

    def test_completion_rechecks_after_taking_the_same_learner_lock(self):
        payload = {"monthlyAssignment": {"month": "2026-09", "timeEntries": [entry(3)], "claims": []}, "actualTimeHours": "3"}
        cur = MagicMock()
        cur.fetchone.return_value = ("saved", "draft", payload)
        cur.fetchall.return_value = [([entry(6)],)]
        save = MagicMock()
        with patch("learner_api.monthly_assignment.connections") as conn, patch("learner_api.monthly_assignment.transaction.atomic"), patch("learner_api.monthly_assignment.booked_coaching", return_value=True), patch("learner_api.monthly_assignment.valid_presentation", return_value=False):
            conn.__getitem__.return_value.cursor.return_value.__enter__.return_value = cur
            with self.assertRaisesMessage(ValueError, "recheck before submitting"):
                complete_saved_assignment("commercial", "1", "A", {}, save, assignment_topic="2")
        save.assert_not_called()
        self.assertIn("pg_advisory_xact_lock", cur.execute.call_args_list[0].args[0])
        self.assertEqual(cur.execute.call_args_list[-1].args[1], ["commercial", "1", "A", "2"])
        self.assertFalse(any("UPDATE " in call.args[0] for call in cur.execute.call_args_list))

    def test_omitting_time_entries_does_not_erase_an_existing_daily_reservation(self):
        from .reflection_submissions import _submit_reflection
        original = {"monthlyAssignment": {"month": "2026-09", "timeEntries": [entry(6)]}}
        payload = {"learnerKind": "commercial", "learnerId": "1", "activityType": "assignment", "activityId": "A",
                   "submissionMode": "draft", "monthlyAssignment": {"month": "2026-09", "actionPlan": "Updated"}}
        cur = MagicMock()
        cur.fetchone.side_effect = [("draft", original, None, None, None, None), ("saved",)]
        cur.fetchall.return_value = []
        with patch("learner_api.reflection_submissions.connections") as conn, patch("learner_api.reflection_submissions.transaction.atomic"), patch("learner_api.reflection_submissions._reflection_lineage", return_value={}), patch("learner_api.reflection_submissions.record_submission_row"):
            conn.__getitem__.return_value.cursor.return_value.__enter__.return_value = cur
            response = unwrap(_submit_reflection)(RequestFactory().post("/", json.dumps(payload), content_type="application/json"))
        self.assertEqual(response.status_code, 201)
        saved = json.loads(cur.execute.call_args.args[1][30])
        self.assertEqual(saved["monthlyAssignment"]["timeEntries"], [entry(6)])
        self.assertEqual(saved["monthlyAssignment"]["actionPlan"], "Updated")

    def test_new_submission_cannot_bypass_dated_claims_by_omitting_time_entries(self):
        from .reflection_submissions import _submit_reflection
        payload = {"learnerKind": "commercial", "learnerId": "1", "activityType": "assignment", "activityId": "A",
                   "submissionMode": "submit", "assignmentAnswer": "Answer", "whatYouLearned": "Learned",
                   "businessImpact": "Impact", "actualTimeHours": "16", "monthlyAssignment": {"month": "2026-09"}}
        cur = MagicMock()
        cur.fetchone.return_value = None
        def check(data):
            return [{"key": "hours", "label": "Dated hours required", "passed": valid_time_entries(data["monthlyAssignment"], 16, daily_limit=True)}]
        with patch("learner_api.reflection_submissions.connections") as conn, patch("learner_api.reflection_submissions.transaction.atomic"), patch("learner_api.reflection_submissions._reflection_lineage", return_value={}), patch("learner_api.programme_access.submission_refusal", return_value=None), patch("learner_api.monthly_assignment.assignment_checks", side_effect=check):
            conn.__getitem__.return_value.cursor.return_value.__enter__.return_value = cur
            response = unwrap(_submit_reflection)(RequestFactory().post("/", json.dumps(payload), content_type="application/json"))
        self.assertEqual(response.status_code, 400)
        self.assertFalse(any("insert into" in call.args[0].lower() for call in cur.execute.call_args_list))
