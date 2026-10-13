"""Dashboard section contracts, authorization and paging, with no live I/O."""

from copy import deepcopy
from datetime import date
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.db.backends.postgresql.base import DatabaseWrapper
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.urls import resolve

from coach_api.dashboard_cache import (
    cache_dashboard_section, cache_coach_dashboard, dashboard_section_cache_key, get_cached_dashboard_section,
    invalidate_coach_dashboard_cache,
)
from coach_api.dashboard_view import coach_dashboard_section
from coach_api.models import CoachDashboardSnapshot
from coach_api.services.dashboard.sections import (
    DashboardSectionProjection, load_section, normalize_otjh_contract, paginate_learners, project_section, summarize_meetings,
)


def learner(identity, name, **extra):
    return {"id": str(identity), "name": name, "learnerType": "commercial", "rawProgramStatus": "Delivery",
            "cohortId": "cohort-a", "cohortName": "Cohort A", "group": "Group A", "programme": "Programme",
            "otjhCompleted": 20, "otjhTargetAsOfToday": 100, "otjhRagStatus": "at-risk", **extra}


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "dashboard-sections"}})
class DashboardSectionTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.factory = RequestFactory()
        self.payload = {
            "owner": {"name": "Synthetic Coach", "email": "coach@example.invalid"},
            "learners": [learner(1, "Alpha", ksbCompletedDetails=[{"privateDetail": "x" * 10000}],
                                 otjhCompletedEntries=[{"privateEvidence": "y" * 10000}], riskFlags=["not needed"]),
                         learner(2, "Beta", learnerType="apprenticeship", enrolmentId="1002", otjhRagStatus="on-track")],
            "meetings": {"events": [{"id": "kept-id", "eventKey": "kept-key", "learnerId": "1", "source": "mcr",
                                     "status": "scheduled", "scheduledDate": "2026-09-21", "meetingLink": "https://example.invalid/join",
                                     "meetingOptions": {"presenters": ["synthetic"]}}],
                         "summary": {"mcrRows": 1}, "reviewGenerationIssues": []},
            "marking": {"summary": {"pendingItems": 3}, "items": [{"id": "1", "learnerId": "1", "learner": "Alpha", "pendingEvidence": 3}]}, "assignedGroups": [{"unused": True}],
            "monthlyRisk": [{"unused": True}], "errors": {},
        }

    @patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=date(2026, 9, 23))
    def test_weekly_popup_and_counts_share_aliases_dates_and_stable_identity(self, _today):
        aliases = {"mcm": ["mcr", "mcm", "monthly_coaching", "monthly-coaching"],
                   "pr": ["progress-review", "progress_review", "pr"],
                   "catchUps": ["catch-up", "catch_up"]}
        events = []
        for key, sources in aliases.items():
            for index, source in enumerate(sources):
                events.append({"id": f"{key}-{index}", "eventKey": f"event-{key}-{index}",
                               "learnerId": "2", "enrolmentId": "1002", "learner": "Alpha",
                               "source": source, "scheduledDate": "2026-09-25", "date": "2026-09-26",
                               "status": "not-scheduled" if index == 0 else "scheduled"})
        base = events[0]
        for index, changes in enumerate(({"scheduledDate": "2026-09-20"}, {"scheduledDate": "2026-09-26"},
                                        {"status": "completed"}, {"status": "cancelled"},
                                        {"learnerId": "missing"}, {"learnerId": None}, {"source": "live-session"})):
            events.append({**base, **changes, "id": f"excluded-{index}"})
        events.append({**base, "id": "monday", "scheduledDate": None, "date": None, "targetDate": "2026-09-21"})
        self.payload["meetings"]["events"] = events
        result = summarize_meetings(project_section(self.payload, "summary"))
        for key, sources in aliases.items():
            expected = [f"{key}-{index}" for index in range(len(sources))] + (["monday"] if key == "mcm" else [])
            popup = result["meetingsPopup"][key]
            self.assertEqual(result["summary"]["meetingsThisWeek"][key], len(expected))
            self.assertEqual([item["id"] for item in popup["items"]], expected)
            self.assertTrue(all(item["learnerId"] == "2" and item["enrolmentId"] == "1002" for item in popup["items"]))

    def test_marking_counts_weighted_rows_by_learner_id_not_name(self):
        self.payload["marking"] = {"summary": {"pendingItems": 7}, "items": [
            {"id": "a", "learnerId": "1", "learner": "Same Name", "pendingEvidence": 3,
             "submittedAt": "2026-09-02"},
            {"id": "b", "learnerId": "1", "learner": "Same Name", "pendingEvidence": 2,
             "submittedAt": "2026-09-01"},
            {"id": "c", "learnerId": "2", "learner": "Same Name", "pendingEvidence": 2},
        ]}
        result = summarize_meetings(project_section(self.payload, "summary"))
        rows = result["markingPopup"]["items"]
        self.assertEqual([row["pendingCount"] for row in rows], [5, 2])
        self.assertEqual(rows[0]["oldestPendingDate"], "2026-09-01")
        self.assertEqual(set(rows[0]), {"learnerId", "learnerName", "programme", "group",
                                        "pendingCount", "oldestPendingDate"})
        self.assertEqual(result["summary"]["pendingMarking"], 7)
        self.assertEqual(result["markingPopup"]["count"], sum(row["pendingCount"] for row in rows))

    def test_risk_summary_and_popup_use_unique_nested_rows_without_active_gate(self):
        self.payload["learners"] = [
            learner(1, "Same Name"), learner(1, "Duplicate"),
            learner(2, "Same Name", rawProgramStatus="On break", status="on-track"),
            learner(3, "Not at risk", otjhRagStatus="on-track", status="at-risk"),
        ]
        result = summarize_meetings(project_section(self.payload, "summary"))
        rows = result["learnerPopup"]["all"]
        expected = [row["id"] for row in rows if row["otjh"]["ragStatus"] == "at-risk"]
        self.assertEqual([row["id"] for row in rows], ["1", "2", "3"])
        self.assertEqual(expected, ["1", "2"])
        self.assertEqual(set(result["learnerPopup"]), {"all"})
        self.assertEqual(result["summary"]["otjh"]["atRisk"], len(expected))

    def test_initial_sections_omit_details_without_mutating_legacy_snapshot(self):
        before = deepcopy(self.payload)
        for section in ("summary", "learners", "risk"):
            projected = project_section(self.payload, section)
            self.assertNotIn("privateDetail", json.dumps(projected))
            self.assertNotIn("privateEvidence", json.dumps(projected))
            self.assertNotIn("assignedGroups", projected)
            self.assertNotIn("monthlyRisk", projected)
        self.assertEqual(self.payload, before)

    def test_backend_owns_exact_shortfall_boundaries_and_ignores_legacy_labels(self):
        from coach_api.views import apply_otjh_to_date_metrics

        for shortfall, expected in ((100, "at-risk"), (40.01, "at-risk"), (40, "need-attention"),
                                    (20.01, "need-attention"), (20, "on-track"), (-10, "on-track")):
            with self.subTest(shortfall=shortfall):
                actual = 200 - shortfall
                result = apply_otjh_to_date_metrics({"otjhTarget": 200, "otjhCompleted": actual,
                    "otjhPlanned": 200, "otjhProgrammeStartDate": "2026-01-01",
                    "plannedEndDate": "2026-01-02", "status": "at-risk", "otjhStatus": "at-risk"},
                    today=date(2026,9,23))
                self.assertEqual(result["otjhShortfallHours"], max(shortfall, 0))
                self.assertEqual(result["otjhRagStatus"], expected)
                self.assertEqual(result["otjhTargetAsOfToday"], 200)
                self.assertEqual(result["otjhProgressAsOfToday"], round(min(actual / 200 * 100, 100), 2))

    def test_legacy_performance_status_can_differ_from_canonical_otjh_without_being_overwritten(self):
        from coach_api.views import apply_otjh_to_date_metrics, determine_active_user_status, otjh_status_from_variance

        performance = determine_active_user_status(program_status="Active", otjh_status=otjh_status_from_variance(250 - 400),
            progress_variance="", hours_progress=63, hours_available=True,
            ksb_progress=100, ksb_available=True, component_progress=100, component_available=True)
        result = apply_otjh_to_date_metrics({"status": performance, "otjhCompleted": 250, "otjhTarget": 400, "otjhPlanned": 400,
            "otjhProgrammeStartDate": "2026-01-01", "plannedEndDate": "2026-01-31"}, today=date(2026, 1, 16))
        self.assertEqual(result["otjhTargetAsOfToday"], 200)
        self.assertEqual(result["status"], "at-risk")
        self.assertEqual(result["otjhRagStatus"], "on-track")

    def test_zero_paced_target_is_on_track_and_missing_target_stays_unavailable(self):
        from coach_api.views import apply_otjh_to_date_metrics

        zero = apply_otjh_to_date_metrics({"otjhPlanned": 200, "otjhCompleted": 10,
                                          "otjhProgrammeStartDate": "2026-09-01", "plannedEndDate": "2027-09-01"},
                                         today=date(2026, 8, 1))
        self.assertEqual((zero["otjhTargetAsOfToday"], zero["otjhShortfallHours"], zero["otjhRagStatus"]), (0, 0, "on-track"))
        self.assertIsNone(zero["otjhProgressAsOfToday"])
        self.assertEqual(apply_otjh_to_date_metrics({"otjhCompleted": 10})["otjhRagStatus"], "unavailable")

    def test_read_time_contract_refreshes_stale_status_and_business_date(self):
        item = learner(1, "Alpha", otjhPlanned=120, otjhProgrammeStartDate="2026-06-01", plannedEndDate="2026-07-01",
                       otjhCompleted=40, otjhRagStatus="at-risk", otjhShortfallHours=100, otjhTargetAsOfToday=999)
        with patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=date(2026, 6, 15)):
            result = normalize_otjh_contract({"learners": [item]})["learners"][0]
        self.assertEqual((result["otjhTargetAsOfToday"], result["otjhShortfallHours"], result["otjhRagStatus"]), (56, 16, "on-track"))
        self.assertEqual(result["otjhCompleted"], 40)
        self.assertEqual(result["otjhPlanned"], 120)

    @patch("coach_api.services.dashboard.otjh.otjh_summary_bulk")
    @patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates")
    @patch("coach_api.dashboard_view.schedule_coach_dashboard_refresh")
    @patch("coach_api.dashboard_view.load_section")
    @patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=date(2026, 9, 23))
    def test_cached_endpoint_repairs_otjh_and_global_summary_is_independent_of_page(self, _today, load, _refresh, _profiles, facts):
        self.payload["learners"] = [learner(i, f"Learner {i}", otjhTarget=200, otjhCompleted=100 if i <= 16 else 170,
                                             otjhRagStatus="on-track") for i in range(1, 33)]
        _profiles.return_value = [SimpleNamespace(id=i, enrolment_id=i, programme_status="Active",
            start_date=date(2026,1,1), end_date=date(2026,1,2)) for i in range(1,33)]
        facts.return_value = {i: dict(profile_id=i, actual=100 if i <= 16 else 170, planned=200)
                              for i in range(1,33)}
        self.payload["meetings"]["events"] = [
            {"learnerId": "32", "source": source, "status": "scheduled", "scheduledDate": "2026-09-23"}
            for source in ("progress-review", "mcr", "catch-up")
        ]
        for section in ("summary", "learners"):
            cache_dashboard_section("coach@example.invalid", section, project_section(self.payload, section))
        def get(section, params=None):
            request = self.factory.get(f"/coach_api/coach/dashboard/{section}", params or {})
            request.coach_email = "coach@example.invalid"
            return json.loads(unwrap(coach_dashboard_section)(request, section).content)
        before = get("summary")["summary"]
        page = get("learners", {"page": 1, "pageSize": 15})
        self.assertEqual(len(page["results"]), 15)
        self.assertEqual(page["pagination"], {"page": 1, "pageSize": 15, "total": 32, "totalPages": 3,
                                              "hasNext": True, "hasPrevious": False})
        self.assertEqual(before["totalLearners"], 32)
        self.assertEqual(before["otjh"]["atRisk"], 16)
        self.assertEqual(before["otjh"]["needAttention"], 16)
        self.assertEqual(before["pendingMarking"], 3)
        self.assertEqual(before["meetingsThisWeek"], {"pr": 1, "mcm": 1, "catchUps": 1})
        self.assertNotIn("weeklyCounts", before)
        self.assertNotIn("totals", before)
        self.assertNotIn("32", [item["id"] for item in page["results"]])
        self.assertEqual(get("summary")["summary"], before)
        self.assertEqual(page["results"][0]["otjh"]["ragStatus"], "at-risk")
        load.assert_not_called()

    def test_only_verified_unused_otjh_aliases_are_removed_from_new_sections(self):
        self.payload["learners"][0].update(status="performance-status", otjhStatus="old", otjhSource="audit", otjhProgressHours="unused", otjhMinimum=278)
        for section in ("summary", "learners", "risk"):
            row = project_section(self.payload, section)["learners"][0]
            self.assertEqual(row["status"], "performance-status")
            self.assertEqual(row["otjhMinimum"], 278)
            for field in ("otjhStatus", "otjhSource", "otjhProgressHours"):
                self.assertNotIn(field, row)
        self.assertEqual(self.payload["learners"][0]["otjhStatus"], "old")

    def test_meetings_preserve_action_identity_and_join_link_without_internal_options(self):
        projected = project_section(self.payload, "meetings")
        event = projected["meetings"]["events"][0]
        for field in ("id", "eventKey", "learnerId", "meetingLink"):
            self.assertEqual(event[field], self.payload["meetings"]["events"][0][field])
        self.assertEqual(set(projected["meetings"]), {"events"})
        self.assertNotIn("meetingOptions", event)
        self.assertEqual(self.payload["meetings"]["events"][0]["meetingOptions"], {"presenters": ["synthetic"]})
        self.assertNotIn("learners", projected)

    @patch("coach_api.dashboard_view.snapshot_needs_refresh", return_value=False)
    @patch("coach_api.dashboard_view.dashboard_cache.get_cached_dashboard_section")
    def test_meetings_cached_reads_filter_each_requested_window_without_mutating_cache(self, cached, _refresh):
        cached.return_value = self.payload
        before = deepcopy(self.payload)
        for today, start, end, count in ((date(2026, 9, 18), "2026-09-21", "2026-09-25", 1), (date(2026, 9, 21), "2026-09-28", "2026-10-02", 0)):
            # Reuse an old client's valid hint: the request-time week wins.
            request = self.factory.get("/coach_api/coach/dashboard/meetings", {"from": "2026-09-21", "to": "2026-09-25"})
            request.coach_email = "coach@example.invalid"
            with patch("coach_api.dashboard_view.timezone.localdate", return_value=today):
                response = unwrap(coach_dashboard_section)(request, "meetings")
            self.assertEqual(response.status_code, 200)
            meetings = json.loads(response.content)["meetings"]
            self.assertEqual(meetings["range"], {"from": start, "to": end})
            self.assertEqual(len(meetings["events"]), count)
            self.assertEqual(set(meetings), {"range", "events"})
        self.assertEqual(self.payload, before)

    @patch("coach_api.dashboard_view.load_section")
    def test_meetings_invalid_or_overwide_ranges_fail_before_loading(self, load):
        for query in ({"from": "bad"}, {"from": "2026-10-12"},
                      {"from": "2026-10-12", "to": "2026-11-16"},
                      {"from": "2026-10-13", "to": "2026-10-17"}):
            request = self.factory.get("/coach_api/coach/dashboard/meetings", query)
            request.coach_email = "coach@example.invalid"
            self.assertEqual(unwrap(coach_dashboard_section)(request, "meetings").status_code, 400)
        load.assert_not_called()

    def test_week_rollover_counts_and_popups_share_the_canonical_range(self):
        from coach_api.services.dashboard.weeks import work_week
        self.payload["meetings"]["events"] = [
            {"id": f"{source}-{day}", "source": source, "learnerId": "1", "date": day, "status": "scheduled"}
            for source in ("progress-review", "mcr", "catch-up")
            for day in ("2026-10-05", "2026-10-09", "2026-10-12", "2026-10-16", "2026-10-17")
        ]
        for today in (date(2026, 10, 5), date(2026, 10, 12)):
            with patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=today):
                result = summarize_meetings(project_section(self.payload, "summary"))
            start, end = work_week(today)
            for key in ("pr", "mcm", "catchUps"):
                popup = result["meetingsPopup"][key]
                self.assertEqual(result["summary"]["meetingsThisWeek"][key], 2)
                self.assertEqual(popup["count"], 2)
                self.assertEqual([row["date"] for row in popup["items"]], [start.isoformat(), end.isoformat()])

    def test_cache_keys_change_daily_and_isolate_coaches(self):
        with patch("coach_api.dashboard_cache.timezone.localdate", return_value=date(2026, 10, 11)):
            old = dashboard_section_cache_key("coach-a@example.invalid", "summary")
        with patch("coach_api.dashboard_cache.timezone.localdate", return_value=date(2026, 10, 12)):
            current = dashboard_section_cache_key("coach-a@example.invalid", "summary")
            other = dashboard_section_cache_key("coach-b@example.invalid", "summary")
        self.assertNotEqual(old, current)
        self.assertNotEqual(current, other)

    @patch("coach_api.views.apply_otjh_to_date_metrics")
    def test_otjh_normalization_uses_actual_request_date_on_each_read(self, apply):
        for today in (date(2026, 10, 11), date(2026, 10, 12)):
            apply.reset_mock()
            with patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=today):
                normalize_otjh_contract(self.payload)
            self.assertEqual(apply.call_count, len(self.payload["learners"]))
            self.assertTrue(all(call.kwargs["today"] == today for call in apply.call_args_list))

    def test_summary_uses_business_work_week_active_population_and_all_learners(self):
        self.payload["learners"].extend([learner(3, "Paused", rawProgramStatus="On break"), learner(4, "Enrolling", rawProgramStatus="Ready to enrol")])
        events = self.payload["meetings"]["events"]
        events.extend([
            {"learnerId": "2", "source": "progress-review", "status": "scheduled", "scheduledDate": "2026-09-25"},
            {"learnerId": "3", "source": "mcr", "status": "scheduled", "scheduledDate": "2026-09-21"},
            {"learnerId": "4", "source": "mcr", "status": "scheduled", "scheduledDate": "2026-09-21"},
            {"learnerId": "1", "source": "mcr", "status": "completed", "scheduledDate": "2026-09-21"},
            {"learnerId": "1", "source": "catch-up", "status": "cancelled", "scheduledDate": "2026-09-21"},
            {"learnerId": "1", "source": "catch-up", "status": "scheduled", "scheduledDate": "2026-09-26"},
            {"learnerId": "1", "source": "mcr", "status": "scheduled", "scheduledDate": "2026-09-28"},
        ])
        with patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=date(2026, 9, 23)):
            result = summarize_meetings(project_section(self.payload, "summary"))
        self.assertEqual(result["summary"]["meetingsThisWeek"], {"pr": 1, "mcm": 1, "catchUps": 0})
        self.assertEqual(len(result["learnerPopup"]["all"]), 4)
        self.assertNotIn("meetings", result)
        self.assertEqual(result["markingPopup"]["count"], 3)

    def test_failed_review_generation_does_not_fabricate_zero_availability(self):
        self.payload["meetings"] = {"events": [], "summary": {}, "reviewGenerationIssues": [{"learnerId": "1"}]}
        result = summarize_meetings(project_section(self.payload, "summary"))
        self.assertEqual(result["summary"]["meetingsThisWeek"], {"pr": None, "mcm": None, "catchUps": 0})

    def test_popup_contract_contains_only_display_and_navigation_fields(self):
        self.payload["learners"][0].update(initials="AL", email="private@example.invalid", otjhPlanned=400,
            attendanceAvailable=True, attendanceRate=0)
        self.payload["meetings"]["events"][0].update(learner="Alpha", programme="Programme", group="Group A",
            scheduledTime="09:30", durationMinutes=45)
        self.payload["marking"]["items"] = [{"id": "submission-1", "learnerId": "1", "learner": "Alpha",
            "totalEvidence": 4, "submittedAt": "2026-09-20", "email": "private@example.invalid", "acceptedEvidence": 3}]
        before = deepcopy(self.payload)
        with patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=date(2026, 9, 23)):
            result = summarize_meetings(project_section(self.payload, "summary"))
        self.assertEqual(set(result), {"owner", "summary", "learnerPopup", "markingPopup", "meetingsPopup"})
        self.assertEqual(result["owner"], {"name": "Synthetic Coach"})
        self.assertEqual([row["id"] for row in result["learnerPopup"]["all"] if row["otjh"]["ragStatus"] == "at-risk"], ["1"])
        row = result["learnerPopup"]["all"][0]
        self.assertEqual(set(row), {"id", "name", "programme", "programmeStatus", "group", "otjh"})
        self.assertEqual(row["programmeStatus"], "Delivery")
        self.assertEqual(row["otjh"], {"completed": 20, "target": 100, "planned": 400, "ragStatus": "at-risk"})
        self.assertNotIn("email", row)
        self.assertNotIn("cohortId", row)
        self.assertEqual(result["meetingsPopup"]["mcm"]["items"], [{"id": "kept-id", "eventKey": "kept-key", "learnerId": "1", "learnerName": "Alpha",
            "programme": "Programme", "group": "Group A", "date": "2026-09-21", "time": "09:30", "durationMinutes": 45, "status": "scheduled"}])
        self.assertNotIn("email", result["markingPopup"]["items"][0])
        self.assertNotIn("acceptedEvidence", result["markingPopup"]["items"][0])
        self.assertEqual(self.payload, before)

    def page(self, **overrides):
        options = dict(page=1, page_size=1, search="", cohort="all", status="all", otjh_status="all", sort="name", direction="asc")
        return paginate_learners(project_section(self.payload, "learners"), **{**options, **overrides})

    def test_server_pagination_preserves_role_identity_and_global_filter_options(self):
        result = self.page(page=2)
        self.assertEqual([row["id"] for row in result["results"]], ["2"])
        self.assertEqual(result["results"][0]["learnerType"], "apprenticeship")
        self.assertEqual(result["results"][0]["enrolmentId"], "1002")
        self.assertEqual(result["pagination"]["total"], 2)
        self.assertEqual(result["filterOptions"]["cohort"], [{"value": "cohort-a", "label": "Cohort A"}])
        self.assertNotIn("ksbCompleted", result["results"][0])
        self.assertNotIn("meetings", result)

    def test_search_cohort_group_status_and_otjh_filters_apply_before_paging(self):
        self.payload["learners"][1].update(cohortId="cohort-b", cohortName="Cohort B", group="Group B", rawProgramStatus="Active")
        for filters in ({"search": "beta"}, {"cohort": "cohort:cohort-b"}, {"cohort": "group:Group B"},
                        {"status": "Active"}, {"otjh_status": "on-track"}):
            with self.subTest(filters=filters):
                result = self.page(**filters)
                self.assertEqual([row["id"] for row in result["results"]], ["2"])
                self.assertEqual(result["pagination"]["total"], 1)
                self.assertEqual(len(result["filterOptions"]["cohort"]), 2)
        self.assertEqual(self.page(search="does not exist")["pagination"]["total"], 0)

    def test_minimal_rows_preserve_authoritative_metrics_and_private_filtering(self):
        self.payload["learners"][0].update(email="synthetic@example.invalid", initials="AL", enrolmentId="1001",
            otjhProgressAsOfToday=12.34, activityProgress=66.67, activityProgressAvailable=True,
            componentsCompleted=2, componentsPlanned=3, attendanceAvailable=True, attendanceRate=0,
            lastActivityDate="2026-09-20")
        source = deepcopy(self.payload)
        result = self.page(search="synthetic@example.invalid")
        row = result["results"][0]
        self.assertEqual(set(row), {"id", "name", "initials", "programme", "programmeStatus", "learnerType", "enrolmentId",
            "otjh", "activities", "attendance", "startDate", "lastActivity", "lastPr", "lastMcm"})
        self.assertEqual(row["otjh"], {"completed": 20, "targetToDate": 100, "planned": None,
                                      "progress": 12.34, "ragStatus": "at-risk"})
        self.assertEqual(row["activities"], {"completed": 2, "total": 3, "progress": 66.67})
        self.assertEqual(row["attendance"], {"rate": 0})
        self.assertEqual(row["lastActivity"], {"date": "2026-09-20"})
        self.assertNotIn("email", row)
        self.assertEqual(self.payload, source)
        self.assertEqual(result["pagination"]["total"], 1)
        self.assertEqual(len(result["filterOptions"]["cohort"]), 1)
        self.assertEqual(project_section(self.payload, "summary"), project_section(source, "summary"))

    def test_hidden_statuses_never_reach_results_or_filter_options(self):
        self.payload["learners"].append(learner(3, "Hidden", rawProgramStatus="Withdrawn", cohortName="Hidden Cohort"))
        self.assertEqual(self.page()["pagination"]["total"], 2)
        self.assertNotIn("Hidden Cohort", json.dumps(self.page()["filterOptions"]))

    def test_sort_precedes_page_and_null_values_stay_last_in_both_directions(self):
        self.payload["learners"][0]["attendanceRate"] = None
        self.payload["learners"][1].update(attendanceAvailable=True, attendanceRate=0)
        for direction in ("asc", "desc"):
            self.assertEqual(self.page(sort="attendance", direction=direction)["results"][0]["id"], "2")

    def test_only_summary_cache_version_changes_for_popup_projection(self):
        self.assertTrue(dashboard_section_cache_key("coach@example.invalid", "summary").endswith(":sections:v3:summary"))
        for section in ("learners", "meetings", "risk"):
            self.assertTrue(dashboard_section_cache_key("coach@example.invalid", section).endswith(f":sections:v2:{section}"))

    def test_section_cache_is_identity_scoped_and_central_mutation_invalidation_clears_all_sections(self):
        for section in ("summary", "learners", "meetings", "risk"):
            cache_dashboard_section("coach-a@example.invalid", section, {"identity": "a"})
            cache_dashboard_section("coach-b@example.invalid", section, {"identity": "b"})
        invalidate_coach_dashboard_cache("coach-a@example.invalid")
        for section in ("summary", "learners", "meetings", "risk"):
            self.assertIsNone(get_cached_dashboard_section("coach-a@example.invalid", section))
            self.assertEqual(get_cached_dashboard_section("coach-b@example.invalid", section), {"identity": "b"})
        cache_coach_dashboard("coach-b@example.invalid", self.payload)
        self.assertIsNone(get_cached_dashboard_section("coach-b@example.invalid", "meetings"))

    @patch("coach_api.dashboard_view.schedule_coach_dashboard_refresh")
    @patch("coach_api.dashboard_view.CoachDashboardService.refresh")
    @patch("coach_api.dashboard_view.load_section")
    def test_warm_endpoint_never_rebuilds_and_paginates_cached_source_per_request(self, load, refresh, schedule):
        load.return_value = project_section(self.payload, "learners")
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[]):
            for page in (1, 2):
                request = self.factory.get("/coach_api/coach/dashboard/learners", {"page": page, "page_size": 1, "sort": "name", "direction": "asc"})
                request.coach_email = "coach@example.invalid"
                result = json.loads(unwrap(coach_dashboard_section)(request, "learners").content)
                self.assertEqual(result["results"][0]["id"], str(page))
        load.assert_called_once_with("coach@example.invalid", "learners")
        refresh.assert_not_called()
        schedule.assert_not_called()

    @patch("coach_api.dashboard_view.schedule_coach_dashboard_refresh")
    @patch("coach_api.dashboard_view.CoachDashboardService.refresh")
    @patch("coach_api.dashboard_view.load_section")
    def test_parameter_free_endpoint_returns_all_rows_with_separate_filter_metadata(self, load, refresh, schedule):
        self.payload["learners"] = [learner(i, f"Synthetic {i}", email=f"learner-{i}@example.invalid") for i in range(125)]
        load.return_value = project_section(self.payload, "learners")
        request = self.factory.get("/coach_api/coach/dashboard/learners", {"viewAsCoach": "coach@example.invalid"})
        request.coach_email = "coach@example.invalid"
        response = unwrap(coach_dashboard_section)(request, "learners")
        self.assertEqual(response.status_code, 200)
        result = json.loads(response.content)
        self.assertEqual(len(result["results"]), 125)
        self.assertEqual(result["pagination"]["total"], 125)
        self.assertEqual(result["learnerFilterData"]["0"]["email"], "learner-0@example.invalid")
        self.assertEqual(result["learnerFilterData"]["0"]["group"], "Group A")
        self.assertNotIn("email", result["results"][0])
        self.assertEqual(set(result["results"][0]), set(self.page()["results"][0]))
        load.assert_called_once()
        refresh.assert_not_called()
        schedule.assert_not_called()

    @patch("coach_api.dashboard_view.load_section", side_effect=RuntimeError("private token value"))
    @patch("coach_api.dashboard_view.logging.getLogger")
    def test_section_failure_is_503_with_no_fake_empty_success_or_secret(self, _logger, _load):
        request = self.factory.get("/coach_api/coach/dashboard/meetings")
        request.coach_email = "coach@example.invalid"
        response = unwrap(coach_dashboard_section)(request, "meetings")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn("private token", response.content.decode())

    @patch("coach_api.dashboard_view.load_section")
    def test_invalid_paging_and_sort_are_rejected_before_database_read(self, load):
        for query in ({"page": "0"}, {"page_size": "bad"}, {"sort": "private-column"}, {"direction": "bad"}):
            request = self.factory.get("/coach_api/coach/dashboard/learners", query)
            request.coach_email = "coach@example.invalid"
            self.assertEqual(unwrap(coach_dashboard_section)(request, "learners").status_code, 400)
        load.assert_not_called()

    def test_each_route_keeps_the_coach_authorization_wrapper(self):
        for section in ("summary", "learners", "meetings", "risk"):
            matched = resolve(f"/coach_api/coach/dashboard/{section}")
            self.assertIs(matched.func, coach_dashboard_section)
            with patch("login.permissions.authenticate_request", return_value=None):
                self.assertEqual(matched.func(self.factory.get(matched.route), **matched.kwargs).status_code, 401)

    @patch("coach_api.auth._staff_access", side_effect=lambda staff: staff.access)
    @patch("coach_api.auth.StaffUser.objects")
    @patch("login.permissions._accesses_of", return_value=frozenset({"coach"}))
    def test_coach_cannot_choose_another_identity_on_any_section(self, _access, staff, _staff_access):
        account = SimpleNamespace(subject_type="staff", subject_id=1, role="staff")
        staff.filter.return_value.only.return_value.first.return_value = SimpleNamespace(id=1, email="coach-a@example.invalid", access="coach")
        with patch("login.permissions.authenticate_request", return_value=account):
            for section in ("summary", "learners", "meetings", "risk"):
                request = self.factory.get(f"/coach_api/coach/dashboard/{section}", {"viewAsCoach": "coach-b@example.invalid"})
                request.login_account = account
                self.assertEqual(coach_dashboard_section(request, section).status_code, 403)

    @patch("coach_api.dashboard_view.schedule_coach_dashboard_refresh")
    @patch("coach_api.dashboard_view.load_section")
    @patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[])
    @patch("coach_api.auth._staff_access", side_effect=lambda staff: staff.access)
    @patch("coach_api.auth._find_coach_staff")
    @patch("coach_api.auth.StaffUser.objects")
    @patch("login.permissions._accesses_of")
    def test_allowed_sessions_load_only_the_server_selected_coach(self, accesses, staff, find_coach, _access, _profiles, load, _refresh):
        account = SimpleNamespace(subject_type="staff", subject_id=1, role="staff")
        selected = SimpleNamespace(id=2, email="coach-b@example.invalid", access="coach")
        find_coach.return_value = selected
        with patch("login.permissions.authenticate_request", return_value=account):
            for role, params, expected in (
                ("coach", {}, "coach-a@example.invalid"),
                ("super-admin", {"viewAsCoach": "coach-b@example.invalid"}, selected.email),
            ):
                accesses.return_value = frozenset({role})
                staff.filter.return_value.only.return_value.first.return_value = SimpleNamespace(id=1, email="coach-a@example.invalid", access=role)
                for section in ("summary", "learners", "meetings", "risk"):
                    load.return_value = project_section(self.payload, section)
                    request = self.factory.get(f"/coach_api/coach/dashboard/{section}", params)
                    request.login_account = account
                    self.assertEqual(coach_dashboard_section(request, section).status_code, 200)
                    load.assert_called_with(expected, section)

    @patch("coach_api.dashboard_view.load_section")
    @patch("coach_api.auth._staff_access", side_effect=lambda staff: staff.access)
    @patch("coach_api.auth.StaffUser.objects")
    @patch("login.permissions._accesses_of")
    def test_non_coach_roles_and_admin_without_selection_are_refused(self, accesses, staff, _access, load):
        account = SimpleNamespace(subject_type="staff", subject_id=1, role="staff")
        with patch("login.permissions.authenticate_request", return_value=account):
            for role in ("tutor", "employer", "super-admin"):
                accesses.return_value = frozenset({role})
                staff.filter.return_value.only.return_value.first.return_value = SimpleNamespace(id=1, email="staff@example.invalid", access=role)
                for section in ("summary", "learners", "meetings", "risk"):
                    request = self.factory.get(f"/coach_api/coach/dashboard/{section}")
                    request.login_account = account
                    self.assertEqual(coach_dashboard_section(request, section).status_code, 403)
        load.assert_not_called()

    def test_postgres_projection_is_parameterized_and_does_not_select_full_payload(self):
        connection = DatabaseWrapper({"NAME": "isolated_compile_only", "ENGINE": "django.db.backends.postgresql"})
        for section in ("summary", "learners", "meetings", "risk"):
            query = CoachDashboardSnapshot.objects.filter(owner_email="coach@example.invalid").annotate(
                projected=DashboardSectionProjection("payload", section),
            ).values("projected")
            sql, params = query.query.get_compiler(connection=connection).as_sql()
            self.assertIn("jsonb_build_object", sql)
            self.assertNotIn("ksbCompletedDetails", params)
            self.assertNotIn("otjhCompletedEntries", params)
            self.assertIn("coach@example.invalid", params)
            self.assertNotIn("coach@example.invalid", sql)
            self.assertEqual(sql.count("%s"), len(params))

    @patch("coach_api.models.CoachDashboardSnapshot.objects")
    @patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[])
    @patch("coach_api.services.dashboard.sections.connections")
    def test_old_persistent_snapshot_is_projected_and_served_without_live_refresh(self, connections, _profiles, objects):
        from django.utils import timezone
        snapshot = SimpleNamespace(payload=self.payload, schema_version=18, refreshed_at=timezone.now())
        connections.__getitem__.return_value.vendor = "sqlite"
        objects.filter.return_value.order_by.return_value.db = "default"
        objects.filter.return_value.order_by.return_value.only.return_value.first.return_value = snapshot
        result = load_section("coach@example.invalid", "risk")
        self.assertEqual(result["readModel"]["version"], 18)
        self.assertNotIn("ksbCompletedDetails", result["learners"][0])
