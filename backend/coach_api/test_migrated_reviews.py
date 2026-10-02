import copy
import json
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import RequestFactory, SimpleTestCase, TestCase

from coach_api import views
from coach_api.admin import MigratedReviewTemplateForm
from coach_api.migrated_reviews import (
    candidate_definition, initial_local_status, programme_key,
    render_sections, review_family, validate_answers,
)
from coach_api.models import ImportedReviewInstance, MigratedReviewTemplate


SOURCE = {
    "sections": [{
        "section_name": "Review",
        "fields": [{"label": "Private answer", "value": "learner-specific secret"}],
        "source_payload": {
            "learnerName": "learner-specific secret",
            "fields": [
                {"name": "comment", "title": "Comment", "type": 13, "order": 1,
                 "isMandatory": True, "description": "Describe progress", "listAnswers": [],
                 "ifTrue": [], "ifFalse": []},
                {"name": "choice", "title": "Outcome", "type": 5, "order": 2,
                 "isMandatory": True, "listAnswers": ["Good", "Needs work"],
                 "ifTrue": [], "ifFalse": []},
                {"name": "check", "title": "Any concern?", "type": 6, "order": 3,
                 "isMandatory": True, "listAnswers": [],
                 "ifTrue": [{"name": "detail", "title": "Details", "type": 1,
                             "order": 0, "isMandatory": True, "listAnswers": [],
                             "ifTrue": [], "ifFalse": []}], "ifFalse": []},
                {"name": "unverified", "title": "New Aptem control", "type": 99,
                 "order": 4, "isMandatory": False, "listAnswers": [],
                 "ifTrue": [], "ifFalse": []},
            ],
        },
    }],
}


class MigratedDefinitionTests(SimpleTestCase):
    def setUp(self):
        self.definition = candidate_definition(copy.deepcopy(SOURCE))
        self.fields = {field["name"]: field for field in self.definition["sections"][0]["fields"]}

    def test_candidate_uses_metadata_without_source_answers(self):
        before = copy.deepcopy(SOURCE)
        candidate_definition(SOURCE)
        self.assertEqual(SOURCE, before)
        self.assertNotIn("learner-specific secret", json.dumps(self.definition))
        self.assertEqual(self.fields["comment"]["key"], "section-0:comment")
        self.assertEqual(self.fields["choice"]["options"], ["Good", "Needs work"])
        self.assertEqual(self.fields["check"]["ifTrue"][0]["key"], "section-0:check:yes:detail")

    def test_programme_and_family_are_explicit(self):
        self.assertEqual(programme_key("P-42", "Display Name"), "id:P-42")
        self.assertEqual(programme_key(None, "  Display  Name "), "name:display name")
        self.assertEqual(review_family("Progress Review (+ Skills Radar)"), "PR")
        self.assertEqual(review_family("Monthly Coaching Meeting"), "MCM")
        self.assertIsNone(review_family("Gateway Review"))

    def test_typed_render_and_unverified_fallback(self):
        sections, warnings = render_sections(self.definition, {"section-0:comment": "Local value"})
        fields = {field["id"]: field for field in sections[0]["fields"]}
        self.assertEqual(fields["section-0:comment"]["fieldType"], "text_multiline")
        self.assertEqual(fields["section-0:comment"]["answer"], "Local value")
        self.assertTrue(fields["section-0:comment"]["required"])
        self.assertEqual(fields["section-0:choice"]["fieldType"], "list_item")
        self.assertEqual(fields["section-0:choice"]["configuration"]["options"], ["Good", "Needs work"])
        self.assertEqual(fields["section-0:check"]["fieldType"], "boolean_case_block")
        self.assertEqual(fields["section-0:unverified"]["fieldType"], "text_multiline")
        self.assertEqual(warnings, [{"fieldKey": "section-0:unverified", "aptemType": 99}])

    def test_answer_shape_keys_conditions_and_required_fields(self):
        base = {"section-0:comment": "Progress", "section-0:choice": "Good", "section-0:check": "no"}
        self.assertEqual(validate_answers(self.definition, base, completing=True), base)
        with self.assertRaisesRegex(ValueError, "Required"):
            validate_answers(self.definition, {"section-0:comment": "Progress"}, completing=True)
        with self.assertRaisesRegex(ValueError, "Required"):
            validate_answers(self.definition, {**base, "section-0:check": "yes"}, completing=True)
        with self.assertRaisesRegex(ValueError, "not part"):
            validate_answers(self.definition, {**base, "foreign": "value"})
        with self.assertRaisesRegex(ValueError, "hidden conditional"):
            validate_answers(self.definition, {**base, "section-0:check:yes:detail": "Hidden"})
        with self.assertRaisesRegex(ValueError, "listed options"):
            validate_answers(self.definition, {**base, "section-0:choice": "Invented"})
        with self.assertRaisesRegex(ValueError, "yes or no"):
            validate_answers(self.definition, {**base, "section-0:check": True})
        self.assertEqual(initial_local_status("Not Scheduled"), "not-scheduled")
        self.assertEqual(initial_local_status("Scheduled"), "scheduled")
        self.assertIsNone(initial_local_status("AwaitingSignature"))

    @patch("coach_api.views.curriculum_review_instances.progress_review_rag_history", return_value=[])
    @patch("coach_api.views._imported_review_progress_snapshot", return_value=None)
    @patch("coach_api.views.ImportedReviewInstance.objects.filter")
    @patch("coach_api.views._sections_by_review", return_value={})
    @patch("coach_api.views.connections")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_detail_uses_snapshot_and_separates_source_from_local_status(
        self, profiles, connections, _sections, overlays, _progress, _history,
    ):
        profiles.return_value = [SimpleNamespace(
            id=21, aptem_id=101, _caseload_source=SimpleNamespace(aptem_id=101),
            programme_id="P-42", programme="Programme", username="Synthetic learner",
        )]
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = ["id", "learner_id", "aptem_review_id", "review_name", "review_type",
                   "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
                   "status", "review_data", "extraction_status", "last_error"]
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [(407, 21, "A-7", "Progress Review", "Progress Review",
                                        "Coach", "Synthetic learner", None, None,
                                        "Scheduled", {"sections": []}, "partial", None)]
        overlays.return_value.first.return_value = SimpleNamespace(
            event_key="imported-review:A-7", owner_email="coach@example.invalid",
            learner_id=21, source_review_id=407, status="in-progress", completed_at=None,
            template_snapshot=self.definition,
            answers={"section-0:comment": "LMS answer"},
        )
        result = views._imported_review_definition("coach@example.invalid", "imported-review:A-7")
        self.assertTrue(result["formAvailable"])
        self.assertFalse(result["summaryOnly"])
        self.assertTrue(result["migratedForm"])
        self.assertEqual(result["sourceStatus"], "Scheduled")
        self.assertEqual(result["localStatus"], "in-progress")
        self.assertEqual(result["sections"][0]["fields"][0]["answer"], "LMS answer")
        self.assertEqual(result["instance"]["reviewTemplateId"], "")
        self.assertIsNone(result["instance"]["occurrenceNumber"])
        self.assertEqual(result["pdf"]["source"], "lms-migrated")
        self.assertFalse(result["pdf"]["available"])
        overlays.return_value.first.return_value.learner_id = 22
        self.assertIsNone(views._imported_review_definition("coach@example.invalid", "imported-review:A-7"))


class MigratedModelTests(TestCase):
    def test_one_active_assignment_per_programme_family(self):
        first = MigratedReviewTemplate.objects.create(
            programme_key="id:P-42", review_family="PR", name="Candidate A",
            definition_json=candidate_definition(SOURCE), is_active=True,
        )
        MigratedReviewTemplate.objects.create(
            programme_key="id:P-42", review_family="PR", name="Candidate B",
            definition_json=candidate_definition(SOURCE), is_active=False,
        )
        self.assertTrue(first.pk)
        with self.assertRaises(IntegrityError), transaction.atomic():
            MigratedReviewTemplate.objects.create(
                programme_key="id:P-42", review_family="PR", name="Candidate C",
                definition_json=candidate_definition(SOURCE), is_active=True,
            )
        form = MigratedReviewTemplateForm(data={
            "programme_key": "id:P-42", "review_family": "PR", "name": "Duplicate",
            "definition_json": json.dumps(candidate_definition(SOURCE)), "is_active": "on",
        })
        self.assertFalse(form.is_valid())
        self.assertIn("is_active", form.errors)

    def _source_definition(self, status):
        return {
            "readOnly": True, "canInitialize": True, "sourceStatus": status,
            "migratedProgrammeKey": "id:P-42",
            "instance": {"id": "imported-review:A-1", "learnerId": 21},
            "historicalReview": {"id": "401", "type": "Progress Review"},
        }

    def test_explicit_initialization_snapshots_both_safe_source_statuses(self):
        template = MigratedReviewTemplate.objects.create(
            programme_key="id:P-42", review_family="PR", name="Approved",
            definition_json=candidate_definition(SOURCE), is_active=True,
        )
        for source_status, expected in (("not-scheduled", "not-scheduled"), ("scheduled", "scheduled")):
            definition = self._source_definition(source_status)
            definition["instance"]["id"] += source_status
            definition["historicalReview"]["id"] = "401" if source_status == "not-scheduled" else "402"
            with patch("coach_api.views.authenticated_coach_email", return_value="Coach@Example.Invalid"), \
                 patch("coach_api.views._imported_review_definition", side_effect=[definition, {"localStatus": expected}]):
                response = unwrap(views.coach_review_instance_initialize)(
                    RequestFactory().post("/coach/reviews/imported-review:A-1/initialize"),
                    definition["instance"]["id"],
                )
            self.assertEqual(response.status_code, 200)
            overlay = ImportedReviewInstance.objects.get(event_key=definition["instance"]["id"])
            self.assertEqual(overlay.owner_email, "coach@example.invalid")
            self.assertEqual(overlay.learner_id, 21)
            self.assertEqual(overlay.source_review_id, int(definition["historicalReview"]["id"]))
            self.assertEqual(overlay.status, expected)
            self.assertEqual(overlay.answers, {})
            self.assertEqual(overlay.template_snapshot["name"], "Approved")
        template.definition_json = {"sections": []}
        template.save(update_fields=["definition_json"])
        self.assertEqual(ImportedReviewInstance.objects.first().template_snapshot["sections"][0]["title"], "Review")

    def test_completed_source_and_mismatch_do_not_initialize_or_write(self):
        source = self._source_definition("completed")
        source["canInitialize"] = False
        with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
             patch("coach_api.views._imported_review_definition", return_value=source):
            response = unwrap(views.coach_review_instance_initialize)(
                RequestFactory().post("/coach/reviews/imported-review:A-1/initialize"),
                "imported-review:A-1",
            )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)

        overlay = ImportedReviewInstance.objects.create(
            event_key="imported-review:A-1", owner_email="coach@example.invalid",
            learner_id=99, source_review_id=401,
            template_snapshot=candidate_definition(SOURCE), status="in-progress",
        )
        self.assertIsNone(views._owned_migrated_overlay("coach@example.invalid", source))
        overlay.learner_id = 21
        overlay.source_review_id = 402
        overlay.save(update_fields=["learner_id", "source_review_id"])
        self.assertIsNone(views._owned_migrated_overlay("coach@example.invalid", source))


class MigratedWriteTests(TestCase):
    def setUp(self):
        self.definition_json = candidate_definition(SOURCE)
        self.template = MigratedReviewTemplate.objects.create(
            programme_key="id:P-42", review_family="PR", name="Approved",
            definition_json=self.definition_json, is_active=True,
        )
        self.overlay = ImportedReviewInstance.objects.create(
            event_key="imported-review:A-7", owner_email="coach@example.invalid",
            learner_id=21, source_review_id=407, migrated_template=self.template,
            template_snapshot=copy.deepcopy(self.definition_json), answers={}, status="scheduled",
        )
        self.definition = {
            "migratedForm": True, "readOnly": False, "sourceStatus": "scheduled",
            "localStatus": "scheduled", "instance": {"id": self.overlay.event_key, "learnerId": 21},
            "historicalReview": {"id": "407", "type": "Progress Review"},
        }
        self.factory = RequestFactory()

    def _post(self, view, suffix, body):
        with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
             patch("coach_api.views._imported_review_definition", return_value=self.definition):
            return unwrap(view)(
                self.factory.post(f"/coach/reviews/imported-review:A-7/{suffix}",
                                  data=json.dumps(body), content_type="application/json"),
                self.overlay.event_key,
            )

    def test_scheduled_review_starts_locally_then_submits_for_signature(self):
        response = self._post(views.coach_review_instance_local_status, "local-status", {"status": "in-progress"})
        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "in-progress")
        self.assertEqual(self.definition["sourceStatus"], "scheduled")
        draft = {"section-0:comment": "Good progress"}
        response = self._post(views.coach_review_instance_answers, "answers", {"answers": draft})
        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers, draft)
        response = self._post(views.coach_review_instance_complete, "complete", {"answers": draft})
        self.assertEqual(response.status_code, 400)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "in-progress")
        complete = {**draft, "section-0:choice": "Good", "section-0:check": "no"}
        response = self._post(views.coach_review_instance_complete, "complete", {"answers": complete})
        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers, complete)
        self.assertEqual(self.overlay.status, "awaiting-signature")
        self.assertIsNone(self.overlay.completed_at)
        self.assertEqual(self.definition["sourceStatus"], "scheduled")

    def test_unknown_and_wrong_shape_answers_are_rejected(self):
        self.assertEqual(self._post(views.coach_review_instance_answers, "answers", {"answers": {"foreign": "x"}}).status_code, 400)
        self.assertEqual(self._post(views.coach_review_instance_answers, "answers", {"answers": {"section-0:choice": "Unknown"}}).status_code, 400)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers, {})

    def test_wrong_owner_and_source_association_rejected(self):
        self.definition["historicalReview"]["id"] = "408"
        self.assertEqual(self._post(views.coach_review_instance_answers, "answers", {"answers": {}}).status_code, 409)
        self.definition["historicalReview"]["id"] = "407"
        self.overlay.owner_email = "other@example.invalid"
        self.overlay.save(update_fields=["owner_email"])
        self.assertEqual(self._post(views.coach_review_instance_answers, "answers", {"answers": {}}).status_code, 409)
