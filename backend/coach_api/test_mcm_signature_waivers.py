"""Scoped legacy exceptions with synthetic forms, database and external IO."""
from copy import deepcopy
from datetime import date, time
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.db import connection
from django.test import TestCase

from .management.commands import waive_legacy_mcm_signatures as command
from .migrated_completion import ensure_document, required_roles, submit
from .migrated_signature_rules import WAIVER_KEY, requirements_for_family, requirements_for_overlay
from .migrated_template_sync import synchronize_locked
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewSignature, MigratedReviewTemplate
from .migrated_templates import snapshot_for
from . import test_migrated_signature_settings as fixtures
from .test_migrated_pdf_parity import CONTEXT
from .tests_migrated_completion import PNG


class LegacyMcmSignatureWaiverTests(TestCase):
    def create(self):
        template, _ = MigratedReviewTemplate.objects.get_or_create(scope="GLOBAL", programme_key="", review_family="MCM",
            defaults={"name": "Synthetic MCM", "is_active": True, "definition_json": deepcopy(fixtures.DEFINITION)})
        source_id = 7000 + ImportedReviewInstance.objects.count()
        review = ImportedReviewInstance.objects.create(owner_email="coach@example.invalid", learner_id=17,
            source_review_id=source_id, event_key=f"imported-review:synthetic-{source_id}", status="scheduled",
            migrated_template=template, template_snapshot=snapshot_for(template),
            signature_requirements=requirements_for_family("MCM"))
        booking = CoachCalendarEvent.objects.create(event_key=review.event_key, owner_email=review.owner_email,
            learner_id=17, event_type="mcr", target_date=date(2026, 10, 22), scheduled_date=date(2026, 10, 22),
            scheduled_time=time(10), duration_minutes=60, status="scheduled", graph_event_id="synthetic-existing",
            meeting_link="https://example.invalid/meeting")
        return template, review, booking

    def setUp(self):
        self.source = self.enterContext(patch.object(command, "source_for", return_value=(
            "Monthly Coaching Meeting", date(2026, 10, 22), "Scheduled", None)))
        profiles = self.enterContext(patch.object(command.LearnerProfile.objects, "filter"))
        profiles.return_value.values_list.return_value.first.return_value = "coach@example.invalid"
        self.lock = self.enterContext(patch.object(command, "lock_learner_calendar"))
        # The command resolves bookings through the same production resolver;
        # fixtures use its direct event-key association without enrolment IO.
        from .models import CoachCalendarEvent
        self.enterContext(patch.object(command, "booking_for_overlay", side_effect=lambda overlay, **kw:
            CoachCalendarEvent.objects.filter(event_key=overlay.event_key).first()))
        self.enterContext(patch.object(command, "_mirror_status", side_effect=lambda overlay:
            CoachCalendarEvent.objects.filter(event_key=overlay.event_key).update(
                status=overlay.status, review_completed_at=overlay.completed_at)))

    def run_command(self, *overlays, apply=True, **overrides):
        branch = "sqlite"
        if connection.vendor == "postgresql":
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('neon.branch_id', true)")
                branch = cursor.fetchone()[0]
        options = dict(owner_email="coach@example.invalid", actor_email="admin@example.invalid",
            before="2026-11-06", reason="Approved historical MCM exception",
            review_id=[row.pk for row in overlays], expected_database=str(connection.settings_dict["NAME"]),
            expected_branch=branch, stdout=StringIO(), apply=apply)
        options.update(overrides)
        ids = options.pop("review_id")
        argv = [value for pk in ids for value in ("--review-id", str(pk))]
        call_command("waive_legacy_mcm_signatures", *argv, **options)

    def test_preview_is_read_only_and_explicit_selection_leaves_other_reviews_unchanged(self):
        template, old, _ = self.create()
        _, other, _ = self.create()
        before = deepcopy(old.__dict__)
        self.run_command(old, apply=False)
        old.refresh_from_db()
        self.assertEqual(old.meeting_intelligence, before["meeting_intelligence"])
        self.assertEqual(old.signature_requirements, before["signature_requirements"])
        self.lock.assert_not_called()
        self.run_command(old)
        old.refresh_from_db()
        other.refresh_from_db()
        template.refresh_from_db()
        self.assertEqual(required_roles(old), ())
        self.assertEqual(required_roles(other), ("advisor", "participant"))
        self.assertNotIn("signatures", template.definition_json)
        self.assertEqual(old.status, "scheduled")
        self.assertIsNone(old.completed_at)

    def test_waiver_survives_master_sync_and_submission_keeps_saved_work_and_pdf(self):
        template, review, booking = self.create()
        review.answers = {"answer": "Saved before waiver"}
        review.progress_snapshot = {"completed": 12}
        review.meeting_intelligence = {"other": "Keep metadata"}
        review.save()
        self.run_command(review)
        review.refresh_from_db()
        waiver = deepcopy(review.meeting_intelligence[WAIVER_KEY])
        template.definition_json["signatures"] = {"advisor": True, "participant": True, "employer": True}
        template.definition_json["sections"][0]["title"] = "Updated discussion"
        template.save()
        from django.db import transaction
        with transaction.atomic():
            self.assertTrue(synchronize_locked(review, "MCM", "id:synthetic"))
        self.assertEqual(required_roles(review), ())
        self.assertEqual(review.answers, {"answer": "Saved before waiver"})
        self.assertEqual(review.progress_snapshot, {"completed": 12})
        self.assertEqual(review.meeting_intelligence, {"other": "Keep metadata", WAIVER_KEY: waiver})
        submit(review, {"answer": "Coach submitted summary"})
        review.refresh_from_db()
        self.assertEqual(review.status, "completed")
        self.assertFalse(review.migrated_signatures.exists())
        self.assertTrue(ensure_document(review, **CONTEXT).pdf_bytes)
        booking.refresh_from_db()
        self.assertEqual(booking.graph_event_id, "synthetic-existing")
        self.assertEqual(booking.meeting_link, "https://example.invalid/meeting")
        self.assertEqual(booking.scheduled_time, time(10))

    def test_already_submitted_completes_preserving_actual_signatures_and_retry_is_noop(self):
        _, review, booking = self.create()
        submit(review, {"answer": "Already submitted summary"})
        from django.utils import timezone
        signature = MigratedReviewSignature.objects.create(overlay=review, role="advisor", signer_account_id=1,
            signer_email="coach@example.invalid", signer_name="Synthetic coach", signature=PNG, signed_at=timezone.now())
        original = {field.attname: deepcopy(getattr(signature, field.attname)) for field in signature._meta.concrete_fields}
        self.run_command(review)
        review.refresh_from_db()
        booking.refresh_from_db()
        signature.refresh_from_db()
        self.assertEqual((review.status, booking.status), ("completed", "completed"))
        self.assertEqual(review.answers, {"answer": "Already submitted summary"})
        self.assertEqual({field.attname: getattr(signature, field.attname) for field in signature._meta.concrete_fields}, original)
        self.assertTrue(ensure_document(review, **CONTEXT).pdf_bytes)
        before = (review.updated_at, review.completed_at, deepcopy(review.meeting_intelligence))
        self.run_command(review)
        review.refresh_from_db()
        self.assertEqual((review.updated_at, review.completed_at, review.meeting_intelligence), before)

    def test_cutoff_is_exclusive_and_actual_booking_overrides_older_planned_date(self):
        _, review, booking = self.create()
        for day in (date(2026, 11, 6), date(2026, 11, 7)):
            booking.scheduled_date = day
            booking.save()
            with self.assertRaisesRegex(CommandError, "cutoff"):
                self.run_command(review)
        review.refresh_from_db()
        self.assertNotIn(WAIVER_KEY, review.meeting_intelligence)

    def test_missing_booking_uses_dated_source_without_starting_or_submitting_a_draft(self):
        _, review, booking = self.create()
        booking.delete()
        review.status = "not-scheduled"
        review.save()
        self.run_command(review)
        review.refresh_from_db()
        self.assertEqual(review.status, "not-scheduled")
        self.assertEqual(review.meeting_intelligence[WAIVER_KEY]["dateBasis"], "source-planned")
        with self.assertRaisesRegex(ValueError, "scheduled"):
            submit(review, {"answer": "Must still schedule"})

    def test_source_owner_family_and_database_mismatches_fail_closed(self):
        _, review, _ = self.create()
        for overrides in ({"owner_email": "other@example.invalid"}, {"expected_database": "wrong"},
                          {"expected_branch": "wrong"}, {"review_id": [999999]}):
            with self.subTest(overrides=overrides), self.assertRaises(CommandError):
                self.run_command(review, **overrides)
        for source in (None, ("Progress Review", date(2026, 10, 22), "Scheduled", None),
                       ("Monthly Coaching Meeting", None, "Completed", date(2026, 10, 22))):
            with self.subTest(source=source), self.assertRaises(CommandError):
                self.source.return_value = source
                self.run_command(review)
        review.refresh_from_db()
        self.assertNotIn(WAIVER_KEY, review.meeting_intelligence)

    def test_malformed_or_copied_metadata_cannot_remove_other_signature_requirements(self):
        _, review, _ = self.create()
        self.run_command(review)
        review.refresh_from_db()
        waiver = deepcopy(review.meeting_intelligence[WAIVER_KEY])
        for changed in ({"eventKey": "another-review"}, {"learnerId": 999}, {"sourceReviewId": 999},
                        {"meetingDate": "2026-11-06"}, {"before": "invalid"}, {"appliedAt": "2026-11-01"},
                        {"reason": ""}):
            with self.subTest(changed=changed):
                review.meeting_intelligence[WAIVER_KEY] = {**waiver, **changed}
                self.assertEqual(requirements_for_overlay(review, "MCM"), requirements_for_family("MCM"))
        review.meeting_intelligence[WAIVER_KEY] = waiver
        for family in ("PR", "PR_SKILLS_RADAR", "PSP"):
            self.assertEqual(requirements_for_overlay(review, family), requirements_for_family(family))

    def test_a_later_failure_rolls_back_the_whole_selected_batch(self):
        _, first, _ = self.create()
        _, second, booking = self.create()
        booking.scheduled_date = date(2026, 11, 6)
        booking.save()
        with self.assertRaises(CommandError):
            self.run_command(first, second)
        first.refresh_from_db()
        self.assertNotIn(WAIVER_KEY, first.meeting_intelligence)

    def test_multiple_selected_reviews_apply_in_one_batch(self):
        _, first, _ = self.create()
        _, second, _ = self.create()
        self.run_command(first, second)
        for review in (first, second):
            review.refresh_from_db()
            self.assertEqual(required_roles(review), ())
            self.assertIn(WAIVER_KEY, review.meeting_intelligence)

    def test_completion_failure_rolls_back_exception_and_preserves_submitted_state(self):
        _, review, booking = self.create()
        submit(review, {"answer": "Submitted"})
        with patch.object(command, "complete", side_effect=ValueError("Synthetic completion failure")):
            with self.assertRaisesRegex(ValueError, "completion failure"):
                self.run_command(review)
        review.refresh_from_db()
        booking.refresh_from_db()
        self.assertEqual(review.status, "awaiting-signature")
        self.assertEqual(booking.status, "scheduled")
        self.assertNotIn(WAIVER_KEY, review.meeting_intelligence)

    def test_waiver_does_not_skip_required_answers(self):
        _, review, _ = self.create()
        self.run_command(review)
        review.refresh_from_db()
        with self.assertRaisesRegex(ValueError, "Required"):
            submit(review, {})
        review.refresh_from_db()
        self.assertEqual(review.status, "scheduled")

    def test_preview_checks_submitted_answers_before_reporting_completion(self):
        _, review, _ = self.create()
        review.status = "awaiting-signature"
        review.save()
        with self.assertRaisesRegex(ValueError, "Required"):
            self.run_command(review, apply=False)
        review.refresh_from_db()
        self.assertNotIn(WAIVER_KEY, review.meeting_intelligence)
