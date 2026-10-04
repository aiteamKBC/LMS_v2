"""Synthetic binding/persistence and ordered race tests; Graph and AI are mocked."""
from copy import deepcopy
from datetime import date, time, timedelta
from inspect import unwrap
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils import timezone
from pypdf import PdfReader

from . import migrated_completion_views as lifecycle, migrated_intelligence_views as intelligence, views
from .migrated_completion import build_pdf, ensure_document
from .migrated_reviews import meeting_summary_field, render_sections
from .migrated_summary_binding import answer_version, binding_state, populate_answer, preserve_original
from .migrated_templates import serialize_template, snapshot_for, validate_managed_definition
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate
from .tests_migrated_completion import PNG


OWNER = "coach@example.invalid"
DEFINITION = {"sections": [{"key": "meeting", "title": "Meeting discussion", "order": 0, "fields": [
    {"key": "recap", "title": "Discussion record", "aptemType": 13, "order": 0, "semanticKey": "meeting_summary"},
    {"key": "other", "title": "Other answer", "aptemType": 1, "order": 1},
]}]}


class MigratedBindingValidationTests(SimpleTestCase):
    def test_only_two_text_types_accept_binding(self):
        for kind in (1, 13, 2, 4, 5, 6, 11, 99):
            with self.subTest(kind=kind):
                definition = deepcopy(DEFINITION)
                field = definition["sections"][0]["fields"][0]
                field.update(aptemType=kind, options=["Choice"] if kind == 5 else [])
                if kind in (1, 13):
                    self.assertEqual(validate_managed_definition(definition), definition)
                else:
                    with self.assertRaises(ValueError):
                        validate_managed_definition(definition)

    def test_zero_binding_and_labels_do_not_create_binding(self):
        definition = deepcopy(DEFINITION)
        field = definition["sections"][0]["fields"][0]
        field.pop("semanticKey")
        field["title"] = "AI Meeting Summary"
        validate_managed_definition(definition)
        self.assertIsNone(meeting_summary_field(definition))

    def test_unknown_semantics_are_rejected(self):
        for marker in ("AI_SUMMARY", "", None, 1):
            definition = deepcopy(DEFINITION)
            definition["sections"][0]["fields"][0]["semanticKey"] = marker
            with self.subTest(marker=marker), self.assertRaisesRegex(ValueError, "Unknown"):
                validate_managed_definition(definition)

    def test_duplicate_across_sections_and_conditional_binding_are_rejected_at_runtime_too(self):
        duplicate = deepcopy(DEFINITION)
        duplicate["sections"].append({"key": "two", "title": "Second", "fields": [
            {**deepcopy(DEFINITION["sections"][0]["fields"][0]), "key": "second"},
        ]})
        nested = deepcopy(DEFINITION)
        nested["sections"][0]["fields"] = [{"key": "gate", "title": "Condition", "aptemType": 6,
            "ifFalse": [deepcopy(DEFINITION["sections"][0]["fields"][0])]}]
        for definition, message in ((duplicate, "only one"), (nested, "conditional")):
            with self.subTest(message=message):
                for validator in (validate_managed_definition, meeting_summary_field):
                    with self.assertRaisesRegex(ValueError, message):
                        validator(definition)

    def test_renderer_forwards_metadata_and_keeps_authoritative_answer(self):
        sections, warnings = render_sections(DEFINITION, {"recap": "Coach answer"})
        self.assertFalse(warnings)
        self.assertEqual(sections[0]["fields"][0]["configuration"]["semanticKey"], "meeting_summary")
        self.assertEqual(sections[0]["fields"][0]["answer"], "Coach answer")

    def test_runtime_refuses_a_bound_key_duplicated_by_an_unbound_field(self):
        definition = deepcopy(DEFINITION)
        definition["sections"][0]["fields"][1]["key"] = "recap"
        with self.assertRaisesRegex(ValueError, "unique"):
            meeting_summary_field(definition)

    def test_edited_legacy_summary_is_not_misrepresented_as_original(self):
        state = {"summary": {"overview": "Previously edited"}, "summaryStatus": "edited", "editedAt": "old"}
        preserve_original(state)
        self.assertNotIn("aiSummaryOriginal", state)
        overlay = SimpleNamespace(template_snapshot=DEFINITION, meeting_intelligence=state, answers={}, status="in-progress")
        self.assertEqual(populate_answer(overlay, state, "")["status"], "summary-unavailable")
        self.assertEqual(overlay.answers, {})


class MigratedBindingFlowTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.template = MigratedReviewTemplate.objects.create(scope="GLOBAL", programme_key="", review_family="MCM",
            name="Synthetic MCM", definition_json=deepcopy(DEFINITION), is_active=True)
        self.overlay = ImportedReviewInstance.objects.create(event_key="imported-review:binding-test", owner_email=OWNER,
            learner_id=42, source_review_id=7001, migrated_template=self.template, template_snapshot=snapshot_for(self.template),
            status="in-progress", answers={"other": "Keep this answer"}, signature_requirements={"advisor": True, "participant": True})
        self.calendar = CoachCalendarEvent.objects.create(event_key=self.overlay.event_key, owner_email=OWNER, learner_id=42,
            event_type="mcr", target_date=date.today() - timedelta(days=1), scheduled_date=date.today() - timedelta(days=1),
            scheduled_time=time(10), duration_minutes=30, graph_event_id="synthetic", sync_state="synced", status="in-progress")
        self.definition = {"migratedForm": True, "readOnly": False, "instance": {"id": self.overlay.event_key, "learnerId": 42},
            "historicalReview": {"id": "7001", "type": "Monthly Coaching Meeting"}, "template": {"reviewTypeCode": "aptem_mcm"}}
        self.snapshot = {"artifacts": [], "attendanceReports": [], "attendanceTracker": {"tracker": []},
            "attendance": {"reports": [], "records": []}, "errors": [], "partial": False}

    def check(self, *, summary=None, transcript="Synthetic transcript", ai_error=None, during_fetch=None, snapshot=None):
        def fetch(_record):
            if during_fetch:
                during_fetch()
            return deepcopy(snapshot or self.snapshot), None, 200
        with patch.object(intelligence, "_coach_review", return_value=(OWNER, self.definition)), \
             patch.object(views, "fetch_coach_meeting_graph_snapshot", side_effect=fetch), \
             patch.object(views, "persist_coach_meeting_snapshots", return_value={"stored": True}), \
             patch.object(views, "stored_coach_meeting_snapshot", return_value=self.snapshot), \
             patch.object(views, "stored_coach_meeting_transcript_for_summary", return_value={"artifactId": "artifact-one", "text": transcript} if transcript else None), \
             patch.object(views, "openai_meeting_summary", side_effect=ai_error, return_value=(summary or {"overview": "Original AI facts"}, "test-model")) as ai:
            response = unwrap(intelligence.migrated_review_check_session)(self.factory.post("/"), self.overlay.event_key)
        self.overlay.refresh_from_db()
        return response, ai

    def save(self, answers, *, version=None, view=None, edited=None):
        payload = {"answers": answers, "answerVersion": version if version is not None else answer_version(self.overlay)}
        if edited is not None:
            payload["editedFields"] = edited
        request = self.factory.post("/", data=json.dumps(payload), content_type="application/json")
        request.coach_email = OWNER
        with patch.object(views, "_imported_review_definition", return_value=deepcopy(self.definition)):
            response = unwrap(view or views.coach_review_instance_answers)(request, self.overlay.event_key)
        self.overlay.refresh_from_db()
        return response

    def test_first_population_is_atomic_and_retains_provenance(self):
        before = deepcopy(self.overlay.template_snapshot)
        response, ai = self.check()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.overlay.answers, {"other": "Keep this answer", "recap": "Original AI facts"})
        state = self.overlay.meeting_intelligence
        self.assertEqual(state["aiSummaryOriginal"], {"overview": "Original AI facts"})
        self.assertEqual(state["aiSummaryProvenance"]["transcriptArtifactId"], "artifact-one")
        self.assertEqual(state["aiSummaryProvenance"]["transcriptHash"], state["transcriptHash"])
        self.assertEqual(state["aiSummaryProvenance"]["model"], "test-model")
        self.assertEqual(state["aiSummaryProvenance"]["generatedAt"], state["generatedAt"])
        self.assertEqual(state["summaryBinding"]["state"], "AI_POPULATED_UNEDITED")
        self.assertEqual(json.loads(response.content)["answerVersion"], answer_version(self.overlay))
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertEqual(self.overlay.status, "in-progress")
        ai.assert_called_once()

    def test_zero_binding_old_snapshot_is_not_retrofitted(self):
        self.overlay.template_snapshot["sections"][0]["fields"][0].pop("semanticKey")
        self.overlay.save()
        before = deepcopy(self.overlay.template_snapshot)
        response, _ = self.check()
        self.assertEqual(json.loads(response.content)["summaryBinding"]["status"], "no-binding")
        self.assertEqual(self.overlay.answers, {"other": "Keep this answer"})
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertEqual(json.loads(response.content)["answerVersion"], answer_version(self.overlay))
        self.assertEqual(json.loads(response.content)["reviewAnswers"], self.overlay.answers)

    def test_unbound_summary_save_returns_the_new_form_version(self):
        self.template.definition_json["sections"][0]["fields"][0].pop("semanticKey")
        self.template.save()
        self.overlay.template_snapshot = snapshot_for(self.template)
        self.overlay.meeting_intelligence = {"summary": {"overview": "Original"}, "summaryStatus": "ready"}
        self.overlay.save()
        before = answer_version(self.overlay)
        request = self.factory.patch("/", data=json.dumps({"summary": {"overview": "Coach revision"}}), content_type="application/json")
        request.login_account = SimpleNamespace(email=OWNER)
        with patch.object(intelligence, "_coach_review", return_value=(OWNER, self.definition)):
            response = unwrap(intelligence.migrated_review_summary)(request, self.overlay.event_key)
        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        data = json.loads(response.content)
        self.assertNotEqual(data["answerVersion"], before)
        self.assertEqual(data["answerVersion"], answer_version(self.overlay))
        self.assertEqual(data["reviewAnswers"], self.overlay.answers)
        self.assertEqual(self.save({"other": "Next answer"}, version=data["answerVersion"]).status_code, 200)

    def test_manual_edit_and_clear_preserve_original_on_repeated_and_new_transcript_checks(self):
        self.check()
        original = deepcopy(self.overlay.meeting_intelligence["aiSummaryProvenance"])
        for text, state in (("Coach's authoritative words", "COACH_EDITED"), ("", "COACH_CLEARED")):
            with self.subTest(state=state):
                self.assertEqual(self.save({"other": "Keep this answer", "recap": text}).status_code, 200)
                response, ai = self.check(transcript="Additional transcript segment")
                ai.assert_not_called()
                self.assertEqual(self.overlay.answers["recap"], text)
                self.assertEqual(self.overlay.meeting_intelligence["summaryBinding"]["state"], state)
                self.assertEqual(self.overlay.meeting_intelligence["aiSummaryOriginal"]["overview"], "Original AI facts")
                self.assertEqual(self.overlay.meeting_intelligence["aiSummaryProvenance"], original)
                self.assertEqual(self.overlay.meeting_intelligence["summaryBinding"]["editedBy"], OWNER)
                self.assertEqual(json.loads(response.content)["summaryBinding"]["status"], "answer-preserved")

    def test_untouched_ai_answer_is_never_replaced_on_rerun(self):
        self.check()
        response, ai = self.check(transcript="New segment")
        ai.assert_not_called()
        self.assertEqual(self.overlay.answers["recap"], "Original AI facts")
        self.assertEqual(json.loads(response.content)["summaryBinding"]["state"], "AI_POPULATED_UNEDITED")

    def test_clear_before_first_generation_and_touch_then_restore_are_manual(self):
        self.assertEqual(self.save({"other": "Keep", "recap": ""}).status_code, 200)
        self.check()
        self.assertEqual(self.overlay.answers["recap"], "")
        self.assertEqual(binding_state(self.overlay)["state"], "COACH_CLEARED")
        self.save({"other": "Keep", "recap": "Manual"})
        self.assertEqual(self.save(self.overlay.answers, edited=["recap"]).status_code, 200)
        self.assertEqual(binding_state(self.overlay)["state"], "COACH_EDITED")

    def test_preexisting_empty_key_without_provenance_is_preserved(self):
        self.overlay.answers["recap"] = ""
        self.overlay.save()
        self.check()
        self.assertEqual(self.overlay.answers["recap"], "")
        self.assertEqual(binding_state(self.overlay)["state"], "COACH_CLEARED")

    def test_overflow_retains_full_original_and_returns_manual_shortening_text(self):
        text = "X" * 4001
        response, _ = self.check(summary={"overview": text})
        binding = json.loads(response.content)["summaryBinding"]
        self.assertEqual(binding["status"], "summary-too-long")
        self.assertEqual(binding["suggestionText"], text)
        self.assertNotIn("recap", self.overlay.answers)
        self.assertEqual(self.overlay.meeting_intelligence["aiSummaryOriginal"]["overview"], text)
        self.assertEqual(self.save({**self.overlay.answers, "recap": "Shortened manually"}).status_code, 200)

    def test_exact_limit_populates(self):
        self.check(summary={"overview": "X" * 4000})
        self.assertEqual(len(self.overlay.answers["recap"]), 4000)

    def test_ai_failure_and_no_transcript_preserve_answers_and_allow_manual_required_completion(self):
        # The required rule belongs to the effective template as well as the
        # working snapshot now that submission revalidates its definition.
        self.template.definition_json["sections"][0]["fields"][0]["mandatory"] = True
        self.template.save()
        self.overlay.template_snapshot["sections"][0]["fields"][0]["mandatory"] = True
        self.overlay.save()
        response, _ = self.check(ai_error=RuntimeError("synthetic"))
        self.assertEqual(json.loads(response.content)["intelligence"]["summaryStatus"], "failed")
        self.assertEqual(self.overlay.answers, {"other": "Keep this answer"})
        response, ai = self.check(transcript=None)
        ai.assert_not_called()
        self.assertNotIn("recap", self.overlay.answers)
        self.assertEqual(self.save({"recap": "Manual required answer"}, view=lifecycle.migrated_review_submit).status_code, 200)
        self.assertEqual(self.overlay.status, "awaiting-signature")

    def test_transcript_error_preserves_existing_answer(self):
        self.save({"recap": "Coach answer"})
        snapshot = {**self.snapshot, "errors": ["Failed to get transcripts"], "artifacts": [
            {"artifact_type": "transcript", "transcript_fetch_error": "unavailable"}]}
        response, ai = self.check(snapshot=snapshot, transcript=None)
        self.assertEqual(response.status_code, 207)
        ai.assert_not_called()
        self.assertEqual(self.overlay.answers["recap"], "Coach answer")

    def test_no_transcript_does_not_populate_even_if_old_summary_is_stored(self):
        self.overlay.meeting_intelligence = {"summary": {"overview": "Earlier AI output"}, "summaryStatus": "ready"}
        self.overlay.save()
        response, ai = self.check(transcript=None)
        ai.assert_not_called()
        self.assertNotIn("recap", self.overlay.answers)
        self.assertEqual(json.loads(response.content)["summaryBinding"]["status"], "summary-unavailable")
        self.assertEqual(self.overlay.meeting_intelligence["aiSummaryOriginal"]["overview"], "Earlier AI output")

    def test_stale_save_and_both_submit_routes_cannot_erase_check_session_answer(self):
        stale = answer_version(self.overlay)
        self.check()
        for view in (views.coach_review_instance_answers, lifecycle.migrated_review_submit, views.coach_review_instance_complete):
            with self.subTest(view=view.__name__):
                response = self.save({"other": "Old form"}, version=stale, view=view)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(json.loads(response.content)["code"], "ANSWER_CONFLICT")
                self.assertEqual(self.overlay.answers["recap"], "Original AI facts")
                self.assertEqual(self.overlay.status, "in-progress")

    def test_missing_version_is_rejected_for_bound_writes(self):
        self.assertEqual(self.save({"recap": "Unsafe"}, version="").status_code, 409)

    def test_invalid_submit_answers_return_validation_error_without_changes(self):
        for view in (lifecycle.migrated_review_submit, views.coach_review_instance_complete):
            for answers in (None, [], "invalid"):
                with self.subTest(view=view.__name__, answers=answers):
                    self.assertEqual(self.save(answers, view=view).status_code, 400)
                    self.assertEqual(self.overlay.answers, {"other": "Keep this answer"})
                    self.assertEqual(self.overlay.status, "in-progress")

    def test_check_loads_latest_other_fields_under_lock(self):
        def save_during_graph():
            self.assertEqual(self.save({"other": "Newer coach answer"}).status_code, 200)
        self.check(during_fetch=save_during_graph)
        self.assertEqual(self.overlay.answers, {"other": "Newer coach answer", "recap": "Original AI facts"})

    def test_late_check_does_not_overwrite_coach_edit(self):
        self.check(during_fetch=lambda: self.save({"recap": "Written while Graph fetched", "other": "Keep"}))
        self.assertEqual(self.overlay.answers["recap"], "Written while Graph fetched")

    def test_submit_or_completion_winning_race_prevents_late_intelligence_write(self):
        for status in ("awaiting-signature", "completed"):
            self.overlay.status = "in-progress"
            self.overlay.save()
            def freeze():
                ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(status=status, answers={"recap": "Frozen content"})
            response, ai = self.check(during_fetch=freeze)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.overlay.answers, {"recap": "Frozen content"})
            ai.assert_not_called()

    def test_noneditable_stages_never_fetch_graph(self):
        for status in ("awaiting-signature", "completed", "not-scheduled"):
            self.overlay.status = status
            self.overlay.save()
            response, ai = self.check()
            self.assertEqual(response.status_code, 409)
            ai.assert_not_called()

    def test_bad_associations_and_changed_ownership_cannot_populate(self):
        for values in ({"event_type": "live-session"}, {"learner_id": 99}, {"owner_email": "other@example.invalid"}, {"review_instance_id": "native"}):
            with self.subTest(values=values):
                original = {key: getattr(self.calendar, key) for key in values}
                CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(**values)
                response, ai = self.check()
                self.assertEqual(response.status_code, 409)
                ai.assert_not_called()
                CoachCalendarEvent.objects.filter(pk=self.calendar.pk).update(**original)
        response, ai = self.check(during_fetch=lambda: ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(owner_email="new@example.invalid"))
        self.assertEqual(response.status_code, 409)
        ai.assert_not_called()
        self.assertNotIn("recap", self.overlay.answers)

    def test_no_cross_review_write(self):
        other = ImportedReviewInstance.objects.create(event_key="imported-review:other", owner_email=OWNER, learner_id=43,
            template_snapshot=deepcopy(DEFINITION), answers={"recap": "Different learner"})
        self.check()
        other.refresh_from_db()
        self.assertEqual(other.answers, {"recap": "Different learner"})
        self.assertEqual(other.meeting_intelligence, {})

    def test_summary_patch_is_not_a_second_editor_for_bound_reviews(self):
        self.check()
        request = self.factory.patch("/", data=json.dumps({"summary": {"overview": "Other editor"}}), content_type="application/json")
        with patch.object(intelligence, "_coach_review", return_value=(OWNER, self.definition)):
            response = unwrap(intelligence.migrated_review_summary)(request, self.overlay.event_key)
        self.assertEqual(response.status_code, 409)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.meeting_intelligence["aiSummaryOriginal"]["overview"], "Original AI facts")

    def test_unbound_legacy_summary_edit_preserves_original_with_provenance(self):
        self.overlay.template_snapshot["sections"][0]["fields"][0].pop("semanticKey")
        self.overlay.meeting_intelligence = {"summary": {"overview": "Legacy AI original"}, "summaryStatus": "ready",
            "generatedAt": "2026-01-01T00:00:00Z", "model": "legacy-model", "transcriptHash": "legacy-hash", "transcriptArtifactId": "legacy-id"}
        self.overlay.save()
        request = self.factory.patch("/", data=json.dumps({"summary": {"overview": "Edited legacy recap"}}), content_type="application/json")
        request.login_account = SimpleNamespace(email=OWNER)
        with patch.object(intelligence, "_coach_review", return_value=(OWNER, self.definition)):
            response = unwrap(intelligence.migrated_review_summary)(request, self.overlay.event_key)
        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.meeting_intelligence["aiSummaryOriginal"]["overview"], "Legacy AI original")
        self.assertEqual(self.overlay.meeting_intelligence["aiSummaryProvenance"]["transcriptHash"], "legacy-hash")
        self.assertEqual(self.overlay.meeting_intelligence["summary"]["overview"], "Edited legacy recap")

    def test_database_serializer_copy_and_initialization_keep_binding_and_independence(self):
        from . import migrated_template_views as templates
        self.assertEqual(serialize_template(self.template, definition=True)["definition"], DEFINITION)
        request = self.factory.post("/", data=json.dumps({"scope": "PROGRAMME", "programme_key": "id:SYNTHETIC", "review_family": "MCM", "name": "Custom"}), content_type="application/json")
        response = unwrap(templates.collection)(request)
        self.assertEqual(response.status_code, 201)
        custom = MigratedReviewTemplate.objects.get(pk=json.loads(response.content)["id"])
        self.assertEqual(custom.definition_json, DEFINITION)
        source = {**self.definition, "canInitialize": True, "readOnly": True, "sourceStatus": "scheduled", "migratedProgrammeKey": None,
                  "historicalReview": {"id": "7002", "type": "Monthly Coaching Meeting"}, "instance": {"id": "imported-review:new", "learnerId": 42}}
        request = self.factory.post("/")
        request.coach_email = OWNER
        with patch.object(views, "_imported_review_definition", return_value=source):
            self.assertEqual(unwrap(views.coach_review_instance_initialize)(request, source["instance"]["id"]).status_code, 200)
        initialized = ImportedReviewInstance.objects.get(source_review_id=7002)
        frozen = deepcopy(initialized.template_snapshot)
        self.template.definition_json["sections"][0]["fields"][0].pop("semanticKey")
        self.template.is_active = False
        self.template.save()
        initialized.refresh_from_db()
        custom.refresh_from_db()
        self.assertEqual(initialized.template_snapshot, frozen)
        self.assertEqual(meeting_summary_field(frozen)["key"], "recap")
        self.assertEqual(custom.definition_json, DEFINITION)

    def test_pdf_uses_saved_answer_once_and_existing_pdf_is_not_regenerated(self):
        self.check()
        self.save({"recap": "FINAL COACH WORDING", "other": "Other context"})
        self.overlay.status = "completed"
        self.overlay.completed_at = timezone.now()
        signatures = [SimpleNamespace(role=role, signer_name="Synthetic signer", signed_at=timezone.now(), signature=PNG) for role in ("advisor", "participant")]
        with patch.object(type(self.overlay), "migrated_signatures") as relation:
            relation.all.return_value = signatures
            content = build_pdf(self.overlay, learner_name="Synthetic", learner_email="example@example.invalid", programme="Synthetic programme", scheduled_date="2026-01-01", coach_name="Coach")
        text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        self.assertEqual(text.count("FINAL COACH WORDING"), 1)
        self.assertNotIn("Original AI facts", text)
        saved = object()
        with patch("coach_api.migrated_completion.MigratedReviewDocument.objects.filter") as lookup, patch("coach_api.migrated_completion.build_pdf") as build:
            lookup.return_value.first.return_value = saved
            self.assertIs(ensure_document(self.overlay), saved)
            build.assert_not_called()

    def test_party_views_get_saved_answer_without_intelligence(self):
        self.overlay.answers = {"recap": "Saved final summary"}
        sections, _ = render_sections(self.overlay.template_snapshot, self.overlay.answers)
        for role in ("learner", "employer"):
            definition = {**self.definition, "sections": sections, "summaryBinding": {"state": "COACH_EDITED", "editedBy": OWNER}, "answerVersion": "private"}
            with patch.object(lifecycle, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                 patch.object(lifecycle, "_party_overlay", return_value=self.overlay), \
                 patch.object(views, "_imported_review_definition", return_value=definition):
                response = lifecycle.migrated_review_party_detail(self.factory.get("/"), self.overlay.event_key)
            data = json.loads(response.content)
            self.assertTrue(data["readOnly"])
            self.assertEqual(data["sections"][0]["fields"][0]["answer"], "Saved final summary")
            self.assertNotIn("summaryBinding", data)
            self.assertNotIn("answerVersion", data)

    def test_learner_and_employer_cannot_write_any_summary_boundary(self):
        for role in ("learner", "employer"):
            account = SimpleNamespace(role=role, subject_type=role, subject_id=42)
            with patch("login.permissions.authenticate_request", return_value=account), patch("login.permissions._accesses_of", return_value=frozenset()):
                for view in (intelligence.migrated_review_check_session, intelligence.migrated_review_summary,
                             views.coach_review_instance_answers, lifecycle.migrated_review_submit):
                    self.assertEqual(view(self.factory.post("/"), self.overlay.event_key).status_code, 403)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers, {"other": "Keep this answer"})
