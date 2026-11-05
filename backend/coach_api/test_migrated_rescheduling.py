"""Existing imported booking identity and lifecycle under real PostgreSQL writes."""
import copy
import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from datetime import date, time, timedelta
from inspect import unwrap
from threading import Event
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection, connections, transaction
from django.test import RequestFactory, TestCase, TransactionTestCase

from . import views, test_migrated_reviews as fixtures
from . import test_auto_review_reconciliation_postgres as reconciliation_fixtures
from .models import CoachCalendarEvent, ImportedReviewInstance


class RescheduleFixtures:
    databases = {"default", "enrolment"}

    def setUp(self):
        super().setUp()
        fixtures.MigratedBookingTests.setUp(self)
        self.overlay.status = "scheduled"
        self.overlay.answers = {"section-0:comment": "Saved draft"}
        self.overlay.progress_snapshot = {"version": 1, "saved": True}
        self.overlay.save()
        self.definition["localStatus"] = "scheduled"
        future = date.today() + timedelta(days=14)
        self.day = future + timedelta(days=(0 - future.weekday()) % 7)
        self.calendar = CoachCalendarEvent.objects.create(
            event_key=self.overlay.event_key, idempotency_key=self.overlay.event_key,
            owner_email="coach@example.invalid", learner_id=21, learner_email="learner@example.invalid",
            event_type="progress-review", target_date=self.day, scheduled_date=self.day,
            scheduled_time=time(10), duration_minutes=60, status="scheduled", sync_state="synced",
            graph_event_id="existing-graph", graph_organizer_email="original@example.invalid",
            meeting_link="https://example.invalid/teams/existing", notes="Keep booking notes",
        )
        self.slot = {"scheduledDate": self.day.isoformat(), "scheduledTime": "12:00", "durationMinutes": 45,
                     "expectedBooking": {"scheduledDate": self.day.isoformat(), "scheduledTime": "10:00", "durationMinutes": 60}}
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        for name, kwargs in {
            "authenticated_coach_email": {"return_value": "coach@example.invalid"},
            "_imported_review_definition": {"side_effect": lambda *a: copy.deepcopy(self.definition)},
            "find_generated_timetable_event": {"side_effect": lambda *a: (self.base_event, "Coach")},
            "fetch_caseload_dashboard_profiles": {"return_value": [SimpleNamespace(id=21, enrolment_id=101, learner_type="commercial")]},
            "coach_learner_personal_calendar_conflicts": {"return_value": False},
            "england_non_delivery_reason": {"return_value": None},
        }.items():
            mock = self.stack.enter_context(patch.object(views, name, **kwargs))
            if name == "coach_learner_personal_calendar_conflicts":
                self.personal = mock
        self.graph = self.stack.enter_context(patch.object(views, "sync_calendar_event_to_graph", return_value=""))
        self.native = self.stack.enter_context(patch.object(views, "ensure_review_instance_for_calendar_record", side_effect=AssertionError("No Native creation")))

    def reschedule(self, slot=None):
        request = RequestFactory().patch("/coach/reviews/imported-review:A-9/book",
            data=json.dumps(slot or self.slot), content_type="application/json")
        return unwrap(views.coach_review_instance_book)(request, self.overlay.event_key)

    def source_rows(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT * FROM "Learner".reviews ORDER BY id')
            return cursor.fetchall()


class ImportedRescheduleTests(RescheduleFixtures, TestCase):
    def test_all_families_preserve_booking_source_and_saved_work_and_repeat_without_graph(self):
        for family, source_type, event_type in (("MCM", "Monthly Coaching Meeting", "mcr"),
                ("PR", "Progress Review", "progress-review"),
                ("PR_SKILLS_RADAR", "Progress Review (+ Skills Radar)", "progress-review")):
            with self.subTest(family=family):
                self.template.review_family = family
                self.template.save()
                self.definition["historicalReview"]["type"] = source_type
                self.base_event["source"] = event_type
                CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(
                    event_type=event_type, scheduled_time=time(10), duration_minutes=60)
                with connection.cursor() as cursor:
                    cursor.execute('UPDATE "Learner".reviews SET review_type=%s WHERE id=409', [source_type])
                source = self.source_rows()
                before = CoachCalendarEvent.objects.values().get(pk=self.calendar.pk)
                overlay = ImportedReviewInstance.objects.values().get(pk=self.overlay.pk)
                self.graph.reset_mock()
                self.assertEqual(self.reschedule().status_code, 200)
                self.assertEqual(self.reschedule().status_code, 200)
                self.assertEqual(self.graph.call_count, 1)
                after = CoachCalendarEvent.objects.values().get(pk=self.calendar.pk)
                for key in before.keys() - {"scheduled_time", "duration_minutes", "sync_attempt_count", "last_sync_attempt_at", "updated_at"}:
                    self.assertEqual(after[key], before[key], key)
                self.assertEqual(after["scheduled_time"], time(12))
                self.assertEqual(after["duration_minutes"], 45)
                self.assertEqual(ImportedReviewInstance.objects.values().get(pk=self.overlay.pk), overlay)
                self.assertEqual(self.source_rows(), source)
                self.assertEqual(CoachCalendarEvent.objects.count(), 1)
                self.assertEqual(self.personal.call_args.kwargs["exclude_record"].pk, self.calendar.pk)
        self.native.assert_not_called()

    def test_stale_booking_conflicts_and_validation_do_not_call_graph(self):
        for change, expected in (({"expectedBooking": None}, 400), ({"durationMinutes": 0}, 400),
                ({"expectedBooking": {**self.slot["expectedBooking"], "scheduledTime": "09:00"}}, 409)):
            with self.subTest(change=change):
                self.assertEqual(self.reschedule({**self.slot, **change}).status_code, expected)
        self.graph.assert_not_called()

    def test_advanced_local_states_and_sync_claims_are_rejected(self):
        for state in ("not-scheduled", "in-progress", "awaiting-signature", "completed"):
            ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(status=state)
            self.assertEqual(self.reschedule().status_code, 409)
        ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(status="scheduled")
        for state in ("in-progress", "awaiting-signature", "completed", "cancelled"):
            CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(status=state)
            self.assertEqual(self.reschedule().status_code, 409)
        CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(status="scheduled")
        for state in ("pending", "syncing", "reconciliation-required", "cancelled"):
            CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(sync_state=state)
            self.assertEqual(self.reschedule().status_code, 409)
        self.graph.assert_not_called()

    def test_source_completion_by_status_or_date_blocks_despite_scheduled_overlay(self):
        for status, completed in (("Completed", None), ("Not Scheduled", "2099-01-01")):
            with connection.cursor() as cursor:
                cursor.execute('UPDATE "Learner".reviews SET status=%s,completed_date=%s WHERE id=409', [status, completed])
            self.assertEqual(self.reschedule().status_code, 409)
        self.graph.assert_not_called()

    def test_wrong_owner_missing_graph_and_calendar_collision_do_not_create(self):
        CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(owner_email="other@example.invalid")
        self.assertEqual(self.reschedule().status_code, 409)
        CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(owner_email="coach@example.invalid", graph_event_id="")
        self.assertEqual(self.reschedule().status_code, 409)
        self.graph.assert_not_called()

    def test_busy_slot_leaves_original_booking(self):
        with patch.object(views, "ensure_learner_calendar_available", side_effect=views.LearnerCalendarConflict("Busy")):
            self.assertEqual(self.reschedule().status_code, 409)
        self.calendar.refresh_from_db()
        self.assertEqual(self.calendar.scheduled_time, time(10))
        self.graph.assert_not_called()

    def test_graph_failure_retries_same_existing_meeting_without_rewriting_overlay(self):
        self.graph.return_value = "Temporary failure"
        self.assertEqual(self.reschedule().status_code, 502)
        self.calendar.refresh_from_db()
        self.assertEqual(self.calendar.sync_state, "failed")
        self.assertEqual(self.calendar.graph_event_id, "existing-graph")
        self.graph.return_value = ""
        self.assertEqual(self.reschedule().status_code, 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "scheduled")
        self.assertEqual(self.overlay.answers, {"section-0:comment": "Saved draft"})
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)


class ImportedRescheduleRaceTests(RescheduleFixtures, TransactionTestCase):
    available_apps = ["coach_api"]

    def setUp(self):
        super().setUp()
        self.assertEqual(connection.vendor, "postgresql")
        self.addCleanup(self.clean_parents)

    def clean_parents(self):
        ImportedReviewInstance.objects.filter(pk=self.overlay.pk).delete()
        CoachCalendarEvent.objects.filter(pk=self.calendar.pk).delete()
        self.template.delete()
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "Learner".reviews WHERE id=409')
            cursor.execute('DELETE FROM login."Login_accounts" WHERE id=121')
            cursor.execute('DELETE FROM "Learner".learners WHERE id=21')
            cursor.execute('DELETE FROM enrolment."Created_users" WHERE id=101')

    def test_second_connection_submission_during_graph_does_not_get_overwritten(self):
        for warning in ("", "Temporary failure"):
            with self.subTest(graph_warning=warning):
                CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(status="scheduled", sync_state="synced", scheduled_time=time(10), duration_minutes=60)
                ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(status="scheduled")
                def graph(record, event):
                    def submit_locked():
                        connections.close_all()
                        try:
                            with transaction.atomic():
                                overlay = views._owned_migrated_overlay("coach@example.invalid", self.definition, lock=True, lock_calendar=True)
                                overlay.status = "awaiting-signature"
                                overlay.save(update_fields=["status", "updated_at"])
                                CoachCalendarEvent.objects.filter(pk=record.pk).update(status="awaiting-signature")
                        finally:
                            connections.close_all()
                    with ThreadPoolExecutor(max_workers=1) as pool:
                        pool.submit(submit_locked).result(timeout=10)
                    return warning
                self.graph.side_effect = graph
                self.assertEqual(self.reschedule().status_code, 502 if warning else 200)
                self.calendar.refresh_from_db()
                self.overlay.refresh_from_db()
                self.assertEqual(self.calendar.status, "awaiting-signature")
                self.assertEqual(self.overlay.status, "awaiting-signature")
                self.assertEqual(self.calendar.scheduled_time, time(12))

    def test_simultaneous_reschedule_is_rejected_while_graph_is_in_flight(self):
        started, release = Event(), Event()
        def graph(record, event):
            started.set()
            self.assertTrue(release.wait(10))
            return ""
        self.graph.side_effect = graph
        def first():
            connections.close_all()
            try:
                return self.reschedule().status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(first)
            try:
                self.assertTrue(started.wait(10))
                self.assertEqual(self.reschedule({**self.slot, "scheduledTime": "14:00"}).status_code, 409)
            finally:
                release.set()
            self.assertEqual(pending.result(timeout=10), 200)
        self.assertEqual(self.graph.call_count, 1)
        self.calendar.refresh_from_db()
        self.assertEqual(self.calendar.scheduled_time, time(12))


class ReconciledRescheduleTests(TransactionTestCase):
    databases = {"default", "enrolment"}
    available_apps = ["coach_api"]
    # Reuse persisted setup, without inheriting and rerunning unrelated tests.
    _fixtures = reconciliation_fixtures.AutoReconciliationPostgresTests
    setUp = _fixtures.setUp
    _ensure_programmes_table = _fixtures._ensure_programmes_table
    _clear = _fixtures._clear
    _create_review = _fixtures._create_review
    _template_row = _fixtures._template_row
    persist_identity_parents = _fixtures.persist_identity_parents
    cleanup_identity_parents = _fixtures.cleanup_identity_parents
    cleanup_persisted_graph = _fixtures.cleanup_persisted_graph
    make_booking = _fixtures.make_booking
    snapshot = _fixtures.snapshot
    apply_auto = _fixtures.apply_auto
    source_snapshot = _fixtures.source_snapshot

    def test_imported_patch_uses_reconciled_booking_and_keeps_native_and_assignment_identity(self):
        from . import review_reconciliation as canonical
        self.apply_auto()
        before = self.snapshot()
        source = self.source_snapshot()
        old_slot = {"scheduledDate": self.record.scheduled_date.isoformat(),
                    "scheduledTime": self.record.scheduled_time.strftime("%H:%M"),
                    "durationMinutes": self.record.duration_minutes}
        event = {**canonical._source_event(self.profile, self.source), "reviewSource": "aptem"}
        with patch.object(views, "synchronize_reserved_calendar_event", self.actual_sync), \
             patch.object(views, "find_generated_timetable_event", return_value=(event, "Coach")), \
             patch.object(views, "coach_learner_personal_calendar_conflicts", return_value=False), \
             patch.object(views, "england_non_delivery_reason", return_value=None), \
             patch.object(views, "sync_calendar_event_to_graph", return_value="") as graph:
            request = RequestFactory().patch("/coach/reviews/imported-review:A501/book",
                data=json.dumps({**old_slot, "scheduledTime": "14:00", "expectedBooking": old_slot}),
                content_type="application/json")
            response = unwrap(views.coach_review_instance_book)(request, "imported-review:A501")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(graph.call_count, 1)
        self.record.refresh_from_db()
        self.assertEqual(self.record.scheduled_time, time(14))
        self.assertEqual(self.source_snapshot(), source)
        after = self.snapshot()
        # The existing fixture captures native/dependency identity as well as calendar.
        for key in before.keys() - {"calendar"}:
            self.assertEqual(after[key], before[key], key)
