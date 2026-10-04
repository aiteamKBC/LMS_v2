"""Synthetic working-definition regressions; no external services/source writes."""
from copy import deepcopy
from datetime import date, time
from inspect import unwrap
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import transaction
from django.test import RequestFactory, SimpleTestCase, TestCase
from pypdf import PdfReader

from . import migrated_completion_views as lifecycle, views
from .migrated_completion import build_pdf, complete, sign
from .migrated_reviews import all_fields, render_sections, validate_answers
from .migrated_summary_binding import answer_version
from .migrated_template_sync import (
    TemplateSyncConflict, active_answers, merge_snapshot, preserve_inactive_answers,
    snapshot_fingerprint, synchronize_locked, synchronize_on_open,
)
from .migrated_templates import snapshot_for
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate
from .tests_migrated_completion import PNG


OWNER = "sync-coach@example.invalid"
SOURCE_TYPES = {"MCM": "Monthly Coaching Meeting", "PR": "Progress Review", "PR_SKILLS_RADAR": "Progress Review (+ Skills Radar)"}


def field(key, kind=1, **extra):
    return {"key": key, "title": key.title(), "aptemType": kind, **extra}


def form(*fields):
    return {"sections": [{"key": "discussion", "title": "Discussion", "order": 0, "fields": list(fields or [field("note")])}]}


class DefinitionMergeTests(SimpleTestCase):
    def template(self, definition, family="MCM"):
        return SimpleNamespace(pk=1, scope="GLOBAL", programme_key="", name="Synthetic form", review_family=family, definition_json=definition)

    def test_reordered_and_moved_fields_keep_typed_answers_and_latest_metadata(self):
        old = form(field("text"), field("long", 13), field("boolean", 2), field("date", 4), field("choice", 5, options=["A", "B"]))
        answers = {"text": "Saved words", "long": "Saved paragraph", "boolean": "yes", "date": "2026-10-04", "choice": "B"}
        new = {"sections": [
            {"key": "new-section", "title": "New section", "order": 0, "fields": [field("date", 4), field("long", 13)]},
            {"key": "discussion", "title": "Renamed section", "order": 1, "fields": [field("choice", 5, options=["B", "C"]), field("boolean", 2), field("text", title="Renamed question", description="New help", mandatory=True)]},
        ]}
        before = deepcopy(answers)
        result = merge_snapshot(snapshot_for(self.template(old)), answers, self.template(new), "MCM")
        self.assertEqual(result["sections"], new["sections"])
        self.assertEqual(active_answers(result, answers), before)
        self.assertEqual(answers, before)
        validate_answers(result, active_answers(result, answers), completing=True)

    def test_equal_labels_or_positions_never_match_rekeyed_fields(self):
        old = snapshot_for(self.template(form(field("old", title="Identical label"))))
        result = merge_snapshot(old, {"old": "Original answer"}, self.template(form(field("new", title="Identical label"))), "MCM")
        self.assertEqual(active_answers(result, {"old": "Original answer"}), {})
        self.assertIn("old", result["templateSync"]["retiredFields"])

    def test_new_required_field_is_blank_and_enforced(self):
        old = snapshot_for(self.template(form(field("note"))))
        result = merge_snapshot(old, {"note": "Existing"}, self.template(form(field("note"), field("new", mandatory=True))), "MCM")
        self.assertEqual(active_answers(result, {"note": "Existing"}), {"note": "Existing"})
        with self.assertRaisesRegex(ValueError, "Required"):
            validate_answers(result, {"note": "Existing"}, completing=True)
        validate_answers(result, {"note": "Existing", "new": "Now answered"}, completing=True)

    def test_removed_required_and_empty_fields_no_longer_validate_or_render(self):
        old = snapshot_for(self.template(form(field("old", mandatory=True), field("empty"), field("note"))))
        answers = {"old": "Retain internally", "note": "Visible"}
        result = merge_snapshot(old, answers, self.template(form(field("note"))), "MCM")
        sections, _ = render_sections(result, active_answers(result, answers))
        self.assertEqual([f["id"] for f in sections[0]["fields"]], ["note"])
        validate_answers(result, active_answers(result, answers), completing=True)
        self.assertEqual(preserve_inactive_answers(result, answers, {"note": "Edited"}), {"old": "Retain internally", "note": "Edited"})

    def test_conditional_move_preserves_hidden_work_without_accepting_hidden_payloads(self):
        old = snapshot_for(self.template(form(field("detail"), field("gate", 6))))
        latest = form(field("gate", 6, ifTrue=[field("detail", mandatory=True)]))
        answers = {"detail": "Previously visible", "gate": "no"}
        result = merge_snapshot(old, answers, self.template(latest), "MCM")
        self.assertEqual(active_answers(result, answers), {"gate": "no"})
        with self.assertRaisesRegex(ValueError, "hidden"):
            validate_answers(result, answers)
        retained = preserve_inactive_answers(result, answers, {"gate": "no"})
        self.assertEqual(retained["detail"], "Previously visible")
        self.assertEqual(active_answers(result, {**retained, "gate": "yes"})["detail"], "Previously visible")

    def test_text_multiline_changes_preserve_exact_value_in_both_directions(self):
        for before, after in ((1, 13), (13, 1)):
            with self.subTest(before=before):
                result = merge_snapshot(snapshot_for(self.template(form(field("note", before)))), {"note": "Exact\nwords"}, self.template(form(field("note", after))), "MCM")
                self.assertEqual(active_answers(result, {"note": "Exact\nwords"}), {"note": "Exact\nwords"})

    def test_incompatible_answered_types_and_options_reject_whole_merge(self):
        for before, answer, after in (
            (field("note"), "yes", field("note", 2)),
            (field("note", 4), "2026-10-04", field("note", 5, options=["2026-10-04"])),
            (field("note", 5, options=["A", "B"]), "B", field("note", 5, options=["A"])),
            (field("note"), "Some text", field("note", 11)),
        ):
            with self.subTest(before=before["aptemType"], after=after["aptemType"]):
                previous = snapshot_for(self.template(form(before)))
                original = deepcopy(previous)
                answers = {"note": answer}
                with self.assertRaises(TemplateSyncConflict) as error:
                    merge_snapshot(previous, answers, self.template(form(after)), "MCM")
                self.assertEqual(error.exception.fields, ["note"])
                self.assertEqual(previous, original)
                self.assertEqual(answers, {"note": answer})

    def test_type_change_without_value_does_not_invent_or_coerce_answer(self):
        for answers in ({}, {"note": ""}, {"note": None}):
            with self.subTest(answers=answers):
                previous = snapshot_for(self.template(form(field("note"))))
                result = merge_snapshot(previous, answers, self.template(form(field("note", 2))), "MCM")
                self.assertEqual(active_answers(result, answers), answers)

    def test_removed_and_reintroduced_identity_checks_original_type(self):
        previous = snapshot_for(self.template(form(field("old"), field("note"))))
        answers = {"old": "Saved value"}
        removed = merge_snapshot(previous, answers, self.template(form(field("note"))), "MCM")
        restored = merge_snapshot(removed, answers, self.template(form(field("old", 13))), "MCM")
        self.assertEqual(active_answers(restored, answers), answers)
        with self.assertRaises(TemplateSyncConflict):
            merge_snapshot(removed, answers, self.template(form(field("old", 2))), "MCM")

    def test_unidentified_retained_answer_is_never_assigned_to_new_field(self):
        with self.assertRaises(TemplateSyncConflict):
            merge_snapshot(snapshot_for(self.template(form(field("note")))), {"unknown": "Old value"}, self.template(form(field("unknown"))), "MCM")

    def test_binding_same_moved_removed_and_new_never_copies_coach_words(self):
        for answer in ("Coach edited summary", ""):
            for kind in ("same", "move", "remove", "new"):
                with self.subTest(answer=answer, kind=kind):
                    old = form(field("recap", 13, semanticKey="meeting_summary"), field("note"))
                    new = deepcopy(old)
                    if kind != "same":
                        new["sections"][0]["fields"][0].pop("semanticKey")
                    if kind in {"move", "new"}:
                        new["sections"][0]["fields"].append(field("new-recap", 13, semanticKey="meeting_summary"))
                    if kind in {"remove", "new"}:
                        new["sections"][0]["fields"].pop(0)
                    answers = {"recap": answer}
                    result = merge_snapshot(snapshot_for(self.template(old)), answers, self.template(new), "MCM")
                    self.assertEqual(answers, {"recap": answer})
                    self.assertNotIn("new-recap", active_answers(result, answers))

    def test_duplicate_binding_or_field_keys_and_invalid_master_fail_closed(self):
        for invalid in (
            form(field("a", semanticKey="meeting_summary"), field("b", semanticKey="meeting_summary")),
            form(field("a"), field("a")), {"sections": []},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(TemplateSyncConflict):
                merge_snapshot(snapshot_for(self.template(form())), {}, self.template(invalid), "MCM")

    def test_family_mismatch_fails_for_all_three_families(self):
        for family in SOURCE_TYPES:
            for wrong in set(SOURCE_TYPES) - {family}:
                with self.subTest(family=family, wrong=wrong), self.assertRaises(TemplateSyncConflict):
                    merge_snapshot(snapshot_for(self.template(form(), family)), {}, self.template(form(), wrong), family)

    def test_fingerprint_is_stable_across_json_key_order_and_bookkeeping(self):
        snapshot = snapshot_for(self.template(form()))
        copied = json.loads(json.dumps(snapshot, sort_keys=True))
        copied["templateSync"] = {"synchronizedAt": "later", "retiredFields": {"old": field("old")}}
        self.assertEqual(snapshot_fingerprint(snapshot), snapshot_fingerprint(copied))
        copied["sections"][0]["fields"][0]["title"] = "New title"
        self.assertNotEqual(snapshot_fingerprint(snapshot), snapshot_fingerprint(copied))


class WorkingSnapshotTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.template = MigratedReviewTemplate.objects.create(scope="GLOBAL", programme_key="", review_family="MCM",
            name="Synthetic MCM", definition_json=form(), is_active=True)
        self.overlay = ImportedReviewInstance.objects.create(event_key="imported-review:sync-test", owner_email=OWNER,
            learner_id=42, source_review_id=7001, migrated_template=self.template, template_snapshot=snapshot_for(self.template),
            status="in-progress", answers={"note": "Saved answer"}, progress_snapshot={"unchanged": [1, 2, 3]},
            meeting_intelligence={"aiSummaryOriginal": {"overview": "Original"}, "summaryStatus": "edited", "transcriptArtifactId": "synthetic"})
        self.definition = {"migratedForm": True, "readOnly": False, "localStatus": "in-progress", "migratedProgrammeKey": "id:synthetic",
            "instance": {"id": self.overlay.event_key, "learnerId": 42}, "historicalReview": {"id": "7001", "type": SOURCE_TYPES["MCM"]}}

    def edit(self, definition=None):
        self.template.definition_json = definition or form(field("note", title="Updated label"), field("new"))
        self.template.save(update_fields=["definition_json", "updated_at"])

    def sync(self):
        with transaction.atomic():
            locked = ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)
            changed = synchronize_locked(locked, self.template.review_family, "id:synthetic")
        self.overlay.refresh_from_db()
        return changed

    def request(self, view=views.coach_review_instance_answers, answers=None, version=None):
        payload = {"answers": self.overlay.answers if answers is None else answers,
                   "answerVersion": answer_version(self.overlay) if version is None else version}
        request = self.factory.post("/", data=json.dumps(payload), content_type="application/json")
        request.coach_email = OWNER
        with patch.object(views, "_imported_review_definition", return_value=deepcopy(self.definition)):
            response = unwrap(view)(request, self.overlay.event_key)
        self.overlay.refresh_from_db()
        return response

    def test_each_editable_status_and_family_gets_new_questions_without_other_state_changes(self):
        for family in SOURCE_TYPES:
            self.template.review_family = family
            self.template.save()
            for status in ("not-scheduled", "scheduled", "in-progress"):
                with self.subTest(family=family, status=status):
                    self.template.definition_json = form()
                    self.template.save()
                    self.overlay.template_snapshot = snapshot_for(self.template)
                    self.overlay.status = status
                    self.overlay.save()
                    before = (deepcopy(self.overlay.answers), deepcopy(self.overlay.progress_snapshot), deepcopy(self.overlay.meeting_intelligence))
                    self.edit()
                    self.assertTrue(self.sync())
                    self.assertEqual([f["key"] for f in all_fields(self.overlay.template_snapshot)], ["note", "new"])
                    self.assertEqual((self.overlay.answers, self.overlay.progress_snapshot, self.overlay.meeting_intelligence), before)

    def test_no_change_does_not_rewrite_snapshot_or_advance_version(self):
        before, version = deepcopy(self.overlay.template_snapshot), answer_version(self.overlay)
        self.assertFalse(self.sync())
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertEqual(answer_version(self.overlay), version)

    def test_override_activation_then_deactivation_tracks_latest_effective_definition(self):
        override = MigratedReviewTemplate.objects.create(scope="PROGRAMME", programme_key="id:synthetic", review_family="MCM",
            name="Synthetic override", definition_json=form(field("note", title="Programme note")), is_active=True)
        self.assertTrue(self.sync())
        self.assertEqual(self.overlay.migrated_template_id, override.pk)
        self.assertEqual(self.overlay.answers, {"note": "Saved answer"})
        override.is_active = False
        override.save()
        self.edit()
        self.assertTrue(self.sync())
        self.assertEqual(self.overlay.migrated_template_id, self.template.pk)
        self.assertEqual(self.overlay.template_snapshot["sections"], self.template.definition_json["sections"])

    def test_other_programme_and_family_do_not_change_resolution(self):
        for key, family in (("id:other", "MCM"), ("id:synthetic", "PR"), ("id:synthetic", "PR_SKILLS_RADAR")):
            MigratedReviewTemplate.objects.create(scope="PROGRAMME", programme_key=key, review_family=family,
                name="Other form", definition_json=form(field("foreign")), is_active=True)
        self.assertFalse(self.sync())

    def test_opening_one_review_does_not_bulk_sync_another_learner(self):
        other = ImportedReviewInstance.objects.create(event_key="imported-review:other-sync-test", owner_email=OWNER,
            learner_id=43, source_review_id=7002, migrated_template=self.template, template_snapshot=snapshot_for(self.template),
            status="in-progress", answers={"note": "Other learner"})
        before = deepcopy(other.template_snapshot)
        self.edit()
        self.sync()
        other.refresh_from_db()
        self.assertEqual(other.template_snapshot, before)
        self.assertEqual(other.answers, {"note": "Other learner"})

    def test_start_revalidates_working_definition_without_changing_the_meeting(self):
        self.overlay.status = "scheduled"
        self.overlay.save()
        meeting = CoachCalendarEvent.objects.create(event_key=self.overlay.event_key, owner_email=OWNER, learner_id=42,
            event_type="mcr", target_date=date(2026, 10, 4), scheduled_date=date(2026, 10, 4), scheduled_time=time(10),
            graph_event_id="synthetic-event", meeting_link="https://example.invalid/meeting", sync_state="synced", status="scheduled")
        self.edit()
        request = self.factory.post("/", data=json.dumps({"status": "in-progress"}), content_type="application/json")
        request.coach_email = OWNER
        with patch.object(views, "_imported_review_definition", return_value=deepcopy(self.definition)), \
             patch.object(views, "sync_calendar_event_to_graph") as graph:
            response = unwrap(views.coach_review_instance_local_status)(request, self.overlay.event_key)
        self.assertEqual(response.status_code, 200)
        graph.assert_not_called()
        self.overlay.refresh_from_db()
        meeting.refresh_from_db()
        self.assertEqual(self.overlay.status, "in-progress")
        self.assertIn("new", [f["key"] for f in all_fields(self.overlay.template_snapshot)])
        self.assertEqual(meeting.graph_event_id, "synthetic-event")
        self.assertEqual(meeting.meeting_link, "https://example.invalid/meeting")

    def test_missing_master_is_safe_conflict_without_any_overlay_write(self):
        before = deepcopy(self.overlay.template_snapshot)
        self.template.is_active = False
        self.template.save()
        with self.assertRaises(TemplateSyncConflict):
            self.sync()
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertEqual(self.overlay.answers, {"note": "Saved answer"})

    def test_save_discovers_template_update_preserves_saved_work_and_rejects_stale_retry(self):
        stale = answer_version(self.overlay)
        self.edit()
        response = self.request(answers={"note": "Unsaved local wording"}, version=stale)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "template_sync_changed")
        self.assertEqual(self.overlay.answers, {"note": "Saved answer"})
        self.assertEqual(self.request(answers={"note": "Old tab"}, version=stale).status_code, 409)
        self.assertEqual(self.request(answers={"note": "Current tab", "new": "New answer"}).status_code, 200)

    def test_version_required_on_unbound_working_forms(self):
        self.assertEqual(self.request(version="").status_code, 409)
        self.overlay.template_snapshot.pop("templateSync")
        self.overlay.save()
        self.assertEqual(self.request(version="").status_code, 409)

    def test_submit_final_sync_requires_review_of_latest_fields_then_validates_and_freezes(self):
        self.edit(form(field("note"), field("new", mandatory=True)))
        self.assertEqual(self.request(lifecycle.migrated_review_submit).status_code, 409)
        self.assertEqual(self.overlay.status, "in-progress")
        self.assertEqual(self.request(lifecycle.migrated_review_submit).status_code, 400)
        self.assertEqual(self.request(lifecycle.migrated_review_submit, {"note": "Saved answer", "new": "Confirmed"}).status_code, 200)
        self.assertEqual(self.overlay.status, "awaiting-signature")
        frozen = deepcopy(self.overlay.template_snapshot)
        self.edit(form(field("later")))
        self.assertFalse(self.sync())
        self.assertEqual(self.overlay.template_snapshot, frozen)

    def test_unsafe_type_change_blocks_open_and_submit_without_losing_answer(self):
        before = deepcopy(self.overlay.template_snapshot)
        self.edit(form(field("note", 2)))
        with patch.object(views, "_imported_review_definition", return_value=deepcopy(self.definition)):
            result = synchronize_on_open(OWNER, self.overlay.event_key, self.definition)
        self.assertEqual(result["templateSync"]["status"], "conflict")
        self.assertEqual(result["templateSync"]["fields"], ["note"])
        self.assertTrue(result["readOnly"])
        self.assertFalse(result["canCalculateProgress"])
        self.assertEqual(self.request(lifecycle.migrated_review_submit).status_code, 409)
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertEqual(self.overlay.answers, {"note": "Saved answer"})

    def test_assigned_coach_open_syncs_and_returns_new_version(self):
        self.edit()
        stale = answer_version(self.overlay)
        with patch.object(views, "_imported_review_definition", return_value=deepcopy(self.definition)):
            result = synchronize_on_open(OWNER, self.overlay.event_key, self.definition)
        self.overlay.refresh_from_db()
        self.assertTrue(result["templateSync"]["upToDate"])
        self.assertNotEqual(answer_version(self.overlay), stale)
        self.assertIn("new", [f["key"] for f in all_fields(self.overlay.template_snapshot)])

    def test_awaiting_signature_and_completed_do_not_even_resolve_master(self):
        for status in ("awaiting-signature", "completed"):
            with self.subTest(status=status):
                self.overlay.status = status
                self.overlay.save()
                before = deepcopy(self.overlay.template_snapshot)
                self.edit()
                with patch("coach_api.migrated_template_sync.resolve_template", side_effect=AssertionError("Frozen template lookup")):
                    self.assertFalse(self.sync())
                self.assertEqual(self.overlay.template_snapshot, before)

    def test_removed_answers_survive_save_submit_signature_completion_and_are_excluded_from_pdf(self):
        self.edit(form(field("new", mandatory=True)))
        self.sync()
        self.assertEqual(self.request(answers={"new": "New final answer"}).status_code, 200)
        self.assertEqual(self.overlay.answers["note"], "Saved answer")
        self.assertEqual(self.request(lifecycle.migrated_review_submit, {"new": "New final answer"}).status_code, 200)
        for role in ("advisor", "participant"):
            sign(self.overlay, role, account=SimpleNamespace(pk=-1, display_name="Synthetic signer", email=OWNER), signature=PNG)
        complete(self.overlay)
        frozen = deepcopy(self.overlay.template_snapshot)
        self.edit(form(field("future")))
        with patch("coach_api.migrated_template_sync.resolve_template", side_effect=AssertionError("PDF master lookup")):
            content = build_pdf(self.overlay, learner_name="Synthetic learner", learner_email="learner@example.invalid",
                programme="Synthetic programme", scheduled_date="2026-10-04", coach_name="Synthetic coach")
        text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        self.assertIn("New final answer", text)
        self.assertNotIn("Saved answer", text)
        self.assertNotIn("Future", text)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers["note"], "Saved answer")
        self.assertEqual(self.overlay.template_snapshot, frozen)

    def test_admin_view_as_returns_stored_snapshot_without_sync(self):
        request = self.factory.get("/")
        request.coach_email = OWNER
        self.edit()
        before = deepcopy(self.overlay.template_snapshot)
        with patch.object(views, "is_coach_view_as", return_value=True), \
             patch.object(views, "_imported_review_definition", return_value=deepcopy(self.definition)), \
             patch("coach_api.migrated_template_sync.synchronize_on_open") as sync:
            response = unwrap(views.coach_review_instance_detail)(request, self.overlay.event_key)
        self.assertEqual(response.status_code, 200)
        sync.assert_not_called()
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.template_snapshot, before)

    def test_learners_and_employers_read_stored_snapshots_without_sync(self):
        for role in ("learner", "employer"):
            for status in ("in-progress", "awaiting-signature", "completed"):
                with self.subTest(role=role, status=status):
                    self.overlay.status = status
                    self.overlay.save()
                    before = deepcopy(self.overlay.template_snapshot)
                    with patch.object(lifecycle, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                         patch.object(lifecycle, "_party_overlay", return_value=self.overlay), \
                         patch.object(views, "_imported_review_definition", return_value=deepcopy(self.definition)), \
                         patch("coach_api.migrated_template_sync.synchronize_locked", side_effect=AssertionError("Participant sync")):
                        response = lifecycle.migrated_review_party_detail(self.factory.get("/"), self.overlay.event_key)
                    self.assertEqual(response.status_code, 200)
                    self.assertTrue(json.loads(response.content)["readOnly"])
                    self.overlay.refresh_from_db()
                    self.assertEqual(self.overlay.template_snapshot, before)

    def test_historical_source_becoming_completed_prevents_open_sync(self):
        historical = {"source": "aptem", "readOnly": True, "historicalReview": {"status": "completed"}}
        self.edit()
        with patch.object(views, "_imported_review_definition", return_value=historical), \
             patch("coach_api.migrated_template_sync.synchronize_definition_locked") as sync:
            self.assertEqual(synchronize_on_open(OWNER, self.overlay.event_key, self.definition), historical)
        sync.assert_not_called()

    def test_native_and_historical_definitions_are_returned_without_overlay_lookup(self):
        for definition in ({"source": "curriculum"}, {"source": "aptem", "readOnly": True, "localStatus": None}):
            with patch.object(views, "_owned_migrated_overlay") as lookup:
                self.assertIs(synchronize_on_open(OWNER, "synthetic", definition), definition)
            lookup.assert_not_called()

    def test_progress_and_summary_versions_cannot_be_overwritten_by_old_tab_after_sync(self):
        stale = answer_version(self.overlay)
        self.edit()
        self.sync()
        self.assertEqual(self.request(answers={"note": "Stale edit"}, version=stale).status_code, 409)
        self.assertEqual(self.overlay.progress_snapshot, {"unchanged": [1, 2, 3]})
        self.assertEqual(self.overlay.meeting_intelligence["aiSummaryOriginal"], {"overview": "Original"})
