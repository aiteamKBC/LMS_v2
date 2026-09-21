"""Phase 1: a review_instance-linked row has one writable engine.

    python manage.py test coach_api.tests_review_instance_linked_gating

``coach_timetable_event_action``'s "complete"/"sign" branches used to write
``review_responses``/``manager_signed_at``/``manager_signed_by``/``status``
directly, unconditionally -- even for a row already linked to a
Curriculum-driven ``review_instances`` row. That let the two engines disagree
about the same review. These tests pin the fix: a linked row's completion and
signature now delegate to ``curriculum_api.review_instances`` (the same
domain functions the canonical ``/coach/reviews/<id>/...`` endpoints call),
and never touch the legacy fields; an unlinked (historical) row keeps
behaving exactly as before.
"""
import json
from datetime import date, time
from inspect import unwrap
from unittest.mock import patch

from django.test import RequestFactory, TestCase

from curriculum_api import review_instances as curriculum_review_instances

from . import views
from .models import CoachCalendarEvent

MCM_EVENT = {
    "eventKey": "mcr:301:1:2026-10-01",
    "source": "mcr",
    "targetDate": "2026-10-01",
    "title": "Monthly Coaching",
    "learnerId": 301,
}

PR_EVENT = {
    "eventKey": "progress-review:301:1:2026-10-01",
    "source": "progress-review",
    "targetDate": "2026-10-01",
    "title": "Progress Review",
    "learnerId": 301,
}


class LinkedReviewGatingTestCase(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _record(self, *, event_key, event_type, review_instance_id, status):
        return CoachCalendarEvent.objects.create(
            event_key=event_key, event_type=event_type,
            owner_email="coach@example.com", owner_name="Coach One",
            learner_id=301, learner_name="Learner", learner_email="learner@example.com",
            scheduled_date=date(2026, 10, 1), scheduled_time=time(10, 0),
            target_date=date(2026, 10, 1), duration_minutes=30, status=status,
            meeting_link="https://teams.microsoft.com/meet/abc",
            review_instance_id=review_instance_id or "",
        )

    def _call(self, base_event, action, extra_payload=None):
        body = {"eventKey": base_event["eventKey"], "action": action, **(extra_payload or {})}
        request = self.factory.post(
            "/coach_api/coach/timetable/events/action",
            data=json.dumps(body), content_type="application/json",
        )
        request.coach_email = "coach@example.com"
        with patch.object(views, "find_catchup_calendar_record", return_value=(None, "")), \
             patch.object(views, "find_generated_timetable_event", return_value=(dict(base_event), "Coach One")):
            return unwrap(views.coach_timetable_event_action)(request)

    # -- 1. Linked review + legacy complete action ---------------------------

    def test_linked_mcm_complete_delegates_to_review_instance_engine(self):
        record = self._record(
            event_key=MCM_EVENT["eventKey"], event_type="mcr",
            review_instance_id="REVI-LINKED-1", status=CoachCalendarEvent.STATUS_IN_PROGRESS,
        )
        instance_row = {
            "id": "REVI-LINKED-1", "status": curriculum_review_instances.STATUS_COMPLETED,
            "calendar_event_id": record.pk, "completed_at": None,
        }

        with patch.object(curriculum_review_instances, "get_review_instance", return_value=instance_row), \
             patch.object(curriculum_review_instances, "complete_review_instance", return_value=(True, None)) as complete_instance:
            response = self._call(MCM_EVENT, "complete", {"reviewResponses": {"should": "be-ignored"}})

        self.assertEqual(response.status_code, 200, response.content)
        complete_instance.assert_called_once()
        self.assertEqual(complete_instance.call_args.args[0], instance_row)

        record.refresh_from_db()
        # The legacy hard-coded payload sent by the (still-open) request body
        # was never written -- the canonical engine, not this endpoint, is now
        # the source of the instance's completion state.
        self.assertEqual(record.review_responses, {})
        # Status reflects the canonical engine's own mirror, not a second,
        # independent write of the same conclusion by this endpoint.
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)

    def test_linked_mcm_complete_surfaces_the_canonical_engines_validation(self):
        """An incomplete instance is rejected exactly like the canonical
        endpoint would reject it -- no separate legacy validation kicks in."""
        record = self._record(
            event_key=MCM_EVENT["eventKey"], event_type="mcr",
            review_instance_id="REVI-LINKED-2", status=CoachCalendarEvent.STATUS_IN_PROGRESS,
        )
        instance_row = {"id": "REVI-LINKED-2", "status": curriculum_review_instances.STATUS_IN_PROGRESS, "calendar_event_id": record.pk}

        with patch.object(curriculum_review_instances, "get_review_instance", return_value=instance_row), \
             patch.object(curriculum_review_instances, "complete_review_instance", return_value=(False, {"fields": ["REVF-1"]})) as complete_instance:
            response = self._call(MCM_EVENT, "complete")

        self.assertEqual(response.status_code, 400)
        body = json.loads(response.content)
        self.assertEqual(body["errors"], {"fields": ["REVF-1"]})
        complete_instance.assert_called_once()

        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_IN_PROGRESS)
        self.assertEqual(record.review_responses, {})

    # -- 2. Linked review + legacy sign action -------------------------------

    def test_linked_pr_sign_delegates_to_review_instance_engine_and_leaves_legacy_signature_untouched(self):
        record = self._record(
            event_key=PR_EVENT["eventKey"], event_type="progress-review",
            review_instance_id="REVI-LINKED-3", status=CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
        )
        instance_row = {
            "id": "REVI-LINKED-3", "status": curriculum_review_instances.STATUS_COMPLETED,
            "calendar_event_id": record.pk, "completed_at": None,
        }

        with patch.object(curriculum_review_instances, "get_review_instance", return_value=instance_row), \
             patch.object(curriculum_review_instances, "record_review_instance_signature") as record_signature:
            response = self._call(PR_EVENT, "sign", {"managerName": "Sam Manager"})

        self.assertEqual(response.status_code, 200, response.content)
        record_signature.assert_called_once()
        self.assertEqual(record_signature.call_args.args[1], "advisor")

        record.refresh_from_db()
        # The old, independent signature fields never become a second source
        # of truth for a linked row.
        self.assertIsNone(record.manager_signed_at)
        self.assertEqual(record.manager_signed_by, "")
        # Status still moves to Completed -- via the sync from the instance
        # the signature actually landed on, not a parallel write here.
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)

    def test_advanced_unlinked_review_open_requires_reconciliation_and_keeps_legacy_content(self):
        record = self._record(
            event_key=MCM_EVENT["eventKey"], event_type="mcr",
            review_instance_id=None, status=CoachCalendarEvent.STATUS_COMPLETED,
        )
        record.review_template_id = "REV-LEGACY"
        record.review_responses = {"mcm_outcome": "Green", "historical": "kept"}
        record.save(update_fields=["review_template_id", "review_responses", "updated_at"])
        base_event = {
            **MCM_EVENT,
            "reviewTemplateId": "REV-LEGACY",
            "occurrenceNumber": 1,
            "occurrenceSource": "generated",
        }
        request = self.factory.post(
            "/coach_api/coach/reviews/open",
            data=json.dumps({"eventKey": MCM_EVENT["eventKey"]}),
            content_type="application/json",
        )
        request.coach_email = "coach@example.com"
        with patch.object(views, "find_generated_timetable_event", return_value=(base_event, "Coach One")),              patch.object(views.curriculum_reviews, "get_review_template_row", return_value={"id": "REV-LEGACY"}),              patch.object(curriculum_review_instances, "ensure_review_instance") as ensure:
            response = unwrap(views.coach_review_instance_for_event)(request)

        self.assertEqual(response.status_code, 409)
        body = json.loads(response.content)
        self.assertEqual(body["code"], "LEGACY_REVIEW_RECONCILIATION_REQUIRED")
        ensure.assert_not_called()
        record.refresh_from_db()
        self.assertEqual(record.review_instance_id, "")
        self.assertEqual(record.review_responses["historical"], "kept")

    # -- 3. Linked review normal new-engine completion continues to work -----
    # (already covered by curriculum_api.tests_review_instances /
    # coach_api.tests_review_architecture; not duplicated here.)

    # -- 4. Historical unlinked review: legacy flow is unchanged -------------

    def test_unlinked_historical_mcm_complete_still_uses_the_legacy_payload(self):
        record = self._record(
            event_key=MCM_EVENT["eventKey"], event_type="mcr",
            review_instance_id=None, status=CoachCalendarEvent.STATUS_IN_PROGRESS,
        )
        responses = {key: "Yes" for key in views.MONTHLY_COACHING_YES_NO_RESPONSE_IDS}
        for key in views.MONTHLY_COACHING_RESPONSE_IDS:
            responses.setdefault(key, "Some notes")
        for key in views.MONTHLY_COACHING_AGREEMENT_RESPONSE_IDS:
            responses[key] = "Agree"
        responses["mcm_outcome"] = "Green"
        responses["mcm_previous_meeting"] = "No previous meeting"
        responses["mcm_next_meeting_date"] = "2026-11-01"

        with patch.object(curriculum_review_instances, "get_review_instance") as get_instance:
            response = self._call(MCM_EVENT, "complete", {"reviewResponses": responses})

        self.assertEqual(response.status_code, 200, response.content)
        get_instance.assert_not_called()

        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        self.assertTrue(record.review_responses)
        self.assertIsNotNone(record.review_completed_at)

    def test_unlinked_historical_pr_sign_still_uses_the_legacy_fields(self):
        record = self._record(
            event_key=PR_EVENT["eventKey"], event_type="progress-review",
            review_instance_id=None, status=CoachCalendarEvent.STATUS_AWAITING_SIGNATURE,
        )

        with patch.object(curriculum_review_instances, "get_review_instance") as get_instance:
            response = self._call(PR_EVENT, "sign", {"managerName": "Sam Manager"})

        self.assertEqual(response.status_code, 200, response.content)
        get_instance.assert_not_called()

        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        self.assertEqual(record.manager_signed_by, "Sam Manager")
        self.assertIsNotNone(record.manager_signed_at)
