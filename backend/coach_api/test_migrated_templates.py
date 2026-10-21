import copy
import json
from io import StringIO
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.db import IntegrityError, connection, transaction
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import RequestFactory, TestCase
from django.test.utils import CaptureQueriesContext

from . import migrated_template_views as api, views
from .migrated_reviews import review_family
from .migrated_templates import (
    historical_candidate, resolve_template, snapshot_assignment_valid, snapshot_for,
    template_family, validate_managed_definition,
)
from .models import ImportedReviewInstance, MigratedReviewTemplate


DEFINITION = {"sections": [{"key": "review", "title": "Review", "order": 0, "fields": [
    {"key": "progress", "title": "Progress", "aptemType": 13, "order": 0, "mandatory": True,
     "description": "Describe progress", "options": [], "ifTrue": [], "ifFalse": []},
]}]}


class MigratedTemplateManagementTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role="staff", subject_type="staff", subject_id=1)
        self.auth = patch("login.permissions.authenticate_request", return_value=self.account)
        self.access = patch("login.permissions._accesses_of", return_value=frozenset({"curriculum"}))
        self.auth.start(); self.access.start()
        self.addCleanup(self.auth.stop); self.addCleanup(self.access.stop)

    def template(self, scope="GLOBAL", family="PR", active=True, key="", **kwargs):
        return MigratedReviewTemplate.objects.create(scope=scope, programme_key=key, review_family=family,
            is_active=active, name="Approved form", definition_json=copy.deepcopy(DEFINITION), **kwargs)

    def request(self, view, method="get", data=None, pk=None, csrf=False):
        request = getattr(self.factory, method)("/curriculum_api/curriculum/migrated-review-templates/",
            data=data if method == "get" else json.dumps(data or {}), content_type="application/json")
        request._dont_enforce_csrf_checks = not csrf
        return view(request, pk) if pk else view(request)

    def working_review(self, template, *, answers=None, status="in-progress", number=1):
        return ImportedReviewInstance.objects.create(
            event_key=f"imported-review:authoring-{number}", owner_email="coach@example.invalid",
            learner_id=100 + number, source_review_id=9000 + number, migrated_template=template,
            template_snapshot=snapshot_for(template), status=status,
            answers=answers if answers is not None else {"progress": "Synthetic saved answer"},
        )

    def test_incompatible_edit_is_rejected_atomically_for_all_working_statuses_and_families(self):
        cases = [(scope, family) for scope in ("GLOBAL", "PROGRAMME") for family in ("MCM", "PR", "PR_SKILLS_RADAR")]
        for number, (scope, family) in enumerate(cases, 1):
            template = self.template(scope, family=family, key="id:synthetic" if scope == "PROGRAMME" else "")
            review = self.working_review(template, number=number)
            for status in ("not-scheduled", "scheduled", "in-progress"):
                with self.subTest(scope=scope, family=family, status=status):
                    review.status = status
                    review.save(update_fields=["status"])
                    before = (copy.deepcopy(review.template_snapshot), copy.deepcopy(review.answers), review.updated_at)
                    version = template.updated_at
                    definition = copy.deepcopy(template.definition_json)
                    definition["sections"][0]["fields"][0]["aptemType"] = 2
                    response = self.request(api.detail, "patch", {
                        "name": "Must not persist", "definition": definition, "is_active": False,
                        "updated_at": version.isoformat(),
                    }, template.pk)
                    self.assertEqual(response.status_code, 409)
                    body = json.loads(response.content)
                    self.assertEqual(body["code"], "template_answer_conflict")
                    self.assertEqual(body["fields"], ["progress"])
                    self.assertEqual(body["affectedReviews"], 1)
                    self.assertNotIn("Synthetic saved answer", response.content.decode())
                    self.assertNotIn("coach@example.invalid", response.content.decode())
                    template.refresh_from_db()
                    review.refresh_from_db()
                    self.assertEqual(template.definition_json, DEFINITION)
                    self.assertEqual(template.name, "Approved form")
                    self.assertTrue(template.is_active)
                    self.assertEqual(template.updated_at, version)
                    self.assertEqual((review.template_snapshot, review.answers, review.updated_at), before)

    def test_used_list_option_is_protected_but_unused_options_can_change(self):
        template = self.template()
        question = template.definition_json["sections"][0]["fields"][0]
        question.update(aptemType=5, options=["Used", "Unused"])
        template.save()
        review = self.working_review(template, answers={"progress": "Used"})
        definition = copy.deepcopy(template.definition_json)
        definition["sections"][0]["fields"][0]["options"] = ["Unused"]
        response = self.request(api.detail, "patch", {
            "definition": definition, "updated_at": template.updated_at.isoformat(),
        }, template.pk)
        self.assertEqual(response.status_code, 409)
        definition["sections"][0]["fields"][0]["options"] = ["Used", "New option"]
        response = self.request(api.detail, "patch", {
            "definition": definition, "updated_at": template.updated_at.isoformat(),
        }, template.pk)
        self.assertEqual(response.status_code, 200)
        template.refresh_from_db()
        review.refresh_from_db()
        self.assertEqual(template.definition_json["sections"][0]["fields"][0]["options"], ["Used", "New option"])
        self.assertEqual(review.answers, {"progress": "Used"})
        self.assertEqual(review.template_snapshot["sections"][0]["fields"][0]["options"], ["Used", "Unused"])

    def test_compatible_text_edit_addition_and_removal_preserve_saved_reviews(self):
        template = self.template()
        review = self.working_review(template)
        before = (copy.deepcopy(review.template_snapshot), copy.deepcopy(review.answers), review.updated_at)
        definition = copy.deepcopy(template.definition_json)
        definition["sections"][0]["title"] = "Renamed section"
        definition["sections"][0]["fields"][0].update(aptemType=1, title="New label")
        definition["sections"][0]["fields"].append({"key": "new", "title": "New question", "aptemType": 13})
        for remove in (False, True):
            with self.subTest(remove=remove):
                if remove:
                    definition["sections"][0]["fields"].pop(0)
                response = self.request(api.detail, "patch", {
                    "definition": definition, "updated_at": template.updated_at.isoformat(),
                }, template.pk)
                self.assertEqual(response.status_code, 200)
                template.refresh_from_db()
                review.refresh_from_db()
                self.assertEqual((review.template_snapshot, review.answers, review.updated_at), before)

    def test_unanswered_type_change_ignores_frozen_and_other_template_reviews(self):
        template = self.template()
        own = self.working_review(template, answers={})
        frozen = [self.working_review(template, status=status, number=i)
                  for i, status in enumerate(("awaiting-signature", "completed"), 2)]
        other = self.working_review(self.template("PROGRAMME", key="id:other"), number=4)
        snapshots = [copy.deepcopy(row.template_snapshot) for row in [own, *frozen, other]]
        definition = copy.deepcopy(template.definition_json)
        definition["sections"][0]["fields"][0]["aptemType"] = 2
        response = self.request(api.detail, "patch", {
            "definition": definition, "updated_at": template.updated_at.isoformat(),
        }, template.pk)
        self.assertEqual(response.status_code, 200)
        for row, snapshot in zip([own, *frozen, other], snapshots):
            row.refresh_from_db()
            self.assertEqual(row.template_snapshot, snapshot)
        self.assertEqual(other.answers, {"progress": "Synthetic saved answer"})

    def test_hidden_conditional_answer_is_protected_and_conflicts_are_aggregated(self):
        template = self.template()
        question = template.definition_json["sections"][0]["fields"][0]
        question.update(aptemType=6, ifTrue=[{"key": "followup", "title": "Follow-up", "aptemType": 13}])
        template.save()
        for number in (1, 2):
            self.working_review(template, answers={"progress": "no", "followup": "Preserved answer"}, number=number)
        definition = copy.deepcopy(template.definition_json)
        definition["sections"][0]["fields"][0]["ifTrue"][0]["aptemType"] = 2
        response = self.request(api.detail, "patch", {
            "definition": definition, "updated_at": template.updated_at.isoformat(),
        }, template.pk)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["fields"], ["followup"])
        self.assertEqual(json.loads(response.content)["affectedReviews"], 2)

    def test_reactivating_linked_template_checks_answers_before_enabling(self):
        template = self.template(active=False)
        self.working_review(template)
        # Reproduce an incompatible draft created before the authoring guard.
        template.definition_json["sections"][0]["fields"][0]["aptemType"] = 2
        template.save()
        response = self.request(api.detail, "patch", {
            "is_active": True, "updated_at": template.updated_at.isoformat(),
        }, template.pk)
        self.assertEqual(response.status_code, 409)
        template.refresh_from_db()
        self.assertFalse(template.is_active)

    def test_all_audited_source_names_and_legacy_aliases(self):
        for source, expected in [("Monthly Coaching Meeting", "MCM"), ("Monthly Coaching", "MCM"),
                                 ("MCM", "MCM"), ("Progress Review", "PR"),
                                 ("Progress Review (+ Skills Radar)", "PR_SKILLS_RADAR")]:
            for value in (source, source.upper(), " " + source.lower() + " "):
                self.assertEqual(review_family(value), expected)
        self.assertIsNone(review_family("Progress Review Master"))

    def test_psp_library_and_runtime_recognize_the_same_family(self):
        for source in ("Personal Support Plan", " PERSONAL SUPPORT PLAN "):
            self.assertEqual(template_family(source), "PSP")
            self.assertEqual(review_family(source), "PSP")
        self.assertIsNone(template_family("Personal Support Plan draft"))

    def test_psp_global_can_be_listed_edited_previewed_and_enabled(self):
        template = self.template(family="PSP", active=False)
        body = json.loads(self.request(api.collection).content)
        self.assertIn("PSP", [row["review_family"] for row in body["resolutions"]])
        preview = self.request(api.preview, data={"template_id": template.pk})
        self.assertEqual(preview.status_code, 200)
        self.assertTrue(json.loads(preview.content)["readOnly"])
        response = self.request(api.detail, "patch", {
            "name": "Personal Support Plan", "is_active": True,
            "updated_at": template.updated_at.isoformat(),
        }, template.pk)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(resolve_template(None, "PSP"), template)
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)
        response = self.request(api.collection, "post", {
            "scope": "PROGRAMME", "programme_key": "id:P1", "review_family": "PSP", "name": "Local PSP",
        })
        self.assertEqual(response.status_code, 400)
        self.assertEqual(MigratedReviewTemplate.objects.count(), 1)

    def test_psp_import_strips_answers_and_keeps_conditional_metadata(self):
        from unittest.mock import MagicMock
        cursor = MagicMock()
        source = [{"section_name": "Learner information", "source_payload": {"fullName": "Private learner"}},
                  {"section_name": "Additional Support", "source_payload": {
                      "needs": True, "details": "Private health answer", "fields": [{
                          "name": "needs", "title": "Support needed?", "type": 6, "isMandatory": True,
                          "ifTrue": [{"name": "details", "title": "Details", "type": 13}],
                      }],
                  }}]
        cursor.fetchone.side_effect = [(100, "200", "Personal Support Plan", "Completed", 300, source), ("P1", "Programme")]
        with patch("coach_api.migrated_templates.connections") as connections:
            connections["default"].cursor.return_value.__enter__.return_value = cursor
            definition, metadata = historical_candidate(100, "PSP")
        self.assertEqual(len(definition["sections"]), 1)
        field = definition["sections"][0]["fields"][0]
        self.assertEqual(field["ifTrue"][0]["title"], "Details")
        self.assertTrue(field["mandatory"])
        self.assertNotIn("Private", json.dumps((definition, metadata)))
        self.assertEqual(metadata["sourceReviewId"], 100)

    def test_psp_import_rejects_incomplete_and_wrong_family_sources(self):
        from unittest.mock import MagicMock
        for source_type, status in [("Personal Support Plan", "Scheduled"), ("Progress Review", "Completed")]:
            cursor = MagicMock()
            cursor.fetchone.return_value = (100, "200", source_type, status, 300, [])
            with self.subTest(source_type=source_type, status=status), patch("coach_api.migrated_templates.connections") as connections:
                connections["default"].cursor.return_value.__enter__.return_value = cursor
                with self.assertRaisesRegex(ValueError, "Completed Aptem"):
                    historical_candidate(100, "PSP")

    def test_global_import_command_is_dry_run_by_default_and_idempotent_on_create(self):
        path = "coach_api.management.commands.import_global_migrated_review_template.historical_candidate"
        options = {"source_review_id": 100, "review_family": "PSP", "name": "Personal Support Plan", "stdout": StringIO()}
        with patch(path, return_value=(DEFINITION, {"sourceReviewId": 100})):
            call_command("import_global_migrated_review_template", **options)
            self.assertFalse(MigratedReviewTemplate.objects.exists())
            call_command("import_global_migrated_review_template", create=True, **options)
            template = MigratedReviewTemplate.objects.get()
            self.assertEqual((template.scope, template.programme_key, template.review_family), ("GLOBAL", "", "PSP"))
            self.assertFalse(template.is_active)
            call_command("import_global_migrated_review_template", create=True, **options)
            self.assertEqual(MigratedReviewTemplate.objects.count(), 1)
            template.name = "Edited by administrator"
            template.definition_json = {"sections": [{**DEFINITION["sections"][0], "title": "Edited"}]}
            template.save()
            with self.assertRaisesRegex(CommandError, "already exists"):
                call_command("import_global_migrated_review_template", create=True, **options)
            template.refresh_from_db()
            self.assertEqual(template.name, "Edited by administrator")

    def test_mcm_template_api_rejects_employer_question_permissions(self):
        self.check_no_employer_permissions("MCM")

    def test_psp_template_api_rejects_employer_question_permissions(self):
        self.check_no_employer_permissions("PSP")

    def check_no_employer_permissions(self, family):
        template = self.template(family=family)
        updated = copy.deepcopy(template.definition_json)
        updated["sections"][0]["fields"][0]["respondentRoles"] = ["employer"]
        response = self.request(api.detail, "patch", {"definition": updated, "updated_at": template.updated_at.isoformat()}, template.pk)
        self.assertEqual(response.status_code, 400)
        self.assertIn("Progress Reviews only", json.loads(response.content)["detail"])
        template.refresh_from_db()
        self.assertNotIn("respondentRoles", template.definition_json["sections"][0]["fields"][0])

    def test_resolution_overrides_global_per_family_and_programme(self):
        pr = self.template()
        skills = self.template(family="PR_SKILLS_RADAR")
        override = self.template("PROGRAMME", key="id:P1")
        self.assertEqual(resolve_template("id:P1", "PR"), override)
        self.assertEqual(resolve_template("id:P2", "PR"), pr)
        self.assertEqual(resolve_template("id:P1", "PR_SKILLS_RADAR"), skills)
        self.assertIsNone(resolve_template("id:P1", "MCM"))
        skills_override = self.template("PROGRAMME", family="PR_SKILLS_RADAR", key="id:P1")
        self.assertEqual(resolve_template("id:P1", "PR_SKILLS_RADAR"), skills_override)
        self.assertEqual(resolve_template("id:P2", "PR_SKILLS_RADAR"), skills)
        self.assertEqual(resolve_template("id:P1", "PR"), override)

    def test_inactive_override_falls_back_without_cross_family_fallback(self):
        pr = self.template()
        self.template("PROGRAMME", key="id:P1", active=False)
        self.assertEqual(resolve_template("id:P1", "PR"), pr)
        self.assertIsNone(resolve_template("id:P1", "PR_SKILLS_RADAR"))

    def test_mcm_custom_and_global_keep_distinct_questions_and_summary_bindings(self):
        from .migrated_reviews import meeting_summary_field
        from .migrated_templates import resolution_metadata
        global_template = self.template(family="MCM")
        global_template.name = "Synthetic Global MCM"
        global_template.definition_json["sections"].append({"key": "summary-section", "title": "Meeting Summary", "fields": [
            {"key": "summary", "title": "Meeting Summary", "aptemType": 13, "semanticKey": "meeting_summary"},
        ]})
        global_template.save()
        custom = self.template("PROGRAMME", family="MCM", key="id:P1")
        custom.name = "Synthetic Programme MCM"
        custom.save()
        for key, expected, section_count, has_binding in [
            ("id:P1", custom, 1, False), ("id:P2", global_template, 2, True),
        ]:
            with self.subTest(programme_key=key):
                resolved = resolve_template(key, "MCM")
                self.assertEqual(resolved, expected)
                self.assertEqual(resolution_metadata(resolved, "MCM")["resolved_scope"], expected.scope)
                snapshot = snapshot_for(resolved)
                self.assertEqual(snapshot["name"], expected.name)
                self.assertEqual(len(snapshot["sections"]), section_count)
                self.assertEqual(bool(meeting_summary_field(snapshot)), has_binding)
        custom.refresh_from_db()
        self.assertEqual(custom.definition_json, DEFINITION)

    def test_missing_programme_resolves_each_global_family_only(self):
        for family in ("MCM", "PR", "PR_SKILLS_RADAR"):
            with self.subTest(family=family):
                global_template = self.template(family=family)
                self.template("PROGRAMME", family=family, key="id:P1")
                self.assertEqual(resolve_template(None, family), global_template)
                self.assertEqual(resolve_template("", family), global_template)
                self.assertTrue(snapshot_assignment_valid(SimpleNamespace(
                    migrated_template_id=global_template.pk,
                    template_snapshot=snapshot_for(global_template),
                ), family, None))
        self.assertIsNone(resolve_template(None, "Gateway Review"))

    def test_programme_override_requires_exact_key_without_fuzzy_aliases(self):
        from .migrated_reviews import programme_key
        global_template = self.template()
        override = self.template("PROGRAMME", key="id:PROG-ME-L4")
        self.assertEqual(resolve_template(programme_key("PROG-ME-L4", "Renamed programme"), "PR"), override)
        for label in ("Marketing Executive Level 4", "Level 4 Marketing Executive",
                      "July 2025- Level 4 Marketing Executive", "Marketing Executive Level 4 (Onboarding Stage)"):
            with self.subTest(label=label):
                self.assertEqual(resolve_template(programme_key(None, label), "PR"), global_template)

    def test_database_enforces_active_global_and_programme_slots(self):
        for scope, key in [("GLOBAL", ""), ("PROGRAMME", "id:P1")]:
            self.template(scope, key=key)
            self.template(scope, key=key, active=False)
            with self.assertRaises(IntegrityError), transaction.atomic():
                self.template(scope, key=key)
        self.template("PROGRAMME", key="id:P2")
        self.template(family="PR_SKILLS_RADAR")

    def test_database_enforces_scope_and_family(self):
        for scope, family, key in [("GLOBAL", "PR", "id:P"), ("PROGRAMME", "PR", ""),
                                   ("UNKNOWN", "PR", ""), ("GLOBAL", "NATIVE", "")]:
            with self.assertRaises(IntegrityError), transaction.atomic():
                self.template(scope, family, key=key)

    def test_create_override_deep_copies_definition_without_changing_global(self):
        global_template = self.template()
        response = self.request(api.collection, "post", {"scope": "PROGRAMME", "programme_key": "id:P1", "review_family": "PR", "name": "Local PR"})
        self.assertEqual(response.status_code, 201)
        override = MigratedReviewTemplate.objects.get(pk=json.loads(response.content)["id"])
        self.assertFalse(override.is_active)
        override.definition_json["sections"][0]["title"] = "Local changes"
        override.save()
        global_template.refresh_from_db()
        self.assertEqual(global_template.definition_json, DEFINITION)

    def test_global_import_requires_completed_source_and_keeps_server_provenance(self):
        with patch("coach_api.migrated_template_views.historical_candidate", return_value=(DEFINITION, {"sourceReviewId": 100})) as candidate:
            response = self.request(api.collection, "post", {"scope": "GLOBAL", "review_family": "PR", "name": "Source form", "source_review_id": 100, "is_active": True, "source_metadata": {"spoofed": True}})
        candidate.assert_called_once_with(100, "PR")
        self.assertEqual(response.status_code, 201)
        result = json.loads(response.content)
        self.assertFalse(result["is_active"])
        self.assertEqual(result["source_metadata"], {"sourceReviewId": 100})

    def test_missing_global_prevents_override_creation(self):
        response = self.request(api.collection, "post", {"scope": "PROGRAMME", "review_family": "PR", "programme_key": "id:P1", "name": "Draft"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(MigratedReviewTemplate.objects.count(), 0)

    def test_update_activation_and_optimistic_concurrency(self):
        template = self.template(active=False)
        version = template.updated_at.isoformat()
        response = self.request(api.detail, "patch", {"updated_at": version, "name": "Revised", "is_active": True}, template.pk)
        self.assertEqual(response.status_code, 200)
        stale = self.request(api.detail, "patch", {"updated_at": version, "name": "Stale"}, template.pk)
        self.assertEqual(stale.status_code, 409)
        template.refresh_from_db()
        self.assertEqual(template.name, "Revised")

    def test_activation_conflict_is_409_and_retains_draft(self):
        self.template()
        draft = self.template(active=False)
        response = self.request(api.detail, "patch", {"updated_at": draft.updated_at.isoformat(), "is_active": True}, draft.pk)
        self.assertEqual(response.status_code, 409)
        draft.refresh_from_db(); self.assertFalse(draft.is_active)

    def test_invalid_activation_is_rejected_without_changing_record(self):
        draft = self.template(active=False)
        invalid = copy.deepcopy(DEFINITION); invalid["sections"][0]["fields"][0]["aptemType"] = 99
        draft.definition_json = invalid; draft.save()
        response = self.request(api.detail, "patch", {"updated_at": draft.updated_at.isoformat(), "is_active": True}, draft.pk)
        self.assertEqual(response.status_code, 400)
        draft.refresh_from_db(); self.assertFalse(draft.is_active)

    def test_authoring_validation_rejects_answer_data_duplicates_types_and_options(self):
        variants = []
        for changes in ({"answer": "private"}, {"aptemType": 99}, {"aptemType": 5, "options": []},
                        {"aptemType": 5, "options": ["A", "A"]}, {"aptemType": 5, "options": [2]},
                        {"ifTrue": [DEFINITION["sections"][0]["fields"][0]]}):
            definition = copy.deepcopy(DEFINITION); definition["sections"][0]["fields"][0].update(changes); variants.append(definition)
        duplicate = copy.deepcopy(DEFINITION); duplicate["sections"][0]["fields"] *= 2; variants.append(duplicate)
        for definition in variants:
            with self.assertRaises(ValueError): validate_managed_definition(definition)

    def test_reset_preserves_override_and_uses_global(self):
        global_template = self.template()
        override = self.template("PROGRAMME", key="id:P1")
        response = self.request(api.reset, "post", {"programme_key": "id:P1", "review_family": "PR", "template_id": override.pk, "updated_at": override.updated_at.isoformat()})
        self.assertEqual(response.status_code, 200)
        override.refresh_from_db(); self.assertFalse(override.is_active)
        self.assertEqual(resolve_template("id:P1", "PR"), global_template)
        self.assertEqual(MigratedReviewTemplate.objects.count(), 2)

    def test_programme_snapshot_survives_definition_edit_and_deactivation(self):
        template = self.template("PROGRAMME", key="id:P1")
        overlay = ImportedReviewInstance.objects.create(owner_email="coach@example.invalid", event_key="imported-review:snapshot",
            learner_id=1, source_review_id=103, migrated_template=template, template_snapshot=snapshot_for(template),
            answers={"progress": "Saved response"}, status="in-progress")
        before = copy.deepcopy(overlay.template_snapshot)
        definition = copy.deepcopy(DEFINITION); definition["sections"][0]["fields"][0]["title"] = "Future question"
        response = self.request(api.detail, "patch", {"updated_at": template.updated_at.isoformat(), "definition": definition, "is_active": False}, template.pk)
        self.assertEqual(response.status_code, 200)
        overlay.refresh_from_db()
        self.assertEqual(overlay.template_snapshot, before)
        self.assertEqual(overlay.answers, {"progress": "Saved response"})
        self.assertTrue(snapshot_assignment_valid(overlay, "PR", "id:P1"))

    def test_initialization_snapshots_global_then_edits_and_reset_cannot_mutate_it(self):
        global_template = self.template()
        source = {"canInitialize": True, "readOnly": True, "sourceStatus": "Scheduled", "migratedProgrammeKey": "id:P1",
                  "historicalReview": {"id": "100", "type": "Progress Review"}, "instance": {"id": "imported-review:test", "learnerId": 1}}
        with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
             patch("coach_api.views._imported_review_definition", side_effect=[source, {}]):
            response = unwrap(views.coach_review_instance_initialize)(self.factory.post("/initialize"), "imported-review:test")
        self.assertEqual(response.status_code, 200)
        overlay = ImportedReviewInstance.objects.get()
        self.assertEqual(overlay.migrated_template_id, global_template.pk)
        before = copy.deepcopy(overlay.template_snapshot)
        global_template.definition_json["sections"][0]["title"] = "Future title"
        global_template.is_active = False; global_template.save()
        override = self.template("PROGRAMME", key="id:P1")
        self.request(api.reset, "post", {"programme_key": "id:P1", "review_family": "PR", "template_id": override.pk, "updated_at": override.updated_at.isoformat()})
        overlay.refresh_from_db()
        self.assertEqual(overlay.template_snapshot, before)
        self.assertTrue(snapshot_assignment_valid(overlay, "PR", "id:P1"))
        self.assertEqual(overlay.answers, {})
        self.assertEqual(overlay.signature_requirements, {"advisor": True, "participant": True, "employer": True, "referrer": False})

    def test_legacy_skills_snapshot_keeps_original_pr_reference(self):
        template = self.template("PROGRAMME", key="id:P1", active=False)
        overlay = ImportedReviewInstance.objects.create(owner_email="coach@example.invalid", event_key="imported-review:old", learner_id=1,
            source_review_id=101, migrated_template=template, template_snapshot=copy.deepcopy(DEFINITION))
        self.assertTrue(snapshot_assignment_valid(overlay, "PR_SKILLS_RADAR", "id:P1"))
        self.assertFalse(snapshot_assignment_valid(overlay, "PR_SKILLS_RADAR", "id:P2"))
        overlay.refresh_from_db(); self.assertEqual(overlay.template_snapshot, DEFINITION)

    def test_manual_summary_field_save_reload_preview_copy_and_snapshot_preservation(self):
        for family, source_type in (("MCM", "Monthly Coaching Meeting"), ("PR", "Progress Review"),
                                    ("PR_SKILLS_RADAR", "Progress Review (+ Skills Radar)")):
            with self.subTest(family=family):
                template = self.template(family=family)
                definition = copy.deepcopy(DEFINITION)
                summary = {"key": "meeting-summary", "title": "Meeting Summary", "aptemType": 13,
                           "order": 1, "mandatory": False, "semanticKey": "meeting_summary"}
                definition["sections"][0]["fields"].append(summary)
                saved = self.request(api.detail, "patch", {"updated_at": template.updated_at.isoformat(),
                                                           "definition": definition}, template.pk)
                self.assertEqual(saved.status_code, 200)
                template.refresh_from_db()
                self.assertEqual(template.definition_json, definition)
                reloaded = self.request(api.detail, pk=template.pk)
                self.assertEqual(json.loads(reloaded.content)["definition"], definition)
                preview = self.request(api.preview, data={"template_id": template.pk})
                self.assertEqual(preview.status_code, 200)
                rendered = json.loads(preview.content)["sections"][0]["fields"][1]
                self.assertEqual(rendered["fieldType"], "text_multiline")
                self.assertEqual(rendered["configuration"]["semanticKey"], "meeting_summary")
                self.assertFalse(rendered["required"])
                self.assertEqual(ImportedReviewInstance.objects.filter(migrated_template=template).count(), 0)

                copied = self.request(api.collection, "post", {"scope": "PROGRAMME", "programme_key": "id:P1",
                                                              "review_family": family, "name": "Synthetic custom"})
                self.assertEqual(copied.status_code, 201)
                custom = MigratedReviewTemplate.objects.get(pk=json.loads(copied.content)["id"])
                self.assertEqual(custom.definition_json, definition)

                source_id = 1000 + template.pk
                event_key = f"imported-review:editor-{family}"
                source = {"canInitialize": True, "readOnly": True, "sourceStatus": "Scheduled", "migratedProgrammeKey": None,
                          "historicalReview": {"id": str(source_id), "type": source_type},
                          "instance": {"id": event_key, "learnerId": 1}}
                with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
                     patch("coach_api.views._imported_review_definition", side_effect=[source, {}]):
                    initialized = unwrap(views.coach_review_instance_initialize)(self.factory.post("/initialize"), event_key)
                self.assertEqual(initialized.status_code, 200)
                overlay = ImportedReviewInstance.objects.get(source_review_id=source_id)
                frozen = copy.deepcopy(overlay.template_snapshot)
                self.assertEqual(frozen["sections"][0]["fields"][1], summary)

                # Later unbinding and deletion affect this master only.
                unbound = copy.deepcopy(definition)
                unbound["sections"][0]["fields"][1].pop("semanticKey")
                for future_definition in (unbound, DEFINITION):
                    response = self.request(api.detail, "patch", {"updated_at": template.updated_at.isoformat(),
                                                                  "definition": future_definition}, template.pk)
                    self.assertEqual(response.status_code, 200)
                    template.refresh_from_db()
                    overlay.refresh_from_db()
                    custom.refresh_from_db()
                    self.assertEqual(template.definition_json, future_definition)
                    self.assertEqual(overlay.template_snapshot, frozen)
                    self.assertEqual(custom.definition_json, definition)

    def test_new_skills_template_cannot_resolve_as_plain_pr(self):
        template = self.template(family="PR_SKILLS_RADAR")
        overlay = SimpleNamespace(migrated_template_id=template.pk, template_snapshot=snapshot_for(template))
        self.assertTrue(snapshot_assignment_valid(overlay, "PR_SKILLS_RADAR", "id:P1"))
        self.assertFalse(snapshot_assignment_valid(overlay, "PR", "id:P1"))

    def test_management_preview_and_listing_never_initialize_or_query_native_tables(self):
        template = self.template()
        with CaptureQueriesContext(connection) as queries:
            response = self.request(api.preview, data={"template_id": template.pk})
            library = self.request(api.collection, data={"programme_key": "id:P1"})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(json.loads(response.content)["readOnly"])
        self.assertTrue(json.loads(library.content)["resolutions"][1]["inherited_from_global"])
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)
        for query in queries:
            self.assertNotIn('"curriculum"', query["sql"])
            self.assertFalse(query["sql"].lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")))

    def test_permissions_deny_coach_learner_and_unauthorized_staff_for_every_action(self):
        for role, access in [("learner", "curriculum"), ("staff", "coach"), ("staff", "tutor")]:
            self.account.role = role
            with patch("login.permissions._accesses_of", return_value=frozenset({access})):
                for view, method in [(api.collection, "get"), (api.collection, "post"), (api.detail, "patch"), (api.preview, "get"), (api.reset, "post")]:
                    response = self.request(view, method, pk=1 if view == api.detail else None)
                    self.assertEqual(response.status_code, 403)

    def test_super_admin_allowed_and_csrf_required_on_writes(self):
        self.account.role = "admin"
        with patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"})):
            self.assertEqual(self.request(api.collection).status_code, 200)
            self.assertEqual(self.request(api.collection, "post", csrf=True).status_code, 403)

    def test_view_as_management_post_is_forbidden(self):
        request = self.factory.post('/templates/?viewAsCoach=coach@example.invalid', '{}', content_type="application/json")
        request._dont_enforce_csrf_checks = True
        self.assertEqual(api.collection(request).status_code, 403)

    def test_template_identity_cannot_be_edited(self):
        template = self.template()
        response = self.request(api.detail, "patch", {"updated_at": template.updated_at.isoformat(), "review_family": "MCM"}, template.pk)
        self.assertEqual(response.status_code, 400)
        template.refresh_from_db(); self.assertEqual(template.review_family, "PR")
