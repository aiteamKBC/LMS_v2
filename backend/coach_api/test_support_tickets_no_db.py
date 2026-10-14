"""Coach support tickets: caseload scoping, the wellbeing-only status rule and
the Inclusion app's note format. The Inclusion database is a fake connection;
nothing here can reach it."""
import inspect
import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import support_tickets
from coach_api.support_tickets import (
    coach_support_ticket_notes,
    coach_support_ticket_status,
    coach_support_tickets,
    safeguarding_connection_string,
)

COACH = "coach@example.invalid"
CREATED = datetime(2026, 9, 1, 9, 0, tzinfo=timezone.utc)


def learner(learner_id, email, name="Learner"):
    return SimpleNamespace(id=learner_id, full_name=name, email=email, programme="Programme",
                           cohort="Cohort", group_name="Group", programme_status="Delivery")


def ticket(ticket_id, email, *, ticket_type="wellbeing", status="under review", **extra):
    row = {
        "id": ticket_id, "ticket_type": ticket_type, "full_name": "Learner", "email": email,
        "subject": "Subject", "details": "Details", "urgency": "low", "preferred_contact": "email",
        "status": status, "created_at": CREATED, "updated_at": CREATED, "days_to_close": None,
        "assigned_owner": "", "is_archived": False,
        "notes": [{"id": "n1", "note": "Earlier", "created_at": "2026-09-01T10:00:00+00:00", "created_by": "dsl"}],
        "evidence": [{"id": "e1", "file_name": "letter.pdf", "mime_type": "application/pdf",
                      "url": "https://admin.example.invalid/file", "data_url": "data:application/pdf;base64,AAAA"}],
    }
    row.update(extra)
    return row


class FakeResult:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class FakeConnection:
    """Answers SELECTs from `rows`; records every UPDATE and echoes the row."""

    def __init__(self, rows):
        self.rows = {row["id"]: row for row in rows}
        self.statements = []
        self.read_only = False

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def transaction(self):
        return self

    def execute(self, sql, params):
        self.statements.append((sql, params))
        if sql.lstrip().lower().startswith("update"):
            row = dict(self.rows[params[-1]])
            notes = list(row["notes"])
            if "set status" in sql:
                row["status"] = params[0]
                notes += params[1].obj
            else:
                notes += params[0].obj
            row["notes"] = notes
            return FakeResult([row])
        if "any(%s)" in sql:
            emails = set(params[0])
            return FakeResult([
                {**row, "email_key": row["email"].lower()}
                for row in self.rows.values() if row["email"].lower() in emails
            ])
        return FakeResult([row for row in self.rows.values() if row["id"] == params[0]])

    def updates(self):
        return [statement for statement in self.statements if statement[0].lstrip().lower().startswith("update")]


def unwrapped(view):
    return inspect.unwrap(view)


class SupportTicketViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.caseload = [learner(1, "mine@example.invalid", "Mine")]

    def request(self, method, body=None, *, view_as=False):
        path = "/coach_api/coach/support-tickets"
        request = self.factory.get(path) if method == "get" else getattr(self.factory, method)(
            path, data=json.dumps(body or {}), content_type="application/json",
        )
        request.coach_email = COACH
        request.coach_view_as = view_as
        return request

    def run_view(self, view, conn, *args, method="get", body=None, view_as=False):
        with patch.object(support_tickets, "caseload_learners", return_value=self.caseload), \
                patch.object(support_tickets, "_connect", return_value=conn):
            response = unwrapped(view)(self.request(method, body, view_as=view_as), *args)
        return response.status_code, json.loads(response.content)

    def test_list_queries_only_caseload_emails_and_never_sends_inline_files(self):
        conn = FakeConnection([ticket(10, "Mine@example.invalid"), ticket(11, "other@example.invalid")])
        status, payload = self.run_view(coach_support_tickets, conn)

        self.assertEqual(status, 200)
        self.assertEqual(conn.statements[0][1], [["mine@example.invalid"]])
        self.assertEqual([item["learnerId"] for item in payload["learners"]], [1])
        tickets = payload["learners"][0]["tickets"]
        self.assertEqual([item["id"] for item in tickets], [10])
        self.assertNotIn("data_url", json.dumps(payload))
        self.assertEqual(tickets[0]["evidence"][0]["url"], "https://admin.example.invalid/file")
        self.assertTrue(tickets[0]["canChangeStatus"])
        self.assertTrue(conn.read_only)

    def test_view_as_reads_with_every_action_disabled(self):
        conn = FakeConnection([ticket(10, "mine@example.invalid")])
        _, payload = self.run_view(coach_support_tickets, conn, view_as=True)

        self.assertTrue(payload["readOnly"])
        only = payload["learners"][0]["tickets"][0]
        self.assertFalse(only["canChangeStatus"])
        self.assertFalse(only["canAddNote"])

    def test_safeguarding_ticket_status_is_shown_locked(self):
        conn = FakeConnection([ticket(10, "mine@example.invalid", ticket_type="safeguarding")])
        _, payload = self.run_view(coach_support_tickets, conn)

        only = payload["learners"][0]["tickets"][0]
        self.assertFalse(only["canChangeStatus"])
        self.assertTrue(only["canAddNote"])

    def test_wellbeing_status_change_is_logged_like_the_inclusion_app(self):
        conn = FakeConnection([ticket(10, "mine@example.invalid")])
        status, payload = self.run_view(coach_support_ticket_status, conn, 10, method="patch",
                                        body={"status": "assigned", "expectedStatus": "under review"})

        self.assertEqual(status, 200)
        self.assertEqual(payload["ticket"]["status"], "assigned")
        [(sql, params)] = conn.updates()
        self.assertIn("for update", conn.statements[0][0])
        self.assertIn("days_to_close", sql)
        [activity] = params[1].obj
        self.assertEqual(activity["type"], "activity")
        self.assertEqual(activity["note"], "Status changed from Under Review to Assigned")
        self.assertEqual(activity["created_by"], COACH)
        self.assertEqual(params[-1], 10)

    def test_safeguarding_status_change_is_refused(self):
        conn = FakeConnection([ticket(10, "mine@example.invalid", ticket_type="safeguarding")])
        status, payload = self.run_view(coach_support_ticket_status, conn, 10, method="patch",
                                        body={"status": "closed", "expectedStatus": "under review"})

        self.assertEqual((status, payload["error"]), (403, "ticket_status_locked"))
        self.assertEqual(conn.updates(), [])

    def test_ticket_of_a_learner_off_the_caseload_is_not_found(self):
        conn = FakeConnection([ticket(11, "other@example.invalid")])
        for view, body in ((coach_support_ticket_status, {"status": "closed", "expectedStatus": "under review"}),
                           (coach_support_ticket_notes, {"note": "Hello"})):
            with self.subTest(view=view.__name__):
                method = "patch" if view is coach_support_ticket_status else "post"
                status, _ = self.run_view(view, conn, 11, method=method, body=body)
                self.assertEqual(status, 404)
        self.assertEqual(conn.updates(), [])

    def test_a_status_moved_by_someone_else_is_not_overwritten(self):
        conn = FakeConnection([ticket(10, "mine@example.invalid", status="action in progress")])
        status, payload = self.run_view(coach_support_ticket_status, conn, 10, method="patch",
                                        body={"status": "closed", "expectedStatus": "under review"})

        self.assertEqual((status, payload["error"]), (409, "ticket_status_conflict"))
        self.assertEqual(conn.updates(), [])

    def test_unknown_status_is_rejected_before_any_connection(self):
        with patch.object(support_tickets, "_connect") as connect:
            response = unwrapped(coach_support_ticket_status)(
                self.request("patch", {"status": "resolved", "expectedStatus": "new"}), 10,
            )
        self.assertEqual(response.status_code, 400)
        connect.assert_not_called()

    def test_note_on_a_safeguarding_ticket_is_appended_as_a_plain_note(self):
        conn = FakeConnection([ticket(10, "mine@example.invalid", ticket_type="safeguarding")])
        status, payload = self.run_view(coach_support_ticket_notes, conn, 10, method="post",
                                        body={"note": "  Called the learner.  "})

        self.assertEqual(status, 201)
        [(sql, params)] = conn.updates()
        self.assertNotIn("set status", sql)
        [entry] = params[0].obj
        self.assertEqual(entry["note"], "Called the learner.")
        self.assertEqual(entry["created_by"], COACH)
        self.assertNotIn("type", entry)
        self.assertEqual(len(entry["id"]), 32)
        self.assertEqual(payload["ticket"]["notes"][0]["note"], "Called the learner.")

    def test_blank_note_is_rejected(self):
        with patch.object(support_tickets, "_connect") as connect:
            response = unwrapped(coach_support_ticket_notes)(self.request("post", {"note": "   "}), 10)
        self.assertEqual(response.status_code, 400)
        connect.assert_not_called()

    def test_no_caseload_returns_empty_without_connecting(self):
        self.caseload = []
        with patch.object(support_tickets, "caseload_learners", return_value=[]), \
                patch.object(support_tickets, "_connect") as connect:
            response = unwrapped(coach_support_tickets)(self.request("get"))
        self.assertEqual(json.loads(response.content)["learners"], [])
        connect.assert_not_called()


class SafetyTests(SimpleTestCase):
    def test_the_test_runner_never_receives_the_inclusion_dsn(self):
        with patch.dict("os.environ", {"SafeGuarding_database_url": "postgresql://u:p@host.invalid/db"}):
            self.assertEqual(safeguarding_connection_string(), "")

    def test_write_views_stay_refused_for_admin_view_as(self):
        # coach_access_required refuses unsafe methods under view-as unless a
        # view opts out with one of these markers; these must never opt out.
        for view in (coach_support_ticket_status, coach_support_ticket_notes):
            with self.subTest(view=view.__name__):
                self.assertFalse(getattr(view, "coach_view_as_safe", False))
                self.assertFalse(getattr(view, "coach_view_as_attributed", False))


class JsonTextTests(SimpleTestCase):
    """Inside Django, psycopg returns jsonb as text; it must still be read."""

    def test_notes_and_evidence_arrive_as_text(self):
        row = ticket(10, "mine@example.invalid")
        row["notes"] = json.dumps(row["notes"])
        row["evidence"] = json.dumps(row["evidence"])
        serialized = support_tickets.serialize_ticket(row, read_only=False)
        self.assertEqual([note["note"] for note in serialized["notes"]], ["Earlier"])
        self.assertEqual([item["fileName"] for item in serialized["evidence"]], ["letter.pdf"])

    def test_inline_file_copies_are_stripped_in_sql(self):
        self.assertIn("- 'data_url'", support_tickets.TICKET_COLUMNS)


SUBMISSION = {
    "risk_level": "Low",
    "scores": {"overall": 2.54, "mental": 3.88, "protective": 1.33, "provider": 2.6, "safeguarding": 1.0},
    "score_labels": {"overall": "Overall Score", "mental": "Mental Health", "protective": "Protective Factors",
                     "provider": "Provider Support", "safeguarding": "Safeguarding Safety"},
    "answers": [
        {"question_id": 1, "question_text": "I feel under constant pressure.", "category_name": "Personal Wellbeing",
         "construct_type": "Stress & Pressure", "raw_answer": 8, "normalized_score": 8, "max_score": 10,
         "is_reverse_scored": False, "trigger_rule": "high score"},
        {"question_id": 2, "question_text": "I feel that I belong.", "category_name": "Provider Culture",
         "construct_type": "Belonging at Provider", "raw_answer": 5, "normalized_score": 6, "max_score": 10,
         "is_reverse_scored": True, "trigger_rule": "low score"},
        {"question_id": 3, "question_text": "I feel safe.", "category_name": "Safeguarding",
         "construct_type": "Domestic Safety", "raw_answer": 1, "normalized_score": 1, "max_score": 10,
         "is_reverse_scored": False, "trigger_rule": "high score"},
    ],
    "triggers": {"high": [{"question_id": 1}], "medium": [{"question_id": 2}], "pattern": ["protective_above_5"]},
}


class ReportConnection(FakeConnection):
    def __init__(self, tickets, surveys):
        super().__init__(tickets)
        self.surveys = surveys

    def execute(self, sql, params):
        self.statements.append((sql, params))
        if "wellbeing_safeguarding_monitoring_system" in sql:
            return FakeResult([self.surveys[params[0]]] if params[0] in self.surveys else [])
        return FakeResult([row for row in self.rows.values() if row["id"] == params[0]])


class WellbeingReportTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.caseload = [learner(1, "mine@example.invalid", "Mine")]

    def fetch(self, conn, ticket_id=10):
        request = self.factory.get("/coach_api/coach/support-tickets/10/wellbeing-report")
        request.coach_email = COACH
        request.coach_view_as = False
        with patch.object(support_tickets, "caseload_learners", return_value=self.caseload), \
                patch.object(support_tickets, "_connect", return_value=conn):
            response = unwrapped(support_tickets.coach_support_ticket_wellbeing_report)(request, ticket_id)
        return response.status_code, json.loads(response.content)

    def survey(self, submission=SUBMISSION):
        return {"submission_json": json.dumps(submission), "risk_level": "Low", "trigger_count": 3,
                "submitted_at": datetime(2026, 9, 30, 12, 7)}

    def test_report_maps_answers_flags_and_reasons(self):
        conn = ReportConnection([ticket(10, "mine@example.invalid", wellbeing_record_id=5)], {5: self.survey()})
        status, payload = self.fetch(conn)
        report = payload["report"]

        self.assertEqual(status, 200)
        self.assertTrue(report["available"])
        self.assertEqual(report["counts"], {"riskFlags": 2, "high": 1, "medium": 1, "answers": 3})
        self.assertEqual([answer["flag"] for answer in report["answers"]], ["high", "medium", None])
        self.assertEqual(report["answers"][0]["whyFlagged"], "High answer on a risk question")
        self.assertEqual(report["answers"][1]["whyFlagged"], "Low answer on a positive question")
        self.assertEqual(report["answers"][2]["whyFlagged"], "")
        self.assertEqual(report["patterns"], ["protective_above_5"])
        self.assertEqual(report["scores"][1], {"key": "mental", "label": "Mental Health", "value": 3.88})
        self.assertEqual(report["submittedAt"], "2026-09-30T12:07:00+00:00")
        self.assertTrue(conn.read_only)

    def test_report_never_selects_contact_or_manager_details(self):
        conn = ReportConnection([ticket(10, "mine@example.invalid", wellbeing_record_id=5)], {5: self.survey()})
        self.fetch(conn)
        survey_sql = next(sql for sql, _ in conn.statements if "monitoring_system" in sql).lower()
        for column in ("learner_phone", "learner_address", "postcode", "manager_name", "manager_email", "coach_phone"):
            self.assertNotIn(column, survey_sql)

    def test_report_of_a_learner_off_the_caseload_is_not_found(self):
        conn = ReportConnection([ticket(11, "other@example.invalid", wellbeing_record_id=5)], {5: self.survey()})
        status, _ = self.fetch(conn, ticket_id=11)
        self.assertEqual(status, 404)
        self.assertFalse(any("monitoring_system" in sql for sql, _ in conn.statements))

    def test_ticket_without_a_stored_survey_says_so(self):
        conn = ReportConnection([ticket(10, "mine@example.invalid", wellbeing_record_id=5)],
                                {5: {"submission_json": None, "risk_level": None, "trigger_count": None, "submitted_at": None}})
        _, payload = self.fetch(conn)
        self.assertEqual(payload["report"], {"available": False})
