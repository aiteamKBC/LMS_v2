import copy
import json
from datetime import date, time, timedelta
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.db import IntegrityError, transaction
from django.test import RequestFactory, SimpleTestCase, TestCase

from coach_api import views
from coach_api.admin import MigratedReviewTemplateForm
from coach_api.migrated_reviews import (
    booking_event_type, candidate_definition, initial_local_status, programme_key,
    render_sections, review_family, validate_answers,
)
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate


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

    def test_booking_types_share_pr_without_collapsing_template_families(self):
        for source_type, family, event_type in (
            ("Monthly Coaching Meeting", "MCM", "mcr"),
            ("Progress Review", "PR", "progress-review"),
            ("Progress Review (+ Skills Radar)", "PR_SKILLS_RADAR", "progress-review"),
        ):
            with self.subTest(family=family):
                self.assertEqual(review_family(source_type), family)
                self.assertEqual(booking_event_type(family), event_type)
        self.assertIsNone(booking_event_type(None))
        self.assertIsNone(booking_event_type("Gateway Review"))

    def test_programme_and_family_are_explicit(self):
        self.assertEqual(programme_key("P-42", "Display Name"), "id:P-42")
        self.assertEqual(programme_key(None, "  Display  Name "), "name:display name")
        self.assertEqual(review_family("Progress Review (+ Skills Radar)"), "PR_SKILLS_RADAR")
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
    @patch("coach_api.views.CoachCalendarEvent.objects.filter")
    @patch("coach_api.views.ImportedReviewInstance.objects.filter")
    @patch("coach_api.views._sections_by_review", return_value={})
    @patch("coach_api.views.connections")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_detail_uses_snapshot_and_separates_source_from_local_status(
        self, profiles, connections, _sections, overlays, calendar_rows, _progress, _history,
    ):
        calendar_rows.return_value.__getitem__.return_value = []
        profiles.return_value = [SimpleNamespace(
            id=21, aptem_id=101, _caseload_source=SimpleNamespace(aptem_id=101),
            programme_id="P-42", programme="Programme", username="Authoritative learner",
            email="learner@example.invalid",
        )]
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = ["id", "learner_id", "aptem_review_id", "review_name", "review_type",
                   "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
                   "status", "review_data", "extraction_status", "last_error"]
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [(407, 21, "A-7", "Progress Review", "Progress Review",
                                        "Coach", "Stale source learner label", None, None,
                                        "Scheduled", {"sections": []}, "partial", None)]
        overlays.return_value.first.return_value = SimpleNamespace(
            event_key="imported-review:A-7", owner_email="coach@example.invalid",
            learner_id=21, source_review_id=407, status="in-progress", completed_at=None,
            template_snapshot=self.definition,
            migrated_signatures=SimpleNamespace(all=lambda: []),
            signature_requirements={"advisor": True, "participant": True, "employer": True},
            answers={"section-0:comment": "LMS answer"},
        )
        result = views._imported_review_definition("coach@example.invalid", "imported-review:A-7")
        self.assertTrue(result["formAvailable"])
        self.assertFalse(result["summaryOnly"])
        self.assertTrue(result["migratedForm"])
        self.assertEqual(result["sourceStatus"], "Scheduled")
        self.assertEqual(result["localStatus"], "in-progress")
        self.assertEqual(result["learnerName"], "Authoritative learner")
        self.assertEqual(result["learnerEmail"], "learner@example.invalid")
        self.assertEqual(result["programme"], "Programme")
        self.assertEqual(result["programmeId"], "P-42")
        self.assertEqual(result["sections"][0]["fields"][0]["answer"], "LMS answer")
        self.assertEqual(result["instance"]["reviewTemplateId"], "")
        self.assertIsNone(result["instance"]["occurrenceNumber"])
        self.assertEqual(result["pdf"]["source"], "lms-migrated")
        self.assertFalse(result["pdf"]["available"])
        overlays.return_value.first.return_value.learner_id = 22
        self.assertIsNone(views._imported_review_definition("coach@example.invalid", "imported-review:A-7"))

    @patch("coach_api.views._review_instance_meeting_summary_source", return_value=None)
    @patch("coach_api.views.curriculum_review_instances.review_instance_form_definition")
    @patch("coach_api.views.LearnerProfile.objects.filter")
    def test_native_definition_uses_linked_profile_identity(self, profiles, form_definition, _summary):
        form_definition.return_value = {"instance": {"id": "native-1", "learnerId": 21}}
        profiles.return_value.only.return_value.first.return_value = SimpleNamespace(
            full_name="Native learner", email="native@example.invalid",
            programme="Native programme", programme_id="P-99",
        )
        result = views._coach_review_instance_definition({"learner_id": 21})
        self.assertEqual(result["learnerName"], "Native learner")
        self.assertEqual(result["learnerEmail"], "native@example.invalid")
        self.assertEqual(result["programme"], "Native programme")
        self.assertEqual(result["programmeId"], "P-99")
        profiles.assert_called_once_with(pk=21)
        profiles.return_value.only.return_value.first.return_value = None
        self.assertEqual(views._coach_review_instance_definition({"learner_id": 21})["learnerName"], "")


class MigratedPreviewTests(SimpleTestCase):
    """The GET path is exercised with database access disabled by SimpleTestCase."""

    def setUp(self):
        self.definition_json = candidate_definition(SOURCE)
        self.profile = SimpleNamespace(
            id=21, aptem_id=101, _caseload_source=SimpleNamespace(aptem_id=101),
            programme_id="P-42", programme="Programme", username="Synthetic learner",
            email="synthetic@example.invalid",
        )
        self._patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[self.profile])
        connections = self._patch("coach_api.views.connections")
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = ["id", "learner_id", "aptem_review_id", "review_name", "review_type",
                   "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
                   "status", "review_data", "extraction_status", "last_error"]
        cursor.description = [(column,) for column in columns]
        self.cursor = cursor
        self._set_source_status("Scheduled")
        self._patch("coach_api.views._sections_by_review", return_value={})
        self.overlays = self._patch("coach_api.views.ImportedReviewInstance.objects.filter")
        self.overlays.return_value.first.return_value = None
        self._patch("coach_api.views.CoachCalendarEvent.objects.filter").return_value.__getitem__.return_value = []
        self.templates = self._patch("coach_api.views.resolve_migrated_template")
        self.templates.return_value = SimpleNamespace(
            pk=1, scope="PROGRAMME", name="Approved template", definition_json=self.definition_json,
        )
        self._patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
        self.view_as = self._patch("coach_api.views.is_coach_view_as", return_value=True)

    def _patch(self, target, **kwargs):
        patcher = patch(target, **kwargs)
        mocked = patcher.start()
        self.addCleanup(patcher.stop)
        return mocked

    def _set_source_status(self, status):
        self.cursor.fetchall.return_value = [(
            407, 21, "A-7", "Monthly Coaching Meeting", "Monthly Coaching Meeting",
            "Coach", "Synthetic learner", None, None, status,
            {"sections": []}, "partial", None,
        )]

    def _get(self):
        request = RequestFactory().get(
            "/coach_api/coach/reviews/imported-review%3AA-7",
            {"viewAsCoach": "coach@example.invalid"},
        )
        response = unwrap(views.coach_review_instance_detail)(request, "imported-review:A-7")
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)

    def test_view_as_get_previews_approved_template_without_any_database_write(self):
        result = self._get()
        self.assertTrue(result["previewOnly"])
        self.assertTrue(result["readOnly"])
        self.assertTrue(result["formAvailable"])
        self.assertFalse(result["summaryOnly"])
        self.assertFalse(result["migratedForm"])
        self.assertFalse(result["canInitialize"])
        self.assertIsNone(result["localStatus"])
        self.assertEqual(result["sourceStatus"], "Scheduled")
        self.assertEqual(result["migratedProgrammeKey"], "id:P-42")
        self.assertEqual(result["template"]["name"], "Approved template")
        self.assertEqual(result["sections"][0]["displayOrder"], 0)
        fields = result["sections"][0]["fields"]
        self.assertEqual([field["id"] for field in fields[:3]], [
            "section-0:comment", "section-0:choice", "section-0:check",
        ])
        self.assertEqual(fields[0]["fieldType"], "text_multiline")
        self.assertTrue(fields[0]["required"])
        self.assertEqual(fields[0]["configuration"]["description"], "Describe progress")
        self.assertEqual(fields[1]["configuration"]["options"], ["Good", "Needs work"])
        self.assertEqual(fields[2]["yesFields"][0]["id"], "section-0:check:yes:detail")
        self.assertTrue(all(field["answer"] is None for field in fields))
        self.assertNotIn("learner-specific secret", json.dumps(result["sections"]))
        self.templates.assert_called_once_with(
            "id:P-42", "MCM",
        )
        self.overlays.return_value.first.assert_called_once()
        self.assertEqual(self.cursor.execute.call_count, 1)
        self.assertTrue(self.cursor.execute.call_args.args[0].lstrip().startswith("SELECT"))

    def test_mcm_preview_keeps_approved_template_section_order(self):
        self.templates.return_value.definition_json = {"sections": [
            {"key": "summary", "title": "Meeting Summary", "order": 0, "fields": []},
            {"key": "learner", "title": "Learner information", "order": 1, "fields": []},
        ]}
        result = self._get()
        self.assertTrue(result["previewOnly"])
        self.assertEqual(
            [(section["title"], section["displayOrder"]) for section in result["sections"]],
            [("Meeting Summary", 0), ("Learner information", 1)],
        )

    def test_view_as_global_preview_exposes_inheritance_without_initialization(self):
        self.templates.return_value.scope = "GLOBAL"
        result = self._get()
        self.assertTrue(result["previewOnly"])
        self.assertTrue(result["readOnly"])
        self.assertTrue(result["formAvailable"])
        self.assertFalse(result["summaryOnly"])
        self.assertFalse(result["canInitialize"])
        self.assertEqual(result["migratedTemplateResolution"]["resolved_scope"], "GLOBAL")
        self.assertTrue(result["migratedTemplateResolution"]["inherited_from_global"])
        self.overlays.return_value.get_or_create.assert_not_called()

    def test_skills_radar_preview_requests_its_own_family(self):
        row = list(self.cursor.fetchall.return_value[0])
        row[3] = row[4] = "Progress Review (+ Skills Radar)"
        self.cursor.fetchall.return_value = [tuple(row)]
        self.templates.return_value.scope = "GLOBAL"
        self._patch("coach_api.views._imported_review_progress_snapshot", return_value=None)
        result = self._get()
        self.templates.assert_called_once_with("id:P-42", "PR_SKILLS_RADAR")
        self.assertEqual(result["migratedTemplateResolution"]["review_family"], "PR_SKILLS_RADAR")
        self.assertTrue(result["readOnly"])
        self.assertTrue(result["formAvailable"])
        self.assertFalse(result["canInitialize"])

    def test_initialized_skills_radar_exposes_booking_and_existing_meeting_actions(self):
        from coach_api.migrated_templates import snapshot_for
        from coach_api.migrated_completion import requirements_for_family

        self.view_as.return_value = False
        row = list(self.cursor.fetchall.return_value[0])
        row[3] = row[4] = "Progress Review (+ Skills Radar)"
        self.cursor.fetchall.return_value = [tuple(row)]
        self._patch("coach_api.views._imported_review_progress_snapshot", return_value=None)
        template = SimpleNamespace(pk=22, scope="GLOBAL", programme_key="",
            review_family="PR_SKILLS_RADAR", name="Global Skills Radar", definition_json=self.definition_json)
        saved = SimpleNamespace(learner_id=21, source_review_id=407,
            migrated_template=template, migrated_template_id=22,
            template_snapshot=snapshot_for(template), answers={}, status="not-scheduled", completed_at=None,
            migrated_signatures=SimpleNamespace(all=lambda: []),
            signature_requirements=requirements_for_family("PR_SKILLS_RADAR"))
        self.overlays.return_value.first.return_value = saved
        result = self._get()
        self.assertTrue(result["booking"]["canBook"])
        self.assertFalse(result["booking"]["booked"])
        self.assertEqual(result["migratedTemplateResolution"]["review_family"], "PR_SKILLS_RADAR")
        self.assertEqual(result["migratedTemplateResolution"]["resolved_template_id"], 22)
        self.assertEqual([role for role, state in result["signatures"].items() if state["required"]],
                         ["advisor", "participant", "employer"])

        calendar = CoachCalendarEvent(event_key="imported-review:A-7", owner_email="coach@example.invalid",
            learner_id=21, event_type="progress-review", status="scheduled", sync_state="synced",
            graph_event_id="synthetic-graph", meeting_link="https://example.invalid/teams",
            scheduled_date=date(2026, 10, 30), scheduled_time=time(10), duration_minutes=60)
        with patch("coach_api.views.CoachCalendarEvent.objects.filter") as lookup:
            lookup.return_value.__getitem__.return_value = [calendar]
            result = self._get()
            self.assertTrue(result["booking"]["booked"])
            self.assertTrue(result["booking"]["canAttach"])
            self.assertFalse(result["booking"]["conflict"])
            self.assertFalse(result["booking"]["canBook"])
            self.assertEqual(result["booking"]["eventKey"], "imported-review:A-7")
            saved.status = "scheduled"
            result = self._get()
            self.assertEqual(result["localStatus"], "scheduled")
            self.assertFalse(result["booking"]["canAttach"])
            self.assertTrue(result["booking"]["booked"])
        self.templates.assert_not_called()

    def test_missing_programme_all_families_can_preview_and_initialize_global(self):
        self.profile.programme_id = None
        self.profile.programme = ""
        self.templates.return_value.scope = "GLOBAL"
        self._patch("coach_api.views._imported_review_progress_snapshot", return_value=None)
        for source_type, family in (("Monthly Coaching Meeting", "MCM"), ("Progress Review", "PR"),
                                    ("Progress Review (+ Skills Radar)", "PR_SKILLS_RADAR")):
            for preview in (True, False):
                with self.subTest(family=family, preview=preview):
                    self.templates.reset_mock()
                    self.view_as.return_value = preview
                    row = list(self.cursor.fetchall.return_value[0])
                    row[3] = row[4] = source_type
                    # Aptem programme IDs are a separate namespace. Neither this
                    # source label nor a competing label authorizes an LMS override.
                    row[10] = {"sections": [], "live_odata": {"ProgramId": 71, "ProgramName": "Programme A"},
                               "programme": "Programme B"}
                    self.cursor.fetchall.return_value = [tuple(row)]
                    result = self._get()
                    self.templates.assert_called_once_with(None, family)
                    self.assertEqual(result["migratedTemplateResolution"]["resolved_scope"], "GLOBAL")
                    self.assertIsNone(result["migratedProgrammeKey"])
                    self.assertEqual(result["formAvailable"], preview)
                    self.assertEqual(result["summaryOnly"], not preview)
                    self.assertEqual(result["canInitialize"], not preview)
                    self.assertTrue(result["readOnly"])
                    self.assertEqual(result["previewOnly"], preview)
                    self.overlays.return_value.get_or_create.assert_not_called()

    def test_missing_programme_and_global_keeps_safe_missing_state(self):
        self.profile.programme_id = None
        self.profile.programme = ""
        self.templates.return_value = None
        result = self._get()
        self.assertTrue(result["noApprovedMigratedTemplate"])
        self.assertTrue(result["summaryOnly"])
        self.assertFalse(result["formAvailable"])
        self.assertFalse(result["canInitialize"])

    def test_unsupported_family_without_programme_never_selects_global(self):
        self.profile.programme_id = None
        self.profile.programme = ""
        row = list(self.cursor.fetchall.return_value[0])
        row[3] = row[4] = "Gateway Review"
        self.cursor.fetchall.return_value = [tuple(row)]
        self._patch("coach_api.views._imported_review_progress_snapshot", return_value=None)
        result = self._get()
        self.templates.assert_not_called()
        self.assertFalse(result["canInitialize"])
        self.assertFalse(result["formAvailable"])

    def test_view_as_initialized_review_uses_stored_snapshot_and_answers(self):
        self.overlays.return_value.first.return_value = SimpleNamespace(
            learner_id=21, source_review_id=407, template_snapshot=self.definition_json,
            answers={"section-0:comment": "Saved LMS answer"},
            status="in-progress", completed_at=None,
            migrated_signatures=SimpleNamespace(all=lambda: []),
            signature_requirements={"advisor": True, "participant": True},
        )
        result = self._get()
        self.assertFalse(result["previewOnly"])
        self.assertTrue(result["migratedForm"])
        self.assertTrue(result["readOnly"])
        self.assertEqual(result["localStatus"], "in-progress")
        self.assertEqual(result["sections"][0]["fields"][0]["answer"], "Saved LMS answer")
        self.templates.assert_not_called()

    def test_normal_coach_get_still_offers_explicit_initialization(self):
        self.view_as.return_value = False
        result = self._get()
        self.assertFalse(result["previewOnly"])
        self.assertTrue(result["canInitialize"])
        self.assertFalse(result["formAvailable"])
        self.assertTrue(result["summaryOnly"])
        self.assertEqual(result["sections"], [])

    def test_historical_completed_source_never_uses_future_template(self):
        self._set_source_status("Completed")
        result = self._get()
        self.assertFalse(result["previewOnly"])
        self.assertFalse(result["canInitialize"])
        self.assertTrue(result["summaryOnly"])
        self.assertEqual(result["sections"], [])
        self.assertEqual(result["pdf"]["source"], "aptem")
        self.assertEqual(result["learnerName"], "Synthetic learner")
        self.assertEqual(result["programme"], "Programme")
        self.templates.assert_not_called()

    def test_no_approved_template_returns_clear_empty_state(self):
        self.templates.return_value = None
        result = self._get()
        self.assertTrue(result["noApprovedMigratedTemplate"])
        self.assertFalse(result["previewOnly"])
        self.assertFalse(result["formAvailable"])
        self.assertTrue(result["summaryOnly"])
        self.assertEqual(result["sections"], [])

    def test_invalid_active_template_is_not_shown_as_a_form(self):
        self.templates.return_value.definition_json = {"sections": []}
        result = self._get()
        self.assertTrue(result["migratedPreviewError"])
        self.assertFalse(result["noApprovedMigratedTemplate"])
        self.assertFalse(result["previewOnly"])
        self.assertTrue(result["summaryOnly"])
        self.assertEqual(result["sections"], [])

    def test_admin_view_as_migrated_writes_are_forbidden_before_view_body(self):
        account = SimpleNamespace(subject_type="staff", subject_id=1, role="admin")
        def authenticate(request):
            request.login_account = account
            return account
        self._patch("login.permissions.authenticate_request", side_effect=authenticate)
        self._patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"}))
        admin_staff = SimpleNamespace(id=1, email="admin@example.invalid", access="super-admin")
        self._patch("coach_api.auth.StaffUser.objects.filter").return_value.only.return_value.first.return_value = admin_staff
        definition = self._patch("coach_api.views._imported_review_definition")
        for suffix, endpoint in (
            ("initialize", views.coach_review_instance_initialize),
            ("book", views.coach_review_instance_book),
            ("local-status", views.coach_review_instance_local_status),
            ("answers", views.coach_review_instance_answers),
            ("complete", views.coach_review_instance_complete),
            ("signatures", views.coach_review_instance_signature),
        ):
            with self.subTest(suffix=suffix):
                request = RequestFactory().post(
                    f"/coach_api/coach/reviews/imported-review%3AA-7/{suffix}?viewAsCoach=coach@example.invalid",
                )
                response = endpoint(request, "imported-review:A-7")
                self.assertEqual(response.status_code, 403)
                self.assertEqual(json.loads(response.content)["code"], "coach_view_as_read_only")
        definition.assert_not_called()


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

    def test_global_initialization_without_programme_freezes_each_family(self):
        from coach_api.migrated_templates import snapshot_for
        for index, (family, source_type) in enumerate((("MCM", "Monthly Coaching Meeting"),
                ("PR", "Progress Review"), ("PR_SKILLS_RADAR", "Progress Review (+ Skills Radar)"))):
            with self.subTest(family=family):
                template = MigratedReviewTemplate.objects.create(
                    scope="GLOBAL", programme_key="", review_family=family,
                    name="Approved Global", definition_json=candidate_definition(SOURCE), is_active=True,
                )
                definition = self._source_definition("Scheduled")
                definition["migratedProgrammeKey"] = None
                definition["historicalReview"] = {"id": str(500 + index), "type": source_type}
                definition["instance"]["id"] = f"imported-review:global-{index}"
                with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
                     patch("coach_api.views._imported_review_definition", side_effect=[definition, {"migratedForm": True}]):
                    response = unwrap(views.coach_review_instance_initialize)(
                        RequestFactory().post("/initialize"), definition["instance"]["id"],
                    )
                self.assertEqual(response.status_code, 200)
                overlay = ImportedReviewInstance.objects.get(source_review_id=500 + index)
                before = copy.deepcopy(overlay.template_snapshot)
                self.assertEqual(before, snapshot_for(template))
                self.assertEqual(overlay.migrated_template_id, template.pk)
                self.assertEqual(overlay.answers, {})
                self.assertEqual(overlay.status, "scheduled")
                self.assertEqual(overlay.signature_requirements["employer"], family != "MCM")
                template.definition_json["sections"][0]["title"] = "Future form"
                template.save(update_fields=["definition_json"])
                overlay.refresh_from_db()
                self.assertEqual(overlay.template_snapshot, before)

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
        calendar = CoachCalendarEvent.objects.create(
            event_key=self.overlay.event_key, owner_email=self.overlay.owner_email,
            learner_id=self.overlay.learner_id, event_type="progress-review",
            target_date=date(2026, 10, 20), scheduled_date=date(2026, 10, 20),
            scheduled_time=time(10, 0), status="scheduled", sync_state="synced",
            graph_event_id="graph-synthetic", meeting_link="https://example.invalid/teams",
        )
        response = self._post(views.coach_review_instance_local_status, "local-status", {"status": "in-progress"})
        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        calendar.refresh_from_db()
        self.assertEqual(calendar.status, "in-progress")
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


class MigratedBookingTests(TestCase):
    """Aptem booking uses one calendar identity and mocked Graph transport."""

    def setUp(self):
        self.template = MigratedReviewTemplate.objects.create(
            programme_key="id:P-42", review_family="PR", name="Approved",
            definition_json=candidate_definition(SOURCE), is_active=True,
        )
        self.overlay = ImportedReviewInstance.objects.create(
            event_key="imported-review:A-9", owner_email="coach@example.invalid",
            learner_id=21, source_review_id=409, migrated_template=self.template,
            template_snapshot=candidate_definition(SOURCE), answers={}, status="not-scheduled",
        )
        self.definition = {
            "migratedForm": True, "readOnly": False, "sourceStatus": "Not Scheduled",
            "migratedProgrammeKey": "id:P-42", "localStatus": "not-scheduled",
            "booking": {"conflict": False},
            "instance": {"id": self.overlay.event_key, "learnerId": 21, "targetDate": "2026-10-30"},
            "historicalReview": {"id": "409", "type": "Progress Review"},
        }
        self.slot = {"scheduledDate": (date.today() + timedelta(days=10)).isoformat(),
                     "scheduledTime": "10:00", "durationMinutes": 60}
        self.base_event = {"eventKey": self.overlay.event_key, "reviewSource": "aptem",
                           "learnerId": "21", "source": "progress-review", "sequence": 1,
                           "status": "not-scheduled", "sourceStatus": "Not Scheduled",
                           "targetDate": "2026-10-30",
                           "learner": "Synthetic learner", "email": "learner@example.invalid",
                           "title": "Progress Review"}

    def book(self, *, graph_warning="", slot=None, definition=None):
        def graph_sync(record, _base_event):
            if graph_warning:
                return graph_warning
            record.graph_event_id = "graph-event-9"
            record.meeting_link = "https://example.invalid/teams/9"
            record.graph_organizer_email = record.owner_email
            record.save(update_fields=["graph_event_id", "meeting_link", "graph_organizer_email"])
            return ""

        with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
             patch("coach_api.views._imported_review_definition", return_value=self.definition if definition is None else definition), \
             patch("coach_api.views.find_generated_timetable_event", return_value=(self.base_event, "Coach")), \
             patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[SimpleNamespace(id=21)]), \
             patch("coach_api.views.coach_learner_personal_calendar_conflicts", return_value=False), \
             patch("coach_api.views.england_non_delivery_reason", return_value=None), \
             patch("coach_api.views.sync_calendar_event_to_graph", side_effect=graph_sync) as graph:
            request = RequestFactory().post(
                "/coach/reviews/imported-review:A-9/book",
                data=json.dumps(slot or self.slot), content_type="application/json",
            )
            response = unwrap(views.coach_review_instance_book)(request, self.overlay.event_key)
        return response, graph.call_count

    def test_not_scheduled_books_once_and_replays_without_another_graph_meeting(self):
        first, calls = self.book()
        self.assertEqual(first.status_code, 200)
        self.assertEqual(calls, 1)
        replay, calls = self.book()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(calls, 0)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        calendar = CoachCalendarEvent.objects.get()
        self.assertEqual(calendar.event_key, self.overlay.event_key)
        self.assertEqual(calendar.graph_event_id, "graph-event-9")
        self.assertEqual(calendar.sync_state, "synced")
        self.assertFalse(calendar.review_instance_id)
        self.assertFalse(calendar.review_template_id)
        self.assertIsNone(calendar.occurrence_number)
        displayed = views.overlay_calendar_record(self.base_event, calendar)
        self.assertEqual(displayed["status"], "scheduled")
        self.assertEqual(displayed["sourceStatus"], "Not Scheduled")
        self.assertEqual(displayed["reviewSource"], "aptem")
        self.assertFalse(displayed["reviewInstanceId"])
        self.assertEqual(displayed["meetingLink"], "https://example.invalid/teams/9")
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "scheduled")
        self.assertEqual(self.definition["sourceStatus"], "Not Scheduled")

    def test_source_scheduled_without_local_booking_requires_explicit_post(self):
        self.overlay.status = "scheduled"
        self.overlay.save(update_fields=["status"])
        self.definition["sourceStatus"] = "Scheduled"
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)
        response, calls = self.book()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, 1)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_verified_existing_booking_is_reused_without_graph_creation(self):
        calendar = CoachCalendarEvent.objects.create(
            event_key=self.overlay.event_key, owner_email=self.overlay.owner_email,
            learner_id=21, event_type="progress-review", target_date=date(2026, 10, 30),
            scheduled_date=date.fromisoformat(self.slot["scheduledDate"]), scheduled_time=time(10, 0),
            duration_minutes=60, status="scheduled", sync_state="synced",
            graph_event_id="existing-graph-event", meeting_link="https://example.invalid/teams/existing",
        )
        response, calls = self.book()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, 0)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        calendar.refresh_from_db()
        self.assertEqual(calendar.graph_event_id, "existing-graph-event")
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "scheduled")

    def test_future_mcm_uses_same_imported_identity_without_native_occurrence(self):
        self.template.review_family = "MCM"
        self.template.save(update_fields=["review_family"])
        self.definition["historicalReview"]["type"] = "Monthly Coaching Meeting"
        self.base_event["source"] = "mcr"
        response, calls = self.book()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, 1)
        calendar = CoachCalendarEvent.objects.get()
        self.assertEqual(calendar.event_type, "mcr")
        self.assertEqual(calendar.event_key, self.overlay.event_key)
        self.assertIsNone(calendar.occurrence_number)
        self.assertFalse(calendar.review_instance_id)
        with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
             patch("coach_api.views._imported_review_definition", return_value=self.definition):
            started = unwrap(views.coach_review_instance_local_status)(
                RequestFactory().post("/coach/reviews/imported-review:A-9/local-status",
                    data=json.dumps({"status": "in-progress"}), content_type="application/json"),
                self.overlay.event_key,
            )
        self.assertEqual(started.status_code, 200)
        self.overlay.refresh_from_db()
        calendar.refresh_from_db()
        self.assertEqual(self.overlay.status, "in-progress")
        self.assertEqual(calendar.status, "in-progress")

    def test_deactivated_template_does_not_invalidate_initialized_booking(self):
        self.template.is_active = False
        self.template.save(update_fields=["is_active"])
        response, calls = self.book()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, 1)
        self.assertEqual(CoachCalendarEvent.objects.get().event_key, self.overlay.event_key)

    def test_global_snapshot_uses_existing_migrated_booking_path(self):
        from coach_api.migrated_templates import snapshot_for
        self.template.scope = "GLOBAL"
        self.template.programme_key = ""
        self.template.save(update_fields=["scope", "programme_key"])
        self.overlay.template_snapshot = snapshot_for(self.template)
        self.overlay.save(update_fields=["template_snapshot"])
        response, calls = self.book()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, 1)
        calendar = CoachCalendarEvent.objects.get()
        self.assertEqual(calendar.event_key, self.overlay.event_key)
        self.assertFalse(calendar.review_instance_id)

    def _book_global_without_programme(self, family, source_type, event_type):
        from coach_api.migrated_templates import snapshot_for
        self.template.scope = "GLOBAL"
        self.template.programme_key = ""
        self.template.review_family = family
        self.template.save(update_fields=["scope", "programme_key", "review_family"])
        self.overlay.template_snapshot = snapshot_for(self.template)
        self.overlay.save(update_fields=["template_snapshot"])
        before = copy.deepcopy(self.overlay.template_snapshot)
        self.definition["migratedProgrammeKey"] = None
        self.definition["historicalReview"]["type"] = source_type
        self.base_event["source"] = event_type
        response, calls = self.book()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, 1)
        replay, calls = self.book()
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(calls, 0)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.template_snapshot, before)
        self.assertFalse(CoachCalendarEvent.objects.get().review_instance_id)

    def test_global_pr_booking_does_not_require_programme_identity(self):
        self._book_global_without_programme("PR", "Progress Review", "progress-review")

    def test_global_mcm_booking_does_not_require_programme_identity(self):
        self._book_global_without_programme("MCM", "Monthly Coaching Meeting", "mcr")

    def test_skills_global_books_retries_and_starts_with_imported_identity(self):
        self._book_global_without_programme("PR_SKILLS_RADAR", "Progress Review (+ Skills Radar)", "progress-review")
        calendar = CoachCalendarEvent.objects.get()
        self.assertEqual(calendar.event_type, "progress-review")
        self.assertEqual(calendar.event_key, "imported-review:A-9")
        self.assertFalse(calendar.review_template_id)
        self.assertIsNone(calendar.occurrence_number)
        before = copy.deepcopy(self.overlay.template_snapshot)
        self.assertEqual(before["templateSource"]["family"], "PR_SKILLS_RADAR")
        with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
             patch("coach_api.views._imported_review_definition", return_value=self.definition):
            response = unwrap(views.coach_review_instance_local_status)(
                RequestFactory().post("/coach/reviews/imported-review:A-9/local-status",
                    data=json.dumps({"status": "in-progress"}), content_type="application/json"),
                self.overlay.event_key,
            )
        self.assertEqual(response.status_code, 200)
        self.overlay.refresh_from_db()
        calendar.refresh_from_db()
        self.assertEqual(self.overlay.status, "in-progress")
        self.assertEqual(calendar.status, "in-progress")
        self.assertEqual(self.overlay.template_snapshot, before)

    def test_skills_programme_override_reuses_existing_meeting_unchanged(self):
        from coach_api.migrated_templates import snapshot_for

        self.template.review_family = "PR_SKILLS_RADAR"
        self.template.save(update_fields=["review_family"])
        self.overlay.template_snapshot = snapshot_for(self.template)
        self.overlay.save(update_fields=["template_snapshot"])
        self.definition["historicalReview"]["type"] = "Progress Review (+ Skills Radar)"
        calendar = CoachCalendarEvent.objects.create(
            event_key=self.overlay.event_key, owner_email=self.overlay.owner_email,
            learner_id=21, event_type="progress-review", target_date=date(2026, 10, 30),
            scheduled_date=date.fromisoformat(self.slot["scheduledDate"]), scheduled_time=time(10),
            duration_minutes=60, status="scheduled", sync_state="synced", sync_attempt_count=1,
            graph_event_id="existing-graph-event", meeting_link="https://example.invalid/teams/existing",
        )
        before = CoachCalendarEvent.objects.values().get(pk=calendar.pk)
        response, calls = self.book()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(calls, 0)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        self.assertEqual(CoachCalendarEvent.objects.values().get(pk=calendar.pk), before)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "scheduled")
        self.assertEqual(self.overlay.template_snapshot["templateSource"]["family"], "PR_SKILLS_RADAR")

    def test_programme_snapshot_cannot_book_with_unresolved_programme(self):
        self.definition["migratedProgrammeKey"] = None
        response, calls = self.book()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(calls, 0)
        self.assertFalse(CoachCalendarEvent.objects.exists())

    def test_unconfirmed_graph_booking_cannot_start_review(self):
        self.overlay.status = "scheduled"
        self.overlay.save(update_fields=["status"])
        self.definition["sourceStatus"] = "Scheduled"
        self.book(graph_warning="Graph unavailable")
        with patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid"), \
             patch("coach_api.views._imported_review_definition", return_value=self.definition):
            response = unwrap(views.coach_review_instance_local_status)(
                RequestFactory().post("/coach/reviews/imported-review:A-9/local-status",
                    data=json.dumps({"status": "in-progress"}), content_type="application/json"),
                self.overlay.event_key,
            )
        self.assertEqual(response.status_code, 409)
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "scheduled")

    def test_unknown_review_cannot_book_or_create_calendar_row(self):
        response, calls = self.book(definition={})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(calls, 0)
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_native_review_cannot_enter_migrated_booking_path(self):
        with patch("coach_api.views._imported_review_definition") as definition, \
             patch("coach_api.views.sync_calendar_event_to_graph") as graph:
            response = unwrap(views.coach_review_instance_book)(
                RequestFactory().post("/coach/reviews/native-instance/book",
                    data=json.dumps(self.slot), content_type="application/json"),
                "native-instance",
            )
        self.assertEqual(response.status_code, 409)
        definition.assert_not_called()
        graph.assert_not_called()
        self.assertFalse(CoachCalendarEvent.objects.exists())

    def test_skills_radar_graph_payload_keeps_title_and_pr_attendees(self):
        record = CoachCalendarEvent(event_key=self.overlay.event_key, owner_email="coach@example.invalid",
            owner_name="Test coach", learner_id=21, learner_name="Test learner",
            learner_email="learner@example.invalid", event_type=booking_event_type("PR_SKILLS_RADAR"),
            scheduled_date=date(2026, 10, 30), scheduled_time=time(10), duration_minutes=60)
        event = {**self.base_event, "source": record.event_type,
                 "title": "Progress Review (+ Skills Radar)", "employerEmail": "employer@example.invalid"}
        with patch("coach_api.views.get_graph_settings", return_value={"timezone": "Europe/London"}):
            payload = views.build_graph_event_payload(record, event)
        self.assertEqual(payload["subject"], "Progress Review (+ Skills Radar) - Test learner")
        self.assertEqual({a["emailAddress"]["address"] for a in payload["attendees"]},
                         {"coach@example.invalid", "learner@example.invalid", "employer@example.invalid"})
        self.assertEqual(payload["transactionId"], str(record.operation_id))
        self.assertEqual(payload["start"], {"dateTime": "2026-10-30T10:00:00", "timeZone": "Europe/London"})
        self.assertEqual(payload["end"]["dateTime"], "2026-10-30T11:00:00")
        self.assertTrue(payload["isOnlineMeeting"])

    def test_different_slot_and_mismatched_existing_link_are_rejected(self):
        self.book()
        changed = {**self.slot, "scheduledTime": "11:00"}
        response, calls = self.book(slot=changed)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["error"], "ALREADY_BOOKED")
        self.assertEqual(calls, 0)
        calendar = CoachCalendarEvent.objects.get()
        calendar.learner_id = 99
        calendar.save(update_fields=["learner_id"])
        response, calls = self.book()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(calls, 0)

    def test_graph_failure_keeps_retry_reservation_but_not_successful_local_status(self):
        response, calls = self.book(graph_warning="Graph unavailable")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(calls, 1)
        calendar = CoachCalendarEvent.objects.get()
        self.assertEqual(calendar.sync_state, "failed")
        self.assertFalse(calendar.graph_event_id)
        displayed = views.overlay_calendar_record(self.base_event, calendar)
        self.assertEqual(displayed["status"], "not-scheduled")
        self.assertFalse(displayed["meetingLink"])
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.status, "not-scheduled")
        retry, calls = self.book()
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(calls, 1)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_historical_and_wrong_source_associations_cannot_book(self):
        self.definition["sourceStatus"] = "Completed"
        self.assertEqual(self.book()[0].status_code, 409)
        self.definition["sourceStatus"] = "Not Scheduled"
        self.definition["historicalReview"]["id"] = "410"
        self.assertEqual(self.book()[0].status_code, 409)
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)
