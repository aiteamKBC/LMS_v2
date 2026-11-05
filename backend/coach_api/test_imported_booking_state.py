"""Booking state vs review lifecycle for imported Aptem reviews.

The calendar record owns the booking, the overlay owns the lifecycle and the
Aptem row stays untouched evidence. These cases pin the rule that decides when
a booking is real, so one Review can never be booked on the calendar and
unbooked in the form, and so an attempt that never reserved a slot does not
block the next booking.

SimpleTestCase cases prohibit database access; the model cases build synthetic
rows only. PostgreSQL lock and concurrency semantics are not covered here.
"""
from copy import deepcopy
from itertools import count
from datetime import date, time
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import uuid4

from django.test import RequestFactory, SimpleTestCase, TestCase

from . import imported_booking_state as booking_state
from . import views
from .migrated_initialization import initialize_imported_review
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate
from .test_migrated_reviews import SOURCE, candidate_definition


OWNER = "coach@example.invalid"
_VERIFIED = object()


def synthetic_record(**overrides):
    """A fully verified Aptem appointment; overrides express each defect."""
    fields = dict(
        pk=10, event_key="imported-review:5101", owner_email=OWNER, learner_id=21,
        event_type="mcr", status=CoachCalendarEvent.STATUS_SCHEDULED,
        sync_state=CoachCalendarEvent.SYNC_SYNCED, graph_event_id="synthetic-graph-id",
        meeting_link="https://example.invalid/meeting", graph_web_link="",
        scheduled_date=date(2026, 11, 2), scheduled_time=time(10), duration_minutes=60,
        review_instance_id="", review_template_id="", idempotency_key="", notes="",
        owner_name="Coach", learner_name="Learner", learner_email="learner@example.invalid",
        sequence=1, target_date=date(2026, 11, 2), save=Mock(),
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


class VerifiedMeetingRuleTests(SimpleTestCase):
    """One predicate decides 'booked' for every imported booking path."""

    def verified(self, **overrides):
        return booking_state.verified_meeting(
            synthetic_record(**overrides), owner_email=OWNER, event_type="mcr")

    def test_a_synced_owned_appointment_with_a_slot_is_a_verified_meeting(self):
        self.assertTrue(self.verified())
        self.assertTrue(self.verified(status=CoachCalendarEvent.STATUS_IN_PROGRESS))
        self.assertTrue(self.verified(owner_email=OWNER.upper()))
        self.assertTrue(self.verified(meeting_link="", graph_web_link="https://example.invalid/web"))

    def test_no_record_is_never_a_verified_meeting(self):
        self.assertFalse(booking_state.verified_meeting(None, owner_email=OWNER, event_type="mcr"))

    def test_cancelled_pending_and_failed_states_are_each_rejected(self):
        self.assertFalse(self.verified(status=CoachCalendarEvent.STATUS_CANCELLED))
        self.assertFalse(self.verified(status=CoachCalendarEvent.STATUS_NOT_SCHEDULED))
        self.assertFalse(self.verified(sync_state=CoachCalendarEvent.SYNC_PENDING))
        self.assertFalse(self.verified(sync_state=CoachCalendarEvent.SYNC_FAILED))
        self.assertFalse(self.verified(sync_state=CoachCalendarEvent.SYNC_SYNCING))

    def test_a_meeting_without_graph_identity_or_a_slot_is_rejected(self):
        self.assertFalse(self.verified(graph_event_id=""))
        self.assertFalse(self.verified(meeting_link="", graph_web_link=""))
        self.assertFalse(self.verified(scheduled_date=None))
        self.assertFalse(self.verified(scheduled_time=None))

    def test_another_coach_or_another_session_type_is_rejected(self):
        self.assertFalse(self.verified(owner_email="other.coach@example.invalid"))
        self.assertFalse(self.verified(event_type="progress-review"))
        self.assertFalse(booking_state.verified_meeting(
            synthetic_record(), owner_email=OWNER, event_type="progress-review"))


class UnreservedPlaceholderRuleTests(SimpleTestCase):
    """Only a row that never held a booking may be reserved by a new one."""

    def placeholder(self, **overrides):
        base = dict(status=CoachCalendarEvent.STATUS_NOT_SCHEDULED, scheduled_date=None,
                    scheduled_time=None, sync_state=CoachCalendarEvent.SYNC_PENDING,
                    graph_event_id="", meeting_link="", graph_web_link="")
        base.update(overrides)
        return booking_state.unreserved_placeholder(synthetic_record(**base))

    def test_a_row_with_no_slot_no_sync_and_no_meeting_is_a_placeholder(self):
        self.assertTrue(self.placeholder())

    def test_no_record_is_not_a_placeholder(self):
        self.assertFalse(booking_state.unreserved_placeholder(None))

    def test_a_real_cancelled_or_syncing_booking_is_not_a_placeholder(self):
        self.assertFalse(self.placeholder(status=CoachCalendarEvent.STATUS_SCHEDULED,
                                          scheduled_date=date(2026, 11, 2), scheduled_time=time(10)))
        self.assertFalse(self.placeholder(status=CoachCalendarEvent.STATUS_CANCELLED))
        self.assertFalse(self.placeholder(sync_state=CoachCalendarEvent.SYNC_SYNCING))
        self.assertFalse(self.placeholder(sync_state=CoachCalendarEvent.SYNC_FAILED))
        self.assertFalse(self.placeholder(sync_state=CoachCalendarEvent.SYNC_CANCELLED))

    def test_an_existing_teams_meeting_or_native_linkage_is_not_a_placeholder(self):
        self.assertFalse(self.placeholder(graph_event_id="synthetic-graph-id"))
        self.assertFalse(self.placeholder(meeting_link="https://example.invalid/meeting"))
        self.assertFalse(self.placeholder(graph_web_link="https://example.invalid/web"))
        self.assertFalse(self.placeholder(review_instance_id="native-instance"))
        self.assertFalse(self.placeholder(review_template_id="native-template"))

    def test_a_half_reserved_row_is_not_treated_as_free(self):
        self.assertFalse(self.placeholder(scheduled_date=date(2026, 11, 2)))
        self.assertFalse(self.placeholder(scheduled_time=time(10)))


class ScheduleForVerifiedMeetingTests(SimpleTestCase):
    """Booking state may advance the lifecycle exactly one step, and no further."""

    def overlay(self, **overrides):
        fields = dict(pk=1, event_key="imported-review:5101", owner_email=OWNER, learner_id=21,
                      status=ImportedReviewInstance.STATUS_NOT_SCHEDULED, completed_at=None, save=Mock())
        fields.update(overrides)
        return SimpleNamespace(**fields)

    def schedule(self, overlay, record=_VERIFIED):
        return booking_state.schedule_for_verified_meeting(
            overlay, synthetic_record() if record is _VERIFIED else record,
            owner_email=OWNER, event_type="mcr")

    def test_a_verified_meeting_schedules_a_never_scheduled_overlay(self):
        overlay = self.overlay()
        self.assertTrue(self.schedule(overlay))
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
        overlay.save.assert_called_once_with(update_fields=["status", "updated_at"])

    def test_a_booking_never_starts_submits_signs_or_completes_a_review(self):
        for status in (ImportedReviewInstance.STATUS_SCHEDULED, ImportedReviewInstance.STATUS_IN_PROGRESS,
                       ImportedReviewInstance.STATUS_AWAITING_SIGNATURE,
                       ImportedReviewInstance.STATUS_COMPLETED):
            with self.subTest(status=status):
                overlay = self.overlay(status=status)
                self.assertFalse(self.schedule(overlay))
                self.assertEqual(overlay.status, status)
                overlay.save.assert_not_called()

    def test_a_completed_overlay_or_another_coachs_overlay_is_left_alone(self):
        for overlay in (self.overlay(completed_at="2026-10-01T00:00:00Z"),
                        self.overlay(owner_email="other.coach@example.invalid")):
            self.assertFalse(self.schedule(overlay))
            self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
            overlay.save.assert_not_called()

    def test_an_unverified_booking_leaves_the_overlay_unscheduled(self):
        for record in (None, synthetic_record(sync_state=CoachCalendarEvent.SYNC_PENDING),
                       synthetic_record(status=CoachCalendarEvent.STATUS_CANCELLED),
                       synthetic_record(scheduled_time=None)):
            overlay = self.overlay()
            self.assertFalse(self.schedule(overlay, record))
            self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)
            overlay.save.assert_not_called()


class ImportedInitializationBookingTests(TestCase):
    """A booking made before the working copy exists is still that Review's."""

    def setUp(self):
        self.source_ids = count(5101)
        self.template = MigratedReviewTemplate.objects.create(
            programme_key="id:P-42", review_family="MCM", name="Approved",
            definition_json=candidate_definition(SOURCE), is_active=True,
        )

    def definition(self, key, source_id, *, source_status="not-scheduled"):
        return {
            "readOnly": True, "canInitialize": True, "sourceStatus": source_status,
            "migratedProgrammeKey": "id:P-42",
            "instance": {"id": key, "learnerId": 21},
            "historicalReview": {"id": str(source_id), "aptemReviewId": str(source_id),
                                 "type": "Monthly Coaching Meeting", "status": "Not Scheduled"},
        }

    def initialize(self, record, *, source_status="not-scheduled"):
        key = f"imported-review:{uuid4().hex}"
        profile = SimpleNamespace(id=21, enrolment_id=71, learner_type="apprenticeship")
        with patch("learner_api.models.LearnerProfile.objects") as profiles, \
             patch("coach_api.review_sources.booking_for_imported_review",
                   return_value=record) as resolver:
            profiles.filter.return_value.values_list.return_value.first.return_value = OWNER
            profiles.filter.return_value.first.return_value = profile
            overlay, created = initialize_imported_review(
                OWNER, self.definition(key, next(self.source_ids), source_status=source_status))
        self.assertTrue(created)
        return overlay, resolver

    def test_a_verified_booking_made_first_opens_the_review_as_scheduled(self):
        overlay, resolver = self.initialize(synthetic_record())
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
        # Resolved through the durable source linkage under the learner lock.
        self.assertTrue(resolver.call_args.kwargs.get("lock"))

    def test_a_review_without_a_verified_booking_is_not_treated_as_scheduled(self):
        for record in (None,
                       synthetic_record(sync_state=CoachCalendarEvent.SYNC_PENDING),
                       synthetic_record(status=CoachCalendarEvent.STATUS_CANCELLED),
                       synthetic_record(scheduled_date=None),
                       synthetic_record(graph_event_id=""),
                       synthetic_record(owner_email="other.coach@example.invalid"),
                       synthetic_record(event_type="progress-review")):
            with self.subTest(record=record):
                overlay, _ = self.initialize(record)
                self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)

    def test_an_ambiguous_calendar_association_leaves_the_review_unscheduled(self):
        from .review_sources import ReviewIdentityConflict

        key = f"imported-review:{uuid4().hex}"
        profile = SimpleNamespace(id=21, enrolment_id=71, learner_type="apprenticeship")
        with patch("learner_api.models.LearnerProfile.objects") as profiles, \
             patch("coach_api.review_sources.booking_for_imported_review",
                   side_effect=ReviewIdentityConflict("two bookings")):
            profiles.filter.return_value.values_list.return_value.first.return_value = OWNER
            profiles.filter.return_value.first.return_value = profile
            overlay, _ = initialize_imported_review(
                OWNER, self.definition(key, next(self.source_ids)))
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_NOT_SCHEDULED)

    def test_the_aptem_source_status_still_wins_when_it_is_already_scheduled(self):
        overlay, resolver = self.initialize(None, source_status="scheduled")
        self.assertEqual(overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)
        resolver.assert_not_called()


class CoachBookingPlaceholderRecoveryTests(TestCase):
    """An abandoned attempt must not strand the Review's only booking action."""

    slot = {"scheduledDate": "2026-11-02", "scheduledTime": "10:00", "durationMinutes": 60}

    def setUp(self):
        self.key = "imported-review:5101"
        self.template = MigratedReviewTemplate.objects.create(
            scope="GLOBAL", programme_key="", review_family="MCM", name="Approved Global",
            definition_json=candidate_definition(SOURCE), is_active=True,
        )
        self.overlay = ImportedReviewInstance.objects.create(
            event_key=self.key, owner_email=OWNER, learner_id=21, source_review_id=5101,
            status=ImportedReviewInstance.STATUS_NOT_SCHEDULED, migrated_template=self.template,
            template_snapshot={"sections": [{"id": "s"}],
                               "templateSource": {"id": self.template.pk, "family": "MCM",
                                                  "scope": "GLOBAL"}},
        )
        self.definition = {
            "source": "aptem", "sourceStatus": "Not Scheduled", "migratedForm": True,
            "readOnly": False, "migratedProgrammeKey": "", "localStatus": "not-scheduled",
            "historicalReview": {"id": "5101", "aptemReviewId": "5101",
                                 "type": "Monthly Coaching Meeting", "status": "Not Scheduled"},
            "instance": {"id": self.key, "learnerId": 21, "targetDate": "2026-11-02"},
            "booking": {"conflict": False},
        }
        self.base_event = {
            "reviewSource": "aptem", "learnerId": 21, "source": "mcr", "sequence": 1,
            "learner": "Learner", "email": "learner@example.invalid",
            "aptemReviewId": "5101", "reviewId": "5101",
        }

    def placeholder(self, **overrides):
        fields = dict(event_key=self.key, owner_email=OWNER, learner_id=21, event_type="mcr",
                      status=CoachCalendarEvent.STATUS_NOT_SCHEDULED,
                      sync_state=CoachCalendarEvent.SYNC_PENDING, target_date=date(2026, 11, 2))
        fields.update(overrides)
        return CoachCalendarEvent.objects.create(**fields)

    def book(self, slot=None):
        learner = SimpleNamespace(id=21, enrolment_id=71, learner_type="apprenticeship")

        def synced(record_id, _base_event):
            record = CoachCalendarEvent.objects.get(pk=record_id)
            record.sync_state = CoachCalendarEvent.SYNC_SYNCED
            record.graph_event_id = "synthetic-graph-id"
            record.meeting_link = "https://example.invalid/meeting"
            record.save(update_fields=["sync_state", "graph_event_id", "meeting_link"])
            self.graph_calls.append(record_id)
            return record, "", True

        self.graph_calls = []
        with patch("coach_api.views.authenticated_coach_email", return_value=OWNER), \
             patch("coach_api.views._imported_review_definition",
                   side_effect=lambda *_a, **_k: deepcopy(self.definition)), \
             patch("coach_api.views.find_generated_timetable_event",
                   return_value=(dict(self.base_event), "Coach")), \
             patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[learner]), \
             patch("coach_api.views.coach_learner_personal_calendar_conflicts", return_value=False), \
             patch("coach_api.views.ensure_coach_booking_available"), \
             patch("coach_api.views.ensure_learner_calendar_available"), \
             patch("coach_api.views.england_non_delivery_reason", return_value=""), \
             patch("coach_api.views.synchronize_reserved_calendar_event", side_effect=synced):
            request = RequestFactory().post(
                f"/coach/reviews/{self.key}/book",
                data=json.dumps(slot or self.slot), content_type="application/json")
            return unwrap(views.coach_review_instance_book)(request, self.key)

    def test_a_placeholder_that_never_reserved_a_slot_is_booked_not_rejected(self):
        row = self.placeholder()
        response = self.book()
        self.assertEqual(response.status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.status, CoachCalendarEvent.STATUS_SCHEDULED)
        self.assertEqual((row.scheduled_date, row.scheduled_time), (date(2026, 11, 2), time(10)))
        self.assertEqual(CoachCalendarEvent.objects.filter(event_key=self.key).count(), 1)
        self.assertEqual(len(self.graph_calls), 1)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, ImportedReviewInstance.STATUS_SCHEDULED)

    def test_booking_a_placeholder_never_creates_a_second_appointment(self):
        self.placeholder()
        self.assertEqual(self.book().status_code, 200)
        self.assertEqual(CoachCalendarEvent.objects.filter(learner_id=21, event_type="mcr").count(), 1)

    def test_a_real_booking_at_another_time_is_still_refused(self):
        self.placeholder(status=CoachCalendarEvent.STATUS_SCHEDULED,
                         scheduled_date=date(2026, 11, 3), scheduled_time=time(9),
                         duration_minutes=60, graph_event_id="synthetic-graph-id",
                         meeting_link="https://example.invalid/meeting",
                         sync_state=CoachCalendarEvent.SYNC_SYNCED)
        response = self.book()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["error"], "ALREADY_BOOKED")
        self.assertEqual(self.graph_calls, [])

    def test_a_cancelled_booking_is_not_reused_as_a_free_placeholder(self):
        self.placeholder(status=CoachCalendarEvent.STATUS_CANCELLED)
        response = self.book()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.graph_calls, [])

    def test_a_synchronisation_lease_still_blocks_a_duplicate_request(self):
        self.placeholder(status=CoachCalendarEvent.STATUS_SCHEDULED,
                         scheduled_date=date(2026, 11, 2), scheduled_time=time(10),
                         duration_minutes=60, sync_state=CoachCalendarEvent.SYNC_SYNCING)
        response = self.book()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.graph_calls, [])

    def test_another_coachs_row_is_rejected_before_any_reservation(self):
        row = self.placeholder(owner_email="other.coach@example.invalid")
        response = self.book()
        self.assertEqual(response.status_code, 409)
        row.refresh_from_db()
        self.assertEqual(row.status, CoachCalendarEvent.STATUS_NOT_SCHEDULED)
        self.assertIsNone(row.scheduled_date)
        self.assertEqual(self.graph_calls, [])

    def test_a_placeholder_for_another_session_type_is_rejected(self):
        self.placeholder(event_type="progress-review")
        self.assertEqual(self.book().status_code, 409)
        self.assertEqual(self.graph_calls, [])
