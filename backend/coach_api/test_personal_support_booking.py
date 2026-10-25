"""PSP booking permissions and HTTP operations with synthetic storage/Graph."""
from contextlib import nullcontext
from copy import deepcopy
from datetime import date, time, timedelta
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import views, personal_support_booking as booking
from .models import CoachCalendarEvent
from . import test_migrated_reviews as fixtures


OWNER = "coach@example.invalid"
KEY = "imported-review:A-7"


class PersonalSupportIdentityTests(SimpleTestCase):
    @patch("coach_api.models.CoachCalendarEvent.objects.filter")
    def test_existing_appointment_is_found_by_source_identity_and_other_learners_are_rejected(self, records):
        profile = SimpleNamespace(id=21, enrolment_id=121, learner_type="apprenticeship")
        source = {"id": "407", "aptemReviewId": "A-7", "type": "Personal Support Plan",
                  "status": "not-scheduled"}
        record = CoachCalendarEvent(pk=1, event_key=KEY, owner_email=OWNER, learner_id=21,
                                    event_type="progress-review", status="scheduled", sync_state="synced",
                                    graph_event_id="original-event", meeting_link="https://example.invalid/meeting",
                                    scheduled_date=date(2026, 11, 2), scheduled_time=time(10), duration_minutes=60)
        records.return_value = [record]
        linked, state = booking.booking_state(OWNER, profile, source)
        self.assertIs(linked, record)
        self.assertTrue(state["canReschedule"])
        self.assertEqual(state["scheduledDate"], "2026-11-02")
        self.assertEqual(state["status"], "scheduled")
        record.learner_id = 99
        linked, state = booking.booking_state(OWNER, profile, source)
        self.assertIsNone(linked)
        self.assertTrue(state["conflict"])
        self.assertFalse(state["canBook"] or state["canReschedule"])


class PersonalSupportDefinitionTests(SimpleTestCase):
    _patch = fixtures.MigratedPreviewTests._patch
    _set_source_status = fixtures.MigratedPreviewTests._set_source_status
    _get = fixtures.MigratedPreviewTests._get

    def setUp(self):
        fixtures.MigratedPreviewTests.setUp(self)
        self.view_as.return_value = False
        row = list(self.cursor.fetchall.return_value[0])
        row[3] = row[4] = "Personal Support Plan"
        self.cursor.fetchall.return_value = [tuple(row)]
        self._patch("coach_api.personal_support_booking.booking_for_imported_review", return_value=None)

    def test_summary_can_be_booked_without_initializing_or_unlocking_a_form(self):
        self.templates.return_value = None
        result = self._get()
        self.assertTrue(result["readOnly"])
        self.assertTrue(result["summaryOnly"])
        self.assertFalse(result["migratedForm"])
        self.assertFalse(result["canInitialize"])
        self.assertTrue(result["booking"]["canBook"])
        self.assertFalse(result["booking"]["formRequired"])
        self.templates.assert_called_once()

    def test_view_as_summary_stays_read_only_and_cannot_book(self):
        self.view_as.return_value = True
        result = self._get()
        self.assertFalse(result["booking"]["canBook"])
        self.assertFalse(result["booking"]["canReschedule"])

    def test_active_global_psp_can_initialize_while_booking_stays_independent(self):
        result = self._get()
        self.assertTrue(result["canInitialize"])
        self.assertTrue(result["readOnly"])
        self.assertEqual(result["template"]["reviewTypeCode"], "aptem_psp")
        self.assertTrue(result["booking"]["canBook"])
        self.assertFalse(result["booking"]["formRequired"])
        self.assertFalse(any(state["required"] for state in result["signatures"].values()))

    def test_in_progress_source_with_captured_fields_can_use_the_global_form(self):
        row = list(self.cursor.fetchall.return_value[0])
        row[9] = "In Progress"
        self.cursor.fetchall.return_value = [tuple(row)]
        with patch.object(views, "_imported_review_has_usable_form", return_value=True):
            result = self._get()
        self.assertTrue(result["canInitialize"])
        self.assertTrue(result["readOnly"])
        self.assertFalse(result["migratedForm"])

    def test_historical_psp_stays_read_only_without_resolving_a_global_template(self):
        row = list(self.cursor.fetchall.return_value[0])
        row[9] = "Completed"
        self.cursor.fetchall.return_value = [tuple(row)]
        result = self._get()
        self.assertTrue(result["readOnly"])
        self.assertFalse(result["canInitialize"])
        self.templates.assert_not_called()

    def test_other_unsupported_imports_are_not_made_bookable(self):
        row = list(self.cursor.fetchall.return_value[0])
        row[3] = row[4] = "Gateway Review"
        self.cursor.fetchall.return_value = [tuple(row)]
        self.assertNotIn("booking", self._get())


class PersonalSupportBookingTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.profile = SimpleNamespace(id=21, enrolment_id=121, learner_type="apprenticeship")
        future = date.today() + timedelta(days=14)
        self.day = future + timedelta(days=(0 - future.weekday()) % 7)
        self.source = {"id": "407", "aptemReviewId": "A-7", "type": "Personal Support Plan",
                       "status": "not-scheduled", "completedDate": None}
        self.record = None
        self.overlay = None
        self.base = {"eventKey": KEY, "reviewSource": "aptem", "source": "progress-review",
                     "importedReviewType": "Personal Support Plan", "learnerId": "21",
                     "learner": "Synthetic learner", "email": "learner@example.invalid", "sequence": 4}
        self._patch("coach_api.views.authenticated_coach_email", return_value=OWNER)
        self._patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[self.profile])
        self._patch("coach_api.views._imported_review_definition", side_effect=lambda *a: self.definition())
        self._patch("coach_api.views.find_generated_timetable_event", side_effect=lambda *a: (self.base, "Coach"))
        self._patch("coach_api.personal_support_booking.booking_for_imported_review", side_effect=lambda *a, **kw: self.record)
        self._patch("coach_api.personal_support_booking.transaction.atomic", side_effect=lambda: nullcontext())
        self._patch("coach_api.views.lock_learner_calendar")
        self.overlays = self._patch("coach_api.personal_support_booking.ImportedReviewInstance.objects.select_for_update")
        self.overlays.return_value.filter.return_value.first.side_effect = lambda: self.overlay
        self.create = self._patch("coach_api.personal_support_booking.CoachCalendarEvent.objects.create", side_effect=self.create_record)
        self.persist = self._patch("coach_api.views.persist_calendar_sync_reservation", side_effect=lambda row, **kw: row)
        self.sync = self._patch("coach_api.views.synchronize_reserved_calendar_event", side_effect=self.synchronize)
        self.conflicts = self._patch("coach_api.views.coach_learner_personal_calendar_conflicts", return_value=False)
        self.payload = {"scheduledDate": self.day.isoformat(), "scheduledTime": "10:00", "durationMinutes": 60}

    def _patch(self, target, **kwargs):
        patcher = patch(target, **kwargs)
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def definition(self):
        _, state = booking.booking_state(OWNER, self.profile, self.source, self.overlay)
        return {"source": "aptem", "readOnly": True, "summaryOnly": True, "migratedForm": False,
                "instance": {"id": KEY, "learnerId": 21, "targetDate": self.day.isoformat(),
                             "status": "not-scheduled"}, "historicalReview": deepcopy(self.source), "booking": state}

    def create_record(self, **fields):
        self.record = CoachCalendarEvent(pk=1, **fields)
        return self.record

    def synchronize(self, *args):
        self.record.graph_event_id = self.record.graph_event_id or "graph-original"
        self.record.graph_organizer_email = "organizer@example.invalid"
        self.record.meeting_link = "https://example.invalid/original-meeting"
        self.record.sync_state = "synced"
        return self.record, "", True

    def existing(self):
        self.create_record(event_key=KEY, idempotency_key=KEY, owner_email=OWNER, learner_id=21,
                           event_type="progress-review", target_date=self.day, scheduled_date=self.day,
                           scheduled_time=time(10), duration_minutes=60, status="scheduled",
                           notes="Keep notes", review_responses={"answer": "Keep answer"})
        self.synchronize()
        self.payload["expectedBooking"] = {"scheduledDate": self.day.isoformat(), "scheduledTime": "10:00", "durationMinutes": 60}
        self.payload["scheduledTime"] = "12:00"

    def request(self, method="post"):
        request = getattr(self.factory, method)("/coach/reviews/" + KEY + "/book",
            data=json.dumps(self.payload), content_type="application/json")
        return unwrap(views.coach_review_instance_book)(request, KEY)

    def test_books_summary_for_both_learner_types_and_keeps_form_and_source_unchanged(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                self.record = None
                self.profile.learner_type = kind
                before = deepcopy(self.source)
                response = self.request()
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(self.source, before)
                result = json.loads(response.content)
                self.assertTrue(result["readOnly"])
                self.assertTrue(result["booking"]["booked"])
                self.assertEqual(result["booking"]["status"], "scheduled")
                self.assertEqual(self.record.event_key, KEY)
                self.assertEqual(self.record.idempotency_key, KEY)
                self.assertFalse(self.record.review_template_id)
                self.assertFalse(self.record.review_instance_id)
                self.assertEqual(self.conflicts.call_args.kwargs["business_time_zone"], "Europe/London")

    def test_reschedule_preserves_identity_organizer_answers_and_target_date(self):
        self.existing()
        identity = (self.record.pk, self.record.operation_id, self.record.event_key,
                    self.record.graph_event_id, self.record.graph_organizer_email, self.record.meeting_link)
        response = self.request("patch")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.record.scheduled_time, time(12))
        self.assertEqual((self.record.pk, self.record.operation_id, self.record.event_key,
                          self.record.graph_event_id, self.record.graph_organizer_email, self.record.meeting_link), identity)
        self.assertEqual(self.record.notes, "Keep notes")
        self.assertEqual(self.record.review_responses, {"answer": "Keep answer"})
        self.assertEqual(self.record.target_date, self.day)
        self.create.assert_not_called()

    def test_same_request_retries_do_not_duplicate_a_successful_booking(self):
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.request().status_code, 200)
        self.create.assert_called_once()
        self.sync.assert_called_once()

    def test_failed_create_retries_the_same_reservation(self):
        def failed(*args):
            self.record.sync_state = "failed"
            return self.record, "Unavailable", True
        self.sync.side_effect = failed
        self.assertEqual(self.request().status_code, 502)
        record_id = self.record.operation_id
        self.sync.side_effect = self.synchronize
        self.assertEqual(self.request().status_code, 200)
        self.assertEqual(self.record.operation_id, record_id)
        self.create.assert_called_once()

    def test_failed_update_stays_recoverable_without_creating_another_meeting(self):
        self.existing()
        def failed(*args):
            self.record.sync_state = "failed"
            return self.record, "Unavailable", True
        self.sync.side_effect = failed
        self.assertEqual(self.request("patch").status_code, 502)
        self.sync.side_effect = self.synchronize
        self.assertEqual(self.request("patch").status_code, 200)
        self.assertEqual(self.record.graph_event_id, "graph-original")
        self.create.assert_not_called()

    def test_stale_reschedule_cannot_overwrite_a_newer_slot(self):
        self.existing()
        self.record.scheduled_time = time(11)
        self.assertEqual(self.request("patch").status_code, 409)
        self.assertEqual(self.record.scheduled_time, time(11))
        self.persist.assert_not_called()
        self.sync.assert_not_called()

    def test_wrong_owner_learner_and_native_link_fail_closed(self):
        for field, value in (("owner_email", "other@example.invalid"), ("learner_id", 99),
                             ("review_instance_id", "native"), ("review_template_id", "template")):
            with self.subTest(field=field):
                self.existing()
                setattr(self.record, field, value)
                self.assertEqual(self.request("patch").status_code, 409)
        self.persist.assert_not_called()
        self.sync.assert_not_called()

    def test_started_completed_and_cancelled_source_or_overlay_cannot_be_booked(self):
        for status in ("in-progress", "awaiting-signature", "completed", "cancelled"):
            with self.subTest(status=status):
                self.source["status"] = status
                self.assertEqual(self.request().status_code, 409)
                self.source["status"] = "not-scheduled"
                self.overlay = SimpleNamespace(status=status, completed_at=None)
                self.assertEqual(self.request().status_code, 409)
                self.overlay = None
        self.create.assert_not_called()

    def test_sync_in_progress_refuses_a_second_update(self):
        self.existing()
        for state in ("syncing", "reconciliation", "cancelled"):
            self.record.sync_state = state
            self.assertEqual(self.request("patch").status_code, 409)
        self.sync.assert_not_called()

    def test_availability_and_invalid_slots_cannot_create_an_appointment(self):
        self.conflicts.return_value = True
        self.assertEqual(self.request().status_code, 409)
        self.conflicts.return_value = False
        for value in (0, 481):
            self.payload["durationMinutes"] = value
            self.assertEqual(self.request().status_code, 400)
        self.create.assert_not_called()
        self.sync.assert_not_called()

    def test_changed_source_is_checked_again_inside_reservation(self):
        def lock(*args):
            self.source["status"] = "completed"
        self._patch("coach_api.views.lock_learner_calendar", side_effect=lock)
        self.assertEqual(self.request().status_code, 409)
        self.create.assert_not_called()
        self.sync.assert_not_called()

    def test_real_access_gate_and_csrf_reject_untrusted_requests(self):
        from django.middleware.csrf import CsrfViewMiddleware
        actor = SimpleNamespace(role="staff", subject_type="staff", subject_id=9)
        def authenticate(request):
            request.login_account = actor
            return actor
        self._patch("login.permissions.authenticate_request", side_effect=authenticate)
        self._patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"}))
        self._patch("coach_api.auth._staff_access", return_value="super-admin")
        staff = SimpleNamespace(id=9, email="admin@example.invalid", access="super-admin")
        self._patch("coach_api.auth.StaffUser.objects.filter").return_value.only.return_value.first.return_value = staff
        for method in ("post", "patch"):
            request = getattr(self.factory, method)("/?viewAsCoach=" + OWNER,
                data=json.dumps(self.payload), content_type="application/json")
            self.assertEqual(views.coach_review_instance_book(request, KEY).status_code, 403)
            rejected = CsrfViewMiddleware(lambda _: None).process_view(request, views.coach_review_instance_book, (), {})
            self.assertEqual(rejected.status_code, 403)
        self.create.assert_not_called()
        self.sync.assert_not_called()
