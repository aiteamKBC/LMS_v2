"""Persisted synthetic graph and real PostgreSQL locks; never use operational DBs."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date
from inspect import unwrap
from io import StringIO
import json
from threading import Barrier
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection, connections, transaction
from django.test import TransactionTestCase, RequestFactory

from . import auto_review_reconciliation as auto, review_reconciliation as canonical
from . import views, reconciliation_links as links, migrated_completion_views as lifecycle
from .models import ImportedReviewInstance, ReviewSourceReconciliation, MigratedReviewSignature, MigratedReviewDocument
from .test_review_reconciliation import ReviewReconciliationTests as Fixtures
from learner_api.models import LearnerProfile
from login.models import LoginAccount


class AutoReconciliationPostgresTests(TransactionTestCase):
    databases = {"default", "enrolment"}
    available_apps = ["coach_api"]
    _ensure_programmes_table = Fixtures._ensure_programmes_table
    _clear = Fixtures._clear
    _create_review = Fixtures._create_review
    _template_row = Fixtures._template_row
    persist_identity_parents = Fixtures.persist_identity_parents
    cleanup_identity_parents = Fixtures.cleanup_identity_parents
    make_booking = Fixtures.make_booking
    snapshot = Fixtures.snapshot

    def cleanup_persisted_graph(self):
        MigratedReviewSignature.objects.all().delete()
        MigratedReviewDocument.objects.all().delete()
        Fixtures.cleanup_persisted_graph(self)

    def setUp(self):
        self.assertEqual(connection.vendor, "postgresql", "These cases require verified disposable PostgreSQL.")
        actual = {"read_profile": canonical.read_profile, "read_source": canonical.read_source,
                  "lock": views.lock_learner_calendar, "definition": views._imported_review_definition,
                  "account_filter": LoginAccount.objects.filter}
        Fixtures.setUp(self)
        # Reuse legacy fixture construction; exercise actual source/owner/admin,
        # definition and locking paths for every policy/apply operation below.
        for target, name, value in ((canonical, "read_profile", actual["read_profile"]),
                                    (canonical, "read_source", actual["read_source"]),
                                    (views, "lock_learner_calendar", actual["lock"]),
                                    (views, "_imported_review_definition", actual["definition"]),
                                    (LoginAccount.objects, "filter", actual["account_filter"])):
            self.stack.enter_context(patch.object(target, name, value))
        self.stack.enter_context(patch.object(views, "fetch_caseload_dashboard_profiles",
                                             side_effect=lambda owner: list(LearnerProfile.objects.using("default").filter(pk=21))))
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET planned_scheduled_date=%s WHERE id=501', ["2099-11-29"])
        self.answers = {"section-0:comment": "Synthetic saved summary", "section-0:choice": "Good", "section-0:check": "no"}

    def rows(self):
        return auto.run_batch(actor_id=990)["rows"]

    def apply_auto(self, expected=1):
        return auto.run_batch(actor_id=990, apply=True, expected_count=expected, reason="Approved synthetic batch")

    def source_snapshot(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT * FROM "Learner".reviews ORDER BY id')
            return cursor.fetchall()

    def native_counts(self):
        with connection.cursor() as cursor:
            return [cursor.execute(f"SELECT count(*) FROM curriculum.{table}").fetchone()[0]
                    for table in ("review_instances", "learner_review_additions", "review_occurrence_overrides")]

    def test_read_only_default_command_and_apply_idempotency_preserve_entire_graph(self):
        before, sources, native_counts = self.snapshot(), self.source_snapshot(), self.native_counts()
        out = StringIO()
        call_command("auto_reconcile_legacy_aptem_reviews", actor_id=990, stdout=out)
        self.assertEqual(json.loads(out.getvalue())["counts"], {"AUTO_ELIGIBLE": 1})
        self.assertEqual(self.snapshot(), before)
        self.assertFalse(ImportedReviewInstance.objects.exists())
        self.assertFalse(ReviewSourceReconciliation.objects.exists())
        self.assertEqual(self.apply_auto()["outcomes"][0]["status"], "APPLIED")
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.source_snapshot(), sources)
        self.assertEqual(self.native_counts(), native_counts)
        link = ReviewSourceReconciliation.objects.get()
        reason = json.loads(link.reason)
        self.assertEqual(reason["method"], auto.PROVENANCE)
        self.assertEqual(reason["rule_version"], auto.RULE_VERSION)
        self.assertEqual(reason["candidate_count"], 1)
        self.assertEqual(self.rows()[0]["classification"], "ALREADY_RECONCILED")
        self.apply_auto()
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 1)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        from curriculum_api import review_instances as engine
        with self.assertRaisesRegex(ValueError, "reconciled"):
            engine.save_review_instance_answers(self.instance, {})
        event = canonical._source_event(self.profile, self.source)
        from . import review_sources
        bookings, overlays = review_sources.load_imported_links([event])
        resolved = review_sources.apply_imported_state(event, bookings[event["eventKey"]], overlays[event["eventKey"]])
        self.assertEqual(resolved["calendarEventKey"], self.record.event_key)
        self.assertEqual(resolved["formEventKey"], "imported-review:A501")
        self.assertIsNone(resolved["reviewInstanceId"])
        self.assertEqual(review_sources.standalone_review_records([self.record], [self.profile], {21}), [])

    def test_real_conflicts_and_completed_source_do_not_mutate(self):
        from .models import CoachCalendarEvent
        for status in ("scheduled", "not-scheduled"):
            claim = CoachCalendarEvent.objects.create(event_key="imported-review:A501", learner_id=21,
                        owner_email="other@example.invalid", event_type="mcr", status=status,
                        target_date=date(2099, 11, 29), graph_event_id="other" if status == "scheduled" else "")
            self.assertEqual(self.rows()[0]["classification"], "IMPORTED_CALENDAR_CONFLICT")
            claim.delete()
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET completed_date=%s WHERE id=501', ["2099-11-29"])
        self.assertEqual(self.rows()[0]["classification"], "LIFECYCLE_CONFLICT")
        self.assertFalse(ReviewSourceReconciliation.objects.exists())
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_repeat_mixed_batch_keeps_manual_rows_and_returns_already_reconciled(self):
        second, instance = self.make_booking(2)
        second.target_date = second.scheduled_date = date(2099, 12, 1)
        second.save()
        with connection.cursor() as cursor:
            cursor.execute('UPDATE curriculum.review_instances SET target_date=%s WHERE id=%s', ["2099-12-01", instance["id"]])
        self.assertEqual(self.apply_auto()["outcomes"][0]["status"], "APPLIED")
        result = self.apply_auto()
        self.assertEqual(result["counts"], {"ALREADY_RECONCILED": 1, "NO_CANDIDATE": 1})
        self.assertEqual(result["outcomes"], [])
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 1)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)

    def test_ambiguity_keeps_conflicting_candidate_and_source_reuse_blocks_both(self):
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET planned_scheduled_date=%s WHERE id=502', ["2099-11-01"])
        self.assertEqual(self.rows()[0]["classification"], "AMBIGUOUS")
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET planned_scheduled_date=NULL WHERE id=502')
        self.make_booking(2)
        self.assertEqual([r["classification"] for r in self.rows()], ["SOURCE_REUSE_CONFLICT"] * 2)
        self.assertFalse(ReviewSourceReconciliation.objects.exists())

    def test_active_overlay_is_not_overwritten(self):
        from .migrated_initialization import initialize_imported_review
        definition = views._imported_review_definition(self.record.owner_email, "imported-review:A501")
        overlay, _ = initialize_imported_review(self.record.owner_email, definition)
        overlay.answers = self.answers
        overlay.save()
        self.assertEqual(self.rows()[0]["classification"], "OVERLAY_CONFLICT")
        overlay.refresh_from_db()
        self.assertEqual(overlay.answers, self.answers)

    def test_changed_candidate_set_aborts_pair_before_any_persistent_change(self):
        row = self.rows()[0]
        before = self.snapshot()
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".reviews SET planned_scheduled_date=%s WHERE id=502', ["2099-11-01"])
        with self.assertRaisesRegex(ValueError, "Eligibility changed"):
            auto._apply_pair(row, actor_id=990, reason="Stale synthetic approval")
        self.assertFalse(ImportedReviewInstance.objects.exists())
        self.assertFalse(ReviewSourceReconciliation.objects.exists())
        self.assertEqual(self.snapshot(), before)

    def test_non_admin_operator_cannot_apply(self):
        LoginAccount.objects.filter(pk=990).update(role="staff")
        with self.assertRaises(PermissionError):
            self.apply_auto()
        self.assertFalse(ReviewSourceReconciliation.objects.exists())
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_candidate_inserted_after_initial_validation_is_rechecked_under_canonical_locks(self):
        row = self.rows()[0]
        inspect_pair = canonical._inspect

        def concurrent_import(*args, **kwargs):
            inspected = inspect_pair(*args, **kwargs)
            if kwargs.get("lock"):
                # A separate real PostgreSQL connection commits a newly dated
                # candidate after canonical pair inspection, before its write.
                with connections["enrolment"].cursor() as cursor:
                    cursor.execute('UPDATE "Learner".reviews SET planned_scheduled_date=%s WHERE id=502', ["2099-11-01"])
            return inspected

        with patch.object(canonical, "_inspect", side_effect=concurrent_import), \
             self.assertRaisesRegex(ValueError, "Eligibility changed"):
            auto._apply_pair(row, actor_id=990, reason="Synthetic concurrent source refresh")
        self.assertFalse(ReviewSourceReconciliation.objects.exists())
        self.assertFalse(ImportedReviewInstance.objects.exists())

    def test_imported_legacy_key_bookings_without_native_are_excluded(self):
        from .models import CoachCalendarEvent
        record = CoachCalendarEvent.objects.create(owner_email=self.record.owner_email, learner_id=21,
                    event_key="mcr:21:99:2099-12-01", event_type="mcr", target_date=date(2099, 12, 1),
                    idempotency_key="learner-book:mcm:apprenticeship:121:2099-12:502")
        before = canonical.calendar_fingerprint(record)
        self.assertEqual([row["calendar_event_id"] for row in self.rows()], [self.record.pk])
        self.apply_auto()
        record.refresh_from_db()
        self.assertEqual(canonical.calendar_fingerprint(record), before)

    def test_failed_pair_rolls_back_without_undoing_independent_success(self):
        second, instance = self.make_booking(2)
        second.target_date = second.scheduled_date = date(2099, 12, 1)
        second.save()
        with connection.cursor() as cursor:
            cursor.execute('UPDATE curriculum.review_instances SET target_date=%s WHERE id=%s', ["2099-12-01", instance["id"]])
            cursor.execute('UPDATE "Learner".reviews SET planned_scheduled_date=%s WHERE id=502', ["2099-12-29"])
        before = self.snapshot()
        validate = links.validate_record

        def reject_second(link, record):
            if record.pk == second.pk:
                raise canonical.ReconciliationConflict("Synthetic late validation failure")
            return validate(link, record)

        with patch.object(links, "validate_record", side_effect=reject_second):
            result = self.apply_auto(expected=2)
        self.assertEqual([outcome["status"] for outcome in result["outcomes"]], ["APPLIED", "BLOCKED"])
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 1)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        self.assertEqual(self.snapshot(), before)

    def race(self, *operations):
        barrier = Barrier(len(operations))
        def worker(operation):
            connections.close_all()
            try:
                barrier.wait(timeout=10)
                return operation()
            except (ValueError, auto.DatabaseError) as exc:
                return {"blocked": type(exc).__name__}
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=len(operations)) as pool:
            futures = [pool.submit(worker, operation) for operation in operations]
            results = [future.result(timeout=35) for future in futures]
        self.assertFalse(any(result.get("blocked") in {"OperationalError", "DatabaseError"} for result in results), results)
        return results

    def test_concurrent_auto_apply_same_native_creates_one_mapping(self):
        row = self.rows()[0]
        action = lambda: auto._apply_pair(row, actor_id=990, reason="Concurrent synthetic approval")
        results = self.race(action, action)
        self.assertEqual([result.get("status") for result in results], ["APPLIED", "APPLIED"])
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 1)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)

    def test_concurrent_canonical_source_claims_remain_unique(self):
        second, _ = self.make_booking(2)
        def claim(pk):
            return canonical.apply(calendar_event_id=pk, source_review_id=501, actor_id=990, reason="Synthetic exact-pair contention")
        results = self.race(lambda: claim(self.record.pk), lambda: claim(second.pk))
        self.assertEqual(sum(r.get("status") == "APPLIED" for r in results), 1)
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 1)

    def test_reverse_racing_auto_revalidation_has_compatible_locks(self):
        row = self.rows()[0]
        self.apply_auto()
        link = ReviewSourceReconciliation.objects.get()
        self.race(lambda: canonical.reverse(reconciliation_id=link.pk, actor_id=990, reason="Explicit synthetic reverse"),
                  lambda: auto._apply_pair(row, actor_id=990, reason="Explicit synthetic revalidation"))
        self.assertLessEqual(ReviewSourceReconciliation.objects.filter(status="APPLIED").count(), 1)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)

    def submit(self):
        from .migrated_summary_binding import answer_version
        overlay = ImportedReviewInstance.objects.get()
        request = RequestFactory().post("/", data=json.dumps({"answers": self.answers, "answerVersion": answer_version(overlay)}),
                                        content_type="application/json")
        with patch.object(lifecycle, "authenticated_coach_email", return_value=self.record.owner_email):
            response = unwrap(lifecycle.migrated_review_submit)(request, "imported-review:A501")
        return {"http": response.status_code, "body": json.loads(response.content)}

    def test_scheduled_direct_submit_and_concurrent_auto_revalidation_preserve_work(self):
        row = self.rows()[0]
        sources = self.source_snapshot()
        self.apply_auto()
        results = self.race(self.submit, lambda: auto._apply_pair(row, actor_id=990, reason="Repeat synthetic apply"))
        self.assertEqual(results[0]["http"], 200, results)
        overlay = ImportedReviewInstance.objects.get()
        self.assertEqual(overlay.status, "awaiting-signature")
        self.assertEqual(overlay.answers, self.answers)
        self.assertEqual(self.source_snapshot(), sources)
        self.assertEqual(self.rows()[0]["classification"], "ALREADY_RECONCILED")

    def test_initial_auto_apply_racing_scheduled_submit_preserves_the_saved_work(self):
        from .migrated_initialization import initialize_imported_review
        row = self.rows()[0]
        definition = views._imported_review_definition(self.record.owner_email, "imported-review:A501")
        overlay, _ = initialize_imported_review(self.record.owner_email, definition)
        overlay.status = "scheduled"
        overlay.save()
        sources = self.source_snapshot()
        identity = (self.record.event_key, self.record.graph_event_id, self.record.meeting_link,
                    self.record.graph_organizer_email, self.record.scheduled_date, self.record.scheduled_time)
        results = self.race(self.submit, lambda: auto._apply_pair(row, actor_id=990, reason="Initial synthetic apply"))
        self.assertEqual(results[0]["http"], 200, results)
        self.assertTrue(results[1].get("status") == "APPLIED" or results[1].get("blocked") == "ReconciliationConflict", results)
        overlay.refresh_from_db()
        self.record.refresh_from_db()
        self.assertEqual(overlay.status, "awaiting-signature")
        self.assertEqual(overlay.answers, self.answers)
        self.assertEqual(self.source_snapshot(), sources)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        self.assertEqual((self.record.event_key, self.record.graph_event_id, self.record.meeting_link,
                          self.record.graph_organizer_email, self.record.scheduled_date, self.record.scheduled_time), identity)

    def test_complete_racing_auto_revalidation_never_resets_signed_work(self):
        from .migrated_completion import submit, complete
        from django.utils import timezone
        row = self.rows()[0]
        self.apply_auto()
        overlay = ImportedReviewInstance.objects.get()
        submit(overlay, self.answers)
        for role in ("advisor", "participant"):
            MigratedReviewSignature.objects.create(overlay=overlay, role=role, signer_account_id=990,
                signer_name="Synthetic", signer_email="synthetic@example.invalid", signature="synthetic", signed_at=timezone.now())
        def finish():
            definition = views._imported_review_definition(self.record.owner_email, "imported-review:A501")
            with transaction.atomic():
                locked = views._owned_migrated_overlay(self.record.owner_email, definition, lock=True, lock_calendar=True)
                complete(locked)
                lifecycle._mirror_status(locked)
            return {"completed": True}
        results = self.race(finish, lambda: auto._apply_pair(row, actor_id=990, reason="Repeat synthetic apply"))
        self.assertTrue(results[0].get("completed"), results)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, "completed")
        self.assertEqual(MigratedReviewSignature.objects.count(), 2)
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 1)
