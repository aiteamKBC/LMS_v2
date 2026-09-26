from datetime import date, time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

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
    @patch("coach_api.views.resolve_curriculum_review_occurrences")
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.fetch_aptem_review_events")
    @patch("coach_api.views.resolve_effective_aptem_ids", return_value=({1: 101}, set()))
    def test_aptem_learner_uses_aptem_only(
        self, _identities, fetch_aptem, _source_rows, curriculum_occurrences,
    ):
        aptem_event = {"eventKey": "imported-review:A-1", "source": "progress-review", "reviewSource": "aptem"}
        fetch_aptem.return_value = ([aptem_event], {1})

        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [learner(1)])

        self.assertEqual(result["events"], [aptem_event])
        curriculum_occurrences.assert_not_called()
        self.assertEqual(result["sourceCounts"]["aptemLearners"], 1)
        self.assertEqual(result["sourceCounts"]["curriculumLearners"], 0)

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
        aptem_event = {"eventKey": "imported-review:A-1", "source": "mcr", "reviewSource": "aptem"}
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

    @patch("coach_api.views._sections_by_review")
    @patch("coach_api.views.connections")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_imported_definition_reuses_native_form_contract_without_curriculum_identity(
        self, fetch_profiles, connections, sections_by_review,
    ):
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
            "tables": [], "rawText": "",
        }]}

        definition = views._imported_review_definition(
            "coach@example.invalid", "imported-review:R-1",
        )

        self.assertTrue(definition["readOnly"])
        self.assertEqual(definition["source"], "aptem")
        self.assertEqual(definition["instance"]["id"], "imported-review:R-1")
        self.assertEqual(definition["instance"]["reviewTemplateId"], "")
        self.assertEqual(definition["sections"][0]["displayOrder"], 2)
        self.assertEqual(definition["sections"][0]["fields"][0]["answer"], "Good progress")


class TimetableResolvedReviewStreamTests(SimpleTestCase):
    @patch("coach_api.views.assign_timetable_slots", side_effect=lambda events: events)
    @patch("coach_api.views.curriculum_review_instances.reconcile_review_event_keys", return_value={})
    @patch("coach_api.views.fetch_calendar_event_records", return_value={})
    @patch("coach_api.views.fetch_standalone_event_records")
    @patch("coach_api.views.collect_live_session_events", return_value=[])
    @patch("coach_api.views.resolve_coach_review_events")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
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
