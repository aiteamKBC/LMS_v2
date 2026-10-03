"""Hermetic lifecycle/PDF regression tests; no production database or Graph."""
import base64
from datetime import datetime, timezone
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from pypdf import PdfReader
from PIL import Image

from coach_api.migrated_completion import (
    build_pdf, complete, ensure_document, requirements_for_family,
    sign, submit, validate_signature_image,
)
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance


_png_buffer = BytesIO()
Image.new("RGB", (2, 2), "black").save(_png_buffer, format="PNG")
PNG = "data:image/png;base64," + base64.b64encode(_png_buffer.getvalue()).decode()
SNAPSHOT = {"name": "Synthetic MCM", "sections": [{"key": "s1", "title": "Meeting", "fields": [
    {"key": "answer", "title": "Agreed action", "aptemType": 1, "mandatory": True, "ifTrue": [], "ifFalse": []},
    {"key": "conditional", "title": "Concern?", "aptemType": 6, "mandatory": False,
     "ifTrue": [{"key": "hidden", "title": "Hidden detail", "aptemType": 1, "mandatory": False, "ifTrue": [], "ifFalse": []}], "ifFalse": []},
]}]}


def overlay(family="MCM", status="in-progress", answers=None, signatures=None):
    rows = signatures or []
    relation = Mock()
    relation.all.return_value = rows
    relation.values_list.return_value = [row.role for row in rows]
    relation.filter.return_value.exists.return_value = False
    return SimpleNamespace(
        status=status, answers=answers or {}, template_snapshot=SNAPSHOT,
        migrated_template=SimpleNamespace(review_family=family),
        signature_requirements=requirements_for_family(family),
        migrated_signatures=relation, completed_at=None, save=Mock(),
    )


class MigratedReviewCompletionTests(SimpleTestCase):
    def test_learner_calendar_marks_only_an_owned_migrated_overlay(self):
        from learner_api.calendar import _serialize_event

        event = CoachCalendarEvent(
            event_key="imported-review:synthetic", learner_id=1208,
            event_type="mcr", target_date=datetime(2026, 11, 18).date(),
        )
        with patch("learner_api.calendar.ImportedReviewInstance.objects.filter") as lookup:
            lookup.return_value.exists.return_value = True
            self.assertTrue(_serialize_event(event, review_types_by_template={}, templates_by_id={})["migratedForm"])
            lookup.assert_called_once_with(
                event_key=event.event_key, learner_id=event.learner_id,
                source_review_id__isnull=False,
            )
            lookup.return_value.exists.return_value = False
            self.assertFalse(_serialize_event(event, review_types_by_template={}, templates_by_id={})["migratedForm"])
            event.event_key = "native-review:synthetic"
            lookup.reset_mock()
            self.assertFalse(_serialize_event(event, review_types_by_template={}, templates_by_id={})["migratedForm"])
            lookup.assert_not_called()

    def test_roles_match_audited_native_rules(self):
        self.assertEqual([role for role, needed in requirements_for_family("MCM").items() if needed], ["advisor", "participant"])
        self.assertEqual([role for role, needed in requirements_for_family("PR").items() if needed], ["advisor", "participant", "employer"])
        self.assertEqual([role for role, needed in requirements_for_family("PR_SKILLS_RADAR").items() if needed], ["advisor", "participant", "employer"])

    def test_submission_validates_required_visible_fields_and_freezes_rules(self):
        review = overlay()
        with self.assertRaisesRegex(ValueError, "Required review fields"):
            submit(review, {})
        self.assertEqual(review.status, "in-progress")
        with self.assertRaisesRegex(ValueError, "hidden conditional"):
            submit(review, {"answer": "Done", "hidden": "Old Aptem text"})
        submit(review, {"answer": "Controlled answer", "conditional": "no"})
        self.assertEqual(review.status, "awaiting-signature")
        self.assertEqual(review.signature_requirements, requirements_for_family("MCM"))
        review.save.assert_called_once()

    def test_signature_is_immutable_and_requires_submitted_state(self):
        account = SimpleNamespace(pk=12, display_name="Test coach", email="coach@example.invalid")
        review = overlay()
        with self.assertRaisesRegex(ValueError, "submitted"):
            sign(review, "advisor", account=account, signature=PNG)
        review.status = "awaiting-signature"
        with patch("coach_api.migrated_completion.MigratedReviewSignature.objects.create") as create:
            sign(review, "advisor", account=account, signature=PNG)
            create.assert_called_once()
        review.migrated_signatures.filter.return_value.exists.return_value = True
        with self.assertRaisesRegex(ValueError, "already signed"):
            sign(review, "advisor", account=account, signature=PNG)
        with self.assertRaisesRegex(ValueError, "not required"):
            sign(review, "employer", account=account, signature=PNG)

    def test_completion_requires_all_roles_and_is_terminal(self):
        coach = SimpleNamespace(role="advisor")
        learner = SimpleNamespace(role="participant")
        review = overlay(status="awaiting-signature", answers={"answer": "Done"}, signatures=[coach])
        with self.assertRaisesRegex(ValueError, "All required signatures"):
            complete(review)
        review.migrated_signatures.values_list.return_value = ["advisor", "participant"]
        complete(review)
        self.assertEqual(review.status, ImportedReviewInstance.STATUS_COMPLETED)
        self.assertIsNotNone(review.completed_at)
        with self.assertRaisesRegex(ValueError, "awaiting signatures"):
            complete(review)

    def test_skills_radar_completion_still_requires_employer_signature(self):
        review = overlay(family="PR_SKILLS_RADAR", answers={"answer": "Done"})
        submit(review, {"answer": "Done"})
        self.assertEqual(review.signature_requirements, requirements_for_family("PR"))
        review.migrated_signatures.values_list.return_value = ["advisor", "participant"]
        with self.assertRaisesRegex(ValueError, "All required signatures"):
            complete(review)
        review.migrated_signatures.values_list.return_value.append("employer")
        complete(review)
        self.assertEqual(review.status, ImportedReviewInstance.STATUS_COMPLETED)

    def test_pdf_uses_saved_answers_signatures_and_lms_provenance(self):
        at = datetime(2026, 10, 2, 14, 0, tzinfo=timezone.utc)
        rows = [SimpleNamespace(role=role, signer_name=name, signed_at=at, signature=PNG)
                for role, name in [("advisor", "Test coach"), ("participant", "Test learner")]]
        review = overlay(status="completed", answers={"answer": "Controlled answer", "conditional": "no"}, signatures=rows)
        review.completed_at = at
        document = build_pdf(review, learner_name="Test learner", learner_email="learner@example.invalid",
                             programme="Synthetic Programme", scheduled_date="2026-11-18 14:00",
                             coach_name="Test coach")
        content = "\n".join(page.extract_text() for page in PdfReader(BytesIO(document)).pages)
        for expected in ("LMS Generated Migrated Review", "Controlled answer", "Test learner", "Synthetic Programme", "MCM", "Test coach", "LMS signatures"):
            self.assertIn(expected, content)
        self.assertNotIn("Hidden detail", content)
        self.assertNotIn("Original Aptem PDF", content)

    def test_pdf_failure_does_not_store_a_partial_document(self):
        review = overlay(status="completed", answers={"answer": "Done"})
        review.completed_at = datetime.now(timezone.utc)
        with patch("coach_api.migrated_completion.MigratedReviewDocument.objects.filter") as lookup, patch("coach_api.migrated_completion.build_pdf", side_effect=RuntimeError("render failed")), patch("coach_api.migrated_completion.MigratedReviewDocument.objects.create") as create:
            lookup.return_value.first.return_value = None
            with self.assertRaisesRegex(RuntimeError, "render failed"):
                ensure_document(review)
            create.assert_not_called()
            self.assertEqual(review.status, "completed")

    def test_pdf_request_reuses_existing_authoritative_document(self):
        review = overlay(status="completed", answers={"answer": "Done"})
        saved = object()
        with patch("coach_api.migrated_completion.MigratedReviewDocument.objects.filter") as lookup, patch("coach_api.migrated_completion.build_pdf") as build:
            lookup.return_value.first.return_value = saved
            self.assertIs(ensure_document(review), saved)
            build.assert_not_called()

    def test_signature_image_rejects_external_or_empty_payloads(self):
        for value in ("https://example.invalid/signature.png", "data:image/svg+xml;base64,PHN2Zz4=", "", "data:image/png;base64,AA!!"):
            with self.assertRaises(ValueError):
                validate_signature_image(value)
