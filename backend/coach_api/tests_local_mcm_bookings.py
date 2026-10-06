"""Calendar and retry regressions for learner-booked local MCMs."""
from datetime import date, datetime, time
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import TestCase

from learner_api.calendar import _serialize_event
from . import local_mcm_bookings, views
from .models import CoachCalendarEvent


class LocalMcmBookingTests(TestCase):
    key = "imported-review:MCM-62"
    owner = "coach@example.invalid"

    def setUp(self):
        self.row = (62, 211, "MCM-62", 125, "commercial", datetime(2026, 11, 4, 10))
        patcher = patch.object(local_mcm_bookings, "_review_rows", return_value=[self.row])
        self.review_rows = patcher.start()
        self.addCleanup(patcher.stop)
        self.base = {
            "eventKey": self.key, "source": "mcr", "reviewSource": "aptem",
            "reviewId": "62", "aptemReviewId": "MCM-62", "importedReviewType": "Monthly Coaching Meeting",
            "enrolmentId": "125", "learnerType": "commercial",
            "learnerId": "211", "learner": "Synthetic learner", "title": "MCM",
            "targetDate": "2026-11-04", "date": "2026-11-04",
            "status": "not-scheduled", "sourceStatus": "Not Scheduled",
            "sequence": 1, "type": "coaching",
        }
        self.profile = SimpleNamespace(id=211, enrolment_id=125, learner_type="commercial")
        profile_lookup = patch("learner_api.models.LearnerProfile.objects.filter")
        profile_lookup.start().return_value.first.return_value = self.profile
        self.addCleanup(profile_lookup.stop)

    def record(self, **changes):
        fields = dict(
            event_key="mcr:211:1:2026-10-23",
            idempotency_key="learner-book:mcm:commercial:125:2026-11:62",
            owner_email=self.owner, owner_name="Coach", learner_id=211,
            learner_name="Synthetic learner", learner_email="learner@example.invalid",
            event_type="mcr", sequence=1, target_date=date(2026, 11, 4),
            scheduled_date=date(2026, 10, 23), scheduled_time=time(10),
            duration_minutes=60, status="scheduled", sync_state="synced",
            graph_event_id="existing-graph-event", meeting_link="https://example.invalid/teams/62",
            meeting_provider="Microsoft Teams", graph_organizer_email="learner@example.invalid",
        )
        fields.update(changes)
        return CoachCalendarEvent.objects.create(**fields)

    def reserve(self, **changes):
        fields = dict(
            owner_email=self.owner, owner_name="Coach", learner_id=211,
            learner_name="Synthetic learner", learner_email="learner@example.invalid",
            session_type="mcr", scheduled_date=date(2026, 10, 23), scheduled_time=time(10),
            duration_minutes=60, notes="Monthly assignment",
            idempotency_key="learner-book:mcm:commercial:125:2026-10:62",
            local_mcm_review_id="62",
        )
        fields.update(changes)
        with patch.object(views, "england_non_delivery_reason", return_value=None):
            return views.reserve_coach_calendar_booking(**fields)

    def test_both_calendars_and_artifacts_use_the_saved_meeting(self):
        record = self.record()
        mapped = views.fetch_calendar_event_records(self.owner, [self.key])
        self.assertEqual(mapped[self.key].pk, record.pk)
        coach = views.overlay_calendar_record(self.base, mapped[self.key])
        learner = _serialize_event(record)
        for field in ("scheduledDate", "scheduledTime", "durationMinutes", "meetingLink", "syncState"):
            self.assertEqual(coach[field], learner[field])
        self.assertEqual(coach["status"], "scheduled")
        self.assertEqual(coach["eventKey"], self.key)
        self.assertEqual(learner["eventKey"], record.event_key)
        self.assertEqual(views.coach_meeting_artifact_record(self.owner, self.key).pk, record.pk)
        record.refresh_from_db()
        self.assertEqual(record.graph_event_id, "existing-graph-event")
        self.assertEqual(record.graph_organizer_email, "learner@example.invalid")
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_coach_timetable_displays_one_linked_event(self):
        record = self.record()
        resolved = {"events": [self.base], "sourceCounts": {},
                    "reviewGenerationIssues": [], "aptemProfileIds": {211}}
        with patch.object(views, "fetch_owner_active_learner_profiles", return_value=[]), \
             patch.object(views, "fetch_caseload_timetable_profiles", return_value=[]), \
             patch.object(views, "coach_staff_display_name", return_value="Coach"), \
             patch.object(views, "resolve_coach_review_events", return_value=resolved):
            timetable = views.collect_generated_timetable(
                self.owner, include_live_sessions=False, include_scheduler_queues=False)
        self.assertEqual(len(timetable["events"]), 1)
        event = timetable["events"][0]
        self.assertEqual(event["meetingLink"], record.meeting_link)
        self.assertEqual(event["date"], "2026-10-23")

    def test_coach_timetable_rejects_a_cross_learner_review_key_collision(self):
        self.record(event_key=self.key)
        resolved = {"events": [{**self.base, "learnerId": "999"}], "sourceCounts": {},
                    "reviewGenerationIssues": [], "aptemProfileIds": {211, 999}}
        with patch.object(views, "fetch_owner_active_learner_profiles", return_value=[]), \
             patch.object(views, "fetch_caseload_timetable_profiles", return_value=[]), \
             patch.object(views, "coach_staff_display_name", return_value="Coach"), \
             patch.object(views, "resolve_coach_review_events", return_value=resolved):
            with self.assertRaises(DatabaseError):
                views.collect_generated_timetable(
                    self.owner, include_live_sessions=False, include_scheduler_queues=False)

    def test_failed_sync_keeps_warning_and_does_not_claim_a_teams_link(self):
        record = self.record(sync_state="failed", last_graph_sync_error="Sync failed")
        event = views.overlay_calendar_record(
            self.base, views.fetch_calendar_event_records(self.owner, [self.key])[self.key])
        self.assertEqual(event["syncState"], "failed")
        self.assertTrue(event["syncWarning"])
        self.assertEqual(event["meetingLink"], "")
        self.assertEqual(event["scheduledDate"], record.scheduled_date.isoformat())

    def test_identity_mismatch_or_another_coach_never_links_the_record(self):
        for changes in (
            {"learner_id": 999},
            {"idempotency_key": "learner-book:mcm:commercial:999:2026-11:62"},
            {"idempotency_key": "learner-book:mcm:apprenticeship:125:2026-11:62"},
            {"idempotency_key": "learner-book:mcm:commercial:125:2026-11:999"},
            {"owner_email": "another@example.invalid"},
            {"review_template_id": "NATIVE-REVIEW"},
        ):
            with self.subTest(changes=changes):
                record = self.record(**changes)
                self.assertEqual(views.fetch_calendar_event_records(self.owner, [self.key]), {})
                record.delete()

    def test_apprenticeship_uses_its_own_source_identity(self):
        self.review_rows.return_value = [(62, 211, "MCM-62", 125, "apprenticeship", self.row[5])]
        record = self.record(idempotency_key="learner-book:mcm:apprenticeship:125:2026-11:62")
        self.assertEqual(views.fetch_calendar_event_records(self.owner, [self.key])[self.key].pk, record.pk)

    def test_ambiguous_legacy_bookings_block_display_and_booking(self):
        self.record()
        self.record(event_key="mcr:211:2:2026-10-23",
                    idempotency_key="learner-book:mcm:commercial:125:2026-10:62", sequence=2)
        with self.assertRaises(DatabaseError):
            views.fetch_calendar_event_records(self.owner, [self.key])
        # A third operation must not choose one of two meetings.
        with self.assertRaises(views.LearnerCalendarConflict):
            self.reserve(idempotency_key="learner-book:mcm:commercial:125:2026-09:62")
        self.assertEqual(CoachCalendarEvent.objects.count(), 2)

    def test_learner_reuses_coach_booking_without_creating_another_event(self):
        record = self.record(event_key=self.key, idempotency_key=self.key)
        saved, created = self.reserve()
        self.assertFalse(created)
        self.assertEqual(saved.pk, record.pk)
        with patch.object(views, "sync_calendar_event_to_graph") as graph:
            synced, warning, attempted = views.synchronize_reserved_calendar_event(saved.pk, self.base)
        self.assertEqual(synced.graph_event_id, record.graph_event_id)
        self.assertFalse(attempted)
        self.assertEqual(warning, "")
        graph.assert_not_called()
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        learner = _serialize_event(saved)
        self.assertEqual(learner["reviewId"], "62")

    def test_different_slot_or_wrong_owner_cannot_create_second_meeting(self):
        record = self.record(event_key=self.key, idempotency_key=self.key)
        with self.assertRaises(views.LearnerCalendarConflict):
            self.reserve(scheduled_date=date(2026, 11, 4))
        record.owner_email = "another@example.invalid"
        record.save(update_fields=["owner_email"])
        with self.assertRaises(views.LearnerCalendarConflict):
            self.reserve()
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_former_coach_legacy_booking_blocks_a_second_meeting(self):
        self.record(owner_email="former-coach@example.invalid")
        # A different week must not bypass the shared review identity.
        with self.assertRaises(views.LearnerCalendarConflict):
            self.reserve(scheduled_date=date(2026, 11, 4))
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        self.assertEqual(views.fetch_calendar_event_records(self.owner, [self.key]), {})

    def test_allocation_rechecks_after_the_learner_lock(self):
        record = self.record(event_key=self.key, idempotency_key=self.key)
        with patch.object(views, "lock_learner_calendar", wraps=views.lock_learner_calendar) as lock, \
             patch.object(views, "imported_review_calendar_rows", wraps=views.imported_review_calendar_rows) as lookup:
            saved, created = self.reserve()
        lock.assert_called_once_with(211)
        lookup.assert_called_once_with(self.owner, self.key, lock=True)
        self.assertEqual(saved.pk, record.pk)
        self.assertFalse(created)

    def test_new_reservation_is_linked_without_rekeying_and_retry_keeps_identity(self):
        saved, created = self.reserve()
        self.assertTrue(created)
        mapped = views.fetch_calendar_event_records(self.owner, [self.key])
        self.assertEqual(mapped[self.key].pk, saved.pk)
        replay, created = self.reserve()
        self.assertFalse(created)
        self.assertEqual(replay.event_key, saved.event_key)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_unowned_local_review_cannot_reserve_a_meeting(self):
        self.review_rows.return_value = []
        with self.assertRaises(ValueError):
            self.reserve()
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_local_metadata_query_is_scoped_to_review_and_profile(self):
        self.assertEqual(local_mcm_bookings.local_mcm_event_key(211, 62), self.key)
        self.review_rows.assert_called_with("r.id = %s AND r.learner_id = %s", [62, 211])


    def test_review_status_and_pdf_date_follow_the_same_saved_meeting(self):
        from .migrated_completion_views import _mirror_status, _pdf_context
        record = self.record()
        overlay = SimpleNamespace(event_key=self.key, owner_email=self.owner, learner_id=211,
                                  source_review_id=62, status="awaiting-signature")
        _mirror_status(overlay)
        record.refresh_from_db()
        self.assertEqual(record.status, "awaiting-signature")
        self.assertEqual(record.graph_event_id, "existing-graph-event")
        context = _pdf_context(overlay, {"instance": {"targetDate": "2026-11-04"}})
        self.assertEqual(context["scheduled_date"], date(2026, 10, 23))

    def test_meeting_intelligence_uses_the_same_owned_record(self):
        from . import migrated_intelligence_views as intelligence
        record = self.record()
        overlay = SimpleNamespace(event_key=self.key, owner_email=self.owner, learner_id=211, source_review_id=62)
        definition = {"template": {"reviewTypeCode": "aptem_mcm"}}
        with patch.object(intelligence, "_coach_review", return_value=(self.owner, definition)), \
             patch.object(views, "_owned_migrated_overlay", return_value=overlay):
            found_overlay, found, _ = intelligence._association(None, self.key)
        self.assertIs(found_overlay, overlay)
        self.assertEqual(found.pk, record.pk)
