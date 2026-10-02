import json
from datetime import date, time
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from django.db import DatabaseError

from coach_api import views
from coach_api.models import CoachCalendarEvent


def learner(profile_id, *, aptem_id=None, source_aptem_id=None):
    return SimpleNamespace(
        id=profile_id,
        enrolment_id=profile_id + 100,
        aptem_id=aptem_id,
        _caseload_source=SimpleNamespace(aptem_id=source_aptem_id),
        username=f"Learner {profile_id}",
        full_name=f"Learner {profile_id}",
        email=f"learner-{profile_id}@example.invalid",
        programme="Programme",
        programme_id="programme-1",
        programme_status="delivery",
        cohort="Cohort",
        cohort_id="cohort-1",
        group_name="Group",
        group_id="group-1",
        coach_name="Coach",
    )


class EffectiveAptemIdentityTests(SimpleTestCase):
    def test_enrolment_value_wins_and_profile_is_a_matching_fallback_only(self):
        rows = [
            learner(1, aptem_id=101, source_aptem_id=101),
            learner(2, aptem_id=202, source_aptem_id=None),
            learner(3, aptem_id=None, source_aptem_id=303),
        ]

        resolved, conflicts = views.resolve_effective_aptem_ids(rows)

        self.assertEqual(resolved, {1: 101, 2: 202, 3: 303})
        self.assertEqual(conflicts, set())

    def test_disagreeing_stable_ids_are_rejected_without_a_fuzzy_fallback(self):
        resolved, conflicts = views.resolve_effective_aptem_ids([
            learner(7, aptem_id=700, source_aptem_id=701),
        ])

        self.assertEqual(resolved, {})
        self.assertEqual(conflicts, {7})


class SharedReviewSourceResolverTests(SimpleTestCase):
    @patch("coach_api.views.resolve_curriculum_programme_id", return_value=None)
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.fetch_aptem_review_events", side_effect=DatabaseError("statement timeout"))
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    def test_aptem_timeout_is_reported_without_failing_the_whole_timetable(
        self, _identities, _fetch_aptem, _source_rows, _programme,
    ):
        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [learner(1)])

        self.assertEqual(result["events"], [])
        self.assertIn(
            {"learnerId": "1", "code": "aptem_reviews_unavailable"},
            result["reviewGenerationIssues"],
        )

    @patch("coach_api.views.resolve_curriculum_review_occurrences")
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.fetch_aptem_review_events")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    def test_aptem_learner_with_aptem_mcm_uses_aptem_only(
        self, _identities, fetch_aptem, _source_rows, curriculum_occurrences,
    ):
        aptem_events = [
            {"eventKey": "imported-review:A-1", "source": "progress-review", "reviewSource": "aptem", "learnerId": "1"},
            {"eventKey": "imported-review:A-2", "source": "mcr", "reviewSource": "aptem", "learnerId": "1"},
        ]
        fetch_aptem.return_value = (aptem_events, {1})

        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [learner(1)])

        self.assertEqual(result["events"], aptem_events)
        curriculum_occurrences.assert_not_called()
        self.assertEqual(result["sourceCounts"]["aptemLearners"], 1)
        self.assertEqual(result["sourceCounts"]["curriculumLearners"], 0)
        self.assertEqual(result["sourceCounts"]["curriculumMcmFallbackLearners"], 0)

    @patch("coach_api.views.build_generated_calendar_event")
    @patch("coach_api.views.resolve_curriculum_review_occurrences")
    @patch("coach_api.views.resolve_curriculum_programme_id", return_value="programme-1")
    @patch("coach_api.views.resolve_schedule_window", return_value=(date(2026, 1, 1), date(2027, 1, 1)))
    @patch("coach_api.views.resolve_review_anchor_date", return_value=(date(2026, 1, 1), None))
    @patch("coach_api.views.curriculum_review_instances.programme_review_template_identifiers", return_value=[("template-1", "mcm")])
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.fetch_aptem_review_events")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    def test_aptem_learner_without_imported_mcm_does_not_get_curriculum_fallback(
        self, _identities, fetch_aptem, _source_rows, _templates, _anchor, _window,
        _programme, occurrences, build_event,
    ):
        aptem_event = {"eventKey": "imported-review:A-1", "source": "progress-review", "reviewSource": "aptem", "learnerId": "1"}
        fetch_aptem.return_value = ([aptem_event], {1})
        occurrences.return_value = [
            {"reviewTypeCode": "mcm", "occurrenceNumber": 1, "targetDate": date(2026, 10, 24),
             "reviewTemplateId": "template-1", "reviewName": "Monthly Coaching", "occurrenceSource": "generated"},
            {"reviewTypeCode": "progress_review", "occurrenceNumber": 1, "targetDate": date(2026, 11, 24),
             "reviewTemplateId": "template-2", "reviewName": "Progress Review", "occurrenceSource": "generated"},
        ]
        build_event.side_effect = lambda **kwargs: {"eventKey": f"review:1:{kwargs['review_template_id']}:1", "source": kwargs["event_type"]}

        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [learner(1)])

        self.assertEqual(result["events"], [aptem_event])
        occurrences.assert_not_called()
        build_event.assert_not_called()
        self.assertEqual(result["reviewGenerationIssues"], [])
        self.assertEqual(result["sourceCounts"]["curriculumMcmFallbackLearners"], 0)
        self.assertEqual(result["aptemProfileIds"], {1})

    @patch("coach_api.views.resolve_curriculum_review_occurrences", return_value=[])
    @patch("coach_api.views.fetch_aptem_mcm_profile_ids", return_value={1})
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.fetch_aptem_review_events")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    def test_windowed_resolution_checks_aptem_mcm_outside_the_window(
        self, _identities, fetch_aptem, _source_rows, _mcm_profiles, curriculum_occurrences,
    ):
        # The Aptem MCM falls outside the requested month, so the windowed
        # fetch is empty, but the learner still has Aptem MCMs -- no fallback.
        fetch_aptem.return_value = ([], set())

        result = views.resolve_coach_review_events(
            "coach@example.invalid", "Coach", [learner(1)],
            start_date=date(2026, 9, 1), end_date=date(2026, 9, 30),
        )

        self.assertEqual(result["events"], [])
        curriculum_occurrences.assert_not_called()
        self.assertEqual(result["sourceCounts"]["curriculumMcmFallbackLearners"], 0)

    @patch("coach_api.views.build_generated_calendar_event")
    @patch("coach_api.views.resolve_curriculum_review_occurrences")
    @patch("coach_api.views.resolve_curriculum_programme_id", return_value="programme-1")
    @patch("coach_api.views.resolve_schedule_window", return_value=(date(2026, 1, 1), date(2027, 1, 1)))
    @patch("coach_api.views.resolve_review_anchor_date", return_value=(date(2026, 1, 1), None))
    @patch("coach_api.views.curriculum_review_instances.programme_review_template_identifiers", return_value=[("template-1", "mcr")])
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.fetch_aptem_review_events", return_value=([], set()))
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({}, set()))
    def test_native_learner_uses_curriculum_only(
        self, _identities, fetch_aptem, _source_rows, _templates, _anchor, _window,
        _programme, occurrences, build_event,
    ):
        occurrences.return_value = [{
            "reviewTypeCode": "mcr", "occurrenceNumber": 1,
            "targetDate": date(2026, 9, 23), "reviewTemplateId": "template-1",
            "reviewName": "Monthly Coaching", "occurrenceSource": "generated",
        }]
        build_event.return_value = {"eventKey": "review:2:1", "source": "mcr"}

        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [learner(2)])

        self.assertEqual(result["events"][0]["reviewSource"], "curriculum")
        fetch_aptem.assert_called_once_with(
            [learner(2)], {}, owner_email="coach@example.invalid", owner_name="Coach",
            start_date=None, end_date=None,
        )
        occurrences.assert_called_once()
        self.assertEqual(result["sourceCounts"]["curriculumLearners"], 1)

    @patch("coach_api.views.build_generated_calendar_event")
    @patch("coach_api.views.resolve_curriculum_review_occurrences")
    @patch("coach_api.views.resolve_curriculum_programme_id", return_value="programme-1")
    @patch("coach_api.views.resolve_schedule_window", return_value=(date(2026, 1, 1), date(2027, 1, 1)))
    @patch("coach_api.views.resolve_review_anchor_date", return_value=(date(2026, 1, 1), None))
    @patch("coach_api.views.curriculum_review_instances.programme_review_template_identifiers", return_value=[("template-1", "pr")])
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.fetch_aptem_review_events")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    def test_mixed_caseload_uses_each_source_once(
        self, _identities, fetch_aptem, _source_rows, _templates, _anchor, _window,
        _programme, occurrences, build_event,
    ):
        aptem_event = {"eventKey": "imported-review:A-1", "source": "mcr", "reviewSource": "aptem", "learnerId": "1"}
        fetch_aptem.return_value = ([aptem_event], {1})
        occurrences.return_value = [{
            "reviewTypeCode": "pr", "occurrenceNumber": 1,
            "targetDate": date(2026, 9, 24), "reviewTemplateId": "template-1",
            "reviewName": "Progress Review", "occurrenceSource": "generated",
        }]
        build_event.return_value = {"eventKey": "review:2:1", "source": "progress-review"}

        result = views.resolve_coach_review_events(
            "coach@example.invalid", "Coach", [learner(1), learner(2)],
        )

        self.assertEqual([event["reviewSource"] for event in result["events"]], ["aptem", "curriculum"])
        called_learner_ids = {call.kwargs["learner_id"] for call in occurrences.call_args_list}
        self.assertEqual(called_learner_ids, {2})


class CoachAttendanceGroupNameTests(SimpleTestCase):
    def test_final_attendance_payload_preserves_learner_group_name_and_id(self):
        source = {
            "id": "1", "name": "Learner", "initials": "L",
            "learnerType": "commercial", "enrolmentId": "101",
            "currentModule": None, "currentWeek": None, "componentsTargetToDate": 0,
            "email": "learner@example.invalid", "programmeName": "Commercial Intelligence",
            "programmeId": "PROG-CI-L6",
            "cohortName": "October 2025", "group": "G1 Keith-Commercial Intelligence-Oct 25",
            "groupName": "G1 Keith-Commercial Intelligence-Oct 25",
            "groupId": "APTEM-GROUP-stable", "rawProgramStatus": "Active",
            "enrollmentStatus": "active", "employer": "--", "overallProgress": 0,
            "otjhCompleted": 0, "otjhPlanned": 0, "otjhTarget": 1, "ksbProgress": 0,
        }

        result = views.serialize_attendance_learner(source, None)

        self.assertEqual(result["groupName"], "G1 Keith-Commercial Intelligence-Oct 25")
        self.assertEqual(result["groupId"], "APTEM-GROUP-stable")
        self.assertEqual(result["programmeId"], "PROG-CI-L6")


class DashboardCompletedReviewHistoryTests(SimpleTestCase):
    def test_latest_completed_dates_use_only_completed_at_and_stable_profile_id(self):
        rows = [learner(316), learner(401), learner(402), learner(403), learner(404)]
        events = [
            # Abbie Nicol acceptance history: latest completed PR/MCM win.
            {"learnerId": "316", "source": "progress-review", "status": "completed", "reviewCompletedAt": "2026-07-23"},
            {"learnerId": "316", "source": "progress-review", "status": "completed", "reviewCompletedAt": "2026-05-11"},
            {"learnerId": "316", "source": "mcr", "status": "completed", "reviewCompletedAt": "2026-09-08"},
            {"learnerId": "316", "source": "mcr", "status": "completed", "reviewCompletedAt": "2026-08-11"},
            # Planned/current events must never replace completed history.
            {"learnerId": "316", "source": "progress-review", "status": "confirmed", "reviewCompletedAt": "2026-10-01"},
            {"learnerId": "316", "source": "mcr", "status": "in-progress", "reviewCompletedAt": "2026-10-02"},
            {"learnerId": "316", "source": "progress-review", "status": "completed", "targetDate": "2026-12-01"},
            # Daniel and Douglas cover independent stable-id selection.
            {"learnerId": "401", "source": "progress-review", "status": "completed", "reviewCompletedAt": "2026-06-14"},
            {"learnerId": "401", "source": "mcr", "status": "completed", "reviewCompletedAt": "2026-08-02"},
            {"learnerId": "402", "source": "progress-review", "status": "completed", "reviewCompletedAt": "2026-04-19"},
            {"learnerId": "402", "source": "mcr", "status": "completed", "reviewCompletedAt": "2026-07-21"},
            # 403 genuinely has no completed PR; 404 genuinely has no completed MCM.
            {"learnerId": "403", "source": "mcr", "status": "completed", "reviewCompletedAt": "2026-08-20"},
            {"learnerId": "403", "source": "progress-review", "status": "scheduled", "reviewCompletedAt": None},
            {"learnerId": "404", "source": "progress-review", "status": "completed", "reviewCompletedAt": "2026-08-25"},
            {"learnerId": "404", "source": "mcr", "status": "confirmed", "reviewCompletedAt": None},
            # Same display data, wrong stable id: ignored.
            {"learnerId": "999", "source": "progress-review", "status": "completed", "reviewCompletedAt": "2026-09-30"},
        ]

        result = views.latest_completed_review_dates_from_events(rows, events)

        self.assertEqual(result[316], {"lastPr": "23 Jul 2026", "lastMcm": "08 Sep 2026"})
        self.assertEqual(result[401], {"lastPr": "14 Jun 2026", "lastMcm": "02 Aug 2026"})
        self.assertEqual(result[402], {"lastPr": "19 Apr 2026", "lastMcm": "21 Jul 2026"})
        self.assertEqual(result[403], {"lastPr": None, "lastMcm": "20 Aug 2026"})
        self.assertEqual(result[404], {"lastPr": "25 Aug 2026", "lastMcm": None})

    @patch("coach_api.views.resolve_coach_review_events")
    def test_dashboard_history_reuses_unbounded_shared_resolver(self, resolve_reviews):
        row = learner(316, aptem_id=5170, source_aptem_id=5170)
        resolve_reviews.return_value = {
            "events": [{
                "learnerId": "316", "source": "progress-review", "reviewSource": "aptem",
                "status": "completed", "reviewCompletedAt": "2026-07-23",
            }],
        }

        result = views.dashboard_latest_completed_review_dates(
            [row], owner_email="coach@example.invalid", owner_name="Coach",
        )

        resolve_reviews.assert_called_once_with(
            "coach@example.invalid", "Coach", [row],
        )
        self.assertEqual(result[316], {"lastPr": "23 Jul 2026", "lastMcm": None})


class AptemEventVerificationTests(SimpleTestCase):
    def test_imported_aptem_learning_progress_text_becomes_visual_snapshot(self):
        snapshot = views._imported_progress_snapshot_from_review({
            "plannedDate": "2026-09-25",
            "completedDate": None,
            "sections": [{
                "name": "Learning Progress",
                "rawText": (
                    "Learning Plan Activities 41 of 94 Completed Submitted Remaining Target 41 1 52 57 "
                    "Off–The–Job Hours Overall Progress 46% (263h) Minimum Required 557h "
                    "Planned Hours (ILR) 576h Completed 263h Forecast 637h "
                    "Progress Marketing Manager Apprenticeship Standard [V1.0] (Level 6) Behind 17% "
                    "Timeline Start: 7 Nov 2025 Planned End: 6 Aug 2027"
                ),
            }],
        })

        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot["calculatedFrom"], "2025-11-07")
        self.assertEqual(snapshot["calculatedAt"], "2026-09-25")
        self.assertEqual(snapshot["programmeProgress"]["actual"], 41)
        self.assertEqual(snapshot["programmeProgress"]["expected"], 57)
        self.assertEqual(snapshot["programmeProgress"]["actualPercent"], 43.62)
        self.assertEqual(snapshot["offTheJobHours"]["actual"], 263.0)
        self.assertEqual(snapshot["offTheJobHours"]["actualPercent"], 46.0)

    def test_embedded_section_requires_usable_content_before_form_is_available(self):
        self.assertFalse(views._imported_review_has_usable_form({
            "sections": [{"id": "empty", "fields": [], "tables": [], "rawText": ""}],
        }))
        self.assertTrue(views._imported_review_has_usable_form({
            "sections": [{"id": "answer", "fields": [{"label": "Progress", "value": "Good"}]}],
        }))
        self.assertTrue(views._imported_review_has_usable_form(
            {"sections": []},
            has_normalized_sections=True,
        ))

    def test_missing_calendar_overlay_preserves_each_aptem_lifecycle_status(self):
        for status in ("not-scheduled", "scheduled", "in-progress", "awaiting-signature", "completed"):
            with self.subTest(status=status):
                base = {
                    "eventKey": f"imported-review:{status}",
                    "reviewSource": "aptem",
                    "status": status,
                    "rawStatus": status.replace("-", " ").title(),
                    "targetDate": "2026-09-23",
                    "scheduledDate": "2026-09-23",
                    "scheduledTime": "11:00",
                    "reviewCompletedAt": "2026-09-23" if status == "completed" else None,
                }

                event = views.overlay_calendar_record(base, None)

                self.assertEqual(event["status"], status)
                self.assertEqual(event["rawStatus"], base["rawStatus"])

    def test_confirmed_aptem_review_is_preserved_and_never_becomes_completed(self):
        base = {
            "eventKey": "imported-review:confirmed", "reviewSource": "aptem",
            "status": "confirmed", "rawStatus": "Confirmed",
            "targetDate": "2026-09-23", "scheduledDate": "2026-09-23",
            "scheduledTime": "11:00",
        }

        event = views.overlay_calendar_record(base, None)

        self.assertEqual(event["status"], "confirmed")
        self.assertEqual(event["scheduledTime"], "11:00")

    def test_native_event_still_uses_calendar_lifecycle_status(self):
        base = {
            "eventKey": "review:1:1", "reviewSource": "curriculum",
            "status": "completed", "targetDate": "2026-09-23",
        }

        event = views.overlay_calendar_record(base, None)

        self.assertEqual(event["status"], CoachCalendarEvent.STATUS_NOT_SCHEDULED)

    def test_linked_calendar_booking_overlays_the_same_aptem_event_identity(self):
        base = {
            "eventKey": "imported-review:R-1", "id": "imported-review:R-1",
            "source": "mcr", "reviewSource": "aptem", "status": "in-progress",
            "rawStatus": "In Progress", "targetDate": "2026-09-23", "title": "MCM",
        }
        record = CoachCalendarEvent(
            event_key="imported-review:R-1", owner_email="coach@example.invalid",
            learner_id=1, event_type="mcr", target_date=date(2026, 9, 23),
            scheduled_date=date(2026, 9, 24), scheduled_time=time(11, 0),
            duration_minutes=60, status=CoachCalendarEvent.STATUS_SCHEDULED,
            meeting_provider="Microsoft Teams", meeting_link="https://teams.example.invalid/join",
        )

        event = views.overlay_calendar_record(base, record)

        self.assertEqual(event["eventKey"], "imported-review:R-1")
        self.assertEqual(event["status"], "in-progress")
        self.assertEqual(event["scheduledDate"], "2026-09-24")
        self.assertEqual(event["scheduledTime"], "11:00")
        self.assertEqual(event["meetingLink"], "https://teams.example.invalid/join")

    @patch("coach_api.views.connections")
    def test_only_matching_source_learner_id_is_emitted_and_ids_are_deduplicated(self, connections):
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = [
            "learner_id", "id", "aptem_review_id", "review_name", "review_type",
            "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
            "status", "review_data", "extraction_status", "last_error", "has_review_sections", "source_learner_id",
        ]
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [
            (1, 11, "R-1", "MCM", "MCM", "Coach", "Learner 1", date(2026, 9, 23), None, "Planned", "{}", "complete", None, True, "101"),
            (1, 12, "R-1", "MCM", "MCM", "Coach", "Learner 1", date(2026, 9, 23), None, "Planned", "{}", "complete", None, True, "101"),
            (1, 13, "R-2", "Progress Review", "Progress Review", "Coach", "Learner 1", None, date(2026, 9, 22), "Finished", "{}", "complete", None, True, "999"),
            (1, 14, "R-3", "Gateway Review", "Gateway Review", "Coach", "Learner 1", date(2026, 9, 24), None, "Planned", "{}", "complete", None, True, None),
        ]

        events, contributors = views.fetch_aptem_review_events(
            [learner(1)], {1: 101}, owner_email="coach@example.invalid", owner_name="Coach",
        )

        self.assertEqual(
            [event["eventKey"] for event in events],
            ["imported-review:R-1", "imported-review:R-3"],
        )
        self.assertEqual(contributors, {1})
        self.assertEqual(events[0]["learnerId"], "1")
        self.assertTrue(events[0]["hasReviewForm"])
        self.assertNotIn("reviewInstanceId", events[0])
        self.assertNotIn("reviewTemplateId", events[0])
        query = cursor.execute.call_args.args[0]
        self.assertIn("jsonb_build_object", query)
        self.assertNotIn("lr.review_data, lr.extraction_status", query)

    @patch("coach_api.views.connections")
    def test_metadata_only_import_does_not_claim_to_have_a_review_form(self, connections):
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = [
            "learner_id", "id", "aptem_review_id", "review_name", "review_type",
            "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
            "status", "review_data", "extraction_status", "last_error", "has_review_sections", "source_learner_id",
        ]
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [(
            1, 15, "R-SUMMARY", "MCM", "MCM", "Coach", "Learner 1",
            date(2026, 9, 25), None, "Planned",
            {"source_metadata": {"Status": "Planned"}, "sections": []},
            "partial", None, False, "101",
        )]

        events, _contributors = views.fetch_aptem_review_events(
            [learner(1)], {1: 101}, owner_email="coach@example.invalid", owner_name="Coach",
        )

        self.assertEqual(events[0]["eventKey"], "imported-review:R-SUMMARY")
        self.assertFalse(events[0]["hasReviewForm"])

    @patch("coach_api.views._imported_review_progress_snapshot", return_value=None)
    @patch("coach_api.views.ImportedReviewInstance.objects.filter")
    @patch("coach_api.views._sections_by_review")
    @patch("coach_api.views.connections")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_imported_definition_reuses_native_form_contract_without_curriculum_identity(
        self, fetch_profiles, connections, sections_by_review, imported_instances, _progress_snapshot,
    ):
        imported_instances.return_value.first.return_value = None
        fetch_profiles.return_value = [learner(1, aptem_id=101, source_aptem_id=101)]
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = [
            "id", "learner_id", "aptem_review_id", "review_name", "review_type",
            "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
            "status", "review_data", "extraction_status", "last_error",
        ]
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [
            (11, 1, "R-1", "Progress Review", "Progress Review", "Coach", "Learner 1",
             date(2026, 9, 23), None, "Scheduled", {}, "complete", None),
        ]
        sections_by_review.return_value = {11: [{
            "id": 501, "name": "Progress", "order": 2,
            "fields": [{"label": "What went well?", "value": "Good progress"}],
            "tables": [{"title": "Actions", "rows": [
                ["Action", "Responsible", "Deadline"],
                ["Submit assignments", "Learner 1", "9 October 2026"],
            ]}], "rawText": "",
        }]}

        definition = views._imported_review_definition(
            "coach@example.invalid", "imported-review:R-1",
        )

        self.assertFalse(definition["readOnly"])
        self.assertEqual(definition["source"], "aptem")
        self.assertEqual(definition["instance"]["id"], "imported-review:R-1")
        self.assertTrue(definition["formAvailable"])
        self.assertFalse(definition["summaryOnly"])
        self.assertEqual(definition["instance"]["status"], "in-progress")
        self.assertEqual(definition["instance"]["reviewTemplateId"], "")
        self.assertEqual(definition["sections"][0]["displayOrder"], 2)
        self.assertEqual(definition["sections"][0]["fields"][0]["answer"], "Good progress")
        table_field = definition["sections"][0]["fields"][1]
        self.assertEqual(table_field["title"], "Actions")
        self.assertEqual(table_field["configuration"]["importedTable"][1], [
            "Submit assignments", "Learner 1", "9 October 2026",
        ])

    @patch("coach_api.views.ImportedReviewInstance.objects.filter")
    @patch("coach_api.views._sections_by_review", return_value={})
    @patch("coach_api.views.connections")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_owned_summary_only_import_returns_explicit_read_only_definition(
        self, fetch_profiles, connections, _sections, imported_instances,
    ):
        fetch_profiles.return_value = [learner(1, aptem_id=101, source_aptem_id=101)]
        cursor = connections["default"].cursor.return_value.__enter__.return_value
        columns = [
            "id", "learner_id", "aptem_review_id", "review_name", "review_type",
            "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
            "status", "review_data", "extraction_status", "last_error",
        ]
        cursor.description = [(column,) for column in columns]
        cursor.fetchall.return_value = [(
            15, 1, "R-SUMMARY", "MCM", "MCM", "Coach", "Learner 1",
            date(2026, 9, 25), None, "Not Scheduled",
            {"source_metadata": {"Status": "Not Scheduled"}, "sections": []},
            "partial", None,
        )]

        definition = views._imported_review_definition(
            "coach@example.invalid", "imported-review:R-SUMMARY",
        )

        self.assertTrue(definition["summaryOnly"])
        self.assertFalse(definition["formAvailable"])
        self.assertTrue(definition["readOnly"])
        self.assertEqual(definition["sections"], [])
        self.assertEqual(definition["instance"]["id"], "imported-review:R-SUMMARY")
        imported_instances.assert_called_once_with(
            owner_email__iexact="coach@example.invalid",
            event_key="imported-review:R-SUMMARY",
        )

    @patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[])
    def test_imported_definition_does_not_expose_review_outside_current_coach_caseload(self, _profiles):
        self.assertIsNone(views._imported_review_definition(
            "unrelated-coach@example.invalid", "imported-review:R-1",
        ))

    @patch("coach_api.views.authenticated_coach_email", return_value="selected-coach@example.invalid")
    @patch("coach_api.views._imported_review_definition")
    def test_detail_uses_effective_view_as_coach_and_returns_summary_only_200(
        self, imported_definition, _coach_email,
    ):
        imported_definition.return_value = {
            "summaryOnly": True, "formAvailable": False, "readOnly": True,
            "source": "aptem", "sections": [],
        }
        request = RequestFactory().get(
            "/coach_api/coach/reviews/imported-review%3AR-SUMMARY",
            {"viewAsCoach": "selected-coach@example.invalid"},
        )
        # The test bypasses coach_access_required, which normally sets this.
        request.coach_view_as = True

        response = unwrap(views.coach_review_instance_detail)(request, "imported-review:R-SUMMARY")

        self.assertEqual(response.status_code, 200)
        imported_definition.assert_called_once_with(
            "selected-coach@example.invalid", "imported-review:R-SUMMARY",
            preview_only=True,
        )

    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views._imported_review_definition")
    def test_owned_import_with_form_remains_editable_and_returns_200(
        self, imported_definition, _coach_email,
    ):
        imported_definition.return_value = {
            "summaryOnly": False, "formAvailable": True, "readOnly": False,
            "source": "aptem", "sections": [{"id": "section-1", "fields": []}],
        }
        request = RequestFactory().get("/coach_api/coach/reviews/imported-review%3AR-1")

        response = unwrap(views.coach_review_instance_detail)(request, "imported-review:R-1")

        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertFalse(payload["readOnly"])
        self.assertTrue(payload["formAvailable"])

    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views._imported_review_definition", return_value=None)
    def test_missing_imported_review_remains_404(self, _definition, _coach_email):
        request = RequestFactory().get("/coach_api/coach/reviews/imported-review%3AMISSING")

        response = unwrap(views.coach_review_instance_detail)(request, "imported-review:MISSING")

        self.assertEqual(response.status_code, 404)


class ImportedReviewWriteTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.definition = {
            "source": "aptem",
            "instance": {"id": "imported-review:R-1", "learnerId": 1},
            "sections": [{"fields": [{"id": "aptem-field:501:0"}]}],
        }

    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views.ImportedReviewInstance.objects.get_or_create")
    @patch("coach_api.views._imported_review_definition")
    def test_save_uses_the_canonical_imported_identity(
        self, imported_definition, get_or_create, _coach_email,
    ):
        imported_definition.return_value = self.definition
        imported = MagicMock(
            event_key="imported-review:R-1",
            status=views.ImportedReviewInstance.STATUS_IN_PROGRESS,
            answers={},
        )
        get_or_create.return_value = (imported, True)
        request = self.factory.post(
            "/coach/reviews/imported-review%3A11/answers",
            data=json.dumps({"answers": {"aptem-field:501:0": "Updated locally"}}),
            content_type="application/json",
        )

        response = unwrap(views.coach_review_instance_answers)(request, "imported-review:11")

        self.assertEqual(response.status_code, 200)
        get_or_create.assert_called_once_with(
            owner_email="coach@example.invalid",
            event_key="imported-review:R-1",
            defaults={"learner_id": 1},
        )
        self.assertEqual(imported.answers, {"aptem-field:501:0": "Updated locally"})
        imported.save.assert_called_once_with(update_fields=["answers", "updated_at"])

    @patch("coach_api.views.timezone.now")
    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views.ImportedReviewInstance.objects.get_or_create")
    @patch("coach_api.views._imported_review_definition")
    def test_complete_persists_answers_and_completed_state(
        self, imported_definition, get_or_create, _coach_email, now,
    ):
        imported_definition.return_value = self.definition
        imported = MagicMock(event_key="imported-review:R-1", answers={})
        get_or_create.return_value = (imported, False)
        completed_at = MagicMock(name="completed_at")
        now.return_value = completed_at
        request = self.factory.post(
            "/coach/reviews/imported-review%3AR-1/complete",
            data=json.dumps({"answers": {"aptem-field:501:0": "Final answer"}}),
            content_type="application/json",
        )

        response = unwrap(views.coach_review_instance_complete)(request, "imported-review:R-1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(imported.answers, {"aptem-field:501:0": "Final answer"})
        self.assertEqual(imported.status, views.ImportedReviewInstance.STATUS_COMPLETED)
        self.assertIs(imported.completed_at, completed_at)
        imported.save.assert_called_once_with(
            update_fields=["answers", "status", "completed_at", "updated_at"],
        )

    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views._imported_review_definition")
    def test_summary_only_import_rejects_answer_writes(self, imported_definition, _coach_email):
        imported_definition.return_value = {
            **self.definition,
            "readOnly": True,
            "formAvailable": False,
            "summaryOnly": True,
            "sections": [],
        }
        request = self.factory.post(
            "/coach/reviews/imported-review%3AR-SUMMARY/answers",
            data=json.dumps({"answers": {}}),
            content_type="application/json",
        )

        response = unwrap(views.coach_review_instance_answers)(request, "imported-review:R-SUMMARY")

        self.assertEqual(response.status_code, 409)

    @patch("coach_api.views.authenticated_coach_email", return_value="coach@example.invalid")
    @patch("coach_api.views._imported_review_definition")
    def test_summary_only_import_rejects_completion(self, imported_definition, _coach_email):
        imported_definition.return_value = {
            **self.definition,
            "readOnly": True,
            "formAvailable": False,
            "summaryOnly": True,
            "sections": [],
        }
        request = self.factory.post(
            "/coach/reviews/imported-review%3AR-SUMMARY/complete",
            data=json.dumps({"answers": {}}),
            content_type="application/json",
        )

        response = unwrap(views.coach_review_instance_complete)(request, "imported-review:R-SUMMARY")

        self.assertEqual(response.status_code, 409)


class TimetableResolvedReviewStreamTests(SimpleTestCase):
    @patch("coach_api.views.assign_timetable_slots", side_effect=lambda events: events)
    @patch("coach_api.views.curriculum_review_instances.reconcile_review_event_keys", return_value={})
    @patch("coach_api.views.fetch_calendar_event_records", return_value={})
    @patch("coach_api.views.fetch_standalone_event_records")
    @patch("coach_api.views.collect_live_session_events", return_value=[])
    @patch("coach_api.views.resolve_coach_review_events")
    @patch("coach_api.views.fetch_caseload_timetable_profiles")
    @patch("coach_api.views.fetch_owner_active_learner_profiles", return_value=[])
    @patch("coach_api.views.coach_staff_display_name", return_value="Coach")
    def test_calendar_includes_aptem_events_and_drops_coexisting_curriculum_record(
        self, _owner, _active, review_profiles, resolve_reviews, _live,
        standalone_records, _fetch_records, _reconcile, _slots,
    ):
        profile = learner(1, source_aptem_id=101)
        review_profiles.return_value = [profile]
        event = {
            "eventKey": "imported-review:R-1", "id": "imported-review:R-1",
            "source": "mcr", "reviewSource": "aptem", "learnerId": "1",
            "learner": "Learner 1", "status": "scheduled", "date": "2026-09-23",
            "targetDate": "2026-09-23", "startHour": 9, "type": "coaching",
        }
        resolve_reviews.return_value = {
            "events": [event], "reviewGenerationIssues": [], "aptemProfileIds": {1},
            "sourceCounts": {
                "progressReviewRows": 0, "mcrRows": 1, "reviewRows": 0,
                "learnersWithDates": 1, "reviewAnchorSkipped": 0,
                "reviewAnchorSkipReasons": {}, "aptemReviewRows": 1,
                "curriculumReviewRows": 0, "aptemLearners": 1, "curriculumLearners": 0,
            },
        }
        duplicate = MagicMock(
            event_key="curriculum:duplicate", learner_id=1, event_type="mcr",
        )
        standalone_records.return_value = [duplicate]

        result = views.collect_generated_timetable(
            "coach@example.invalid", start_date=date(2026, 9, 1), end_date=date(2026, 9, 30),
            include_live_sessions=False, include_scheduler_queues=False,
        )

        self.assertEqual([item["eventKey"] for item in result["events"]], ["imported-review:R-1"])
        self.assertEqual(result["summary"]["sourceCounts"]["aptemReviewRows"], 1)
