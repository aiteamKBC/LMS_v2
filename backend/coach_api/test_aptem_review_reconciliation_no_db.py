"""Aptem cutover preview and historical write gates, with no external services."""

import json
from datetime import date, datetime, time, timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import views
from coach_api.aptem_review_reconciliation import (
    build_aptem_review_reconciliation_preview, classify_aptem_review_preview,
)


TODAY = date(2026, 10, 2)
TEMPLATE_PR = {"id": "REV-PR", "name": "Progress Review"}
TEMPLATE_MCM = {"id": "REV-MCM", "name": "Monthly Coaching Meeting"}


def learner(*, aptem_id=101):
    return SimpleNamespace(
        id=1, enrolment_id=101, aptem_id=aptem_id,
        _caseload_source=SimpleNamespace(aptem_id=aptem_id),
        effective_aptem_id=aptem_id, programme="Programme", programme_id="PROG",
        programme_status="Active", cohort_id=None, group_id=None,
        start_date=TODAY, end_date=date(2027, 12, 31),
    )


def imported(status, *, review_type="Progress Review", review_id=7, planned=date(2026, 11, 1)):
    return {
        "id": review_id, "learner_id": 1, "aptem_review_id": f"A-{review_id}",
        "review_name": review_type, "review_type": review_type,
        "reviewer_name": "", "learner_name": "",
        "planned_scheduled_date": datetime.combine(planned, time(10), timezone.utc) if planned else None,
        "completed_date": datetime(2026, 9, 1, 10, tzinfo=timezone.utc) if status == "Completed" else None,
        "status": status, "review_data": {}, "extraction_status": "complete", "last_error": None,
    }


def occurrence(*, family="progress_review", number=1, target=date(2026, 11, 1)):
    template_id = "REV-MCM" if family == "mcm" else "REV-PR"
    return {
        "reviewTemplateId": template_id, "reviewTypeId": "REVT-MCM" if family == "mcm" else "REVT-PROGRESS_REVIEW",
        "reviewTypeCode": family, "occurrenceNumber": number,
        "occurrenceRef": f"generated:{number}", "occurrenceSource": "generated",
        "targetDate": target,
    }


def booking(*, template_id="", number=None, instance_id="", owner="coach@example.invalid",
            event_key="imported-review:A-7", scheduled=date(2026, 11, 1)):
    return SimpleNamespace(
        id=55, event_key=event_key, learner_id=1, owner_email=owner,
        review_instance_id=instance_id, review_template_id=template_id,
        occurrence_number=number, event_type="progress-review",
        scheduled_date=scheduled, scheduled_time=time(10), duration_minutes=60,
        operation_id=None, idempotency_key="", graph_event_id="GRAPH-1",
        graph_organizer_email="coach@example.invalid", graph_web_link="", meeting_link="https://example.invalid/meeting",
        meeting_provider="Microsoft Teams", sync_state="synced",
    )


def preview(imported_rows, *, occurrences=None, native_rows=None, calendar_rows=None,
            anchor=date(2026, 10, 1), programme_id="PROG", missing_reason=None):
    return classify_aptem_review_preview(
        learner=learner(), imported_rows=imported_rows,
        occurrences=occurrences if occurrences is not None else [occurrence()],
        native_rows=native_rows or [], calendar_rows=calendar_rows or [],
        templates=[TEMPLATE_PR, TEMPLATE_MCM], programme_id=programme_id,
        anchor=anchor, missing_reason=missing_reason,
        owner_email="coach@example.invalid", today=TODAY,
    )


class PreviewClassificationTests(SimpleTestCase):
    def test_completed_pr_and_mcm_are_historical_even_with_future_planned_dates(self):
        for review_type in ("Progress Review", "Monthly Coaching Meeting"):
            with self.subTest(review_type=review_type):
                family = "mcm" if review_type == "Monthly Coaching Meeting" else "progress_review"
                result = preview([imported("Completed", review_type=review_type)],
                                 occurrences=[occurrence(family=family)])
                self.assertEqual(result["items"][0]["classification"], "HISTORICAL_COMPLETED")
                self.assertEqual(result["items"][1]["classification"], "CONFLICT")
                self.assertEqual(result["items"][1]["reason"], "historical_import_date_collision")

    def test_advanced_statuses_are_protected(self):
        rows = [imported("AwaitingSignature", review_id=7), imported("InProgress", review_id=8)]
        result = preview(rows)
        self.assertEqual([item["classification"] for item in result["items"][:2]], [
            "PROTECTED_AWAITING_SIGNATURE", "PROTECTED_IN_PROGRESS",
        ])

    def test_date_only_scheduled_pr_and_mcm_are_not_ready(self):
        for review_type, family in (("Progress Review", "progress_review"),
                                    ("Monthly Coaching Meeting", "mcm")):
            with self.subTest(review_type=review_type):
                result = preview([imported("Scheduled", review_type=review_type)],
                                 occurrences=[occurrence(family=family)])
                item = result["items"][0]
                self.assertEqual(item["classification"], "FUTURE_SCHEDULED_OCCURRENCE_UNRESOLVED")
                self.assertEqual(item["candidateOccurrences"][0]["reviewTemplateId"],
                                 "REV-MCM" if family == "mcm" else "REV-PR")
                self.assertIsNone(item["occurrenceNumber"])
                self.assertEqual(result["summary"]["scheduledFuture"]["scheduledOccurrenceUnresolved"], 1)

    def test_multiple_date_candidates_are_a_conflict_without_durable_identity(self):
        result = preview([imported("Scheduled")], occurrences=[
            occurrence(number=1), occurrence(number=2),
        ])
        item = result["items"][0]
        self.assertEqual(item["classification"], "CONFLICT")
        self.assertEqual(item["reason"], "multiple_candidate_occurrences")
        self.assertEqual(len(item["candidateOccurrences"]), 2)

    def test_exact_booking_with_canonical_link_is_ready_without_mutation(self):
        row = booking(template_id="REV-PR", number=1)
        before = dict(row.__dict__)
        result = preview([imported("Scheduled")], calendar_rows=[row])
        item = result["items"][0]
        self.assertEqual(item["classification"], "FUTURE_SCHEDULED_READY_FOR_ADOPTION")
        self.assertEqual(item["bookingMatch"], "exact")
        self.assertEqual(item["calendarEventId"], 55)
        self.assertEqual(item["occurrenceNumber"], 1)
        self.assertEqual(item["booking"]["graphEventId"], "GRAPH-1")
        self.assertEqual(row.__dict__, before)

    def test_exact_booking_without_canonical_link_is_unresolved(self):
        result = preview([imported("Scheduled")], calendar_rows=[booking()])
        self.assertEqual(result["items"][0]["classification"], "FUTURE_SCHEDULED_OCCURRENCE_UNRESOLVED")

    def test_existing_native_instance_is_reported(self):
        native = {"id": "REVI-1", "review_template_id": "REV-PR", "learner_id": 1,
                  "occurrence_number": 1, "calendar_event_id": 55}
        result = preview([imported("Scheduled")], native_rows=[native],
                         calendar_rows=[booking(template_id="REV-PR", number=1,
                                                instance_id="REVI-1")])
        item = result["items"][0]
        self.assertEqual(item["classification"], "FUTURE_SCHEDULED_NATIVE_ALREADY_EXISTS")
        self.assertEqual(item["nativeReviewInstanceId"], "REVI-1")

    def test_not_scheduled_requires_durable_occurrence_identity(self):
        unsupported = preview([imported("Not Scheduled")])["items"][0]
        self.assertEqual(unsupported["classification"], "CONFLICT")
        linked = preview([imported("Not Scheduled")],
                         calendar_rows=[booking(template_id="REV-PR", number=1)])["items"][0]
        self.assertEqual(linked["classification"], "FUTURE_NOT_SCHEDULED_READY_FOR_NATIVE")

    def test_complete_one_to_one_history_resolves_not_scheduled_without_booking(self):
        rows = [imported("Completed", review_id=6, planned=date(2026, 9, 1)),
                imported("Not Scheduled", review_id=7, planned=date(2026, 11, 1))]
        result = preview(rows, occurrences=[
            occurrence(number=1, target=date(2026, 9, 1)),
            occurrence(number=2, target=date(2026, 11, 1)),
        ])
        historical, future = result["items"][:2]
        self.assertEqual(historical["classification"], "HISTORICAL_COMPLETED")
        self.assertEqual(historical["historicalFulfilment"]["occurrenceNumber"], 1)
        self.assertEqual(future["classification"], "FUTURE_NOT_SCHEDULED_READY_FOR_NATIVE")
        self.assertEqual(future["occurrenceNumber"], 2)
        self.assertIsNone(future["calendarEventId"])

    def test_proven_scheduled_occurrence_still_requires_durable_booking(self):
        rows = [imported("Completed", review_id=6, planned=date(2026, 9, 1)),
                imported("Scheduled", review_id=7, planned=date(2026, 11, 1))]
        result = preview(rows, occurrences=[
            occurrence(number=1, target=date(2026, 9, 1)),
            occurrence(number=2, target=date(2026, 11, 1)),
        ])
        self.assertEqual(result["items"][1]["classification"], "FUTURE_SCHEDULED_BOOKING_UNRESOLVED")
        self.assertEqual(result["items"][1]["reasonCode"], "BOOKING_UNRESOLVED")

    def test_incomplete_history_does_not_assign_sequence_from_date_alone(self):
        rows = [imported("Completed", review_id=6, planned=date(2026, 9, 1)),
                imported("Not Scheduled", review_id=7, planned=date(2026, 11, 1))]
        result = preview(rows, occurrences=[
            occurrence(number=1, target=date(2026, 8, 1)),
            occurrence(number=2, target=date(2026, 9, 1)),
            occurrence(number=3, target=date(2026, 11, 1)),
        ])
        self.assertIsNone(result["items"][0]["historicalFulfilment"])
        self.assertEqual(result["items"][1]["classification"], "CONFLICT")
        self.assertEqual(result["items"][1]["reasonCode"], "CONFLICT_DATE_ONLY_MATCH")

    def test_missing_source_window_and_template_ambiguity_have_reason_codes(self):
        cases = [
            (dict(anchor=None, missing_reason="missing_created_users_row"), "MISSING_ENROLMENT_SOURCE"),
            (dict(missing_reason="missing_window_end"), "MISSING_WINDOW_END"),
        ]
        for kwargs, code in cases:
            with self.subTest(code=code):
                item = preview([imported("Not Scheduled")], **kwargs)["items"][0]
                self.assertEqual(item["classification"], "MISSING_RECURRENCE_INPUT")
                self.assertEqual(item["reasonCode"], code)
                self.assertTrue(item["reasonDetail"])
        result = classify_aptem_review_preview(
            learner=learner(), imported_rows=[imported("Not Scheduled")],
            occurrences=[occurrence()], native_rows=[], calendar_rows=[],
            templates=[TEMPLATE_PR], programme_id="PROG", anchor=date(2026, 10, 1),
            owner_email="coach@example.invalid", today=TODAY,
            template_family_counts={"progress_review": 2},
        )
        self.assertEqual(result["items"][0]["reasonCode"], "CONFLICT_TEMPLATE_AMBIGUOUS")
        missing_family = classify_aptem_review_preview(
            learner=learner(), imported_rows=[imported("Not Scheduled", review_type="Monthly Coaching Meeting")],
            occurrences=[occurrence()], native_rows=[], calendar_rows=[],
            templates=[TEMPLATE_PR], programme_id="PROG", anchor=date(2026, 10, 1),
            owner_email="coach@example.invalid", today=TODAY,
            template_family_counts={"progress_review": 1, "mcm": 0},
        )
        self.assertEqual(missing_family["items"][0]["reasonCode"], "MISSING_FAMILY_TEMPLATE")

    def test_existing_durably_linked_native_precedes_missing_recurrence_input(self):
        row = booking(template_id="REV-PR", number=1, instance_id="REVI-1")
        native = {"id": "REVI-1", "review_template_id": "REV-PR", "learner_id": 1,
                  "occurrence_number": 1, "calendar_event_id": 55}
        item = preview([imported("Scheduled")], occurrences=[], native_rows=[native],
                       calendar_rows=[row], anchor=None,
                       missing_reason="missing_created_users_row")["items"][0]
        self.assertEqual(item["classification"], "FUTURE_SCHEDULED_NATIVE_ALREADY_EXISTS")
        self.assertEqual(item["nativeReviewInstanceId"], "REVI-1")

    def test_conflicting_native_link_and_ownership_are_rejected(self):
        result = preview([imported("Scheduled")],
                         calendar_rows=[booking(template_id="REV-PR", number=1,
                                                owner="other@example.invalid")])
        self.assertEqual(result["items"][0]["classification"], "CONFLICT")
        self.assertIsNone(result["items"][0]["booking"])

    def test_missing_anchor_and_template_are_reported(self):
        for kwargs in ({"anchor": None, "missing_reason": "missing_start_date"},
                       {"occurrences": [], "missing_reason": "no_applicable_native_review_template"}):
            with self.subTest(kwargs=kwargs):
                result = preview([imported("Scheduled")], **kwargs)
                self.assertEqual(result["items"][0]["classification"], "MISSING_RECURRENCE_INPUT")

    def test_past_open_review_is_not_counted_as_missing_future_recurrence(self):
        item = preview([imported("Not Scheduled", planned=date(2026, 8, 1))],
                       anchor=None, missing_reason="missing_created_users_row")["items"][0]
        self.assertEqual(item["classification"], "CONFLICT")
        self.assertEqual(item["reasonCode"], "CONFLICT_PAST_OR_UNSUPPORTED_STATUS")

    def test_skills_radar_maps_to_pr_and_other_type_is_unsupported(self):
        rows = [imported("Scheduled", review_type="Progress Review (+ Skills Radar)"),
                imported("Scheduled", review_type="Gateway Review", review_id=8)]
        result = preview(rows)
        self.assertEqual(result["items"][0]["reviewFamily"], "progress_review")
        self.assertEqual(result["items"][1]["classification"], "UNSUPPORTED")

    def test_native_occurrence_remains_native_without_aptem_row(self):
        result = preview([], native_rows=[{"id": "REVI-1", "review_template_id": "REV-PR",
                                          "learner_id": 1, "occurrence_number": 1}])
        self.assertEqual(result["items"][0]["classification"], "NATIVE_ALREADY_EXISTS")
        self.assertEqual(result["items"][0]["nativeReviewInstanceId"], "REVI-1")


class HistoricalWriteGateTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("coach_api.views.curriculum_review_instances.progress_review_rag_history", return_value=[])
    @patch("coach_api.views._imported_review_progress_snapshot", return_value=None)
    @patch("coach_api.views.ImportedReviewInstance.objects.filter")
    @patch("coach_api.views._sections_by_review")
    @patch("coach_api.views.connections")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_completed_with_sections_is_read_only_for_pr_and_mcm(
        self, profiles, connections, sections, overlays, _snapshot, _history,
    ):
        profiles.return_value = [learner()]
        overlays.return_value.first.return_value = SimpleNamespace(
            status="in-progress", answers={"field": "local edit"}, completed_at=None,
        )
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = ["id", "learner_id", "aptem_review_id", "review_name", "review_type",
                   "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
                   "status", "review_data", "extraction_status", "last_error"]
        cursor.description = [(column,) for column in columns]
        sections.return_value = {7: [{"id": 1, "name": "Section", "order": 0,
                                     "fields": [{"label": "Question", "value": "Original"}],
                                     "tables": [], "rawText": ""}]}
        for review_type in ("Progress Review", "Monthly Coaching Meeting"):
            with self.subTest(review_type=review_type):
                cursor.fetchall.return_value = [tuple(imported("Completed", review_type=review_type)[col]
                                                       for col in columns)]
                definition = views._imported_review_definition("coach@example.invalid", "imported-review:A-7")
                self.assertTrue(definition["formAvailable"])
                self.assertFalse(definition["summaryOnly"])
                self.assertTrue(definition["readOnly"])
                self.assertEqual(definition["instance"]["status"], "completed")
                self.assertEqual(definition["historicalReview"]["sections"][0]["fields"][0]["value"], "Original")
                self.assertEqual(definition["sections"][0]["fields"][0]["answer"], "Original")

    @patch("coach_api.views.ImportedReviewInstance.objects.get_or_create")
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views._imported_review_definition")
    def test_completed_answer_and_completion_writes_stop_before_storage(
        self, definition, _owner, get_or_create,
    ):
        definition.return_value = {"readOnly": True, "summaryOnly": False,
                                   "instance": {"id": "imported-review:A-7", "status": "completed"},
                                   "sections": [{"fields": [{"id": "field"}]}]}
        for endpoint, suffix in ((views.coach_review_instance_answers, "answers"),
                                 (views.coach_review_instance_complete, "complete")):
            with self.subTest(suffix=suffix):
                request = self.factory.post(f"/coach/reviews/imported-review:A-7/{suffix}",
                                            data=json.dumps({"answers": {"field": "change"}}),
                                            content_type="application/json")
                response = unwrap(endpoint)(request, "imported-review:A-7")
                self.assertEqual(response.status_code, 409)
        get_or_create.assert_not_called()

    @patch("coach_api.views._authorized_review_instance")
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views._imported_review_definition", return_value={"readOnly": True})
    def test_imported_signature_cannot_reach_native_writer(self, _definition, _owner, authorized):
        request = self.factory.post("/coach/reviews/imported-review:A-7/signatures",
                                    data=json.dumps({"role": "advisor"}), content_type="application/json")
        response = unwrap(views.coach_review_instance_signature)(request, "imported-review:A-7")
        self.assertEqual(response.status_code, 409)
        authorized.assert_not_called()

    @patch("coach_api.views.CoachCalendarEvent.objects.filter")
    @patch("coach_api.views.find_generated_timetable_event")
    @patch("coach_api.views.find_catchup_calendar_record", return_value=(None, ""))
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    def test_completed_import_cannot_be_completed_through_calendar_action(
        self, _owner, _catchup, generated, calendar_filter,
    ):
        generated.return_value = ({"reviewSource": "aptem", "status": "completed"}, "Coach")
        request = self.factory.post("/coach/timetable/events/action",
                                    data=json.dumps({"eventKey": "imported-review:A-7", "action": "complete"}),
                                    content_type="application/json")
        response = unwrap(views.coach_timetable_event_action)(request)
        self.assertEqual(response.status_code, 409)
        calendar_filter.assert_not_called()

    @patch("coach_api.views.CoachCalendarEvent.objects.filter")
    @patch("coach_api.views.find_generated_timetable_event")
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    def test_imported_review_cannot_open_native_instance(self, _owner, generated, calendar_filter):
        generated.return_value = ({"reviewSource": "aptem", "status": "completed"}, "Coach")
        request = self.factory.post("/coach/reviews/open",
                                    data=json.dumps({"eventKey": "imported-review:A-7"}),
                                    content_type="application/json")
        response = unwrap(views.coach_review_instance_for_event)(request)
        self.assertEqual(response.status_code, 409)
        calendar_filter.assert_not_called()

    @patch("coach_api.views.CoachCalendarEvent.objects.get_or_create")
    @patch("coach_api.views.find_generated_timetable_event")
    @patch("coach_api.views.find_catchup_template_event", return_value=(None, ""))
    @patch("coach_api.views.find_catchup_calendar_record", return_value=(None, ""))
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    def test_completed_import_cannot_be_rescheduled(self, _owner, _catchup, _template,
                                                     generated, get_or_create):
        generated.return_value = ({"reviewSource": "aptem", "status": "completed"}, "Coach")
        request = self.factory.post("/coach/timetable/events/schedule",
                                    data=json.dumps({"eventKey": "imported-review:A-7",
                                                     "scheduledDate": "2026-11-01",
                                                     "scheduledTime": "10:00"}),
                                    content_type="application/json")
        response = unwrap(views.coach_timetable_schedule_event)(request)
        self.assertEqual(response.status_code, 409)
        get_or_create.assert_not_called()


class PreviewEndpointTests(SimpleTestCase):
    @patch("coach_api.aptem_review_reconciliation.build_aptem_review_reconciliation_preview")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    @patch("coach_api.views.fetch_owner_active_learner_profiles")
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    def test_get_is_scoped_and_returns_service_result(self, _owner, profiles, _ids, build):
        profiles.return_value = [learner()]
        build.return_value = {"learnerId": 1, "items": [], "summary": {}}
        request = RequestFactory().get("/coach/reviews/learners/1/aptem-reconciliation-preview")
        response = unwrap(views.coach_aptem_review_reconciliation_preview)(request, 1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["learnerId"], 1)
        build.assert_called_once()

    @patch("coach_api.aptem_review_reconciliation.build_aptem_review_reconciliation_preview")
    @patch("coach_api.views.fetch_owner_active_learner_profiles", return_value=[])
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    def test_other_coach_cannot_preview_learner(self, _owner, _profiles, build):
        request = RequestFactory().get("/coach/reviews/learners/1/aptem-reconciliation-preview")
        response = unwrap(views.coach_aptem_review_reconciliation_preview)(request, 1)
        self.assertEqual(response.status_code, 404)
        build.assert_not_called()

    @patch("coach_api.aptem_review_reconciliation.build_aptem_review_reconciliation_preview")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({}, set()))
    @patch("coach_api.views.fetch_owner_active_learner_profiles")
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    def test_native_only_learner_does_not_enter_preview(self, _owner, profiles, _ids, build):
        profiles.return_value = [learner(aptem_id=None)]
        request = RequestFactory().get("/coach/reviews/learners/1/aptem-reconciliation-preview")
        response = unwrap(views.coach_aptem_review_reconciliation_preview)(request, 1)
        self.assertEqual(response.status_code, 404)
        build.assert_not_called()


class PreviewReadOnlyTests(SimpleTestCase):
    @patch("coach_api.views.get_graph_settings")
    @patch("coach_api.views.synchronize_reserved_calendar_event")
    @patch("coach_api.aptem_review_reconciliation.CoachCalendarEvent.objects.create")
    @patch("coach_api.aptem_review_reconciliation.review_instances.ensure_review_instance")
    @patch("coach_api.aptem_review_reconciliation.CoachCalendarEvent.objects.filter", return_value=[])
    @patch("coach_api.aptem_review_reconciliation.review_instances.list_review_instances_for_learner", return_value=[])
    @patch("coach_api.aptem_review_reconciliation.connections")
    @patch("coach_api.aptem_review_reconciliation.review_instances.resolve_programme_review_occurrences")
    @patch("coach_api.aptem_review_reconciliation.review_instances.learner_is_eligible", return_value=True)
    @patch("coach_api.aptem_review_reconciliation.review_instances.review_applies_to_placement", return_value=True)
    @patch("coach_api.aptem_review_reconciliation.review_types.review_type_index")
    @patch("coach_api.aptem_review_reconciliation.review_instances.list_enabled_review_templates")
    @patch("coach_api.views.resolve_schedule_window")
    @patch("coach_api.views.resolve_review_anchor_date")
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.resolve_curriculum_programme_id", return_value="PROG")
    @patch("coach_api.aptem_review_reconciliation.schema_gate.runtime_bootstrap_allowed", return_value=False)
    def test_builder_reads_existing_recurrence_and_never_calls_writers_or_graph(
        self, _gate, _programme, _sources, anchor, window, templates, types,
        _scope, _eligible, occurrences, connections, _native, _calendar,
        ensure, create, sync, graph,
    ):
        anchor.return_value = (date(2026, 10, 1), None)
        window.return_value = (date(2026, 10, 1), date(2027, 1, 1))
        templates.return_value = [{**TEMPLATE_PR, "review_type_id": "REVT-PROGRESS_REVIEW"}]
        types.return_value = {"REVT-PROGRESS_REVIEW": {"code": "progress_review"}}
        occurrences.return_value = [occurrence()]
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = ["id", "learner_id", "aptem_review_id", "review_name", "review_type",
                   "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
                   "status", "review_data", "extraction_status", "last_error"]
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [tuple(imported("Scheduled")[column] for column in columns)]

        with patch("coach_api.views.microsoft_graph_request") as teams_request:
            result = build_aptem_review_reconciliation_preview(
                learner(), "coach@example.invalid", today=TODAY,
            )
        teams_request.assert_not_called()

        self.assertEqual(result["items"][0]["classification"], "FUTURE_SCHEDULED_OCCURRENCE_UNRESOLVED")
        occurrences.assert_called_once()
        ensure.assert_not_called()
        create.assert_not_called()
        sync.assert_not_called()
        graph.assert_not_called()
