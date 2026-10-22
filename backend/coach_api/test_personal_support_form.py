"""PSP completion uses synthetic storage and mocked source reads, never Graph."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import date
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import transaction
from django.test import RequestFactory, SimpleTestCase, TestCase

from . import migrated_completion_views as endpoints, views
from .migrated_completion import complete_personal_support_if_ready, required_roles, requirements_for_family, sign, signature_states, submit
from .migrated_signature_rules import requirements_for_definition
from .migrated_template_sync import synchronize_locked
from .migrated_reviews import render_sections
from .migrated_summary_binding import answer_version
from .migrated_templates import snapshot_for
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate
from .personal_support_form import initial_answers
from .test_migrated_auto_completion import sign_request, source_identity
from .test_migrated_respondents import post
from .test_migrated_template_sync import field, form


class PersonalSupportCompletionTests(TestCase):
    def setUp(self):
        self.template = MigratedReviewTemplate.objects.create(scope="GLOBAL", review_family="PSP", is_active=True,
            name="Personal Support Plan", definition_json=form(
                field("goal", 13, mandatory=True, respondentRoles=["participant"]),
                field("support", 6, mandatory=True, respondentRoles=["participant"], ifTrue=[
                    field("detail", 13, mandatory=True, respondentRoles=["participant"])])))
        self.review = ImportedReviewInstance.objects.create(owner_email="coach@example.invalid", learner_id=17,
            event_key="imported-review:psp-synthetic", source_review_id=7001, migrated_template=self.template,
            template_snapshot=snapshot_for(self.template), signature_requirements=requirements_for_family("PSP"),
            status="not-scheduled", answers={})

    def definition(self, owner, key):
        review = ImportedReviewInstance.objects.get(event_key=key)
        sections, _ = render_sections(review.template_snapshot, review.answers)
        return {"source": "aptem", "migratedForm": True, "readOnly": review.status in {"awaiting-signature", "completed"},
            "instance": {"id": key, "learnerId": 17, "status": review.status},
            "template": {"reviewTypeCode": "aptem_psp"}, "localStatus": review.status,
            "historicalReview": {"id": "7001", "type": "Personal Support Plan"},
            "migratedProgrammeKey": None, "sections": sections, "signatures": signature_states(review), "answerVersion": answer_version(review)}

    def select_signatures(self, *roles):
        self.template.definition_json["signatures"] = {role: role in roles for role in ("advisor", "participant", "employer")}
        self.template.save()
        with transaction.atomic():
            synchronize_locked(self.review, "PSP", None)
        self.review.refresh_from_db()

    def test_configured_signatures_apply_on_initialization_and_editable_template_sync(self):
        from .migrated_initialization import initialize_imported_review
        self.select_signatures("advisor", "employer")
        self.assertEqual(required_roles(self.review), ("advisor", "employer"))
        source = {"canInitialize": True, "readOnly": True, "sourceStatus": "Not Scheduled", "migratedProgrammeKey": None,
            "historicalReview": {"id": 7002, "type": "Personal Support Plan"},
            "instance": {"id": "imported-review:psp-new", "learnerId": 17}}
        with patch("coach_api.personal_support_form.initial_answers", return_value={}):
            overlay, created = initialize_imported_review(self.review.owner_email, source)
        self.assertTrue(created)
        self.assertEqual(required_roles(overlay), ("advisor", "employer"))
        self.assertEqual(overlay.signature_requirements, requirements_for_definition(self.template.definition_json, "PSP"))

    def test_coach_and_both_learner_types_save_for_selected_signatures_and_lock_answers(self):
        self.select_signatures("participant")
        for actor in ("coach", "commercial", "apprenticeship"):
            with self.subTest(actor=actor), self.identities("commercial" if actor == "commercial" else "apprenticeship"):
                self.review.status, self.review.answers = "not-scheduled", {}
                self.review.save()
                save = self.coach_save if actor == "coach" else lambda answers: post(self.review, answers)
                self.assertEqual(save({"goal": "Goal"}).status_code, 200)
                self.review.refresh_from_db()
                self.assertEqual(self.review.status, "not-scheduled")
                response = save({"goal": "Goal", "support": "no"})
                self.assertEqual(response.status_code, 200, response.content)
                self.review.refresh_from_db()
                self.assertEqual(self.review.status, "awaiting-signature")
                self.assertIsNone(self.review.completed_at)
                self.assertTrue(json.loads(response.content)["readOnly"])
                self.assertEqual(save({"goal": "Changed"}).status_code, 409)

    def test_selected_signatures_complete_on_last_signer_keep_booking_and_never_credit_hours(self):
        self.template.definition_json["otjh"] = {"expectedHours": 2, "countsTowardsOtjh": True}
        self.select_signatures("advisor", "participant", "employer")
        booking = CoachCalendarEvent.objects.create(event_key=self.review.event_key, learner_id=17,
            owner_email=self.review.owner_email, event_type="progress-review", target_date=date(2026, 11, 1),
            status="scheduled", graph_event_id="original-event", meeting_link="https://example.invalid/original")
        with self.identities(), patch("coach_api.migrated_otjh.record_completion", side_effect=AssertionError("PSP hours")):
            self.assertEqual(self.coach_save({"goal": "Goal", "support": "no"}).status_code, 200)
            self.review.refresh_from_db()
            booking.refresh_from_db()
            self.assertEqual(booking.status, "awaiting-signature")
            # Changing the live template must not change a review already being signed.
            self.select_signatures()
            self.assertEqual(required_roles(self.review), ("advisor", "participant", "employer"))
            for role in ("employer", "advisor", "participant"):
                response = sign_request(self.review, role)
                self.assertEqual(response.status_code, 200, response.content)
                self.review.refresh_from_db()
                self.assertEqual(self.review.status, "completed" if role == "participant" else "awaiting-signature")
            self.assertEqual(sign_request(self.review, "participant").status_code, 409)
        booking.refresh_from_db()
        self.assertEqual((booking.status, booking.review_completed_at), ("completed", self.review.completed_at))
        self.assertEqual((booking.graph_event_id, booking.meeting_link), ("original-event", "https://example.invalid/original"))
        self.assertEqual(self.review.migrated_signatures.count(), 3)

    def test_selected_employer_can_read_and_sign_only_own_plan_without_answer_permission(self):
        self.select_signatures("employer")
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind), self.identities(kind):
                for subject, expected in ((91, 200), (999, 404)):
                    with patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role="employer", subject_id=subject)):
                        response = endpoints.migrated_review_party_detail(RequestFactory().get("/"), self.review.event_key)
                    self.assertEqual(response.status_code, expected)
                    if expected == 200:
                        self.assertTrue(json.loads(response.content)["readOnly"])
                self.assertEqual(post(self.review, {"goal": "Changed"}, role="employer", subject_id=91).status_code, 403)
        with self.identities(), transaction.atomic():
            submit(self.review, {"goal": "Goal", "support": "no"})
            self.assertEqual(sign_request(self.review, "employer", subject_id=999).status_code, 404)
            self.assertEqual(sign_request(self.review, "participant").status_code, 409)
            self.assertEqual(sign_request(self.review, "advisor").status_code, 409)
            self.assertEqual(sign_request(self.review, "employer").status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, "completed")

    def test_signed_psp_pdf_and_reopen_archive_keep_selected_signatures(self):
        from .migrated_completion import build_pdf
        from .migrated_reopening import archive, clear_active_signatures
        from pypdf import PdfReader
        from io import BytesIO
        self.select_signatures("participant")
        with self.identities(), transaction.atomic():
            submit(self.review, {"goal": "Synthetic agreed goal", "support": "no"})
            self.assertEqual(sign_request(self.review, "participant").status_code, 200)
        self.review.refresh_from_db()
        context = {"learner_name": "Synthetic learner", "learner_email": "learner@example.invalid",
            "programme": "Synthetic programme", "scheduled_date": "2026-11-01", "coach_name": "Synthetic coach"}
        content = build_pdf(self.review, **context)
        text = " ".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        self.assertIn("Synthetic agreed goal", text)
        self.assertIn("Participant", text)
        self.assertIn("Signature:", text)
        self.assertNotIn("\nEmployer\n", text)
        self.assertNotIn("\nAdvisor\n", text)
        self.assertNotIn("Learning Progress", text)
        with transaction.atomic():
            revision = archive(self.review, account=SimpleNamespace(pk=1, email=self.review.owner_email),
                reason="signature-error", note="Correction", pdf_context=context)
            clear_active_signatures(self.review)
            self.review.status = "in-progress"
            self.review.save()
            self.select_signatures()
        self.assertTrue(revision.snapshot["signature_requirements"]["participant"])
        self.assertEqual(revision.snapshot["signatures"][0]["role"], "participant")
        self.assertIn("Signature:", " ".join(page.extract_text() for page in PdfReader(BytesIO(bytes(revision.pdf_bytes))).pages))
        self.assertEqual(required_roles(self.review), ())

    @contextmanager
    def identities(self, kind="apprenticeship", source_status="Not Scheduled"):
        with source_identity(kind, source_status=source_status), \
             patch.object(views, "_imported_review_definition", side_effect=self.definition):
            yield

    def coach_save(self, answers, version=None):
        request = RequestFactory().post("/", json.dumps({"answers": answers,
            "answerVersion": version or answer_version(self.review)}), content_type="application/json")
        request.coach_email = self.review.owner_email
        return unwrap(views.coach_review_instance_answers)(request, self.review.event_key)

    def test_coach_partial_save_then_completion_preserves_the_existing_meeting(self):
        booking = CoachCalendarEvent.objects.create(event_key=self.review.event_key, learner_id=17,
            owner_email=self.review.owner_email, event_type="progress-review", target_date=date(2026, 11, 1),
            status="scheduled", graph_event_id="original-event", meeting_link="https://example.invalid/original")
        with self.identities():
            self.assertEqual(self.coach_save({"goal": "Agreed goal"}).status_code, 200)
            self.review.refresh_from_db()
            self.assertEqual(self.review.status, "not-scheduled")
            self.assertEqual(self.coach_save({"goal": "Agreed goal", "support": "no"}).status_code, 200)
        self.review.refresh_from_db()
        booking.refresh_from_db()
        self.assertEqual((self.review.status, booking.status), ("completed", "completed"))
        self.assertEqual(booking.graph_event_id, "original-event")
        self.assertEqual(booking.meeting_link, "https://example.invalid/original")
        self.assertEqual(booking.review_completed_at, self.review.completed_at)
        self.assertFalse(self.review.migrated_signatures.exists())
        self.assertEqual(required_roles(self.review), ())

    def test_learner_completion_is_available_for_both_learner_types_without_a_booking(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                self.review.status, self.review.answers, self.review.completed_at = "not-scheduled", {}, None
                self.review.save()
                with self.identities(kind):
                    result = post(self.review, {"goal": "Agreed goal", "support": "no"})
                self.assertEqual(result.status_code, 200, result.content)
                self.review.refresh_from_db()
                self.assertEqual(self.review.status, "completed")
                self.assertTrue(json.loads(result.content)["readOnly"])
                self.assertFalse(self.review.migrated_signatures.exists())
                self.assertFalse(CoachCalendarEvent.objects.exists())

    def test_required_conditionals_and_whitespace_do_not_complete(self):
        with self.identities():
            for answers in ({"goal": "  ", "support": "no"}, {"goal": "Goal", "support": "yes"}):
                self.assertEqual(post(self.review, answers).status_code, 200)
                self.review.refresh_from_db()
                self.assertNotEqual(self.review.status, "completed")
            self.assertEqual(post(self.review, {"detail": "Agreed support"}).status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, "completed")

    def test_stale_unauthorized_and_invalid_writes_do_not_complete(self):
        with self.identities():
            for kwargs, expected in (({"subject_id": 999}, 404), ({"role": "employer"}, 404),
                                     ({"query": "?viewAsLearner=17"}, 403), ({"version": "stale"}, 409),
                                     ({"csrf": True}, 403)):
                self.assertEqual(post(self.review, {"goal": "Goal", "support": "no"}, **kwargs).status_code, expected)
            self.assertEqual(post(self.review, {"support": "invalid"}).status_code, 400)
            self.assertEqual(post(self.review, {"detail": "Hidden"}).status_code, 403)
        self.review.refresh_from_db()
        self.assertEqual(self.review.answers, {})
        self.assertIsNone(self.review.completed_at)

    def test_completed_and_historical_reviews_are_immutable_and_retries_keep_timestamp(self):
        with self.identities():
            self.assertEqual(post(self.review, {"goal": "Goal", "support": "no"}).status_code, 200)
            self.review.refresh_from_db()
            completed_at = self.review.completed_at
            self.assertEqual(post(self.review, {"goal": "Changed"}).status_code, 409)
            self.assertEqual(self.coach_save({"goal": "Changed"}).status_code, 409)
        with self.identities(source_status="Completed"):
            self.assertEqual(post(self.review, {"goal": "Changed"}).status_code, 404)
        self.review.refresh_from_db()
        self.assertEqual(self.review.completed_at, completed_at)
        self.assertEqual(self.review.answers["goal"], "Goal")

    def test_default_psp_does_not_require_or_accept_signatures(self):
        for status in ("not-scheduled", "scheduled", "in-progress", "awaiting-signature", "completed"):
            self.review.status = status
            with self.subTest(status=status), self.assertRaises(ValueError):
                sign(self.review, "participant", account=SimpleNamespace(), signature="invalid")
        self.assertFalse(self.review.migrated_signatures.exists())

    def test_legacy_psp_without_stored_requirements_keeps_its_frozen_default(self):
        self.review.signature_requirements = {}
        self.review.migrated_template = None
        self.review.save()
        self.assertEqual(required_roles(self.review), ())
        self.assertTrue(all(not state["required"] for state in signature_states(self.review).values()))

    def test_compatibility_submit_completes_directly_and_never_assigns_hours(self):
        with self.identities(), patch("coach_api.migrated_otjh.record_completion", side_effect=AssertionError("PSP hours")), transaction.atomic():
            submit(self.review, {"goal": "Goal", "support": "no"})
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, "completed")
        self.assertEqual(self.review.answers["goal"], "Goal")

    def test_calendar_failure_rolls_back_answers_and_completion_together(self):
        with self.identities(), patch.object(endpoints, "_mirror_status", side_effect=ValueError("calendar conflict")):
            self.assertEqual(post(self.review, {"goal": "Goal", "support": "no"}).status_code, 400)
        self.review.refresh_from_db()
        self.assertEqual(self.review.answers, {})
        self.assertEqual(self.review.status, "not-scheduled")
        self.assertIsNone(self.review.completed_at)

    def test_reading_fully_answered_form_does_not_complete_it(self):
        self.review.answers = {"goal": "Goal", "support": "no"}
        self.review.save()
        with self.identities(), patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role="learner", subject_id=71)):
            result = endpoints.migrated_review_party_detail(RequestFactory().get("/"), self.review.event_key)
        self.assertEqual(result.status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.status, "not-scheduled")

    def test_completed_pdf_has_answers_and_no_signature_or_progress_blocks(self):
        from .migrated_completion import build_pdf
        from pypdf import PdfReader
        from io import BytesIO
        with self.identities(), transaction.atomic():
            submit(self.review, {"goal": "Synthetic agreed goal", "support": "no"})
        content = build_pdf(self.review, learner_name="Synthetic learner", learner_email="learner@example.invalid",
            programme="Synthetic programme", scheduled_date="2026-11-01", coach_name="Synthetic coach")
        text = " ".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        self.assertIn("Synthetic agreed goal", text)
        self.assertNotIn("Signature", text)
        self.assertNotIn("Learning Progress", text)


class PersonalSupportSourceAnswersTests(SimpleTestCase):
    def test_initialization_preserves_captured_answers_without_mutating_source_or_template(self):
        from .test_migrated_reviews import SOURCE
        from .migrated_reviews import candidate_definition
        source = deepcopy(SOURCE)
        source["sections"][0]["source_payload"].update(comment="Captured answer", choice="Good", check=False)
        snapshot = candidate_definition(source)
        before = deepcopy((source, snapshot))
        with patch("coach_api.personal_support_form.connections") as connections:
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value = (source, "In Progress", None)
            answers = initial_answers(1, 17, snapshot)
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value = (json.dumps(source), "In Progress", None)
            self.assertEqual(initial_answers(1, 17, snapshot), answers)
        self.assertEqual(answers, {"section-0:comment": "Captured answer", "section-0:choice": "Good", "section-0:check": "no"})
        self.assertEqual((source, snapshot), before)

    def test_completed_missing_and_archived_sources_cannot_initialize(self):
        with patch("coach_api.personal_support_form.connections") as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            for row in (None, ({}, "Completed", None), ({}, "Archived", None), ({}, "Scheduled", "2026-01-01")):
                cursor.fetchone.return_value = row
                with self.subTest(row=row), self.assertRaises(ValueError):
                    initial_answers(1, 17, {})


class PersonalSupportActivationTests(TestCase):
    def test_dry_run_and_repeat_apply_preserve_explicit_permissions_and_other_families(self):
        from django.core.management import call_command
        from io import StringIO
        template = MigratedReviewTemplate.objects.create(scope="GLOBAL", review_family="PSP", name="PSP",
            is_active=False, definition_json=form(field("shared"), field("coach-only", respondentRoles=[]), field("heading", 11)))
        other = MigratedReviewTemplate.objects.create(scope="GLOBAL", review_family="PR", name="PR", is_active=True,
            definition_json=form(field("existing")))
        before_other = deepcopy(other.__dict__)
        options = {"template_id": template.pk, "stdout": StringIO()}
        call_command("enable_personal_support_form", **options)
        template.refresh_from_db()
        self.assertFalse(template.is_active)
        self.assertNotIn("respondentRoles", template.definition_json["sections"][0]["fields"][0])
        call_command("enable_personal_support_form", apply=True, **options)
        template.refresh_from_db()
        timestamp = template.updated_at
        fields = template.definition_json["sections"][0]["fields"]
        self.assertEqual(fields[0]["respondentRoles"], ["participant"])
        self.assertEqual(fields[1]["respondentRoles"], [])
        self.assertNotIn("respondentRoles", fields[2])
        self.assertTrue(template.is_active)
        call_command("enable_personal_support_form", apply=True, **options)
        template.refresh_from_db()
        self.assertEqual(template.updated_at, timestamp)
        other.refresh_from_db()
        self.assertEqual(other.definition_json, before_other["definition_json"])
        self.assertEqual(other.updated_at, before_other["updated_at"])
