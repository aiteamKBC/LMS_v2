from contextlib import ExitStack
from copy import deepcopy
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from coach_api.services.dashboard.completed_reviews import saved_completed_review_dates
from coach_api.services.dashboard.service import CoachDashboardService


class DashboardCompletedDatesTests(SimpleTestCase):
    def test_old_native_history_uses_completion_and_preserves_owner_and_type_scope(self):
        rows = [SimpleNamespace(id=1), SimpleNamespace(id=2)]
        records = [
            {"learner_id": 2, "event_type": "progress-review", "review_template_id": "pr",
             "review_completed_at": datetime(2026, 10, 27, tzinfo=timezone.utc)},
            {"learner_id": 2, "event_type": "progress-review", "review_template_id": "other",
             "review_completed_at": datetime(2026, 11, 5, tzinfo=timezone.utc)},
            {"learner_id": 2, "event_type": "mcr", "review_template_id": "mcm", "review_completed_at": None},
        ]
        with patch("coach_api.views.dashboard_imported_completed_review_dates", return_value={1: {"lastPr": None, "lastMcm": "26 Oct 2026"}}), \
             patch("coach_api.models.CoachCalendarEvent.objects") as objects, \
             patch("coach_api.views.review_type_fields_by_template", return_value={"other": {"reviewTypeCode": "personal_support"}}):
            objects.filter.return_value.exclude.return_value.values.return_value = records
            result = saved_completed_review_dates(rows, owner_email="coach@example.invalid", owner_name="Coach")
        objects.filter.assert_called_once_with(owner_email="coach@example.invalid", learner_id__in=[2], status="completed")
        objects.filter.return_value.exclude.assert_called_once_with(event_key__startswith="imported-review:")
        self.assertEqual(result, {1: {"lastPr": None, "lastMcm": "26 Oct 2026"}, 2: {"lastPr": "27 Oct 2026", "lastMcm": None}})

    def test_v20_snapshot_repairs_both_metrics_and_aliases_without_mutating_source(self):
        original = {"readModel": {"version": 20}, "learners": [{"id": "1", "lastPr": "2026-10-26", "lastMcm": "2026-11-26",
            "lastProgressReview": "2026-10-26", "lastReview": "2026-11-26", "otjhCompleted": 5}]}
        before = deepcopy(original)
        rows = [SimpleNamespace(id=1, start_date=date(2026, 1, 1), programme_status="Active")]
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=rows), \
             patch("coach_api.services.dashboard.service.saved_completed_review_dates", return_value={1: {"lastPr": "27 Oct 2026", "lastMcm": "26 Oct 2026"}}) as dates:
            result = CoachDashboardService("coach@example.invalid").normalize_start_dates(original)
        self.assertEqual(original, before)
        item = result["learners"][0]
        self.assertEqual((item["lastPr"], item["lastProgressReview"]), ("2026-10-27", "2026-10-27"))
        self.assertEqual((item["lastMcm"], item["lastReview"]), ("2026-10-26", "2026-10-26"))
        self.assertEqual(item["otjhCompleted"], 5)
        self.assertEqual(result["readModel"]["version"], 20)  # Still queues the durable refresh.
        self.assertEqual(dates.call_args.kwargs["owner_email"], "coach@example.invalid")

    def test_missing_completion_clears_old_schedule_dates_including_aliases(self):
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[SimpleNamespace(id=1)]), \
             patch("coach_api.services.dashboard.service.saved_completed_review_dates", return_value={1: {"lastPr": None, "lastMcm": None}}):
            item = CoachDashboardService("coach@example.invalid").normalize_start_dates({"readModel": {"version": 20}, "learners": [
                {"id": "1", "lastPr": "2026-10-26", "lastMcm": "2026-11-26", "lastProgressReview": "old", "lastReview": "old"},
            ]})["learners"][0]
        self.assertIsNone(item["lastPr"])
        self.assertIsNone(item["lastMcm"])
        self.assertEqual((item["lastProgressReview"], item["lastReview"]), ("--", "--"))

    def test_current_snapshot_does_not_reload_review_history(self):
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[SimpleNamespace(id=1)]), \
             patch("coach_api.services.dashboard.service.saved_completed_review_dates") as dates:
            CoachDashboardService("coach@example.invalid").normalize_start_dates({"readModel": {"version": CoachDashboardService.SCHEMA_VERSION}, "learners": [{"id": "1"}]})
        dates.assert_not_called()

    def test_metric_upgrade_repairs_dates_before_saving_current_schema(self):
        original = {"learners": [{"id": "1", "lastPr": "2026-10-26", "lastReview": "2026-11-26"}],
                    "events": [{"date": "2026-11-26"}]}
        before = deepcopy(original)
        values = {"fetch_caseload_learner_profiles": [SimpleNamespace(id=1)],
                  "caseload_canonical_metrics": {}, "caseload_aptem_ids": {},
                  "dashboard_attendance_rows": [], "caseload_schedule_values": (None, None, None),
                  "caseload_profile_start_date": None}
        with ExitStack() as stack:
            stack.enter_context(patch.multiple("coach_api.views", **{key: MagicMock(return_value=value) for key, value in values.items()}))
            stack.enter_context(patch("coach_api.services.dashboard.service.saved_completed_review_dates", return_value={
                1: {"lastPr": "27 Oct 2026", "lastMcm": "26 Oct 2026"}}))
            stack.enter_context(patch("coach_api.services.dashboard.otjh.refresh_otjh_rows"))
            save = stack.enter_context(patch("coach_api.dashboard_service.CoachDashboardSnapshot.objects.update_or_create"))
            result = CoachDashboardService("coach@example.invalid").refresh_metric_projection(original)
        self.assertEqual(original, before)
        self.assertEqual(result["events"], before["events"])
        learner = result["learners"][0]
        self.assertEqual((learner["lastPr"], learner["lastProgressReview"]), ("2026-10-27", "2026-10-27"))
        self.assertEqual((learner["lastMcm"], learner["lastReview"]), ("2026-10-26", "2026-10-26"))
        self.assertEqual(save.call_args.kwargs["defaults"], {"payload": result, "schema_version": CoachDashboardService.SCHEMA_VERSION})

    def test_live_projection_uses_completion_not_booking_and_keeps_row_aliases_aligned(self):
        row = SimpleNamespace(id=1, training_plan=[])
        events = [
            {"eventKey": "one", "learnerId": "1", "source": "progress-review", "status": "completed", "date": "2026-10-26", "reviewCompletedAt": "2026-10-27T07:00:00Z"},
            {"eventKey": "two", "learnerId": "1", "source": "mcr", "status": "completed", "date": "2026-11-26", "reviewCompletedAt": "2026-10-26T10:00:00Z"},
            {"eventKey": "three", "learnerId": "1", "source": "progress-review", "status": "in-progress", "date": "2026-10-29", "reviewCompletedAt": None},
            {"eventKey": "four", "learnerId": "1", "source": "mcr", "status": "completed", "date": "2026-12-26", "reviewCompletedAt": None},
        ]
        values = {
            "fetch_caseload_learner_profiles": [row], "serialize_caseload_learner": {"id": "1", "lastReview": "1999-01-01"},
            "caseload_canonical_metrics": {}, "caseload_dashboard_progress_projections": {1: {"lastProgressReview": "1999-01-01"}},
            "caseload_audit_hour_totals": {}, "caseload_evidenced_ksb_counts": {}, "caseload_aptem_ids": {},
            "curriculum_expected_otjh_by_component_id": {}, "caseload_progress_history": {}, "build_monthly_risk_history": [],
            "coach_staff_display_name": "Coach", "resolve_coach_review_events": {"events": events},
            "fetch_calendar_event_records": {}, "fetch_standalone_event_records": [],
            "review_type_fields_by_template": {}, "collect_tracked_live_session_events": [],
            "dashboard_attendance_rows": [], "fetch_official_assigned_groups": [],
        }
        with ExitStack() as stack:
            stack.enter_context(patch.multiple("coach_api.views", **{key: MagicMock(return_value=value) for key, value in values.items()}))
            stack.enter_context(patch("coach_api.views.overlay_calendar_record", side_effect=lambda event, record: event))
            stack.enter_context(patch("coach_api.services.dashboard.otjh.refresh_otjh_rows"))
            stack.enter_context(patch("coach_api.services.dashboard.service.dashboard_marking_projection", return_value={"items": []}))
            payload = CoachDashboardService("coach@example.invalid", today=date(2026, 10, 27)).build_live()
        item = payload["learners"][0]
        self.assertEqual(item["lastPr"], "2026-10-27")
        self.assertEqual(item["lastMcm"], "2026-10-26")
        self.assertEqual(item["lastProgressReview"], item["lastPr"])
        self.assertEqual(item["lastReview"], item["lastMcm"])
        self.assertEqual(events[0]["date"], "2026-10-26")
