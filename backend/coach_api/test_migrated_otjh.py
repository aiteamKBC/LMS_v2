"""Prospective review hours: actual database writes, isolated synthetic facts."""
from copy import deepcopy
from datetime import date, datetime, timezone as dtz
from types import SimpleNamespace
from unittest.mock import patch
import json

from django.db import connection, transaction
from django.test import TestCase, SimpleTestCase

from . import migrated_otjh as hours
from .migrated_completion import complete
from .migrated_templates import snapshot_for, validate_managed_definition
from .migrated_template_sync import synchronize_locked
from .models import MigratedReviewTemplate, ImportedReviewInstance
from .test_migrated_templates import DEFINITION, MigratedTemplateManagementTests


class HoursSettingsTests(SimpleTestCase):
    def test_default_and_disabled_hours_do_not_count(self):
        self.assertEqual(hours.hours_for(DEFINITION), 0)
        self.assertEqual(hours.hours_for({"otjh": {"expectedHours": 2, "countsTowardsOtjh": False}}), 0)

    def test_invalid_hours_or_policy_metadata_are_rejected(self):
        for value in (-1, None, True, "NaN", "Infinity", 0.001, 1000000, [], {}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_managed_definition({**DEFINITION, "otjh": {"expectedHours": value, "countsTowardsOtjh": True}})
        for settings in ({}, None, {"expectedHours": 1, "countsTowardsOtjh": "true"},
                         {"expectedHours": 1, "countsTowardsOtjh": True, "creditOldReviews": True}):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                validate_managed_definition({**DEFINITION, "otjh": settings})


class HoursApiTests(MigratedTemplateManagementTests):
    # Reuse the real CSRF/access-protected API harness, not a second transport.
    def test_settings_survive_partial_rename_and_inherit_into_programme_copy(self):
        from . import migrated_template_views as api
        template = self.template()
        definition = {**DEFINITION, "otjh": {"expectedHours": 1.5, "countsTowardsOtjh": True}}
        response = self.request(api.detail, "patch", {"updated_at": template.updated_at.isoformat(), "definition": definition}, template.pk)
        self.assertEqual(response.status_code, 200)
        template.refresh_from_db()
        response = self.request(api.detail, "patch", {"updated_at": template.updated_at.isoformat(), "name": "Renamed"}, template.pk)
        self.assertEqual(json.loads(response.content)["definition"]["otjh"], definition["otjh"])
        copy = self.request(api.collection, "post", {"scope": "PROGRAMME", "review_family": "PR", "programme_key": "id:P2", "name": "Copy"})
        self.assertEqual(copy.status_code, 201)
        self.assertEqual(json.loads(copy.content)["definition"]["otjh"], definition["otjh"])


class MigratedHoursTests(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if connection.vendor != "sqlite":
            from unittest import SkipTest
            raise SkipTest("This fixture is isolated SQLite; PostgreSQL has a separate runner.")
        with connection.cursor() as cursor:
            cursor.execute(f'''CREATE TABLE {hours.table("learners")} (id integer primary key,enrolment_id integer,aptem_id integer,completed_hours numeric)''')
            cursor.execute(f'''CREATE TABLE {hours.table("reviews")} (id integer primary key,learner_id integer,aptem_review_id text,
                review_type text,status text,planned_scheduled_date text,completed_date text,review_data text)''')
            cursor.execute(f'''CREATE TABLE {hours.table("learner_progress_entries")} (
                id integer primary key autoincrement,learner_id integer,enrolment_id integer,entry_order integer,
                kind text,module_title text,week_title text,component_ref text,component_title text,component_type text,
                expected_otjh numeric,actual_seconds numeric,actual_basis text,reporting_started_at text,
                reporting_ended_at text,reporting_month text,reporting_timestamp_label text,source_system text,
                canonical_activity_key text,component_link_source text,component_link_status text,accepted boolean,
                activity_status text,submitted_at text,source_payload text,deleted_at text,
                UNIQUE(learner_id,canonical_activity_key))''')

    def setUp(self):
        hours.query(f'INSERT INTO {hours.table("learners")} VALUES (17,117,5017,20),(18,118,5018,40)')
        self.profile = SimpleNamespace(id=17, enrolment_id=117, aptem_id=5017, programme_id="P1", programme="Programme",
            start_date=date(2026, 1, 1), end_date=date(2027, 12, 31))
        self.template = MigratedReviewTemplate.objects.create(scope="GLOBAL", review_family="PR", name="Progress Review",
            is_active=True, definition_json={**deepcopy(DEFINITION), "otjh": {"expectedHours": 1.5, "countsTowardsOtjh": True}})
        self.source(1)
        self.overlay = self.make_overlay(1)
        self.open_month = patch("curriculum_api.learner_activity_status.require_open_month")
        self.open_month.start()
        self.addCleanup(self.open_month.stop)

    def source(self, ident, learner=17, status="Scheduled", target="2026-10-19", family="Progress Review", raw=None):
        hours.query(f'INSERT INTO {hours.table("reviews")} VALUES (%s,%s,%s,%s,%s,%s,NULL,%s)',
            [ident, learner, f"R{ident}", family, status, target, json.dumps(raw or {})])

    def make_overlay(self, ident, **kwargs):
        return ImportedReviewInstance.objects.create(owner_email="coach@example.invalid", event_key=f"imported-review:R{ident}",
            learner_id=17, source_review_id=ident, migrated_template=self.template, template_snapshot=snapshot_for(self.template),
            answers={"progress": "Discussed progress"}, status="awaiting-signature", signature_requirements={"advisor": False}, **kwargs)

    def finish(self, overlay=None, at=None):
        with patch("coach_api.migrated_completion.timezone.now", return_value=at or datetime(2026, 10, 19, 10, tzinfo=dtz.utc)):
            complete(overlay or self.overlay)

    def test_completion_credits_once_and_keeps_existing_other_learner_hours(self):
        self.finish()
        self.overlay.refresh_from_db()
        row = hours.query(f'SELECT * FROM {hours.table("learner_progress_entries")}')[0]
        self.assertEqual((row["actual_seconds"], row["accepted"], row["reporting_month"]), (5400, 1, "2026-10"))
        self.assertEqual(hours.query(f'SELECT completed_hours FROM {hours.table("learners")} ORDER BY id'),
            [{"completed_hours": 21.5}, {"completed_hours": 40}])
        self.assertEqual(self.overlay.meeting_intelligence["otjhCredit"]["progressId"], row["id"])
        with self.assertRaisesMessage(ValueError, "awaiting signatures"):
            self.finish()
        self.assertEqual(len(hours.query(f'SELECT id FROM {hours.table("learner_progress_entries")}')), 1)

    def test_two_reviews_with_same_title_have_distinct_progress_identities(self):
        from learner_api.active_users import completed_hours_value_from_progress
        self.source(2)
        other = self.make_overlay(2)
        self.finish(); self.finish(other)
        rows = hours.query(f'SELECT * FROM {hours.table("learner_progress_entries")}')
        self.assertEqual(completed_hours_value_from_progress([{"kind": r["kind"], "componentId": r["component_ref"],
            "expectedOtjh": r["expected_otjh"], "componentTitle": r["component_title"]} for r in rows]), 3)

    def test_old_completed_review_and_disabled_review_gain_no_credit(self):
        self.overlay.status = "completed"
        self.overlay.save()
        with self.assertRaises(ValueError): self.finish()
        self.source(2)
        other = self.make_overlay(2)
        other.template_snapshot.pop("otjh")
        other.save()
        self.finish(other)
        self.assertEqual(hours.query(f'SELECT id FROM {hours.table("learner_progress_entries")}'), [])

    def test_not_all_signatures_keeps_review_and_hours_unchanged(self):
        self.overlay.signature_requirements = {"participant": True}
        self.overlay.save()
        with self.assertRaisesMessage(ValueError, "All required signatures"):
            self.finish()
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "awaiting-signature")
        self.assertEqual(hours.query(f'SELECT id FROM {hours.table("learner_progress_entries")}'), [])

    def test_ledger_failure_rolls_back_completion_and_credit(self):
        real_query = hours.query
        def failing(sql, params=()):
            if sql.startswith('UPDATE'):
                raise ValueError("Synthetic write failure")
            return real_query(sql, params)
        with patch.object(hours, "query", side_effect=failing), self.assertRaisesMessage(ValueError, "Synthetic"):
            self.finish()
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "awaiting-signature")
        self.assertEqual(hours.query(f'SELECT id FROM {hours.table("learner_progress_entries")}'), [])

    def test_closed_month_fails_without_changing_completion(self):
        from old_otjh.service import ServiceError
        with patch("curriculum_api.learner_activity_status.require_open_month", side_effect=ServiceError("Month is signed")), self.assertRaisesMessage(ValueError, "signed"):
            self.finish()
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "awaiting-signature")

    def test_existing_native_credit_and_existing_canonical_allocation_are_refused(self):
        link = SimpleNamespace(native_review_instance_id="native:1", native_template_id="T1")
        with patch("coach_api.reconciliation_links.active_links", return_value=[link]), \
             patch("curriculum_api.review_instances.get_review_instance", return_value={"status": "completed"}), \
             patch("curriculum_api.reviews.get_review_template_row", return_value={"expected_otjh": 1, "counts_towards_otjh": True}), \
             self.assertRaisesMessage(ValueError, "Native OTJH"):
            self.finish()
        self.overlay.refresh_from_db()
        self.finish()
        self.overlay.status = "awaiting-signature"
        self.overlay.meeting_intelligence = {}
        self.overlay.save()
        with self.assertRaisesMessage(ValueError, "Activity Log allocation"):
            self.finish()
        self.assertEqual(len(hours.query(f'SELECT id FROM {hours.table("learner_progress_entries")}')), 1)

    def test_completion_uses_frozen_hours_and_uk_month_not_browser_time(self):
        self.template.definition_json["otjh"]["expectedHours"] = 9
        self.template.save()
        self.finish(at=datetime(2026, 9, 30, 23, 30, tzinfo=dtz.utc))
        row = hours.query(f'SELECT actual_seconds,reporting_month FROM {hours.table("learner_progress_entries")}')[0]
        self.assertEqual(row, {"actual_seconds": 5400, "reporting_month": "2026-10"})

    def test_planned_hours_use_real_owned_imports_not_native_recurrence(self):
        self.source(2)
        self.source(3, status="Completed")
        self.source(4, status="Cancelled")
        self.source(5, learner=18)
        self.source(6, target="2028-01-01")
        self.source(7, raw={"aptem_learner_id": "99999"})
        self.source(8, family="Monthly Coaching Meeting")
        rows = hours.planned_meetings(self.profile, date(2026, 1, 1), date(2027, 12, 31))
        self.assertEqual(sum(r["hours"] for r in rows), 3)
        self.assertEqual(sum(r["occurrences"] for r in rows), 2)

    def test_working_sync_includes_changed_hours_frozen_and_old_completion_stay_fixed(self):
        self.overlay.status = "scheduled"; self.overlay.save()
        self.template.definition_json["otjh"]["expectedHours"] = 2
        self.template.save()
        with transaction.atomic(): self.assertTrue(synchronize_locked(self.overlay, "PR", "id:P1"))
        self.assertEqual(self.overlay.template_snapshot["otjh"]["expectedHours"], 2)
        self.overlay.status = "awaiting-signature"; self.overlay.save()
        self.finish()
        self.template.definition_json["otjh"]["countsTowardsOtjh"] = False
        self.template.save()
        self.source(2)
        with transaction.atomic(): self.assertFalse(synchronize_locked(self.overlay, "PR", "id:P1"))
        rows = hours.planned_meetings(self.profile, date(2026, 1, 1), date(2027, 12, 31))
        self.assertEqual(sum(r["hours"] for r in rows), 2)

    def test_programme_override_and_bulk_single_consistency(self):
        MigratedReviewTemplate.objects.create(scope="PROGRAMME", programme_key="id:P1", review_family="PR", name="Custom PR",
            is_active=True, definition_json={**DEFINITION, "otjh": {"expectedHours": 4, "countsTowardsOtjh": True}})
        self.overlay.status = "scheduled"; self.overlay.save()
        result = hours.planned_hours_bulk([vars(self.profile), {**vars(self.profile), "id": 18, "enrolment_id": 118, "aptem_id": 5018}])
        self.assertEqual(result, {117: 4, 118: 0})

    def test_pending_snapshot_keeps_planned_hours_when_template_is_disabled(self):
        self.template.is_active = False
        self.template.save()
        self.source(2)
        rows = hours.planned_meetings(self.profile, self.profile.start_date, self.profile.end_date)
        self.assertEqual([(r["hours"], r["name"], r["reviewTemplateId"]) for r in rows],
                         [(1.5, "Progress Review", f"aptem:{self.template.pk}")])
        self.assertEqual(hours.planned_hours_bulk([vars(self.profile)]), {117: 1.5})

    def test_canonical_metrics_include_credit_without_inflating_activity_completion(self):
        from learner_api.canonical_learning import metrics_from_records
        self.finish()
        rows = hours.query(f'SELECT * FROM {hours.table("learner_progress_entries")}')
        rows[0]["accepted"] = True
        result = metrics_from_records(rows, {"2026-10": 5})
        self.assertEqual(result["otjh"]["actual"], 1.5)
        self.assertEqual(result["programme"]["total"], 0)

    def test_learning_plan_profile_and_target_due_use_the_same_imported_occurrences(self):
        from learner_api.learner_detail import _review_otjh_hours
        from learner_api.learning_plan import _meetings
        from learner_api.review_progress_inputs import review_planned_target_hours
        self.source(2, target="2026-11-19")
        with patch("curriculum_api.review_otjh.completed_hours", return_value=0):
            self.assertEqual(_review_otjh_hours(self.profile), (3, 0))
        self.assertEqual(review_planned_target_hours(self.profile, as_of=date(2026, 10, 31)), (3, 1.5))
        with patch("coach_api.review_sources.review_profile_for_source", return_value=self.profile):
            meetings, reason = _meetings(self.profile)
        self.assertEqual(reason, "")
        self.assertEqual(sum(row["hours"] for row in meetings), 3)

    def test_dashboard_hours_preserve_source_total_and_unknown_programme_plan(self):
        from learner_api import canonical_learning as canonical
        owner = {**vars(self.profile), "programme_planned_hours": 100}
        with patch.object(canonical, "entries_for", return_value=[]), \
             patch.object(canonical, "targets_for", return_value={"2026-10": 10}), \
             patch("learner_api.journal_sources.enabled", return_value=True):
            result = canonical.metrics(117, owner=owner)
            self.assertEqual(result["otjh"]["planned"], 101.5)
            self.assertEqual(result["otjh"]["review_planned"], 1.5)
            self.assertEqual(result["aptem_planned_total"], 100)
            self.assertEqual(result["otjh"]["actual"], 0)
            result = canonical.metrics(117, owner={**owner, "programme_planned_hours": None})
            self.assertIsNone(result["otjh"]["planned"])
            self.assertEqual(result["otjh"]["review_planned"], 1.5)
