"""Existing meeting adoption with real lifecycle/ownership gates and mocked I/O.

SimpleTestCase prohibits database access. PostgreSQL lock semantics are covered
separately by the integration suite; this pins down lock order and preservation.
"""
from contextlib import contextmanager, nullcontext
from copy import deepcopy
from datetime import date, datetime, time, timezone
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from . import views
from .review_sources import ReviewIdentityConflict, linked_booking
from .migrated_summary_binding import AnswerConflict, answer_version, check_answer_version
from .models import ImportedReviewInstance


OWNER = "coach@example.invalid"
KEY = "imported-review:synthetic-adoption"


class MigratedBookingAdoptionTests(SimpleTestCase):
    def stub(self, target, **kwargs):
        patched = patch(target, **kwargs)
        result = patched.start()
        self.addCleanup(patched.stop)
        return result

    def setUp(self):
        self.factory = RequestFactory()
        self.order = []
        self.overlay = SimpleNamespace(
            pk=1, event_key=KEY, owner_email=OWNER, learner_id=21, source_review_id=41,
            status="not-scheduled", completed_at=None, migrated_template_id=7,
            template_snapshot={"sections": [{"id": "saved-section"}],
                               "templateSource": {"id": 7, "family": "MCM", "scope": "GLOBAL"}},
            answers={"summary": "Coach's saved answer"}, progress_snapshot={"hours": 12},
            meeting_intelligence={"summaryStatus": "edited"}, signatures=["saved-signature"], save=Mock(),
            signature_requirements={"advisor": True}, updated_at=datetime(2020, 1, 1, tzinfo=timezone.utc),
        )
        self.calendar = SimpleNamespace(
            pk=10, event_key="legacy-meeting:41", owner_email=OWNER, learner_id=21,
            event_type="mcr", status="scheduled", sync_state="synced",
            graph_event_id="synthetic-graph-id", meeting_link="https://example.invalid/meeting",
            graph_web_link="", scheduled_date=date(2020, 1, 2), scheduled_time=time(10),
            duration_minutes=60, save=Mock(),
        )
        self.definition = {
            "source": "aptem", "sourceStatus": "Not Scheduled", "migratedForm": True,
            "readOnly": False, "migratedProgrammeKey": "P-1",
            "historicalReview": {"id": 41, "type": "Monthly Coaching Meeting"},
            "instance": {"id": KEY, "learnerId": 21},
            "booking": {"eventKey": self.calendar.event_key, "conflict": False},
        }
        self.reader = self.stub("coach_api.views._imported_review_definition", side_effect=self.read)
        self.query = self.stub("coach_api.views.ImportedReviewInstance.objects.filter")
        self.query.return_value.first.side_effect = lambda: self.overlay
        self.query.return_value.select_for_update.return_value.first.side_effect = lambda: self.order.append("overlay") or self.overlay
        self.stub("coach_api.views.transaction.atomic", side_effect=lambda: nullcontext())
        self.stub("coach_api.views.lock_learner_calendar", side_effect=lambda *_: self.order.append("learner"))
        self.booking = self.stub("coach_api.review_sources.booking_for_overlay", side_effect=self.resolve_booking)
        for name in ("microsoft_graph_request", "synchronize_reserved_calendar_event", "openai_meeting_summary",
                     "fetch_coach_meeting_graph_snapshot", "persist_coach_meeting_snapshots"):
            self.stub(f"coach_api.views.{name}", side_effect=AssertionError("Unexpected external or artifact operation"))
        self.stub("coach_api.views.CoachCalendarEvent.objects.create", side_effect=AssertionError("Created a meeting"))

    def read(self, owner, key):
        if owner != OWNER or key != KEY:
            return None
        return {**deepcopy(self.definition), "localStatus": self.overlay.status,
                "answerVersion": answer_version(self.overlay),
                "bookingAdoptionVersion": views._migrated_booking_adoption_version(self.overlay)}

    def resolve_booking(self, overlay, *, lock=False):
        if lock:
            self.order.append("calendar")
        return self.calendar

    def call(self, *, owner=OWNER, key=KEY, payload=None):
        request = self.factory.post("/", payload or {}, content_type="application/json")
        request.coach_email = owner
        return unwrap(views.coach_review_instance_adopt_booking)(request, key)

    def test_guarded_retry_returns_a_saveable_version_and_accepts_a_lost_success_response(self):
        original_version = answer_version(self.overlay)
        token = views._migrated_booking_adoption_version(self.overlay)
        field = ImportedReviewInstance._meta.get_field("updated_at")
        self.overlay.save.side_effect = lambda **kwargs: field.pre_save(self.overlay, add=False)
        result = self.call(payload={"bookingAdoptionVersion": token})
        self.assertEqual(result.status_code, 200)
        updated = json.loads(result.content)
        self.assertNotEqual(updated["answerVersion"], original_version)
        self.assertEqual(updated["bookingAdoptionVersion"], token)
        check_answer_version(self.overlay, updated)
        with self.assertRaises(AnswerConflict):
            check_answer_version(self.overlay, {"answerVersion": original_version})
        # The original retry token remains usable if the successful reply was lost.
        retry = self.call(payload={"bookingAdoptionVersion": token})
        self.assertEqual(json.loads(retry.content)["answerVersion"], updated["answerVersion"])
        self.overlay.save.assert_called_once()

    def test_guarded_retry_rejects_concurrent_saved_work_including_changes_under_lock(self):
        for field, changed in (("answers", {"summary": "Another editor's answer"}),
                               ("template_snapshot", {**self.overlay.template_snapshot, "name": "New questions"}),
                               ("progress_snapshot", {"hours": 25}),
                               ("meeting_intelligence", {"summaryStatus": "ready"}),
                               ("signature_requirements", {"advisor": False})):
            with self.subTest(field=field):
                before = deepcopy(getattr(self.overlay, field))
                token = views._migrated_booking_adoption_version(self.overlay)
                reads = 0

                def read_after_concurrent_edit(owner, key):
                    nonlocal reads
                    reads += 1
                    if reads == 2:
                        setattr(self.overlay, field, changed)
                    return self.read(owner, key)

                self.reader.side_effect = read_after_concurrent_edit
                result = self.call(payload={"bookingAdoptionVersion": token})
                self.assertEqual(result.status_code, 409)
                self.assertEqual(json.loads(result.content)["code"], "ANSWER_CONFLICT")
                self.assertEqual(self.overlay.status, "not-scheduled")
                self.assertEqual(getattr(self.overlay, field), changed)
                self.overlay.save.assert_not_called()
                setattr(self.overlay, field, before)

    def test_response_is_read_under_the_same_lock_as_the_content_check(self):
        in_transaction = False

        @contextmanager
        def atomic():
            nonlocal in_transaction
            in_transaction = True
            try:
                yield
            finally:
                in_transaction = False

        def checked_read(owner, key):
            if self.overlay.status == "scheduled":
                self.assertTrue(in_transaction)
            return self.read(owner, key)

        self.reader.side_effect = checked_read
        self.stub("coach_api.views.transaction.atomic", side_effect=atomic)
        self.assertEqual(self.call().status_code, 200)

    def test_malformed_guard_is_rejected_without_a_write(self):
        for value in (None, "", 123, {}):
            self.assertEqual(self.call(payload={"bookingAdoptionVersion": value}).status_code, 400)
        self.overlay.save.assert_not_called()

    def test_adopts_past_meetings_for_all_review_families_and_retries_without_other_writes(self):
        for family, title, event_type in (("MCM", "Monthly Coaching Meeting", "mcr"),
                                          ("PR", "Progress Review", "progress-review"),
                                          ("PR_SKILLS_RADAR", "Progress Review (+ Skills Radar)", "progress-review")):
            with self.subTest(family=family):
                self.overlay.status = "not-scheduled"
                self.overlay.template_snapshot["templateSource"]["family"] = family
                self.definition["historicalReview"]["type"] = title
                self.calendar.event_type = event_type
                self.overlay.save.reset_mock()
                self.order.clear()
                before = deepcopy({k: v for k, v in vars(self.overlay).items() if k not in {"status", "save"}})
                calendar_before = {k: v for k, v in vars(self.calendar).items() if k != "save"}
                response = self.call()
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(json.loads(response.content)["localStatus"], "scheduled")
                self.assertEqual(self.order[:3], ["learner", "calendar", "overlay"])
                self.assertEqual(self.call().status_code, 200)
                self.overlay.save.assert_called_once_with(update_fields=["status", "updated_at"])
                self.assertEqual(before, {k: v for k, v in vars(self.overlay).items() if k not in {"status", "save"}})
                self.assertEqual(calendar_before, {k: v for k, v in vars(self.calendar).items() if k != "save"})
                self.calendar.save.assert_not_called()

    def test_booking_in_progress_can_be_adopted_without_starting_or_regressing_review(self):
        self.calendar.status = "in-progress"
        self.assertEqual(self.call().status_code, 200)
        self.assertEqual(self.overlay.status, "scheduled")
        self.overlay.status = "in-progress"
        self.overlay.save.reset_mock()
        self.assertEqual(self.call().status_code, 200)
        self.assertEqual(self.overlay.status, "in-progress")
        self.overlay.save.assert_not_called()

    def test_legacy_commercial_and_apprenticeship_bookings_use_exact_learner_and_review_identity(self):
        self.calendar.review_instance_id = self.calendar.review_template_id = ""
        self.calendar.learner_id = 121  # Older learner bookings stored the enrolment ID.
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(learner_type=kind):
                event = {"eventKey": KEY, "source": "mcr", "learnerId": 21,
                         "enrolmentId": "121", "learnerType": kind, "reviewId": "41"}
                self.calendar.idempotency_key = f"learner-book:mcm:{kind}:121:2020-01:41"
                self.booking.side_effect = lambda overlay, **kw: linked_booking(event, [self.calendar], overlay, reconciliations=[])
                self.overlay.status = "not-scheduled"
                self.assertEqual(self.call().status_code, 200)
                self.assertEqual(self.overlay.status, "scheduled")
                self.overlay.status = "not-scheduled"
                self.overlay.save.reset_mock()
                self.calendar.idempotency_key = f"learner-book:mcm:{kind}:999:2020-01:41"
                self.assertEqual(self.call().status_code, 409)
                self.calendar.idempotency_key = f"learner-book:mcm:{kind}:121:2020-01:999"
                self.assertEqual(self.call().status_code, 409)
                self.overlay.save.assert_not_called()

    def test_missing_unconfirmed_or_wrong_booking_is_never_adopted(self):
        for field, value in (("owner_email", "other@example.invalid"), ("event_type", "progress-review"),
                             ("status", "completed"), ("status", "cancelled"), ("sync_state", "failed"),
                             ("graph_event_id", ""), ("meeting_link", ""), ("scheduled_date", None),
                             ("scheduled_time", None), ("event_key", "other-meeting")):
            with self.subTest(field=field, value=value):
                original = getattr(self.calendar, field)
                setattr(self.calendar, field, value)
                self.assertEqual(self.call().status_code, 409)
                setattr(self.calendar, field, original)
        self.booking.side_effect = lambda *a, **kw: None
        self.assertEqual(self.call().status_code, 409)
        self.overlay.save.assert_not_called()

    def test_conflicting_source_or_template_and_historical_reviews_are_preserved(self):
        for update in ({"booking": {"conflict": True}}, {"templateSync": {"status": "conflict"}},
                       {"sourceStatus": "Completed"}, {"readOnly": True}, {"previewOnly": True},
                       {"migratedForm": False}, {"historicalReview": {"type": "Personal Support Plan"}}):
            with self.subTest(update=update):
                before = deepcopy(self.definition)
                self.definition.update(update)
                self.assertEqual(self.call().status_code, 409)
                self.definition = before
        self.booking.side_effect = ReviewIdentityConflict("More than one booking matches the imported Review.")
        self.assertEqual(self.call().status_code, 409)
        self.overlay.save.assert_not_called()

    def test_revalidates_conflicts_under_lock_and_preserves_concurrent_completion(self):
        original = deepcopy(self.definition)
        self.reader.side_effect = [original, {**original, "booking": {"conflict": True}}]
        self.assertEqual(self.call().status_code, 409)
        self.reader.side_effect = self.read
        for status in ("awaiting-signature", "completed", "cancelled"):
            self.overlay.status = status
            self.assertEqual(self.call().status_code, 409)
        self.overlay.status = "not-scheduled"
        self.overlay.template_snapshot["templateSource"]["id"] = 99
        self.assertEqual(self.call().status_code, 409)
        self.overlay.save.assert_not_called()

    def test_wrong_owner_native_identity_and_wrong_source_row_cannot_write(self):
        self.assertEqual(self.call(owner="other@example.invalid").status_code, 404)
        self.assertEqual(self.call(key="native-review").status_code, 409)
        self.overlay.source_review_id = 999
        self.assertEqual(self.call().status_code, 409)
        self.overlay.save.assert_not_called()

    def test_route_and_real_coach_scope_guard_reject_view_as_other_roles_and_spoofed_identity(self):
        route = resolve(f"/coach_api/coach/reviews/{KEY}/adopt-booking")
        self.assertIs(route.func, views.coach_review_instance_adopt_booking)
        # Supply the already-authenticated account; retain the actual coach
        # scope decorator and method guard, mocking only staff storage/cache I/O.
        scoped = route.func.__wrapped__
        staff = SimpleNamespace(id=1, email=OWNER, username="Synthetic coach")
        with patch("coach_api.auth.StaffUser.objects.filter") as staff_query, \
                patch("coach_api.auth._staff_access", return_value="coach") as access, \
                patch("coach_api.auth._invalidate_dashboard_after_mutation", side_effect=lambda v, r, response, owner: response):
            staff_query.return_value.only.return_value.first.return_value = staff
            for role, query in (("super-admin", f"?viewAsCoach={OWNER}"), ("employer", ""),
                                ("coach", "?owner_email=other@example.invalid")):
                access.return_value = role
                request = self.factory.post("/" + query, {}, content_type="application/json")
                request.login_account = SimpleNamespace(subject_type="staff", subject_id=1)
                self.assertEqual(scoped(request, KEY).status_code, 403)
            self.overlay.save.assert_not_called()
            access.return_value = "coach"
            request = self.factory.get("/")
            request.login_account = SimpleNamespace(subject_type="staff", subject_id=1)
            self.assertEqual(scoped(request, KEY).status_code, 405)
            request = self.factory.post("/", {}, content_type="application/json")
            request.login_account = SimpleNamespace(subject_type="staff", subject_id=1)
            self.assertEqual(scoped(request, KEY).status_code, 200)
