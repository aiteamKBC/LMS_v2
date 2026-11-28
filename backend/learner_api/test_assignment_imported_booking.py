"""Learner Aptem bookings, including the monthly-assignment screen.

Booking state lives on the calendar record and the review lifecycle lives on
the overlay, so every answer this endpoint can give for an imported Review has
to leave the two agreeing. The replay case is the one that used to disagree:
the endpoint answers from the appointment that already exists, short of the
reservation branch that performs the transition.

The endpoint, the reservation and the overlay transition all run for real
here. Only boundaries are replaced: the Aptem "Learner".reviews reads, the
learner source models, the coach's Outlook availability, and the single Graph
call. Synthetic rows only; PostgreSQL locking is not covered.
"""
import json
from datetime import date, datetime, time, timezone as utc
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, TestCase
from django.utils import timezone

from coach_api import views
from coach_api.models import (CoachCalendarEvent, ImportedReviewInstance, MigratedReviewSignature,
                              MigratedReviewTemplate)
from coach_api.test_migrated_reviews import SOURCE, candidate_definition

from . import calendar as calendar_module


OWNER = "coach@example.invalid"
PROFILE_ID = 101
ENROLMENT_ID = 701          # deliberately different from the profile id
SOURCE_REVIEW_ID = 4411     # internal "Learner".reviews.id
APTEM_REVIEW_ID = "9840"    # Aptem's own id; the event key uses this one
KEY = f"imported-review:{APTEM_REVIEW_ID}"

REVIEW_COLUMNS = ("id", "aptem_review_id", "review_name", "review_type", "reviewer_name",
                  "learner_name", "planned_scheduled_date", "completed_date", "status",
                  "review_data", "extraction_status", "last_error")

BOOKING_FIELDS = ("event_key", "owner_email", "owner_name", "learner_id", "learner_name",
                  "learner_email", "event_type", "sequence", "target_date", "scheduled_date",
                  "scheduled_time", "duration_minutes", "status", "meeting_provider",
                  "meeting_link", "graph_event_id", "graph_web_link", "notes",
                  "graph_organizer_email", "operation_id", "idempotency_key", "sync_state",
                  "sync_attempt_count", "last_sync_attempt_at", "last_graph_sync_error",
                  "review_template_id", "review_instance_id", "occurrence_number",
                  "review_responses", "review_completed_at")


class FakeAptemCursor:
    """Serves the two raw "Learner".reviews reads the booking path performs."""

    def __init__(self, store):
        self.store = store

    def __enter__(self):
        return self

    def __exit__(self, *_exc):
        return False

    def execute(self, sql, params=None):
        self.params = list(params or [])
        self.description = [(name,) for name in REVIEW_COLUMNS]
        self.rowcount = 0
        self.rows = []
        review_pk, learner_id = (self.params + [None, None])[:2]
        if str(review_pk) == str(self.store["id"]) and str(learner_id) == str(PROFILE_ID):
            self.rows = [tuple(self.store[name] for name in REVIEW_COLUMNS)]
            self.rowcount = 1

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return list(self.rows)


class ImportedLearnerBookingTests(TestCase):
    def setUp(self):
        self.aptem_row = {
            "id": SOURCE_REVIEW_ID, "aptem_review_id": APTEM_REVIEW_ID,
            "review_name": "Monthly Coaching Meeting", "review_type": "Monthly Coaching Meeting",
            "reviewer_name": "Coach", "learner_name": "Test Learner",
            "planned_scheduled_date": datetime(2026, 11, 2, 9), "completed_date": None,
            "status": "Not Scheduled", "review_data": {}, "extraction_status": "partial",
            "last_error": "",
        }
        self.template = MigratedReviewTemplate.objects.create(
            scope="GLOBAL", programme_key="", review_family="MCM", name="Approved Global",
            definition_json=candidate_definition(SOURCE), is_active=True,
        )
        self.mirror = SimpleNamespace(
            id=PROFILE_ID, enrolment_id=ENROLMENT_ID, learner_type="apprenticeship",
            coach_email=OWNER, coach_name="Coach", full_name="Test Learner",
            email="learner@example.invalid", lifecycle_status="active",
        )
        learner = SimpleNamespace(username="Test Learner", email="learner@example.invalid")
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = learner
        self.graph_calls = []
        self.enterContext(patch.object(calendar_module, "SOURCE_MODELS", {"commercial": model}))
        for name in ("learner_profile_for_source", "review_profile_for_source", "_calendar_profile"):
            self.enterContext(patch.object(calendar_module, name, return_value=self.mirror))
        self.enterContext(patch.object(calendar_module, "source_for_learner",
                                       return_value=SimpleNamespace(kind="aptem")))
        self.events = [self.event()]
        self.enterContext(patch.object(calendar_module, "coaching_events_for_learner",
                                       side_effect=lambda *_a, **_k: [dict(row) for row in self.events]))
        self.enterContext(patch.object(calendar_module, "booking_date_restriction", return_value=None))
        self.enterContext(patch.object(calendar_module, "_record_enrolment_review"))
        self.enterContext(patch.object(calendar_module, "_follow_first_session_start_date"))
        self.enterContext(patch.object(calendar_module, "connection",
                                       SimpleNamespace(cursor=lambda: FakeAptemCursor(self.aptem_row))))
        self.enterContext(patch("coach_api.review_reconciliation.read_source",
                                side_effect=lambda review_id, lock=False: {
                                    "id": SOURCE_REVIEW_ID, "learner_id": PROFILE_ID,
                                    "aptem_review_id": APTEM_REVIEW_ID,
                                    "review_type": "Monthly Coaching Meeting",
                                    "status": "Not Scheduled", "completed_date": None}))
        self.enterContext(patch("coach_api.booking_availability.ensure_coach_outlook_available"))
        self.enterContext(patch("learner_api.calendar_connections.booking_conflicts", return_value=False))
        self.enterContext(patch("learner_api.booking_calendar.timezone.localdate",
                                return_value=date(2026, 10, 1)))
        self.enterContext(patch.object(views, "sync_calendar_event_to_graph",
                                       side_effect=self.graph_sync))

    # --- boundaries -----------------------------------------------------
    def graph_sync(self, record, _base_event):
        self.graph_calls.append(record.pk)
        if getattr(self, "graph_fails", False):
            return "Teams did not confirm this meeting."
        record.graph_event_id = record.graph_event_id or f"graph-{record.pk}"
        record.meeting_link = "https://example.invalid/meeting"
        record.meeting_provider = "teamsForBusiness"
        return ""

    def no_graph_allowed(self):
        """Fail loudly on any Graph or reservation write during a replay."""
        # learner_api.calendar imports these from coach_api.views inside the
        # view, so patching the source module covers both call sites.
        for name in ("sync_calendar_event_to_graph", "delete_calendar_event_from_graph",
                     "synchronize_reserved_calendar_event", "persist_calendar_sync_reservation",
                     "reserve_coach_calendar_booking"):
            self.enterContext(patch(f"coach_api.views.{name}",
                                    side_effect=AssertionError(f"{name} must not run on a replay")))

    # --- fixtures -------------------------------------------------------
    def event(self, **overrides):
        """What coaching_events_for_learner reports for this imported MCM."""
        row = {
            "reviewSource": "aptem", "reviewId": str(SOURCE_REVIEW_ID),
            "aptemReviewId": APTEM_REVIEW_ID, "importedReviewType": "Monthly Coaching Meeting",
            "eventKey": KEY, "calendarEventKey": None, "learnerId": str(PROFILE_ID),
            "enrolmentId": str(ENROLMENT_ID), "learnerType": "apprenticeship",
            "source": "mcr", "status": "not-scheduled", "localStatus": "not-scheduled",
            "effectiveLmsStatus": "not-scheduled", "coachEmail": OWNER, "coachName": "Coach",
            "learner": "Test Learner", "email": "learner@example.invalid",
            "sequence": 1, "targetDate": "2026-11-02",
        }
        row.update(overrides)
        return row

    def overlay(self, **overrides):
        fields = dict(event_key=KEY, owner_email=OWNER, learner_id=PROFILE_ID,
                      source_review_id=SOURCE_REVIEW_ID, migrated_template=self.template,
                      status=ImportedReviewInstance.STATUS_NOT_SCHEDULED,
                      template_snapshot={"sections": [{"id": "s"}],
                                         "templateSource": {"id": self.template.pk, "family": "MCM",
                                                            "scope": "GLOBAL"}})
        fields.update(overrides)
        return ImportedReviewInstance.objects.create(**fields)

    def synced_booking(self, **overrides):
        """An appointment Graph already confirmed for this imported Review."""
        fields = dict(
            event_key=KEY, owner_email=OWNER, owner_name="Coach", learner_id=PROFILE_ID,
            learner_name="Test Learner", learner_email="learner@example.invalid",
            event_type="mcr", sequence=1, target_date=date(2026, 11, 2),
            scheduled_date=date(2026, 11, 2), scheduled_time=time(10), duration_minutes=60,
            status=CoachCalendarEvent.STATUS_SCHEDULED, sync_state=CoachCalendarEvent.SYNC_SYNCED,
            graph_event_id="graph-existing", meeting_link="https://example.invalid/meeting",
            meeting_provider="teamsForBusiness", notes="Monthly assignment: Topic",
            idempotency_key=KEY, sync_attempt_count=1,
            last_sync_attempt_at=datetime(2026, 10, 20, 9, tzinfo=utc.utc),
        )
        fields.update(overrides)
        record = CoachCalendarEvent.objects.create(**fields)
        self.events = [self.event(calendarEventKey=record.event_key, status="scheduled")]
        return record

    def snapshot(self, record):
        record.refresh_from_db()
        return {name: getattr(record, name) for name in BOOKING_FIELDS}

    # --- the request the Assignment screen actually sends ----------------
    def book(self, *, review_id=SOURCE_REVIEW_ID, month="2026-11", day="2026-11-02",
             clock="10:00", kind="commercial"):
        payload = {
            "sessionType": "mcr", "bookingContext": "monthly-assignment",
            "reviewId": str(review_id), "assignmentMonth": month,
            "scheduledDate": day, "scheduledTime": clock, "durationMinutes": 60,
            "timezoneOffsetMinutes": 0, "notes": "Monthly assignment: Topic",
        }
        request = RequestFactory().post(f"/learner_api/calendar/{kind}/{PROFILE_ID}/book/",
                                        data=json.dumps(payload), content_type="application/json")
        return unwrap(calendar_module.learner_calendar_book)(request, kind, PROFILE_ID)

    # --- replay of an already synchronized booking -----------------------
    def test_replaying_an_already_synced_booking_schedules_the_overlay(self):
        """Replaces the investigation probe that recorded the opposite."""
        record = self.synced_booking()
        overlay = self.overlay()
        before = self.snapshot(record)
        self.no_graph_allowed()

        response = self.book()

        self.assertEqual(response.status_code, 200, response.content)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
        self.assertEqual(self.snapshot(record), before, "the booking itself must not change")
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        self.assertEqual(self.graph_calls, [])

    def test_the_replay_response_reports_the_completed_transition(self):
        self.synced_booking()
        self.overlay()
        self.no_graph_allowed()
        body = json.loads(self.book().content)
        self.assertEqual(body["event"]["localStatus"], "scheduled")
        self.assertEqual(body["event"]["effectiveLmsStatus"], "scheduled")
        self.assertEqual(body["event"]["eventKey"], KEY)
        self.assertEqual(body["event"]["scheduledDate"], "2026-11-02")
        self.assertEqual(body["event"]["scheduledTime"], "10:00")
        self.assertEqual(sorted(body), ["event", "warning"])

    def test_repeating_the_identical_replay_changes_nothing_further(self):
        record = self.synced_booking()
        overlay = self.overlay()
        self.no_graph_allowed()
        self.assertEqual(self.book().status_code, 200)
        overlay.refresh_from_db()
        first = (overlay.status, overlay.updated_at, self.snapshot(record))

        self.assertEqual(self.book().status_code, 200)

        overlay.refresh_from_db()
        self.assertEqual((overlay.status, overlay.updated_at, self.snapshot(record)), first)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        self.assertEqual(self.graph_calls, [])

    def test_a_replay_without_a_working_copy_creates_none(self):
        record = self.synced_booking()
        before = self.snapshot(record)
        self.no_graph_allowed()

        self.assertEqual(self.book().status_code, 200)

        self.assertFalse(ImportedReviewInstance.objects.exists())
        self.assertEqual(self.snapshot(record), before)
        # The established explicit initialization still produces the right state.
        from coach_api.migrated_initialization import initialize_imported_review

        definition = {
            "readOnly": True, "canInitialize": True, "sourceStatus": "not-scheduled",
            "migratedProgrammeKey": "", "instance": {"id": KEY, "learnerId": PROFILE_ID},
            "historicalReview": {"id": str(SOURCE_REVIEW_ID), "aptemReviewId": APTEM_REVIEW_ID,
                                 "type": "Monthly Coaching Meeting", "status": "Not Scheduled"},
        }
        with patch("learner_api.models.LearnerProfile.objects") as profiles:
            profiles.filter.return_value.values_list.return_value.first.return_value = OWNER
            profiles.filter.return_value.first.return_value = self.mirror
            overlay, created = initialize_imported_review(OWNER, definition)
        self.assertTrue(created)
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)

    # --- protected review states ----------------------------------------
    def test_a_started_or_finished_review_keeps_its_state_answers_and_signature(self):
        signed_at = timezone.now()
        for status in (ImportedReviewInstance.STATUS_IN_PROGRESS,
                       ImportedReviewInstance.STATUS_AWAITING_SIGNATURE,
                       ImportedReviewInstance.STATUS_COMPLETED):
            with self.subTest(status=status):
                CoachCalendarEvent.objects.all().delete()
                MigratedReviewSignature.objects.all().delete()
                ImportedReviewInstance.objects.all().delete()
                record = self.synced_booking()
                completed = signed_at if status == ImportedReviewInstance.STATUS_COMPLETED else None
                overlay = self.overlay(status=status, completed_at=completed,
                                       answers={"recap": "Coach's saved answer"})
                MigratedReviewSignature.objects.create(
                    overlay=overlay, role="advisor", signer_account_id=1, signer_name="Coach",
                    signer_email=OWNER, signature="data:image/png;base64,AAAA", signed_at=signed_at)
                before_booking = self.snapshot(record)
                before_overlay = (overlay.status, overlay.answers, overlay.completed_at,
                                  overlay.updated_at)
                self.no_graph_allowed()

                self.assertEqual(self.book().status_code, 200)

                overlay.refresh_from_db()
                self.assertEqual((overlay.status, overlay.answers, overlay.completed_at,
                                  overlay.updated_at), before_overlay)
                self.assertEqual(self.snapshot(record), before_booking)
                signature = MigratedReviewSignature.objects.get(overlay=overlay)
                self.assertEqual((signature.role, signature.signature, signature.signed_at),
                                 ("advisor", "data:image/png;base64,AAAA", signed_at))

    # --- cases that must never promote -----------------------------------
    def test_a_cancelled_booking_answered_as_a_replay_never_promotes(self):
        record = self.synced_booking(status=CoachCalendarEvent.STATUS_CANCELLED)
        overlay = self.overlay()
        before = self.snapshot(record)
        self.no_graph_allowed()
        self.assertEqual(self.book().status_code, 200)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
        self.assertEqual(self.snapshot(record), before)

    def test_an_unsynced_booking_still_takes_the_existing_retry_path(self):
        """Not a replay: the established reservation/sync path must still run."""
        for state in (CoachCalendarEvent.SYNC_PENDING, CoachCalendarEvent.SYNC_FAILED):
            with self.subTest(sync_state=state):
                CoachCalendarEvent.objects.all().delete()
                ImportedReviewInstance.objects.all().delete()
                self.graph_calls.clear()
                self.synced_booking(sync_state=state)
                overlay = self.overlay()
                self.assertEqual(self.book().status_code, 200)
                # The retry, not the replay answer, completed this booking.
                self.assertEqual(len(self.graph_calls), 1)
                self.assertEqual(CoachCalendarEvent.objects.count(), 1)
                overlay.refresh_from_db()
                self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)

    def test_a_booking_missing_its_teams_meeting_does_not_promote(self):
        for field in ("graph_event_id", "meeting_link"):
            with self.subTest(field=field):
                CoachCalendarEvent.objects.all().delete()
                ImportedReviewInstance.objects.all().delete()
                self.synced_booking(**{field: "", "graph_web_link": ""})
                overlay = self.overlay()
                self.assertEqual(self.book().status_code, 200)
                overlay.refresh_from_db()
                self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)

    def test_another_coachs_overlay_is_not_promoted_by_this_booking(self):
        record = self.synced_booking()
        overlay = self.overlay(owner_email="other.coach@example.invalid")
        before = self.snapshot(record)
        self.no_graph_allowed()
        self.assertEqual(self.book().status_code, 200)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
        self.assertEqual(self.snapshot(record), before)

    def test_an_overlay_bound_to_another_source_review_is_not_promoted(self):
        self.synced_booking()
        overlay = self.overlay(source_review_id=SOURCE_REVIEW_ID + 1, event_key=f"{KEY}-other")
        self.no_graph_allowed()
        self.assertEqual(self.book().status_code, 200)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)

    def test_a_different_requested_slot_is_still_refused_before_any_write(self):
        record = self.synced_booking()
        overlay = self.overlay()
        before = self.snapshot(record)
        self.no_graph_allowed()
        response = self.book(day="2026-11-03", clock="14:00")
        self.assertEqual(response.status_code, 409, response.content)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
        self.assertEqual(self.snapshot(record), before)

    def test_a_review_that_is_not_this_learners_is_refused(self):
        self.synced_booking()
        self.overlay()
        response = self.book(review_id=999999)
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(self.graph_calls, [])

    def test_an_event_reporting_the_enrolment_id_cannot_promote_the_overlay(self):
        """The overlay is keyed by the profile id; the enrolment id must miss."""
        record = self.synced_booking()
        overlay = self.overlay()
        self.events = [self.event(calendarEventKey=KEY, status="scheduled",
                                  learnerId=str(ENROLMENT_ID))]
        before = self.snapshot(record)
        self.no_graph_allowed()
        self.assertEqual(self.book().status_code, 200)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
        self.assertEqual(self.snapshot(record), before)

    def test_the_aptem_review_id_is_not_accepted_as_the_internal_review_id(self):
        self.synced_booking()
        self.overlay()
        response = self.book(review_id=int(APTEM_REVIEW_ID))
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(self.graph_calls, [])

    def test_the_imported_source_row_is_never_rewritten_by_a_replay(self):
        self.synced_booking()
        self.overlay()
        before = dict(self.aptem_row)
        self.no_graph_allowed()
        self.assertEqual(self.book().status_code, 200)
        self.assertEqual(self.aptem_row, before)

    def test_a_cancellation_landing_before_the_lock_blocks_the_promotion(self):
        """The helper re-reads the booking under its lock, not from the resolve."""
        record = self.synced_booking()
        overlay = self.overlay()
        self.no_graph_allowed()

        def cancel_then_lock(learner_id):
            CoachCalendarEvent.objects.filter(pk=record.pk).update(
                status=CoachCalendarEvent.STATUS_CANCELLED)

        with patch.object(views, "lock_learner_calendar", side_effect=cancel_then_lock) as lock:
            self.assertEqual(self.book().status_code, 200)

        lock.assert_called_once_with(str(PROFILE_ID))
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_CANCELLED)

    # --- the first booking, for regression alongside the replay ----------
    def test_a_first_assignment_booking_still_schedules_the_overlay(self):
        overlay = self.overlay()
        response = self.book()
        self.assertEqual(response.status_code, 201, response.content)
        row = CoachCalendarEvent.objects.get(event_key=KEY)
        self.assertEqual((row.status, row.sync_state), ("scheduled", "synced"))
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
        self.assertEqual(len(self.graph_calls), 1)

    def test_a_graph_failure_then_a_retry_recovers_without_a_second_meeting(self):
        overlay = self.overlay()
        self.graph_fails = True
        self.assertEqual(self.book().status_code, 201)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
        self.graph_fails = False
        self.assertEqual(self.book().status_code, 200)
        self.assertEqual(CoachCalendarEvent.objects.filter(event_key=KEY).count(), 1)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
