"""Native booking identity after an email change, without database or Teams writes."""
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from . import calendar


def learner(*, email="new@example.invalid", aptem_id=None):
    return SimpleNamespace(pk=17, email=email, aptem_id=aptem_id)


def profile(*, enrolment_id=17, email="new@example.invalid", aptem_id=None):
    return SimpleNamespace(id=42, enrolment_id=enrolment_id, email=email, aptem_id=aptem_id)


def booking(*, event_type="mcr", email="old@example.invalid", status="scheduled"):
    return SimpleNamespace(
        pk=91, event_key="review:42:template:1", learner_profile_id=42,
        learner_email=email, owner_email="coach@example.invalid",
        review_instance_id="instance-91", review_template_id="template",
        occurrence_number=1, event_type=event_type, status=status,
        idempotency_key="",
    )


def instance(**changes):
    row = {
        "id": "instance-91", "calendar_event_id": 91, "learner_id": 42,
        "review_template_id": "template", "coach_email": "coach@example.invalid",
        "occurrence_number": 1,
    }
    row.update(changes)
    return row


class NativeReviewEmailIdentityTests(SimpleTestCase):
    def calendar_rows(self, rows, source=None, mirror=None, instances=None):
        source = source or learner()
        mirror = mirror or profile()
        query = Mock()
        query.order_by.return_value = rows
        with patch.object(calendar.CoachCalendarEvent.objects, "filter", return_value=query), \
             patch("curriculum_api.review_instances.list_review_instances_for_learner",
                   return_value=instances if instances is not None else [instance()]) as read, \
             patch.object(calendar, "_curriculum_cycle_events",
                          side_effect=lambda _source, _mirror, records, **_kw: list(records)):
            result = calendar.coaching_events_for_learner(source, mirror)
        return result, read

    def test_linked_mcm_and_pr_remain_visible_after_email_change(self):
        for event_type in ("mcr", "progress-review"):
            for status in ("scheduled", "completed"):
                with self.subTest(event_type=event_type, status=status):
                    row = booking(event_type=event_type, status=status)
                    result, read = self.calendar_rows([row])
                    self.assertEqual(result, [row])
                    read.assert_called_once_with(42)

    def test_missing_email_with_stable_link_is_still_owned(self):
        row = booking(email="")
        result, _ = self.calendar_rows([row])
        self.assertEqual(result, [row])

    def test_saved_booking_replaces_generated_not_scheduled_slot(self):
        row = booking()
        generated = {
            "id": row.event_key, "eventKey": row.event_key, "source": "mcr",
            "learnerId": "42", "sequence": 1, "targetDate": "2026-11-19",
            "reviewTemplateId": "template", "occurrenceNumber": 1,
            "status": "not-scheduled", "title": "Monthly Coaching",
        }
        query = Mock()
        query.order_by.return_value = [row]
        with patch.object(calendar.CoachCalendarEvent.objects, "filter", return_value=query), \
             patch("curriculum_api.review_instances.list_review_instances_for_learner", return_value=[instance()]), \
             patch.object(calendar, "_generated_cycle_events", return_value=[generated]), \
             patch.object(calendar, "_serialize_event",
                          return_value={"eventKey": row.event_key, "status": row.status}):
            events = calendar.coaching_events_for_learner(learner(), profile())
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["status"], "scheduled")

    def test_conflicting_links_never_override_current_email_or_colliding_ids(self):
        cases = (
            (booking(email="new@example.invalid"), profile(enrolment_id=18), instance()),
            (booking(), profile(), instance(calendar_event_id=92)),
            (booking(), profile(), instance(learner_id=17)),
            (booking(), profile(), instance(review_template_id="other")),
            (booking(), profile(), instance(coach_email="other@example.invalid")),
        )
        for row, mirror, linked in cases:
            with self.subTest(linked=linked, enrolment_id=mirror.enrolment_id):
                result, _ = self.calendar_rows([row], mirror=mirror, instances=[linked])
                self.assertEqual(result, [])
        row = booking()
        row.learner_profile_id = 17  # Enrolment ID 17 is not profile ID 42.
        result, _ = self.calendar_rows([row], instances=[instance(learner_id=17)])
        self.assertEqual(result, [])

    def test_stale_email_requires_verified_enrolment_link(self):
        result, _ = self.calendar_rows([booking()], mirror=profile(enrolment_id=None))
        self.assertEqual(result, [])

    def test_unlinked_historical_row_is_not_auto_attached_to_a_duplicate_occurrence(self):
        linked = booking(event_type="progress-review")
        old = booking(event_type="progress-review")
        old.event_key = "progress-review:42:1:old"
        old.review_instance_id = ""
        old.review_template_id = ""
        result, _ = self.calendar_rows([linked, old])
        self.assertEqual(result, [linked])

    def test_imported_aptem_uses_its_existing_reader(self):
        source = learner(aptem_id=808)
        mirror = profile(aptem_id=808)
        row = booking()
        query = Mock()
        query.order_by.return_value = [row]
        with patch.object(calendar.CoachCalendarEvent.objects, "filter", return_value=query), \
             patch.object(calendar, "review_profile_for_source", return_value=mirror), \
             patch("curriculum_api.review_instances.list_review_instances_for_learner") as native, \
             patch("learner_api.imported_review_calendar.imported_events_for_learner",
                   return_value=[{"reviewSource": "aptem", "eventKey": "imported-review:808"}]) as imported:
            result = calendar.coaching_events_for_learner(source, mirror)
        self.assertEqual(result, [{"reviewSource": "aptem", "eventKey": "imported-review:808"}])
        self.assertEqual(imported.call_args.args[3], [row])
        native.assert_not_called()

    def test_direct_form_and_artifact_record_require_reverse_instance_link(self):
        source, mirror = learner(), profile()
        row = booking()
        model = Mock()
        model.all_learners.filter.return_value.first.return_value = source
        with patch.object(calendar, "SOURCE_MODELS", {"commercial": model}), \
             patch.object(calendar, "_calendar_profile", return_value=mirror), \
             patch.object(calendar.CoachCalendarEvent.objects, "filter") as events, \
             patch("coach_api.reconciliation_links.for_calendar", return_value=None), \
             patch("curriculum_api.review_instances.get_review_instance") as read:
            events.return_value.first.return_value = row
            read.return_value = instance()
            self.assertIs(calendar._learner_calendar_record("commercial", 17, row.event_key), row)
            for conflict in (instance(calendar_event_id=92), instance(learner_id=17), None):
                read.return_value = conflict
                self.assertIsNone(calendar._learner_calendar_record("commercial", 17, row.event_key))
