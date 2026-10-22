"""Synthetic template-to-signature lifecycle; no Aptem, Graph or mail writes."""
from copy import deepcopy
from datetime import date, time
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import transaction
from django.http import JsonResponse
from django.test import RequestFactory, TestCase

from .migrated_completion import ensure_document, required_roles, sign, submit
from .migrated_initialization import initialize_imported_review
from .migrated_reopening import archive, clear_active_signatures
from .migrated_signature_rules import requirements_for_family
from .migrated_template_sync import synchronize_locked
from .migrated_summary_binding import answer_version
from .models import CoachCalendarEvent, MigratedReviewTemplate
from . import migrated_completion_views as endpoints
from .test_migrated_auto_completion import sign_request, source_identity
from .test_migrated_pdf_parity import CONTEXT
from .tests_migrated_completion import PNG


TYPES = {"MCM": "Monthly Coaching Meeting", "PR": "Progress Review", "PR_SKILLS_RADAR": "Progress Review (+ Skills Radar)"}
DEFINITION = {"sections": [{"key": "section", "title": "Discussion", "fields": [
    {"key": "answer", "title": "Action", "aptemType": 13, "mandatory": True},
]}]}


class MigratedSignatureSettingsTests(TestCase):
    def create(self, family="MCM", signatures=None):
        definition = deepcopy(DEFINITION)
        if signatures is not None:
            definition["signatures"] = signatures
        template = MigratedReviewTemplate.objects.create(scope="GLOBAL", programme_key="", review_family=family,
            name="Synthetic template", is_active=True, definition_json=definition)
        source = {"canInitialize": True, "readOnly": True, "migratedProgrammeKey": "id:synthetic", "sourceStatus": "Scheduled",
            "historicalReview": {"id": 7000 + template.pk, "type": TYPES[family]},
            "instance": {"id": f"imported-review:settings-{template.pk}", "learnerId": 17}}
        overlay, created = initialize_imported_review("coach@example.invalid", source)
        self.assertTrue(created)
        booking = CoachCalendarEvent.objects.create(event_key=overlay.event_key, owner_email=overlay.owner_email, learner_id=17,
            event_type="mcr" if family == "MCM" else "progress-review", target_date=date(2026, 10, 22),
            scheduled_date=date(2026, 10, 22), scheduled_time=time(10), duration_minutes=60, status="scheduled",
            graph_event_id="synthetic-existing", meeting_link="https://example.invalid/meeting")
        return template, overlay, booking

    def sync(self, overlay, family="MCM", key="id:synthetic"):
        with transaction.atomic():
            changed = synchronize_locked(overlay, family, key)
        overlay.refresh_from_db()
        return changed

    def test_legacy_templates_keep_existing_defaults(self):
        for family in TYPES:
            template, overlay, _ = self.create(family)
            self.assertEqual(overlay.signature_requirements, requirements_for_family(family))
            self.assertNotIn("signatures", template.definition_json)

    def test_selected_roles_survive_initialization_submission_and_complete_on_last_signature(self):
        for family, roles in (("MCM", ("employer",)), ("PR", ("advisor", "participant")), ("PR_SKILLS_RADAR", ("participant",))):
            with self.subTest(family=family):
                rules = {role: role in roles for role in ("advisor", "participant", "employer")}
                template, overlay, booking = self.create(family, rules)
                self.assertEqual(overlay.signature_requirements, {**rules, "referrer": False})
                submit(overlay, {"answer": "Synthetic action"})
                self.assertEqual(overlay.status, "awaiting-signature")
                # Later master changes cannot alter the document being signed.
                template.definition_json["signatures"] = {role: True for role in rules}
                template.save()
                self.assertFalse(self.sync(overlay, family))
                with source_identity():
                    for index, role in enumerate(roles):
                        response = sign_request(overlay, role)
                        self.assertEqual(response.status_code, 200, response.content)
                        overlay.refresh_from_db()
                        self.assertEqual(overlay.status, "completed" if index == len(roles) - 1 else "awaiting-signature")
                booking.refresh_from_db()
                self.assertEqual(booking.status, "completed")
                self.assertEqual(booking.graph_event_id, "synthetic-existing")
                self.assertEqual(overlay.signature_requirements, {**rules, "referrer": False})
                self.assertTrue(ensure_document(overlay, **CONTEXT).pdf_bytes)

    def test_signature_only_template_change_updates_working_reviews_and_preserves_answers(self):
        template, overlay, _ = self.create()
        overlay.answers = {"answer": "Keep saved answer"}
        overlay.progress_snapshot = {"keep": 10}
        overlay.meeting_intelligence = {"keep": "summary"}
        overlay.save()
        before_version = overlay.updated_at
        template.definition_json["signatures"] = {"advisor": False, "participant": True, "employer": True}
        template.save()
        self.assertTrue(self.sync(overlay))
        self.assertEqual(required_roles(overlay), ("participant", "employer"))
        self.assertEqual(overlay.answers, {"answer": "Keep saved answer"})
        self.assertEqual(overlay.progress_snapshot, {"keep": 10})
        self.assertEqual(overlay.meeting_intelligence, {"keep": "summary"})
        self.assertNotEqual(overlay.updated_at, before_version)
        self.assertFalse(self.sync(overlay))

    def test_programme_override_and_reset_follow_the_resolved_template(self):
        template, overlay, _ = self.create(signatures={"advisor": False, "participant": True, "employer": False})
        override = MigratedReviewTemplate.objects.create(scope="PROGRAMME", programme_key="id:synthetic", review_family="MCM",
            name="Custom template", is_active=True, definition_json={**DEFINITION,
                "signatures": {"advisor": True, "participant": False, "employer": False}})
        self.assertTrue(self.sync(overlay))
        self.assertEqual(required_roles(overlay), ("advisor",))
        override.is_active = False
        override.save()
        self.assertTrue(self.sync(overlay))
        self.assertEqual(overlay.migrated_template_id, template.pk)
        self.assertEqual(required_roles(overlay), ("participant",))

    def test_no_signatures_completes_only_after_valid_submission_and_supports_pdf(self):
        for family in TYPES:
            with self.subTest(family=family):
                _, overlay, _ = self.create(family, {"advisor": False, "participant": False, "employer": False})
                with self.assertRaisesRegex(ValueError, "Required"):
                    submit(overlay, {})
                overlay.refresh_from_db()
                self.assertEqual(overlay.status, "scheduled")
                submit(overlay, {"answer": "Done"})
                overlay.refresh_from_db()
                self.assertEqual(overlay.status, "completed")
                self.assertIsNotNone(overlay.completed_at)
                self.assertFalse(overlay.migrated_signatures.exists())
                self.assertTrue(ensure_document(overlay, **CONTEXT).pdf_bytes)

    def test_failed_hours_allocation_rolls_back_zero_signature_submission(self):
        template, overlay, _ = self.create(signatures={"advisor": False, "participant": False, "employer": False})
        template.definition_json["otjh"] = {"expectedHours": 1, "countsTowardsOtjh": True}
        template.save()
        self.sync(overlay)
        with patch("coach_api.migrated_otjh.record_completion", side_effect=ValueError("Synthetic hours failure")):
            with self.assertRaisesRegex(ValueError, "hours failure"):
                submit(overlay, {"answer": "Done"})
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, "scheduled")
        self.assertEqual(overlay.answers, {})
        self.assertIsNone(overlay.completed_at)

    def test_submit_endpoint_completes_and_mirrors_zero_signature_review_once(self):
        template, overlay, booking = self.create(signatures={"advisor": False, "participant": False, "employer": False})
        template.definition_json["otjh"] = {"expectedHours": 1, "countsTowardsOtjh": True}
        template.save()
        self.sync(overlay)
        definition = {"migratedForm": True, "readOnly": False, "migratedProgrammeKey": "id:synthetic",
            "instance": {"id": overlay.event_key, "learnerId": 17},
            "historicalReview": {"id": str(overlay.source_review_id), "type": TYPES["MCM"]}}
        request = RequestFactory().post("/submit/", json.dumps({"answerVersion": answer_version(overlay),
            "answers": {"answer": "Completed action"}}), content_type="application/json")
        with patch.object(endpoints, "_coach_review", return_value=(overlay.owner_email, definition)), \
                patch.object(endpoints, "_response", return_value=JsonResponse({"ok": True})), \
                patch("coach_api.migrated_otjh.record_completion") as credit:
            response = unwrap(endpoints.migrated_review_submit)(request, overlay.event_key)
            self.assertEqual(response.status_code, 200, response.content)
            retry = unwrap(endpoints.migrated_review_submit)(request, overlay.event_key)
            self.assertEqual(retry.status_code, 409)
            credit.assert_called_once()
        overlay.refresh_from_db()
        booking.refresh_from_db()
        self.assertEqual((overlay.status, booking.status), ("completed", "completed"))
        self.assertEqual(booking.review_completed_at, overlay.completed_at)
        self.assertEqual(booking.graph_event_id, "synthetic-existing")
        self.assertEqual(booking.meeting_link, "https://example.invalid/meeting")
        self.assertEqual(booking.scheduled_time, time(10))

    def test_deselected_role_cannot_sign(self):
        _, overlay, _ = self.create("PR", {"advisor": False, "participant": True, "employer": False})
        submit(overlay, {"answer": "Done"})
        for role in ("advisor", "employer"):
            with self.assertRaisesRegex(ValueError, "not required"):
                sign(overlay, role, account=SimpleNamespace(pk=1, display_name="Synthetic", email="test@example.invalid"), signature=PNG)
        self.assertFalse(overlay.migrated_signatures.exists())

    def test_reopen_retains_archived_rules_and_syncs_current_template(self):
        template, overlay, _ = self.create()
        submit(overlay, {"answer": "Saved action"})
        previous_rules = deepcopy(overlay.signature_requirements)
        with transaction.atomic():
            revision = archive(overlay, account=SimpleNamespace(pk=1, email=overlay.owner_email),
                reason="correction-required", note="Synthetic correction", pdf_context=CONTEXT)
            clear_active_signatures(overlay)
            overlay.status = "in-progress"
            overlay.save()
        template.definition_json["signatures"] = {"advisor": True, "participant": False, "employer": False}
        template.save()
        self.sync(overlay)
        revision.refresh_from_db()
        self.assertEqual(revision.snapshot["signature_requirements"], previous_rules)
        self.assertEqual(required_roles(overlay), ("advisor",))

    def test_completed_reviews_do_not_sync_signature_changes(self):
        template, overlay, _ = self.create(signatures={"advisor": False, "participant": False, "employer": False})
        submit(overlay, {"answer": "Done"})
        snapshot = deepcopy(overlay.template_snapshot)
        template.definition_json["signatures"]["advisor"] = True
        template.save()
        self.assertFalse(self.sync(overlay))
        self.assertEqual(overlay.template_snapshot, snapshot)
        self.assertEqual(required_roles(overlay), ())
