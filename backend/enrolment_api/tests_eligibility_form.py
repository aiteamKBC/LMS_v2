"""The public apprenticeship eligibility form: validation, the insert, and that
the endpoint is reachable without a session while nothing else is opened.

SimpleTestCase with a recording fake cursor: no query reaches a database.
"""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from enrolment_api import eligibility_form as ef
from login.api_gate import rule_for

URL = "/enrolment_api/public/apprenticeship-application/"
TODAY = date(2026, 10, 14)


class FakeCursor:
    def __init__(self, fail=False):
        self.executed = []
        self.fail = fail

    def execute(self, sql, params=None):
        if self.fail:
            raise DatabaseError('relation "enrolment.eligibility_form" does not exist')
        self.executed.append((" ".join(sql.split()), params))

    def fetchone(self):
        return (41,)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def application(**overrides):
    body = {
        "firstName": "Sam",
        "surname": "Example",
        "workEmail": "sam@employer.example",
        "phoneNumber": "",
        "fullAddress": "1 Example Street, Exampletown",
        "postcode": "EX1 2MP",
        "dateOfBirth": "1995-04-03",
        "employmentStatus": "In paid employment",
        "majorityHoursInEngland": True,
        "employerName": "Example Ltd",
        "employerAddress": "2 Business Park, Exampletown",
        "employerPostcode": "EX3 4MP",
        "representativeName": "Alex Manager",
        "representativeEmail": "alex@employer.example",
        "livesInUk": True,
        "residenceNotForEducation": True,
        "residencyStatus": "Pre-settled Status",
        "programme": "Associate Project Manager Level 4",
        "attendedFundedTraining": False,
        "fundedTrainingCompletedOn": None,
        "notPreviouslyCompletedProgramme": True,
    }
    body.update(overrides)
    return body


class CleanApplicationTests(SimpleTestCase):
    def test_a_complete_application_maps_every_answer_to_its_column(self):
        row, errors = ef.clean_application(application(), today=TODAY)
        self.assertEqual(errors, {})
        self.assertEqual(set(row), set(ef.COLUMNS))
        self.assertEqual(row["first_name"], "Sam")
        self.assertEqual(row["date_of_birth"], date(1995, 4, 3))
        self.assertIs(row["majority_hours_in_england"], True)
        self.assertEqual(row["residency_status"], "Pre-settled Status")
        # The optional phone number, left blank, is stored as NULL, not "".
        self.assertIsNone(row["phone_number"])

    def test_every_required_answer_is_reported_when_missing(self):
        row, errors = ef.clean_application({}, today=TODAY)
        required = {key for key, _col, _kind, req, _lim in ef.FIELDS if req}
        self.assertEqual(set(errors), required)
        self.assertNotIn("phoneNumber", errors)
        self.assertNotIn("fundedTrainingCompletedOn", errors)

    def test_completion_date_is_required_only_after_yes(self):
        _row, errors = ef.clean_application(application(attendedFundedTraining=True), today=TODAY)
        self.assertEqual(errors, {"fundedTrainingCompletedOn": ef.REQUIRED})

        row, errors = ef.clean_application(
            application(attendedFundedTraining=True, fundedTrainingCompletedOn="2026-03-01"), today=TODAY,
        )
        self.assertEqual(errors, {})
        self.assertEqual(row["funded_training_completed_on"], date(2026, 3, 1))

    def test_a_completion_date_left_over_from_a_changed_answer_is_not_stored(self):
        row, errors = ef.clean_application(
            application(attendedFundedTraining=False, fundedTrainingCompletedOn="not a date"), today=TODAY,
        )
        self.assertEqual(errors, {})
        self.assertIsNone(row["funded_training_completed_on"])

    def test_answers_outside_the_form_are_refused(self):
        _row, errors = ef.clean_application(application(
            employmentStatus="Retired",
            programme="Some Other Programme",
            livesInUk="yes",
            workEmail="not-an-email",
            dateOfBirth="2030-01-01",
            firstName="x" * 101,
        ), today=TODAY)
        self.assertEqual(set(errors), {
            "employmentStatus", "programme", "livesInUk", "workEmail", "dateOfBirth", "firstName",
        })
        self.assertEqual(errors["dateOfBirth"], "The date cannot be in the future.")

    def test_no_eligibility_rule_is_applied(self):
        # Collect only: staff assess eligibility, so a "No" or a young applicant is stored as given.
        _row, errors = ef.clean_application(application(
            livesInUk=False, majorityHoursInEngland=False, notPreviouslyCompletedProgramme=False,
            dateOfBirth="2015-01-01",
        ), today=TODAY)
        self.assertEqual(errors, {})

    def test_single_line_answers_are_trimmed(self):
        row, _errors = ef.clean_application(application(firstName="  Sam \n ", postcode=" EX1   2MP "), today=TODAY)
        self.assertEqual(row["first_name"], "Sam")
        self.assertEqual(row["postcode"], "EX1 2MP")


class SubmitApplicationTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def post(self, body, cursor=None, **headers):
        headers.setdefault("HTTP_X_REQUESTED_WITH", "XMLHttpRequest")
        data = body if isinstance(body, (str, bytes)) else json.dumps(body)
        request = self.factory.post(URL, data=data, content_type="application/json", **headers)
        cursor = cursor or FakeCursor()
        connections = {ef.CONN: SimpleNamespace(cursor=lambda: cursor)}
        with patch.object(ef, "connections", connections):
            return ef.submit_application(request), cursor

    def test_inserts_one_row_and_echoes_nothing_stored(self):
        response, cursor = self.post(application(id=7, submitted_at="2000-01-01", Password="x"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(json.loads(response.content), {"submitted": True})
        self.assertEqual(len(cursor.executed), 1)
        sql, params = cursor.executed[0]
        self.assertTrue(sql.startswith("INSERT INTO enrolment.eligibility_form ("))
        # Only the form's own columns: the client cannot set id, timestamps or anything else.
        self.assertIn(f"({', '.join(ef.COLUMNS)})", sql)
        self.assertEqual(len(params), len(ef.COLUMNS))
        self.assertEqual(params[ef.COLUMNS.index("programme")], "Associate Project Manager Level 4")

    def test_invalid_answers_are_returned_by_field_and_nothing_is_saved(self):
        response, cursor = self.post(application(surname="", programme="Other"))
        self.assertEqual(response.status_code, 400)
        payload = json.loads(response.content)
        self.assertEqual(set(payload["fields"]), {"surname", "programme"})
        self.assertEqual(cursor.executed, [])

    def test_requires_the_csrf_header(self):
        request = self.factory.post(URL, data=json.dumps(application()), content_type="application/json")
        self.assertEqual(ef.submit_application(request).status_code, 403)

    def test_only_post_is_accepted(self):
        request = self.factory.get(URL, HTTP_X_REQUESTED_WITH="XMLHttpRequest")
        self.assertEqual(ef.submit_application(request).status_code, 405)

    def test_rejects_malformed_and_oversized_bodies(self):
        self.assertEqual(self.post("{not json")[0].status_code, 400)
        self.assertEqual(self.post("[1, 2]")[0].status_code, 400)
        self.assertEqual(self.post(application(fullAddress="x" * ef.MAX_BODY_BYTES))[0].status_code, 413)

    def test_a_database_failure_is_reported_without_its_details(self):
        with self.assertLogs("enrolment_api.eligibility_form", level="ERROR"):
            response, _cursor = self.post(application(), cursor=FakeCursor(fail=True))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("relation", response.content.decode())


class TableTests(SimpleTestCase):
    def test_ddl_creates_every_column_the_insert_writes(self):
        cursor = FakeCursor()
        ef.ensure_table(cursor)
        statements = [sql for sql, _params in cursor.executed]
        self.assertEqual(statements[0], "CREATE SCHEMA IF NOT EXISTS enrolment")
        self.assertTrue(statements[1].startswith("CREATE TABLE IF NOT EXISTS enrolment.eligibility_form ("))
        for column in ef.COLUMNS:
            self.assertIn(f" {column} ", statements[1])
        # Never alters or drops an existing table.
        self.assertFalse(any("DROP" in sql or "ALTER" in sql for sql in statements))


class GateTests(SimpleTestCase):
    def test_only_the_exact_application_path_is_open(self):
        self.assertIsNone(rule_for(URL))
        self.assertIsNotNone(rule_for(URL + "extra/"))
        self.assertIsNotNone(rule_for("/enrolment_api/public/"))
        self.assertIsNotNone(rule_for("/enrolment_api/wizard-layout/"))

    def test_reachable_without_a_session_through_the_full_stack(self):
        cursor = FakeCursor()
        connections = {ef.CONN: SimpleNamespace(cursor=lambda: cursor)}
        with patch.dict("os.environ", {"API_REQUIRE_AUTH": "1"}), patch.object(ef, "connections", connections):
            response = self.client.post(
                URL, data=json.dumps(application()), content_type="application/json",
                HTTP_X_REQUESTED_WITH="XMLHttpRequest",
            )
            neighbour = self.client.get("/enrolment_api/wizard-layout/")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(len(cursor.executed), 1)
        # The rest of the app is still closed to the same anonymous caller.
        self.assertEqual(neighbour.status_code, 401)
