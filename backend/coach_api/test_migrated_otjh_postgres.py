"""Run only through an environment-verified disposable PostgreSQL runner."""
from concurrent.futures import ThreadPoolExecutor
import json
from copy import deepcopy
from datetime import datetime
from threading import Event
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import TransactionTestCase

from . import migrated_otjh as hours
from .migrated_completion_views import _sign_and_complete
from .migrated_templates import snapshot_for
from .models import MigratedReviewTemplate, ImportedReviewInstance
from .test_migrated_templates import DEFINITION
from .tests_migrated_completion import PNG


@skipUnless(connection.vendor == "postgresql", "Requires verified disposable PostgreSQL")
class PostgresHoursTests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        statements = [
            'CREATE SCHEMA IF NOT EXISTS "Learner"', 'CREATE SCHEMA IF NOT EXISTS enrolment',
            '''CREATE TABLE "Learner".learners (id bigint primary key,enrolment_id bigint,aptem_id bigint,completed_hours numeric)''',
            '''CREATE TABLE enrolment."Created_users" (id bigint primary key)''',
            '''CREATE TABLE "Learner".reviews (id bigint primary key,learner_id bigint,aptem_review_id text,
                review_type text,status text,planned_scheduled_date date,completed_date date,review_data jsonb)''',
            '''CREATE TABLE "Learner".learner_progress_entries (
                id bigserial primary key,learner_id bigint,enrolment_id bigint,entry_order integer,
                kind text,module_title text,week_title text,component_ref text,component_title text,component_type text,
                expected_otjh numeric,actual_seconds numeric,actual_basis text,reporting_started_at timestamptz,
                reporting_ended_at timestamptz,reporting_month text,reporting_timestamp_label text,source_system text,
                canonical_activity_key text,component_link_source text,component_link_status text,accepted boolean,
                activity_status text,submitted_at timestamptz,source_payload jsonb,deleted_at timestamptz,
                UNIQUE(learner_id,canonical_activity_key))''',
            '''CREATE TABLE "Learner".learner_monthly_locks (learner_id bigint,report_month text,locked_at timestamptz,unlocked_at timestamptz)''',
            '''CREATE TABLE "Learner".learner_monthly_signatures (learner_id bigint,report_month text,review_confirmed boolean)''',
            '''CREATE TABLE "Learner".manual_month_finalization_events (id bigint,aptem_id bigint,report_month text,event_type text)''',
            '''CREATE TABLE "Learner".monthly_audit_signoffs (learner_id text,report_month text,review_confirmed boolean)''',
        ]
        for sql in statements: hours.query(sql)

    @classmethod
    def tearDownClass(cls):
        # Only objects provisioned above, inside the runner's disposable DB.
        for name in ("monthly_audit_signoffs", "manual_month_finalization_events", "learner_monthly_signatures",
                     "learner_monthly_locks", "learner_progress_entries", "reviews", "learners"):
            hours.query(f'DROP TABLE "Learner"."{name}"')
        hours.query('DROP TABLE enrolment."Created_users"')
        super().tearDownClass()

    def setUp(self):
        booking = patch("coach_api.migrated_completion_views.booking_for_overlay", return_value=None)
        booking.start()
        self.addCleanup(booking.stop)
        for name in ("monthly_audit_signoffs", "manual_month_finalization_events", "learner_monthly_signatures",
                     "learner_monthly_locks", "learner_progress_entries", "reviews", "learners"):
            hours.query(f'DELETE FROM "Learner"."{name}"')
        hours.query('DELETE FROM enrolment."Created_users"')
        hours.query('INSERT INTO "Learner".learners VALUES (17,117,5017,20)')
        hours.query('INSERT INTO enrolment."Created_users" VALUES (117)')
        hours.query('''INSERT INTO "Learner".reviews VALUES (1,17,'R1','Progress Review','Scheduled','2026-10-19',NULL,'{}')''')
        template = MigratedReviewTemplate.objects.create(scope="GLOBAL", review_family="PR", name="PR", is_active=True,
            definition_json={**deepcopy(DEFINITION), "otjh": {"expectedHours": 1.25, "countsTowardsOtjh": True}})
        self.review = ImportedReviewInstance.objects.create(owner_email="coach@example.invalid", event_key="imported-review:R1",
            learner_id=17, source_review_id=1, migrated_template=template, template_snapshot=snapshot_for(template),
            answers={"progress": "Agreed next steps"}, status="awaiting-signature", signature_requirements={"participant": True})

    def finish(self):
        with transaction.atomic():
            review = ImportedReviewInstance.objects.select_for_update().get(pk=self.review.pk)
            _sign_and_complete(review, "participant", account=SimpleNamespace(pk=41, email="learner@example.invalid", display_name="Synthetic learner"), signature=PNG)

    def test_final_signature_and_credit_commit_once_with_real_sql_and_locks(self):
        attempted = Event()
        def worker():
            def observe(execute, sql, params, many, context):
                if "FOR UPDATE" in sql: attempted.set()
                return execute(sql, params, many, context)
            try:
                with connections["default"].execute_wrapper(observe):
                    try:
                        self.finish()
                        return "completed"
                    except ValueError:
                        return "already-completed"
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                ImportedReviewInstance.objects.select_for_update().get(pk=self.review.pk)
                future = pool.submit(worker)
                self.assertTrue(attempted.wait(10))
                self.assertFalse(future.done())
                self.finish()
            self.assertEqual(future.result(timeout=10), "already-completed")
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, "completed")
        self.assertEqual(self.review.migrated_signatures.count(), 1)
        record = hours.query('SELECT * FROM "Learner".learner_progress_entries')[0]
        self.assertEqual(record["actual_seconds"], 4500)
        self.assertEqual(json.loads(record["source_payload"])["reviewOtjh"]["sourceReviewId"], 1)
        self.assertEqual(hours.query('SELECT completed_hours FROM "Learner".learners')[0]["completed_hours"], 21.25)
        profile = SimpleNamespace(id=17, enrolment_id=117, aptem_id=5017, programme_id="P1", programme="P")
        from datetime import date
        self.assertEqual(hours.planned_meetings(profile, date(2026, 1, 1), date(2027, 1, 1))[0]["hours"], 1.25)

    def test_closed_log_rolls_back_last_signature_completion_and_hours(self):
        month = datetime.now(hours.UK).strftime("%Y-%m")
        hours.query('INSERT INTO "Learner".learner_monthly_signatures VALUES (17,%s,true)', [month])
        with self.assertRaisesMessage(ValueError, "signed"):
            self.finish()
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, "awaiting-signature")
        self.assertEqual(self.review.migrated_signatures.count(), 0)
        self.assertEqual(hours.query('SELECT id FROM "Learner".learner_progress_entries'), [])

    def test_busy_enrolment_returns_retry_without_deadlocking_or_partial_signature(self):
        def worker():
            try:
                try:
                    self.finish()
                except ValueError as exc:
                    return str(exc)
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                hours.query('SELECT id FROM enrolment."Created_users" WHERE id=117 FOR UPDATE')
                future = pool.submit(worker)
                self.assertIn("Please retry", future.result(timeout=10))
        self.assertEqual(self.review.migrated_signatures.count(), 0)
        self.assertEqual(hours.query('SELECT id FROM "Learner".learner_progress_entries'), [])
