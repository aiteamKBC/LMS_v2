"""Tests for the learner monthly report endpoints and deployment SQL."""

from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace

from django.db import connections
from django.test import RequestFactory, SimpleTestCase
from django.urls import reverse

from learner_api.monthly_reports import monthly_reports


SQL_PATH = (
    Path(__file__).resolve().parent / "sql" / "learner_monthly_reports.sql"
)
DEPLOYMENT_SQL = SQL_PATH.read_text(encoding="utf-8")


class MonthlyReportSqlTests(SimpleTestCase):
    """The deployment artifact must be safe to apply repeatedly."""

    databases = {"default", "enrolment"}

    @property
    def connection(self):
        return connections["enrolment"]

    def _assert_test_database(self):
        name = self.connection.settings_dict["NAME"]
        self.assertTrue(
            name.startswith("test_"),
            f"Refusing destructive SQL test outside a test database: {name}",
        )

    def _apply_sql(self):
        with self.connection.cursor() as cursor:
            cursor.execute(DEPLOYMENT_SQL)

    def tearDown(self):
        self._apply_sql()
        super().tearDown()

    def test_fresh_database_is_ready_from_deployment_sql(self):
        self._assert_test_database()
        with self.connection.cursor() as cursor:
            cursor.execute('drop table if exists "Learner".learner_monthly_reports')

        # Applied twice: deployment and test setup both run it, and neither may
        # fail on a table that already exists.
        self._apply_sql()
        self._apply_sql()

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select column_name, udt_name, is_nullable
                  from information_schema.columns
                 where table_schema='Learner'
                   and table_name='learner_monthly_reports'
                """
            )
            columns = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
            cursor.execute(
                """
                select indexname
                  from pg_indexes
                 where schemaname='Learner'
                   and tablename='learner_monthly_reports'
                """
            )
            indexes = {row[0] for row in cursor.fetchall()}

        self.assertEqual(columns["id"], ("uuid", "NO"))
        self.assertEqual(columns["month_key"], ("varchar", "NO"))
        self.assertEqual(columns["learned_summary"], ("text", "NO"))
        self.assertEqual(columns["activity_snapshot"], ("jsonb", "NO"))
        self.assertEqual(columns["summary_metrics"], ("jsonb", "NO"))
        self.assertEqual(columns["attachments"], ("jsonb", "NO"))
        self.assertEqual(columns["selected_ksbs"], ("jsonb", "NO"))
        # The signature is nullable at the column level even though the endpoint
        # requires one: rows predating the sign-off requirement keep no value.
        self.assertEqual(columns["signature"], ("text", "YES"))
        self.assertEqual(columns["signed_name"], ("text", "YES"))
        self.assertEqual(columns["signed_at"], ("timestamptz", "YES"))
        self.assertTrue(
            {
                "idx_learner_monthly_reports_learner",
                "idx_learner_monthly_reports_submitted",
                "uq_learner_monthly_reports_month",
            }
            <= indexes
        )

    def test_one_report_per_learner_per_month(self):
        self._assert_test_database()
        self._apply_sql()
        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                delete from "Learner".learner_monthly_reports
                 where learner_id = 'sql-test-learner'
                """
            )
            for summary in ("first pass", "second pass"):
                cursor.execute(
                    """
                    insert into "Learner".learner_monthly_reports
                        (id, learner_kind, learner_id, month_key, learned_summary)
                    values (gen_random_uuid(), 'commercial', 'sql-test-learner',
                            '2026-09', %s)
                    on conflict (learner_kind, learner_id, month_key)
                    do update set learned_summary = excluded.learned_summary
                    """,
                    [summary],
                )
            cursor.execute(
                """
                select count(*), max(learned_summary)
                  from "Learner".learner_monthly_reports
                 where learner_id = 'sql-test-learner'
                """
            )
            count, summary = cursor.fetchone()
            cursor.execute(
                """
                delete from "Learner".learner_monthly_reports
                 where learner_id = 'sql-test-learner'
                """
            )

        # The second submit updates the month rather than adding a duplicate.
        self.assertEqual(count, 1)
        self.assertEqual(summary, "second pass")


class MonthlyReportEndpointTests(SimpleTestCase):
    """Validation and round-trip behaviour of the report endpoints.

    Runs with the auth gate off (the local-development default), so these cover
    payload handling rather than the permission decorators, which are tested
    against the shared gate in login/.
    """

    databases = {"default", "enrolment"}

    def setUp(self):
        super().setUp()
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(DEPLOYMENT_SQL)
            cursor.execute(
                """
                delete from "Learner".learner_monthly_reports
                 where learner_id = %s
                """,
                [self.learner_id],
            )

    def tearDown(self):
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(
                """
                delete from "Learner".learner_monthly_reports
                 where learner_id = %s
                """,
                [self.learner_id],
            )
        super().tearDown()

    learner_id = "990099"
    # A 1x1 PNG: the shape a signature arrives in, without the bulk.
    signature = (
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
        "AAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
    )

    def _signed(self, **overrides):
        payload = {
            "monthKey": "2026-09",
            "learnedSummary": "I learned to run a stakeholder review.",
            "signature": self.signature,
        }
        payload.update(overrides)
        return payload

    def _url(self):
        return reverse(
            "learner-monthly-reports",
            kwargs={"kind": "commercial", "pk": self.learner_id},
        )

    def _post(self, payload):
        return self.client.post(
            self._url(), data=json.dumps(payload), content_type="application/json"
        )

    def test_month_key_must_be_a_real_month(self):
        for bad in ("2026-13", "2026-00", "September", "2026-9", ""):
            response = self._post(self._signed(monthKey=bad))
            self.assertEqual(response.status_code, 400, bad)

    def test_reflection_is_required(self):
        response = self._post(self._signed(learnedSummary="   "))
        self.assertEqual(response.status_code, 400)

    def test_unknown_learner_kind_is_rejected(self):
        response = self.client.post(
            reverse(
                "learner-monthly-reports",
                kwargs={"kind": "mystery", "pk": self.learner_id},
            ),
            data=json.dumps(self._signed()),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_submit_then_read_back_round_trips(self):
        payload = {
            "monthKey": "2026-09",
            "monthLabel": "September 2026",
            "learnedSummary": "I learned to run a stakeholder review.",
            "signature": self.signature,
            "signedName": "Aya Test",
            "selectedKsbs": [
                {"code": "k1", "type": "K", "description": "Legislation"},
                {"code": "S3", "description": "Communication"},
                {"code": ""},
            ],
            "learnerName": "Aya Test",
            "programmeName": "Business Admin",
            "activitySnapshot": [
                {"at": "2026-09-03T09:00:00", "type": "quiz", "title": "Quiz 1", "action": "Completed quiz"}
            ],
            "summaryMetrics": {"totalEvents": 1, "activeDays": 1, "ksbCount": 2, "ksbCodes": ["K1", "S2"]},
            "attachments": [
                {"id": "abc", "filename": "notes.pdf", "sizeBytes": 120, "status": "approved"}
            ],
        }
        created = self._post(payload)
        self.assertEqual(created.status_code, 201)
        report = created.json()["report"]
        self.assertEqual(report["monthKey"], "2026-09")
        self.assertEqual(report["learnedSummary"], payload["learnedSummary"])
        self.assertEqual(report["status"], "submitted")
        self.assertEqual(len(report["activitySnapshot"]), 1)
        self.assertEqual(report["summaryMetrics"]["ksbCodes"], ["K1", "S2"])
        # The scan verdict round-trips: the page needs it to decide whether the
        # document can be opened yet.
        self.assertEqual(report["attachments"][0]["filename"], "notes.pdf")
        self.assertEqual(report["attachments"][0]["status"], "approved")
        # Codes are upper-cased and blank entries dropped; the description is
        # snapshotted with the code.
        self.assertEqual(
            report["selectedKsbs"],
            [
                {"code": "K1", "type": "K", "description": "Legislation"},
                {"code": "S3", "type": "", "description": "Communication"},
            ],
        )
        self.assertEqual(report["signature"], self.signature)
        self.assertEqual(report["signedName"], "Aya Test")
        self.assertTrue(report["signedAt"])

        listed = self.client.get(self._url())
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item["monthKey"] for item in listed.json()["reports"]], ["2026-09"])

        one = self.client.get(self._url(), {"month": "2026-09"})
        self.assertEqual(one.status_code, 200)
        self.assertEqual(one.json()["report"]["learnedSummary"], payload["learnedSummary"])

    def test_resubmitting_a_month_updates_the_same_report(self):
        first = self._post(self._signed(learnedSummary="First draft"))
        self.assertEqual(first.status_code, 201)
        second = self._post(self._signed(learnedSummary="Revised draft"))
        self.assertEqual(second.status_code, 201)

        listed = self.client.get(self._url()).json()["reports"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["learnedSummary"], "Revised draft")

    def test_missing_month_returns_null_rather_than_404(self):
        response = self.client.get(self._url(), {"month": "2020-01"})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["report"])

    def test_bad_month_filter_is_rejected(self):
        response = self.client.get(self._url(), {"month": "not-a-month"})
        self.assertEqual(response.status_code, 400)

    def test_a_report_cannot_be_submitted_unsigned(self):
        response = self._post({"monthKey": "2026-09", "learnedSummary": "Done things"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("Sign", response.json()["error"])

    def test_signature_must_be_an_image_data_url(self):
        for bad in ("https://example.test/sig.png", "not-a-url", "data:text/plain;base64,eA=="):
            response = self._post(self._signed(signature=bad))
            self.assertEqual(response.status_code, 400, bad)

    def test_oversized_signature_is_rejected(self):
        huge = "data:image/png;base64," + ("A" * 400_001)
        response = self._post(self._signed(signature=huge))
        self.assertEqual(response.status_code, 400)

    def test_signed_name_falls_back_to_the_learner_name(self):
        response = self._post(self._signed(learnerName="Fallback Name"))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["report"]["signedName"], "Fallback Name")

    def test_saved_signature_is_absent_until_one_is_kept(self):
        # This learner id has no Created_users row, so nothing can be saved
        # against it — the response still carries the key rather than omitting
        # it, which is what the wizard reads.
        listed = self.client.get(self._url()).json()
        self.assertIn("savedSignature", listed)
        self.assertEqual(listed["savedSignature"], "")

    def test_a_jpeg_signature_is_accepted(self):
        jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
        response = self._post(self._signed(signature=jpeg))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["report"]["signature"], jpeg)

class MonthlyReportPermissionTests(SimpleTestCase):
    """The gate must be able to see WHICH learner a request is about.

    These run with the auth gate ON, unlike the endpoint tests above. That
    matters: the method-splitting view forwards ``kind``/``pk`` to the gated
    handlers, and forwarding them positionally leaves the gate's
    ``kwargs.get("pk")`` empty, so it cannot identify the learner and rejects
    every request with 400 "The learner this request applies to could not be
    determined." Nothing in the gate-off tests exercises that, so it is pinned
    here.
    """

    databases = {"default", "enrolment"}

    learner_id = 100
    signature = MonthlyReportEndpointTests.signature

    def setUp(self):
        super().setUp()
        self._previous = os.environ.get("LEARNER_API_REQUIRE_AUTH")
        os.environ["LEARNER_API_REQUIRE_AUTH"] = "1"
        with connections["enrolment"].cursor() as cursor:
            cursor.execute(DEPLOYMENT_SQL)
        self.factory = RequestFactory()

    def tearDown(self):
        if self._previous is None:
            os.environ.pop("LEARNER_API_REQUIRE_AUTH", None)
        else:
            os.environ["LEARNER_API_REQUIRE_AUTH"] = self._previous
        super().tearDown()

    def _as(self, request, role, subject_id):
        request.login_account = SimpleNamespace(role=role, subject_id=subject_id)
        request.login_session = object()
        return request

    def test_the_gate_can_identify_the_learner_a_read_is_about(self):
        request = self._as(self.factory.get("/"), "learner", self.learner_id)
        response = monthly_reports(request, kind="apprenticeship", pk=self.learner_id)
        # Specifically NOT 400: a 400 here means the id never reached the gate.
        self.assertEqual(response.status_code, 200)

    def test_another_learner_cannot_read_this_learners_reports(self):
        request = self._as(self.factory.get("/"), "learner", 999999)
        response = monthly_reports(request, kind="apprenticeship", pk=self.learner_id)
        # 404, not 403 — the id must not be confirmed to exist.
        self.assertEqual(response.status_code, 404)

    def test_staff_may_read_but_not_submit(self):
        read = self._as(self.factory.get("/"), "staff", None)
        self.assertEqual(
            monthly_reports(read, kind="apprenticeship", pk=self.learner_id).status_code,
            200,
        )

        write = self._as(
            self.factory.post(
                "/",
                data=json.dumps(
                    {
                        "monthKey": "2026-09",
                        "learnedSummary": "Written by staff",
                        "signature": self.signature,
                    }
                ),
                content_type="application/json",
            ),
            "staff",
            None,
        )
        # A report is the learner's own declaration: staff are refused the write
        # even though they may read it.
        self.assertEqual(
            monthly_reports(write, kind="apprenticeship", pk=self.learner_id).status_code,
            403,
        )

    def test_an_unauthenticated_caller_is_refused(self):
        request = self.factory.get("/")
        request.login_account = None
        request.login_session = None
        self.assertEqual(
            monthly_reports(request, kind="apprenticeship", pk=self.learner_id).status_code,
            401,
        )
