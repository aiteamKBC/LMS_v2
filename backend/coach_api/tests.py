import json
from datetime import date, timedelta
from decimal import Decimal
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from coach_api.models import CoachAbsenceReport
from coach_api.views import (
    build_ksb_completed_details,
    build_otjh_completed_entries,
    build_monthly_activity_learner,
    coach_caseload,
    coach_dashboard,
    coach_monthly_activity,
    coach_timetable_book_event,
    coach_timetable_schedule_event,
    coach_has_live_session_access,
    coach_staff_display_name,
    collect_generated_timetable,
    completed_ksb_codes,
    fetch_caseload_learner_profiles,
    fetch_evidence_file_queue,
    fetch_source_schedule_rows,
    iterate_generated_schedule_dates,
    reported_minutes,
    route_absence_report_evidence,
    serialize_caseload_learner,
)


def call_coach_view(view, request):
    """Unit-test view logic below the integration-tested auth boundary."""
    request.coach_email = "coach@example.com"
    return unwrap(view)(request)


class SourceProfileIdentityTests(SimpleTestCase):
    @patch("coach_api.views.EnrolmentUser.all_learners.annotate")
    def test_source_rows_are_keyed_by_profile_id_after_email_match(self, annotate):
        source = SimpleNamespace(
            id=19,
            email="Mahmoud.Fouda@kentbusinesscollege.com",
            learner_type="commercial",
        )
        annotate.return_value.filter.return_value = [source]
        profile = SimpleNamespace(
            id=2,
            email="mahmoud.fouda@kentbusinesscollege.com",
        )

        commercial, apprenticeship = fetch_source_schedule_rows([profile])

        self.assertEqual(commercial, {2: source})
        self.assertEqual(apprenticeship, {})
        annotate.return_value.filter.assert_called_once_with(
            source_email_key__in={"mahmoud.fouda@kentbusinesscollege.com": 2}
        )


class CoachKsbEvidenceTests(SimpleTestCase):
    def test_failed_quiz_codes_do_not_count_as_completed_ksbs(self):
        completed = completed_ksb_codes(
            [
                {"kind": "quiz", "passed": False, "ksbs": ["K1", "K2", "S1"]},
                {"kind": "video", "ksbs": ["K3.1", "B2.2"]},
            ],
            [],
        )

        self.assertEqual(completed, {"K3", "B2"})

    def test_failed_component_activity_does_not_count_even_with_valid_lineage(self):
        """The gate is the completion rule, not the kind.

        A Component recorded as not passed carries a real componentId, real
        curriculum lineage and a real authored KSB mapping — everything that
        makes it look legitimate to a report that only special-cases quizzes.
        """
        completed = completed_ksb_codes(
            [
                {
                    "kind": "component",
                    "componentId": "COMP-20260816E2E",
                    "componentType": "assignment",
                    "moduleId": "MOD-E2E",
                    "weekId": "WEEK-E2E",
                    "passed": False,
                    "ksbs": ["K1"],
                },
                {"kind": "component", "componentId": "COMP-OTHER", "passed": True, "ksbs": ["S2"]},
            ],
            [],
        )

        self.assertEqual(completed, {"S2"})

    def test_an_unresolved_quiz_attempt_does_not_count(self):
        self.assertEqual(completed_ksb_codes([{"kind": "quiz", "ksbs": ["K1"]}], []), set())

    def test_a_failed_activity_feed_entry_does_not_count(self):
        """Activity-feed rows carry `passed` too, and were never gated at all."""
        completed = completed_ksb_codes(
            [],
            [{"kind": "component", "componentId": "COMP-X", "passed": False, "ksbs": ["B1"]}],
        )

        self.assertEqual(completed, set())

    def test_ksb_completed_details_omit_a_failed_component(self):
        target = [{"code": "K1", "type": "Knowledge", "description": "Knowledge 1"}]
        failed = {
            "kind": "component",
            "componentId": "COMP-20260816E2E",
            "componentTitle": "E2E activity",
            "passed": False,
            "ksbs": ["K1"],
            "submittedAt": "2026-08-17T09:00:00Z",
        }

        # As the coach payload actually assembles it: the completed set comes
        # from completed_ksb_codes, so a failed-only K1 never becomes a row.
        self.assertEqual(
            build_ksb_completed_details(target, completed_ksb_codes([failed], []), [failed], [], []),
            [],
        )
        # And even when a code is completed by other evidence, the failed
        # attempt is not offered as the evidence for it.
        self.assertEqual(
            build_ksb_completed_details(target, {"K1"}, [failed], [], [])[0]["sources"], [],
        )

        succeeded = {**failed, "passed": True}
        passed_details = build_ksb_completed_details(
            target, completed_ksb_codes([succeeded], []), [succeeded], [], [],
        )
        self.assertEqual([item["code"] for item in passed_details], ["K1"])
        self.assertEqual(len(passed_details[0]["sources"]), 1)


class CoachCaseloadLegacyRelationTests(SimpleTestCase):
    """The caseload must not prefetch a relation the database no longer has.

    ``LearnerProfile.assigned_ksbs`` maps the pre-normalisation
    ``Learner.learner_ksbs`` snapshot, which is absent from the current
    database. ``LearnerProfile.ksbs`` tolerates that, but a queryset-level
    ``prefetch_related`` raises first, which turned the entire coach caseload
    into a 500 against the live schema. Probe, then prefetch — the same shape
    already used for the retired activity-events relation.
    """

    def _prefetches(self, *, ksbs_exists, events_exist):
        captured = {}

        class Queryset:
            def annotate(self, **kwargs):
                return self

            def filter(self, **kwargs):
                return self

            def prefetch_related(self, *names):
                captured['names'] = list(names)
                return self

            def order_by(self, *args):
                return self

            def __iter__(self):
                return iter(())

        with patch("coach_api.views.LearnerProfile") as profile:
            profile.objects = Queryset()
            with patch("coach_api.views.get_learner_db_alias", return_value="enrolment"):
                with patch("coach_api.views.learner_ksbs_relation_exists", return_value=ksbs_exists):
                    with patch("coach_api.views.learner_activity_events_relation_exists", return_value=events_exist):
                        with patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {})):
                            fetch_caseload_learner_profiles("coach@example.com")
        return captured.get('names', [])

    def test_dropped_legacy_ksb_relation_is_not_prefetched(self):
        names = self._prefetches(ksbs_exists=False, events_exist=False)

        self.assertNotIn("assigned_ksbs", names)
        self.assertNotIn("activity_events", names)
        # The current, authoritative KSB graph is still loaded.
        self.assertIn("ksb_assignment__profile_version__definitions", names)
        self.assertIn("progress_entries__ksb_links", names)

    def test_legacy_relations_are_prefetched_where_they_still_exist(self):
        names = self._prefetches(ksbs_exists=True, events_exist=True)

        self.assertIn("assigned_ksbs", names)
        self.assertIn("activity_events", names)


class CoachCaseloadViewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("coach_api.views.serialize_caseload_dashboard_learner")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_coach_caseload_can_return_dashboard_summary_snapshots(
        self,
        fetch_rows,
        serialize_learner,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"id": "2", "coachName": "Med Maher"}

        response = call_coach_view(coach_caseload,
            self.factory.get(
                "/coach_api/coach/caseload",
                {"owner_email": "coach@example.com", "summary": "1"},
            )
        )

        self.assertEqual(response.status_code, 200)
        fetch_rows.assert_called_once_with("coach@example.com")
        serialize_learner.assert_called_once_with(row)

    @patch("coach_api.views.serialize_caseload_learner")
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_coach_caseload_uses_cached_snapshots_by_default(
        self,
        fetch_rows,
        serialize_learner,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"id": "2", "coachName": "Med Maher"}

        response = call_coach_view(coach_caseload,
            self.factory.get(
                "/coach_api/coach/caseload",
                {"owner_email": "coach@example.com"},
            )
        )

        self.assertEqual(response.status_code, 200)
        serialize_learner.assert_called_once_with(row, refresh_live_snapshots=False)

    @patch("coach_api.views.serialize_caseload_learner")
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_coach_caseload_allows_live_snapshot_refresh_when_requested(
        self,
        fetch_rows,
        serialize_learner,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"id": "2", "coachName": "Med Maher"}

        response = call_coach_view(coach_caseload,
            self.factory.get(
                "/coach_api/coach/caseload",
                {"owner_email": "coach@example.com", "live": "1"},
            )
        )

        self.assertEqual(response.status_code, 200)
        serialize_learner.assert_called_once_with(row, refresh_live_snapshots=True)


class CoachDashboardViewTests(SimpleTestCase):
    @patch("coach_api.views.cache")
    @patch("coach_api.views.collect_tracked_live_session_events")
    @patch("coach_api.views.collect_generated_timetable")
    @patch("coach_api.views.serialize_caseload_dashboard_learner")
    @patch("coach_api.views.fetch_caseload_dashboard_profiles")
    def test_dashboard_aggregates_workspace_data_with_one_timetable_collection(
        self,
        fetch_rows,
        serialize_learner,
        collect_timetable,
        collect_live_sessions,
        dashboard_cache,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"id": "2", "coachName": "Med Maher"}
        collect_timetable.return_value = {
            "owner_name": "Med Maher",
            "summary": {"total": 1},
            "events": [{"id": "event-1"}],
        }
        dashboard_cache.get.return_value = None
        collect_live_sessions.return_value = [{"id": "live-1", "date": "2026-08-09", "startHour": 9}]

        response = call_coach_view(coach_dashboard,
            RequestFactory().get("/coach_api/coach/dashboard", {"owner_email": "coach@example.com"})
        )
        payload = json.loads(response.content)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["learners"], [{"id": "2", "coachName": "Med Maher"}])
        self.assertEqual(payload["attendance"]["learners"], [])
        self.assertEqual([item["id"] for item in payload["timetable"]["events"]], ["event-1", "live-1"])
        self.assertEqual(payload["evidence"]["items"], [])
        collect_timetable.assert_called_once_with(
            "coach@example.com",
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
            include_live_sessions=False,
            include_scheduler_queues=False,
        )
        collect_live_sessions.assert_called_once_with(
            "coach@example.com",
            "Med Maher",
            start_date=date.today(),
            end_date=date.today() + timedelta(days=90),
        )


class CoachTimetableWindowTests(SimpleTestCase):
    @patch("coach_api.views.StaffUser.objects.annotate")
    def test_live_session_access_comes_from_staff_user_coach_grant(self, annotate):
        annotate.return_value.filter.return_value.exists.return_value = True

        self.assertTrue(coach_has_live_session_access(" Coach@Example.com "))
        annotate.return_value.filter.assert_called_once_with(
            staff_email_key="coach@example.com",
            staff_access_key="coach",
        )

    @patch("coach_api.views.StaffUser.objects.annotate")
    def test_live_session_access_rejects_non_coach_staff(self, annotate):
        annotate.return_value.filter.return_value.exists.return_value = False

        self.assertFalse(coach_has_live_session_access("enrolment@example.com"))

    @patch("coach_api.views.StaffUser.objects.annotate")
    def test_coach_display_name_comes_from_staff_user(self, annotate):
        annotate.return_value.filter.return_value.only.return_value.first.return_value = SimpleNamespace(
            username="Test Coach"
        )

        self.assertEqual(coach_staff_display_name("coach@example.com"), "Test Coach")

    def test_generated_schedule_dates_respect_requested_window(self):
        generated_dates = list(
            iterate_generated_schedule_dates(
                date(2026, 1, 1),
                date(2026, 2, 28),
                timedelta(days=7),
                range_start=date(2026, 1, 20),
                range_end=date(2026, 2, 2),
            )
        )

        self.assertEqual(
            generated_dates,
            [
                (3, date(2026, 1, 22)),
                (4, date(2026, 1, 29)),
            ],
        )

    @patch("coach_api.views.fetch_calendar_event_records", return_value={})
    @patch("coach_api.views.fetch_standalone_event_records", return_value=[])
    @patch("coach_api.views.fetch_source_schedule_rows", return_value=({}, {}))
    @patch("coach_api.views.build_learner_profile_map", return_value={})
    @patch("coach_api.views.fetch_owner_active_learner_profiles", return_value=[])
    @patch("coach_api.views.coach_staff_display_name", return_value="")
    @patch("coach_api.views.collect_live_session_events", side_effect=RuntimeError("legacy staff profile schema"))
    def test_collect_generated_timetable_ignores_live_session_errors(
        self,
        collect_live_session_events,
        coach_staff_display_name,
        fetch_owner_active_learner_profiles,
        build_learner_profile_map,
        fetch_source_schedule_rows,
        fetch_standalone_event_records,
        fetch_calendar_event_records,
    ):
        payload = collect_generated_timetable("coach@example.com")

        self.assertEqual(payload["events"], [])
        self.assertEqual(payload["summary"]["sourceCounts"]["liveSessionRows"], 0)
        collect_live_session_events.assert_called_once()
        coach_staff_display_name.assert_called_once_with("coach@example.com")
        fetch_owner_active_learner_profiles.assert_called_once_with("coach@example.com")
        build_learner_profile_map.assert_called_once_with([])
        fetch_source_schedule_rows.assert_called_once_with([])
        fetch_standalone_event_records.assert_called_once_with("coach@example.com")
        fetch_calendar_event_records.assert_called_once_with("coach@example.com", [])


class CoachTimetableBookingConflictTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    @patch("coach_api.views.sync_calendar_event_to_graph")
    @patch("coach_api.views.coach_learner_personal_calendar_conflicts", return_value=True)
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_book_event_does_not_create_catch_up_or_support_when_learner_busy(
        self,
        fetch_caseload_learner_profiles,
        coach_learner_personal_calendar_conflicts,
        sync_calendar_event_to_graph,
    ):
        learner = SimpleNamespace(
            id=7,
            username="Test User",
            email="learner@example.com",
            coach_name="Coach Example",
        )
        fetch_caseload_learner_profiles.return_value = [learner]

        for session_type in ("catch-up", "student-support"):
            with self.subTest(session_type=session_type):
                request = self.factory.post(
                    "/coach_api/coach/timetable/events/book",
                    data=json.dumps(
                        {
                            "ownerEmail": "coach@example.com",
                            "learnerId": 7,
                            "sessionType": session_type,
                            "scheduledDate": "2026-08-19",
                            "scheduledTime": "10:00",
                            "durationMinutes": 60,
                            "timezoneOffsetMinutes": -180,
                        }
                    ),
                    content_type="application/json",
                )

                response = call_coach_view(coach_timetable_book_event, request)

                self.assertEqual(response.status_code, 409)
                self.assertIn("busy at that time", response.content.decode())

        self.assertEqual(coach_learner_personal_calendar_conflicts.call_count, 2)
        sync_calendar_event_to_graph.assert_not_called()

    @patch("coach_api.views.sync_calendar_event_to_graph")
    @patch("coach_api.views.CoachCalendarEvent.objects.get_or_create")
    @patch("coach_api.views.build_learner_profile_map")
    @patch("coach_api.views.fetch_owner_active_learner_profiles")
    @patch("coach_api.views.coach_learner_personal_calendar_conflicts", return_value=True)
    @patch("coach_api.views.find_catchup_template_event")
    @patch("coach_api.views.find_catchup_calendar_record", return_value=(None, "Coach Example"))
    def test_schedule_template_does_not_create_catch_up_when_learner_busy(
        self,
        find_catchup_calendar_record,
        find_catchup_template_event,
        coach_learner_personal_calendar_conflicts,
        fetch_owner_active_learner_profiles,
        build_learner_profile_map,
        get_or_create,
        sync_calendar_event_to_graph,
    ):
        learner = SimpleNamespace(id=7)
        fetch_owner_active_learner_profiles.return_value = [learner]
        build_learner_profile_map.return_value = {7: learner}
        find_catchup_template_event.return_value = (
            {
                "eventKey": "coach-catchup-template:coach@example.com:7",
                "learnerId": "7",
                "learner": "Test User",
                "email": "learner@example.com",
                "sequence": 1,
            },
            "Coach Example",
        )
        request = self.factory.post(
            "/coach_api/coach/timetable/events/schedule",
            data=json.dumps(
                {
                    "ownerEmail": "coach@example.com",
                    "eventKey": "coach-catchup-template:coach@example.com:7",
                    "scheduledDate": "2026-08-19",
                    "scheduledTime": "10:00",
                    "durationMinutes": 45,
                    "timezoneOffsetMinutes": -180,
                }
            ),
            content_type="application/json",
        )

        response = call_coach_view(coach_timetable_schedule_event, request)

        self.assertEqual(response.status_code, 409)
        self.assertIn("busy at that time", response.content.decode())
        find_catchup_calendar_record.assert_called_once_with(
            "coach@example.com",
            "coach-catchup-template:coach@example.com:7",
        )
        get_or_create.assert_not_called()
        sync_calendar_event_to_graph.assert_not_called()


@override_settings(
    AZURE_STORAGE_ACCOUNT="lmsstorage",
    AZURE_STORAGE_KEY="test-key",
    AZURE_QUARANTINE_CONTAINER="evidence-quarantine",
    AZURE_APPROVED_CONTAINER="evidence-approved",
    AZURE_REJECTED_CONTAINER="evidence-rejected",
)
class AbsenceEvidenceRoutingTests(SimpleTestCase):
    @patch("coach_api.views.move_blob")
    def test_approval_moves_quarantine_blob_to_approved(self, move_blob):
        report = SimpleNamespace(
            evidence_image_url=(
                "https://lmsstorage.blob.core.windows.net/"
                "evidence-quarantine/absence-reports/42/file.pdf"
            )
        )

        moved = route_absence_report_evidence(
            report,
            CoachAbsenceReport.STATUS_APPROVED,
        )

        self.assertEqual(
            (
                "evidence-quarantine",
                "evidence-approved",
                "absence-reports/42/file.pdf",
            ),
            moved,
        )
        move_blob.assert_called_once_with(
            "evidence-quarantine",
            "evidence-approved",
            "absence-reports/42/file.pdf",
        )
        self.assertIn("/evidence-approved/", report.evidence_image_url)

    @patch("coach_api.views.move_blob")
    def test_decline_moves_quarantine_blob_to_rejected(self, move_blob):
        report = SimpleNamespace(
            evidence_image_url=(
                "https://lmsstorage.blob.core.windows.net/"
                "evidence-quarantine/absence-reports/42/file.pdf"
            )
        )

        route_absence_report_evidence(
            report,
            CoachAbsenceReport.STATUS_DECLINED,
        )

        move_blob.assert_called_once_with(
            "evidence-quarantine",
            "evidence-rejected",
            "absence-reports/42/file.pdf",
        )
        self.assertIn("/evidence-rejected/", report.evidence_image_url)

    @patch("coach_api.views.move_blob")
    def test_legacy_local_evidence_is_left_untouched(self, move_blob):
        report = SimpleNamespace(
            evidence_image_url="/media/absence-evidence/legacy.pdf",
        )

        moved = route_absence_report_evidence(
            report,
            CoachAbsenceReport.STATUS_APPROVED,
        )

        self.assertIsNone(moved)
        self.assertEqual(
            "/media/absence-evidence/legacy.pdf",
            report.evidence_image_url,
        )
        move_blob.assert_not_called()


class MonthlyActivityTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_reported_minutes_treats_small_bare_numbers_as_hours_and_large_values_as_minutes(self):
        self.assertEqual(reported_minutes("2"), 120.0)
        self.assertEqual(reported_minutes("2h"), 120.0)
        self.assertEqual(reported_minutes("1.5"), 90.0)
        self.assertEqual(reported_minutes("120"), 120.0)
        self.assertEqual(reported_minutes("90 min"), 90.0)

    def test_build_monthly_activity_learner_dedupes_duplicate_feed_items(self):
        row = SimpleNamespace(
            programme="Marketing",
            training_plan_progress=[],
            activity_feed=[
                {
                    "kind": "quiz",
                    "quizId": "quiz-1",
                    "attempt": "1",
                    "date": "2026-07-15",
                    "quizName": "Quiz A",
                    "detail": "Score 8/10",
                },
                {
                    "kind": "quiz",
                    "quizId": "quiz-1",
                    "attempt": "1",
                    "date": "2026-07-15",
                    "quizName": "Quiz A",
                    "detail": "Score 8/10",
                },
                {
                    "kind": "quiz",
                    "quizId": "quiz-1",
                    "attempt": "2",
                    "date": "2026-07-15",
                    "quizName": "Quiz A",
                    "detail": "Score 9/10",
                },
            ],
        )

        learner = {
            "id": "42",
            "name": "Test Learner",
            "initials": "TL",
            "email": "learner@example.com",
            "cohortName": "Cohort A",
            "group": "Group 1",
            "otjhStatus": "On Track",
            "otjhTarget": 120,
            "otjhCompleted": 40,
        }

        result = build_monthly_activity_learner(
            row,
            learner,
            events=[],
            start_date=date(2026, 7, 1),
            end_date=date(2026, 7, 31),
        )

        self.assertEqual(len(result["activities"]), 2)
        self.assertEqual(
            [activity["id"] for activity in result["activities"]],
            [
                "feed:quiz|quiz-1|1|2026-07-15|Quiz A",
                "feed:quiz|quiz-1|2|2026-07-15|Quiz A",
            ],
        )

    @patch("coach_api.views.curriculum_expected_otjh_by_component_id", return_value={"component-1": 1.5})
    def test_build_otjh_completed_entries_prefers_curriculum_expected_otjh(self, expected_lookup):
        entries = build_otjh_completed_entries(
            [
                {
                    "kind": "video",
                    "componentId": "component-1",
                    "componentTitle": "Pre-recorded video",
                    "reportedTime": "120",
                    "submittedAt": "2026-07-18T08:05:37Z",
                }
            ],
            [],
            [{
                "moduleTitle": "Module A",
                "weeks": [{
                    "weekTitle": "Week 1",
                    "components": [{
                        "componentId": "component-1",
                        "componentTitle": "Pre-recorded video",
                    }],
                }],
            }],
        )

        expected_lookup.assert_called_once_with(["component-1"])
        self.assertEqual(entries[0]["hours"], 1.5)
        self.assertEqual(entries[0]["reportedTime"], "120")

    @patch("coach_api.views.build_monthly_activity_learner")
    @patch("coach_api.views.serialize_caseload_learner")
    @patch("coach_api.views.collect_generated_timetable", return_value={"events": [], "owner_name": "Med Maher"})
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_coach_monthly_activity_uses_cached_snapshots_by_default(
        self,
        fetch_rows,
        collect_generated_timetable,
        serialize_learner,
        build_monthly_activity_learner,
    ):
        row = SimpleNamespace(id=2, coach_name="Med Maher")
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"enrollmentStatus": "active"}
        build_monthly_activity_learner.return_value = {
            "status": "on-track",
            "learning": {"total": 0, "quizzes": 0, "videos": 0, "components": 0},
            "coaching": {"total": 0, "booked": 0, "needsSchedule": 0},
            "evidence": {"submitted": 0},
            "ksb": {"codes": []},
            "otjh": {"monthlyHours": 0},
            "needsAction": [],
            "activities": [],
        }

        response = call_coach_view(coach_monthly_activity,
            self.factory.get(
                "/coach_api/coach/monthly-activity",
                {"owner_email": "coach@example.com", "month": "2026-08"},
            )
        )

        self.assertEqual(response.status_code, 200)
        serialize_learner.assert_called_once_with(row, refresh_live_snapshots=False)

    @patch("coach_api.views.build_monthly_activity_learner")
    @patch("coach_api.views.serialize_caseload_learner")
    @patch("coach_api.views.collect_generated_timetable", return_value={"events": [], "owner_name": "Med Maher"})
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_coach_monthly_activity_allows_live_snapshot_refresh_when_requested(
        self,
        fetch_rows,
        collect_generated_timetable,
        serialize_learner,
        build_monthly_activity_learner,
    ):
        row = SimpleNamespace(id=2, coach_name="Med Maher")
        fetch_rows.return_value = [row]
        serialize_learner.return_value = {"enrollmentStatus": "active"}
        build_monthly_activity_learner.return_value = {
            "status": "on-track",
            "learning": {"total": 0, "quizzes": 0, "videos": 0, "components": 0},
            "coaching": {"total": 0, "booked": 0, "needsSchedule": 0},
            "evidence": {"submitted": 0},
            "ksb": {"codes": []},
            "otjh": {"monthlyHours": 0},
            "needsAction": [],
            "activities": [],
        }

        response = call_coach_view(coach_monthly_activity,
            self.factory.get(
                "/coach_api/coach/monthly-activity",
                {"owner_email": "coach@example.com", "month": "2026-08", "live": "1"},
            )
        )

        self.assertEqual(response.status_code, 200)
        serialize_learner.assert_called_once_with(row, refresh_live_snapshots=True)


class EvidenceQueueSnapshotTests(SimpleTestCase):
    @patch("coach_api.views.serialize_caseload_learner", return_value={"id": ""})
    @patch("coach_api.views.fetch_caseload_learner_profiles")
    def test_fetch_evidence_file_queue_uses_cached_snapshots(
        self,
        fetch_rows,
        serialize_learner,
    ):
        row = SimpleNamespace(id=2)
        fetch_rows.return_value = [row]

        items, learners = fetch_evidence_file_queue("coach@example.com")

        self.assertEqual(items, [])
        self.assertEqual(learners, [{"id": ""}])
        serialize_learner.assert_called_once_with(row, refresh_live_snapshots=False)


class CaseloadOtjhSnapshotTests(SimpleTestCase):
    @patch("coach_api.views.learner_activity_feed_entries", return_value=[])
    @patch("coach_api.views.refresh_caseload_learner_ksb_snapshot")
    @patch("coach_api.views.refresh_learner_otjh_snapshot")
    def test_serialize_caseload_learner_uses_live_otjh_snapshot(
        self,
        refresh_snapshot,
        refresh_ksb_snapshot,
        learner_activity_feed_entries,
    ):
        row = SimpleNamespace(
            id=2,
            username="mahmopud fouda",
            full_name="mahmopud fouda",
            email="learner@example.com",
            coach_name="Med Maher",
            coach_email="Med.Maher@kentbusinesscollege.com",
            programme_status="Active",
            lifecycle_status="active",
            cohort="Cohort A",
            group="Group 1",
            start_date=None,
            end_date=None,
            gateway_review_date=None,
            coach_rag="",
            minimum_hours=Decimal("0"),
            planned_hours=Decimal("111"),
            completed_hours=Decimal("3.4"),
            target_hours=Decimal("16"),
            progress_hours=Decimal("-12.6"),
            progress_variance=Decimal("-0.79"),
            otjh_status="At risk",
            training_plan=[],
            training_plan_progress=[],
            ksbs=[],
            save=lambda **kwargs: None,
        )

        def apply_live_snapshot(learner, *, source=None, detail=None):
            learner.completed_hours = Decimal("29")
            learner.target_hours = Decimal("41.5")
            learner.planned_hours = Decimal("111")
            learner.progress_hours = Decimal("-12.5")
            learner.progress_variance = Decimal("-0.30")
            learner.otjh_status = "At risk"
            return {}

        refresh_snapshot.side_effect = apply_live_snapshot

        payload = serialize_caseload_learner(row)

        refresh_ksb_snapshot.assert_called_once_with(row)
        refresh_snapshot.assert_called_once_with(row)
        learner_activity_feed_entries.assert_called_once_with(row)
        self.assertEqual(payload["otjhCompleted"], 29.0)
        self.assertEqual(payload["otjhTarget"], 41.5)
        self.assertEqual(payload["otjhPlanned"], 111.0)
        self.assertEqual(float(payload["progressVariance"]), -0.3)

    @patch("coach_api.views.learner_activity_feed_entries", return_value=[])
    @patch("coach_api.views.refresh_learner_ksb_snapshot")
    @patch("coach_api.views.refresh_learner_otjh_snapshot", return_value={})
    def test_serialize_caseload_learner_uses_live_ksb_snapshot(
        self,
        refresh_otjh_snapshot,
        refresh_ksb_snapshot,
        learner_activity_feed_entries,
    ):
        row = SimpleNamespace(
            id=5,
            username="mahmopud fouda",
            full_name="mahmopud fouda",
            email="learner@example.com",
            coach_name="Med Maher",
            coach_email="Med.Maher@kentbusinesscollege.com",
            programme="Project Management",
            programme_status="Active",
            lifecycle_status="active",
            cohort="Cohort A",
            group="Group 1",
            start_date=None,
            end_date=None,
            gateway_review_date=None,
            coach_rag="",
            minimum_hours=Decimal("0"),
            planned_hours=Decimal("111"),
            completed_hours=Decimal("29"),
            target_hours=Decimal("41.5"),
            progress_hours=Decimal("-12.5"),
            progress_variance=Decimal("-0.30"),
            otjh_status="At risk",
            training_plan=[{"moduleId": "mod-1"}],
            training_plan_progress=[
                {"ksbs": [{"code": "K1"}, {"code": "S1"}]},
            ],
            ksbs=[],
            _prefetched_objects_cache={"assigned_ksbs": ["stale"]},
            _caseload_source=SimpleNamespace(id=5, programme="Project Management"),
            save=lambda **kwargs: None,
        )

        def apply_live_ksb_snapshot(learner, source, training_plan=None):
            learner.ksbs = [{"code": "K1"}, {"code": "S1"}, {"code": "B1"}]
            return learner.ksbs

        refresh_ksb_snapshot.side_effect = apply_live_ksb_snapshot

        payload = serialize_caseload_learner(row)

        refresh_ksb_snapshot.assert_called_once_with(
            row,
            row._caseload_source,
            training_plan=row.training_plan,
        )
        refresh_otjh_snapshot.assert_called_once_with(row)
        learner_activity_feed_entries.assert_called_once_with(row)
        self.assertEqual(row._prefetched_objects_cache, {})
        self.assertEqual(payload["ksbCompleted"], 2)
        self.assertEqual(payload["ksbTarget"], 3)
        self.assertEqual(payload["ksbProgress"], 67)
        self.assertEqual(payload["knowledgeCompleted"], 1)
        self.assertEqual(payload["knowledgeTarget"], 1)
        self.assertEqual(payload["skillsCompleted"], 1)
        self.assertEqual(payload["skillsTarget"], 1)
        self.assertEqual(payload["behavioursCompleted"], 0)
        self.assertEqual(payload["behavioursTarget"], 1)

    @patch("coach_api.views.learner_activity_feed_entries", return_value=[])
    @patch("coach_api.views.refresh_learner_ksb_snapshot")
    @patch("coach_api.views.refresh_learner_otjh_snapshot", return_value={})
    @patch("coach_api.views.curriculum_expected_otjh_by_component_id", return_value={})
    def test_serialize_caseload_learner_rolls_subcodes_up_to_parent_ksbs(
        self,
        curriculum_expected_lookup,
        refresh_otjh_snapshot,
        refresh_ksb_snapshot,
        learner_activity_feed_entries,
    ):
        row = SimpleNamespace(
            id=6,
            username="test learner",
            full_name="test learner",
            email="learner@example.com",
            coach_name="Med Maher",
            coach_email="Med.Maher@kentbusinesscollege.com",
            programme="Project Management",
            programme_status="Active",
            lifecycle_status="active",
            cohort="Cohort A",
            group="Group 1",
            start_date=None,
            end_date=None,
            gateway_review_date=None,
            coach_rag="",
            minimum_hours=Decimal("0"),
            planned_hours=Decimal("111"),
            completed_hours=Decimal("29"),
            target_hours=Decimal("41.5"),
            progress_hours=Decimal("-12.5"),
            progress_variance=Decimal("-0.30"),
            otjh_status="At risk",
            training_plan=[{
                "moduleId": "mod-1",
                "moduleTitle": "Module A",
                "weeks": [{
                    "weekId": "week-1",
                    "weekTitle": "Week 1",
                    "components": [{
                        "componentId": "component-1",
                        "componentTitle": "Stakeholder Workshop",
                    }],
                }],
            }],
            training_plan_progress=[
                {
                    "kind": "component",
                    "componentId": "component-1",
                    "reportedTime": "2h",
                    "submittedAt": "2026-08-02T10:00:00Z",
                    "ksbs": ["K3.1", "S1.2", "B2.2"],
                },
                {
                    "kind": "component",
                    "componentId": "component-1",
                    "reportedTime": "2h",
                    "submittedAt": "2026-08-02T11:00:00Z",
                    "ksbs": ["K3.1", "S1.2", "B2.2"],
                },
            ],
            ksbs=[],
            _prefetched_objects_cache={"assigned_ksbs": ["stale"]},
            _caseload_source=SimpleNamespace(id=6, programme="Project Management"),
            save=lambda **kwargs: None,
        )

        def apply_live_ksb_snapshot(learner, source, training_plan=None):
            learner.ksbs = [
                {"code": "K3", "type": "Knowledge", "description": "Stakeholder mapping"},
                {"code": "S1", "type": "Skills", "description": "Stakeholder communication"},
                {"code": "B2", "type": "Behaviours", "description": "Professional ownership"},
            ]
            return learner.ksbs

        refresh_ksb_snapshot.side_effect = apply_live_ksb_snapshot

        payload = serialize_caseload_learner(row)

        refresh_ksb_snapshot.assert_called_once_with(
            row,
            row._caseload_source,
            training_plan=row.training_plan,
        )
        refresh_otjh_snapshot.assert_called_once_with(row)
        learner_activity_feed_entries.assert_called_once_with(row)
        self.assertEqual(payload["ksbCompleted"], 3)
        self.assertEqual(payload["ksbTarget"], 3)
        self.assertEqual(payload["ksbProgress"], 100)
        self.assertEqual(payload["knowledgeCompleted"], 1)
        self.assertEqual(payload["knowledgeTarget"], 1)
        self.assertEqual(payload["skillsCompleted"], 1)
        self.assertEqual(payload["skillsTarget"], 1)
        self.assertEqual(payload["behavioursCompleted"], 1)
        self.assertEqual(payload["behavioursTarget"], 1)
        self.assertEqual(len(payload["otjhCompletedEntries"]), 1)
        self.assertEqual(payload["otjhCompletedEntries"][0]["title"], "Stakeholder Workshop")
        self.assertEqual(payload["otjhCompletedEntries"][0]["hours"], 2.0)
        self.assertEqual(payload["otjhCompletedEntries"][0]["completedDate"], "02 Aug 2026")
        self.assertEqual(payload["otjhCompletedEntries"][0]["ksbs"], ["B2", "K3", "S1"])
        self.assertEqual(payload["ksbCompletedDetailCount"], 3)
        self.assertEqual(
            [item["code"] for item in payload["ksbCompletedDetails"]],
            ["K3", "S1", "B2"],
        )
        for item in payload["ksbCompletedDetails"]:
            self.assertEqual(len(item["sources"]), 1)
            self.assertEqual(item["sources"][0]["title"], "Stakeholder Workshop")
            self.assertEqual(item["sources"][0]["module"], "Module A")
            self.assertEqual(item["sources"][0]["week"], "Week 1")
            self.assertEqual(item["sources"][0]["completedDate"], "02 Aug 2026")
