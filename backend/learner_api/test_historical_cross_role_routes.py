"""Route regressions for historical Aptem content; synthetic data and no DB IO."""
import json
from contextlib import ExitStack
from copy import deepcopy
from inspect import unwrap
from itertools import product
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import views
from coach_api.test_review_source_separation import base_event, booking, overlay, profile, source
from learner_api import calendar, review_history
from learner_api.test_historical_review_presentation import capture_fixture


class HistoricalCrossRoleRouteTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.factory = RequestFactory()
        self.row, self.sections = capture_fixture()
        self.person, self.enrolment = profile(), source()
        self.person.full_name = "Alex Example"
        self.records = []

        def replace(target, **kwargs):
            return self.stack.enter_context(patch(target, **kwargs))

        self.account = replace("login.permissions.authenticate_request",
                               return_value=SimpleNamespace(role="learner", subject_id=121))
        replace("login.permissions._auth_gate_enabled", return_value=True)
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = self.enrolment
        model.all_learners.only.return_value.filter.return_value.first.return_value = self.enrolment
        for module in (calendar, review_history):
            self.stack.enter_context(patch.object(module, "SOURCE_MODELS", {
                "commercial": model, "apprenticeship": model,
            }))
        replace("learner_api.calendar._calendar_profile", return_value=self.person)
        replace("learner_api.review_history.review_profile_for_source", return_value=self.person)
        replace("learner_api.calendar.CoachCalendarEvent.objects.filter").return_value.order_by.side_effect = lambda *a: self.records
        replace("learner_api.calendar._belongs_to_current_cycle", return_value=True)
        replace("learner_api.calendar.alternative_recovery_events_for_learner", return_value=[])
        replace("learner_api.calendar.assigned_curriculum_module_ids", return_value=[])
        replace("learner_api.calendar.booking_calendar_payload", return_value={"timezone": "Europe/London"})
        replace("learner_api.calendar._annotate_linked_catchups")
        replace("coach_api.meeting_outcomes.annotate_meeting_outcomes")
        replace("coach_api.live_session_outcomes.annotate_live_session_outcomes")

        for name in ("learner_api.review_history", "learner_api.imported_review_calendar"):
            replace(name + ".connection")
            replace(name + "._review_rows", side_effect=lambda *a: [self.row])
            replace(name + "._sections_by_review", side_effect=lambda *a: self.sections)
        replace("coach_api.views._sections_by_review", side_effect=lambda *a: self.sections)
        replace("coach_api.views.fetch_aptem_review_events",
                side_effect=lambda *a, **k: ([base_event(self.row)], None))
        replace("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[self.person])
        replace("coach_api.views.resolve_effective_aptem_ids", return_value=({21: 6301}, set()))
        replace("coach_api.views.get_learner_db_alias", return_value="default")
        db = replace("coach_api.views.connections")
        self.cursor = db["default"].cursor.return_value.__enter__.return_value
        self.overlay_query = replace("coach_api.models.ImportedReviewInstance.objects.filter")
        self.overlay_query.return_value.first.return_value = None
        self.overlay_query.return_value.filter.return_value = []

        # Reads must not reach any workflow, current metric or Native fallback.
        for target in (
            "coach_api.views.resolve_migrated_template",
            "coach_api.views.build_progress_snapshot",
            "coach_api.views.sync_calendar_event_to_graph",
            "curriculum_api.review_instances.ensure_review_instance",
            "learner_api.calendar._generated_cycle_events",
        ):
            replace(target, side_effect=AssertionError("Unexpected workflow: " + target))

    def main_response(self, kind="commercial", pk=121):
        return calendar.learner_calendar(
            self.factory.get("/learner_api/enrolment/commercial/121/calendar/"),
            kind=kind, pk=pk,
        )

    def payloads(self, kind="commercial"):
        self.cursor.description = [(key,) for key in self.row]
        self.cursor.fetchall.return_value = [tuple(self.row.values())]
        main = self.main_response(kind)
        self.assertEqual(main.status_code, 200)
        events = json.loads(main.content)["events"]
        self.assertEqual(len(events), 1)
        event = events[0]
        category = "monthly-coaching" if self.row["review_type"] == "Monthly Coaching Meeting" else "progress-review"
        response = review_history.learner_review_history(
            self.factory.get("/reviews/history/", {"category": category}), kind=kind, pk=121,
        )
        self.assertEqual(response.status_code, 200)
        history = json.loads(response.content)["reviews"]
        self.assertEqual(len(history), 1)
        request = self.factory.get("/coach_api/coach/reviews/" + event["eventKey"])
        request.coach_email = self.person.coach_email
        # Owner context replaces only the auth wrapper; the actual endpoint,
        # definition loader and synchronize-on-open historical guard execute.
        response = unwrap(views.coach_review_instance_detail)(request, event["eventKey"])
        self.assertEqual(response.status_code, 200)
        return event, history[0], json.loads(response.content)

    def assert_parity(self, *, kind="commercial", expected_fields=71):
        before = deepcopy((self.row, self.sections))
        event, history, coach = self.payloads(kind)
        learner = event["importedReview"]
        # Full DTO equality covers source IDs, source type, raw values,
        # stable field keys, ordering, instructions and presentation metadata.
        self.assertEqual(learner, history)
        self.assertEqual(learner, coach["historicalReview"])
        self.assertEqual(sum(len(s["fields"]) for s in learner["sections"]), expected_fields)
        self.assertEqual((self.row, self.sections), before)
        self.assertEqual(event["eventKey"], "imported-review:historical-reference")
        self.assertEqual(event["eventKey"], coach["instance"]["id"])
        self.assertEqual((event["reviewId"], learner["id"]), ("901", "901"))
        self.assertEqual(learner["type"], self.row["review_type"])
        self.assertEqual(event["importedReviewType"], self.row["review_type"])
        self.assertFalse(event["migratedForm"])
        self.assertTrue(coach["readOnly"])
        self.assertFalse(coach["migratedForm"])

        # Check the actual Coach field adapter too, not only its nested DTO.
        for historical, adapted in zip(learner["sections"], coach["sections"]):
            self.assertEqual(historical["name"], adapted["title"])
            fields = [f for f in adapted["fields"] if not f["id"].startswith("aptem-text:")]
            self.assertEqual(len(historical["fields"]), len(fields))
            for index, (original, field) in enumerate(zip(historical["fields"], fields)):
                self.assertEqual(field["title"], original["label"].strip())
                self.assertEqual(field["displayOrder"], index)
                self.assertEqual(field["answer"], original.get("displayValue", original.get("value")))
                key = ("source:" + original["sourceFieldKey"] if original.get("historicalSupplement")
                       else str(original["historicalIndex"]))
                self.assertEqual(field["id"], f'aptem-field:{historical["id"]}:{key}')
        rag = next(s for s in learner["sections"] if s["name"] == "RAG")
        self.assertEqual([(f["value"], f["displayValue"]) for f in rag["fields"]], [(3, "Green"), (3, "Green")])
        for role in ("Learner", "Manager", "Tutor"):
            instruction = next(s for s in learner["sections"] if s["name"] == role + " Reflections & Ratings")["fields"][0]
            self.assertEqual(instruction["fieldType"], "title_description")
            self.assertIsNone(instruction["value"])
        self.assertNotIn("Inactive question", json.dumps(learner))
        blank = next(f for s in learner["sections"] for f in s["fields"] if f["label"] == "Theme comments")
        self.assertIsNone(blank["value"])
        self.assertTrue(blank["preserveEmpty"])
        progress = next(s for s in learner["sections"] if s["name"] == "Learning progress")
        self.assertEqual(progress["fields"][1]["value"], self.sections[901][1]["fields"][1]["value"])
        return learner, coach

    def test_pr_routes_restore_questions_instructions_and_rag_for_both_learner_types(self):
        for kind in ("commercial", "apprenticeship"):
            with self.subTest(kind=kind):
                self.assert_parity(kind=kind)

    def test_second_pr_shape_retains_empty_conditional_answer_without_guessing(self):
        # A smaller saved projection and an active, explicitly blank branch.
        self.sections[901][3]["fields"] = self.sections[901][3]["fields"][:-4]
        payload = self.row["review_data"]["sections"][3]["source_payload"]
        payload["fields"] = payload["fields"][:-4]
        self.row["review_data"]["sections"][6]["source_payload"]["detail"] = None
        learner, _ = self.assert_parity(expected_fields=67)
        detail = learner["sections"][6]["fields"][1]
        self.assertIsNone(detail["value"])
        self.assertTrue(detail["preserveEmpty"])

    def test_completion_date_enriches_even_when_source_status_awaits_signature(self):
        self.row["status"] = "Awaiting Signature"
        learner, _ = self.assert_parity()
        self.assertEqual(learner["status"], "awaiting-signature")

    def test_mcm_keeps_historical_section_order_and_rich_summary(self):
        self.row, self.sections = capture_fixture("Monthly Coaching Meeting")
        learner, _ = self.assert_parity()
        self.assertEqual([s["name"] for s in learner["sections"]], [s["name"] for s in self.sections[901]])
        self.assertEqual(learner["sections"][10]["fields"][0]["value"], "<p>Historical meeting summary.</p>")

    def test_skills_radar_preserves_original_type_and_nested_assessments(self):
        self.row, self.sections = capture_fixture("Progress Review (+ Skills Radar)")
        skills = {"competency": {"name": "Communication"}, "characteristics": [
            {"name": "Explain plans", "assessedLevel": {"level": 2, "description": "Developing"},
             "levels": [{"level": 1, "description": "Beginning"}, {"level": 2, "description": "Developing"}]},
        ]}
        self.sections[901][2]["fields"][0] = {"label": "Skills Radar", "value": skills}
        self.row["review_data"]["sections"][2]["source_payload"] = {}
        learner, _ = self.assert_parity()
        self.assertEqual(learner["sections"][2]["fields"][0]["value"], skills)

    def test_local_continuation_preserves_open_source_and_booked_identity(self):
        for family, status in product(
            ("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"),
            ("in-progress", "completed"),
        ):
            with self.subTest(family=family, status=status):
                self.row, self.sections = capture_fixture(family)
                self.row.update(status="Scheduled", completed_date=None)
                key = "imported-review:historical-reference"
                local = overlay(source_review_id=901, event_key=key, status=status,
                                answers={"local-note": "Local saved answer"})
                record = booking(key, event_type="mcr" if family == "Monthly Coaching Meeting" else "progress-review")
                self.records = [record]
                self.overlay_query.return_value.filter.return_value = [local]
                before = deepcopy((self.row, self.sections, local.answers, local.template_snapshot))
                response = self.main_response()
                self.assertEqual(response.status_code, 200)
                event = json.loads(response.content)["events"][0]
                self.assertTrue(event["migratedForm"])
                self.assertEqual(event["status"], status)
                self.assertEqual(event["calendarEventKey"], key)
                self.assertEqual(event["meetingLink"], record.meeting_link)
                self.assertEqual(event["importedReview"], review_history._serialize_review(self.row, self.sections))
                self.assertNotIn("historicalPresentation", event["importedReview"]["sections"][0])
                self.assertEqual((self.row, self.sections, local.answers, local.template_snapshot), before)

    def test_native_calendar_never_enters_imported_enrichment(self):
        self.enrolment.aptem_id = ""
        self.person.aptem_id = None
        event = {"id": "review:native:2", "eventKey": "review:native:2", "source": "progress-review",
                 "reviewTemplateId": "native-template", "occurrenceNumber": 2, "status": "not-scheduled"}
        with patch.object(calendar, "_generated_cycle_events", return_value=[event]), \
             patch("curriculum_api.review_instances.reconcile_review_event_keys", return_value={}), \
             patch("learner_api.imported_review_calendar.imported_events_for_learner",
                   side_effect=AssertionError("Native source entered Aptem path")), \
             patch("learner_api.historical_review_presentation.enrich_historical_review",
                   side_effect=AssertionError("Native source was enriched")):
            response = self.main_response()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["events"], [event])

    def test_missing_historical_rag_label_keeps_numeric_value(self):
        del self.row["review_data"]["live_odata"]["RagLevel"]
        event, history, coach = self.payloads()
        self.assertEqual(event["importedReview"], history)
        self.assertEqual(history, coach["historicalReview"])
        self.assertEqual(history["sections"][8]["fields"][0]["value"], 3)
        self.assertNotIn("displayValue", history["sections"][8]["fields"][0])

    def test_other_learner_and_anonymous_requests_still_cannot_read_calendar_or_history(self):
        for account, expected in ((SimpleNamespace(role="learner", subject_id=122), 404), (None, 401)):
            with self.subTest(account=account):
                self.account.return_value = account
                self.assertEqual(self.main_response().status_code, expected)
                response = review_history.learner_review_history(
                    self.factory.get("/reviews/history/", {"category": "progress-review"}),
                    kind="commercial", pk=121,
                )
                self.assertEqual(response.status_code, expected)
