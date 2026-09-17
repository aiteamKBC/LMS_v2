"""reconcile_legacy_review_events links a NAMED, ALLOWLISTED set of real,
already-booked legacy MCM/Progress Review CoachCalendarEvent rows to their
canonical Curriculum review_instance -- without touching the booking itself,
without deleting anything, and without ever reimplementing recurrence math
(see the command's own docstring and learner_api.calendar._generated_cycle_events,
which it reuses for matching).
"""
import io
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from coach_api.management.commands import reconcile_legacy_review_events as cmd_module
from coach_api.models import CoachCalendarEvent
from curriculum_api import review_instances, review_types

from learner_api.tests_review_scheduling_sync import (
    COACH_EMAIL,
    LEARNER_EMAIL,
    MIRROR_ID,
    ReviewSchedulingSyncTestCase,
    bookable_day,
)

OTHER_EVENT_ID = 999999  # not on the allowlist


def _run(*args):
    out = io.StringIO()
    call_command("reconcile_legacy_review_events", *args, stdout=out, stderr=out)
    return out.getvalue()


class ReconcileLegacyReviewEventsTestCase(ReviewSchedulingSyncTestCase):
    """Adds a real, unlinked legacy CoachCalendarEvent row on top of the
    shared Curriculum/scheduling harness, and patches only the
    LearnerProfile/EnrolmentUser resolution seam (Postgres-only under
    production, not needed for these tests) so _generated_cycle_events runs
    for real against the harness's own mirror/source objects."""

    def setUp(self):
        super().setUp()
        self._resolve_patch = patch.object(
            cmd_module, "resolve_learner_and_source",
            return_value=(self.mirror, self.learner),
        )
        self._resolve_patch.start()
        self.addCleanup(self._resolve_patch.stop)

    def make_legacy_row(self, *, event_id, target_date, event_type="mcr", **overrides):
        values = dict(
            id=event_id,
            event_key=f"{event_type}:{MIRROR_ID}:1:{target_date.isoformat()}",
            owner_email=COACH_EMAIL, owner_name="Coach One",
            learner_id=MIRROR_ID, learner_name="Test Learner", learner_email=LEARNER_EMAIL,
            event_type=event_type, sequence=1, target_date=target_date,
            scheduled_date=target_date, scheduled_time=time(14, 0), duration_minutes=60,
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_provider="Microsoft Teams",
            meeting_link="https://teams.microsoft.com/l/meetup-join/existing",
            graph_event_id="EXISTING-GRAPH-EVENT-ID",
            graph_web_link="https://outlook.office365.com/owa/existing",
            idempotency_key=f"learner-book:legacy-direct-request:{event_id}",
        )
        values.update(overrides)
        return CoachCalendarEvent.objects.create(**values)


class BlankStringHandlingTests(ReconcileLegacyReviewEventsTestCase):
    def test_1_blank_string_review_template_id_is_treated_as_missing(self):
        self.assertTrue(cmd_module._blank(""))
        self.assertTrue(cmd_module._blank("   "))
        self.assertTrue(cmd_module._blank(None))
        self.assertFalse(cmd_module._blank("REVT-1"))

    def test_2_blank_string_review_instance_id_is_treated_as_missing(self):
        template = self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target, review_template_id="  ", review_instance_id="")

        output = _run("--event-id", "146", "--dry-run")

        self.assertIn("SAFE_TO_LINK", output)
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "  ")  # dry-run: untouched


class SafeLinkTests(ReconcileLegacyReviewEventsTestCase):
    def test_3_exact_mcm_occurrence_match_links_correctly(self):
        template = self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        output = _run("--event-id", "146", "--apply")

        self.assertIn("LINKED", output)
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, template["id"])
        self.assertTrue(row.review_instance_id)
        self.assertEqual(row.occurrence_number, occurrence["occurrenceNumber"])

    def test_4_5_event_id_and_event_key_preserved(self):
        template = self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        original_key = f"mcr:{MIRROR_ID}:1:{target.isoformat()}"
        row = self.make_legacy_row(event_id=146, target_date=target)
        self.assertEqual(row.event_key, original_key)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.id, 146)
        self.assertEqual(row.event_key, original_key)

    def test_6_target_date_preserved(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.target_date, target)

    def test_7_scheduled_date_preserved(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        scheduled = bookable_day(40)
        row = self.make_legacy_row(event_id=146, target_date=target, scheduled_date=scheduled)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.scheduled_date, scheduled)

    def test_8_scheduled_time_preserved(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target, scheduled_time=time(9, 30))

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.scheduled_time, time(9, 30))

    def test_9_meeting_link_preserved(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(
            event_id=146, target_date=target,
            meeting_link="https://teams.microsoft.com/l/meetup-join/keep-me",
        )

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.meeting_link, "https://teams.microsoft.com/l/meetup-join/keep-me")

    def test_10_graph_event_id_preserved(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target, graph_event_id="KEEP-ME")

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.graph_event_id, "KEEP-ME")

    def test_11_owner_and_learner_fields_preserved(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.owner_email, COACH_EMAIL)
        self.assertEqual(row.owner_name, "Coach One")
        self.assertEqual(row.learner_id, MIRROR_ID)
        self.assertEqual(row.learner_name, "Test Learner")
        self.assertEqual(row.learner_email, LEARNER_EMAIL)

    def test_12_correct_review_template_id_set(self):
        template = self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.review_template_id, template["id"])

    def test_13_exactly_one_review_instance_created_or_found(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        found = review_instances.find_review_instance(
            row.review_template_id, MIRROR_ID, occurrence["occurrenceNumber"],
        )
        self.assertIsNotNone(found)
        self.assertEqual(found["id"], row.review_instance_id)

    def test_14_calendar_event_id_backlink_set(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        instance = review_instances.get_review_instance(row.review_instance_id)
        self.assertEqual(str(instance["calendar_event_id"]), str(row.id))

    def test_15_status_remains_scheduled(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.status, CoachCalendarEvent.STATUS_SCHEDULED)
        instance = review_instances.get_review_instance(row.review_instance_id)
        self.assertEqual(instance["status"], review_instances.STATUS_SCHEDULED)
        self.assertIsNone(instance.get("started_at"))
        self.assertIsNone(instance.get("completed_at"))

    def test_progress_review_also_links_correctly(self):
        template = self.template(
            name="Quarterly Progress Conversation",
            type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW, interval=8,
        )
        occurrence = self.coach_occurrence("progress-review")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=149, target_date=target, event_type="progress-review")

        _run("--event-id", "149", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.review_template_id, template["id"])
        self.assertTrue(row.review_instance_id)

    def test_approved_legacy_target_links_to_reviewed_canonical_occurrence(self):
        template = self.template(
            name="Monthly Learner Catch-up",
            type_code=review_types.REVIEW_TYPE_CODE_MCM,
        )
        legacy_target = date(2026, 10, 5)
        canonical_target = date(2026, 10, 15)
        scheduled = date(2026, 10, 22)
        row = self.make_legacy_row(
            event_id=146,
            target_date=legacy_target,
            scheduled_date=scheduled,
            scheduled_time=time(14, 0),
        )
        generated = [{
            "source": "mcr",
            "targetDate": canonical_target.isoformat(),
            "reviewTemplateId": template["id"],
            "occurrenceNumber": 1,
            "title": "Monthly Learner Catch-up",
            "reviewTypeCode": review_types.REVIEW_TYPE_CODE_MCM,
        }]

        with patch.object(cmd_module, "generated_occurrences", return_value=generated):
            output = _run("--event-id", "146", "--apply")

        self.assertIn("approved legacy mapping", output)
        self.assertIn("LINKED", output)
        row.refresh_from_db()
        self.assertEqual(row.event_key, f"mcr:{MIRROR_ID}:1:{legacy_target.isoformat()}")
        self.assertEqual(row.target_date, legacy_target)
        self.assertEqual(row.scheduled_date, scheduled)
        self.assertEqual(row.scheduled_time, time(14, 0))
        self.assertEqual(row.meeting_link, "https://teams.microsoft.com/l/meetup-join/existing")
        instance = review_instances.get_review_instance(row.review_instance_id)
        self.assertEqual(str(instance["target_date"]), canonical_target.isoformat())
        self.assertEqual(instance["status"], review_instances.STATUS_SCHEDULED)

    def test_approved_mapping_refuses_an_unreviewed_legacy_target(self):
        template = self.template(
            name="Monthly Learner Catch-up",
            type_code=review_types.REVIEW_TYPE_CODE_MCM,
        )
        row = self.make_legacy_row(event_id=146, target_date=date(2026, 10, 6))
        generated = [{
            "source": "mcr",
            "targetDate": "2026-10-15",
            "reviewTemplateId": template["id"],
            "occurrenceNumber": 1,
            "title": "Monthly Learner Catch-up",
            "reviewTypeCode": review_types.REVIEW_TYPE_CODE_MCM,
        }]

        with patch.object(cmd_module, "generated_occurrences", return_value=generated):
            output = _run("--event-id", "146", "--apply")

        self.assertIn("NO_MATCH", output)
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "")
        self.assertEqual(row.review_instance_id, "")


class IdempotencyTests(ReconcileLegacyReviewEventsTestCase):
    def test_16_second_run_is_a_no_op(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146", "--apply")
        row.refresh_from_db()
        first_template, first_instance = row.review_template_id, row.review_instance_id
        first_target, first_scheduled, first_graph = row.target_date, row.scheduled_date, row.graph_event_id

        second_output = _run("--event-id", "146", "--apply")

        self.assertIn("ALREADY_LINKED", second_output)
        self.assertNotIn("LINKED:", second_output.replace("ALREADY_LINKED", ""))
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, first_template)
        self.assertEqual(row.review_instance_id, first_instance)
        self.assertEqual(row.target_date, first_target)
        self.assertEqual(row.scheduled_date, first_scheduled)
        self.assertEqual(row.graph_event_id, first_graph)
        self.assertEqual(
            review_instances.get_review_instance(first_instance)["status"],
            review_instances.STATUS_SCHEDULED,
        )


class NoMatchAmbiguousConflictTests(ReconcileLegacyReviewEventsTestCase):
    def test_17_zero_match_writes_nothing(self):
        row = self.make_legacy_row(event_id=146, target_date=date(2026, 10, 5))
        # No MCM template configured at all -- _generated_cycle_events returns [].

        output = _run("--event-id", "146", "--apply")

        self.assertIn("NO_MATCH", output)
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "")
        self.assertEqual(row.review_instance_id, "")

    def test_18_ambiguous_match_writes_nothing(self):
        row = self.make_legacy_row(event_id=146, target_date=date(2026, 10, 5))
        with patch.object(cmd_module, "generated_occurrences", return_value=[
            {"source": "mcr", "targetDate": "2026-10-05", "reviewTemplateId": "REVT-A",
             "occurrenceNumber": 1, "title": "MCM A", "reviewTypeCode": "mcm"},
            {"source": "mcr", "targetDate": "2026-10-05", "reviewTemplateId": "REVT-B",
             "occurrenceNumber": 1, "title": "MCM B", "reviewTypeCode": "mcm"},
        ]):
            output = _run("--event-id", "146", "--apply")

        self.assertIn("AMBIGUOUS", output)
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "")
        self.assertEqual(row.review_instance_id, "")

    def test_19_conflicting_existing_instance_writes_nothing(self):
        template = self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])

        # A DIFFERENT calendar event already owns this exact occurrence.
        other = self.make_legacy_row(event_id=9999, target_date=target, review_template_id=template["id"],
                                      occurrence_number=occurrence["occurrenceNumber"],
                                      event_key=occurrence["eventKey"])
        instance = review_instances.ensure_review_instance(
            template, learner_id=MIRROR_ID, learner_kind="", programme_id=template["programme_id"],
            occurrence_number=occurrence["occurrenceNumber"], target_date=target,
        )
        review_instances.link_calendar_event(instance["id"], other.id)

        row = self.make_legacy_row(event_id=146, target_date=target)

        output = _run("--event-id", "146", "--apply")

        self.assertIn("CONFLICT", output)
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "")
        self.assertEqual(row.review_instance_id, "")
        # The instance stays pointed at the row that legitimately owns it.
        refreshed_instance = review_instances.get_review_instance(instance["id"])
        self.assertEqual(str(refreshed_instance["calendar_event_id"]), str(other.id))


class TransactionSafetyTests(ReconcileLegacyReviewEventsTestCase):
    def test_20_transaction_rollback_prevents_partial_linkage(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        with patch.object(
            cmd_module, "ensure_review_instance_for_calendar_record",
            side_effect=cmd_module.ReviewTemplateUnavailableError("boom"),
        ):
            with self.assertRaises(CommandError):
                _run("--event-id", "146", "--apply")

        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "")
        self.assertEqual(row.review_instance_id, "")
        self.assertIsNone(row.occurrence_number)


class AllowlistTests(ReconcileLegacyReviewEventsTestCase):
    def test_21_non_allowlisted_event_id_is_rejected(self):
        self.make_legacy_row(event_id=OTHER_EVENT_ID, target_date=date(2026, 10, 5))
        with self.assertRaises(CommandError):
            _run("--event-id", str(OTHER_EVENT_ID), "--dry-run")
        row = CoachCalendarEvent.objects.get(id=OTHER_EVENT_ID)
        self.assertEqual(row.review_template_id, "")

    def test_allowlisted_id_mixed_with_non_allowlisted_rejects_the_whole_batch(self):
        self.make_legacy_row(event_id=146, target_date=date(2026, 10, 5))
        self.make_legacy_row(event_id=OTHER_EVENT_ID, target_date=date(2026, 10, 6))
        with self.assertRaises(CommandError):
            _run("--event-id", "146", "--event-id", str(OTHER_EVENT_ID), "--dry-run")


class NoGraphCallTests(ReconcileLegacyReviewEventsTestCase):
    def test_22_no_graph_api_request_is_made(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        self.make_legacy_row(event_id=146, target_date=target)

        with patch("coach_api.views.microsoft_graph_request") as graph_request:
            _run("--event-id", "146", "--apply")
            graph_request.assert_not_called()


class DryRunNeverWritesTests(ReconcileLegacyReviewEventsTestCase):
    def test_dry_run_reports_safe_to_link_but_writes_nothing(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        output = _run("--event-id", "146", "--dry-run")

        self.assertIn("SAFE_TO_LINK", output)
        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "")
        self.assertEqual(row.review_instance_id, "")

    def test_default_mode_without_flags_is_dry_run(self):
        self.template(name="Monthly Learner Catch-up", type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence("mcr")
        target = date.fromisoformat(occurrence["targetDate"])
        row = self.make_legacy_row(event_id=146, target_date=target)

        _run("--event-id", "146")

        row.refresh_from_db()
        self.assertEqual(row.review_template_id, "")
