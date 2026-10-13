"""Canonical OTJH parity and cache freshness without database/external I/O."""
from copy import deepcopy
from datetime import date
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase
from learner_api import canonical_learning as canonical
from coach_api.dashboard_view import coach_dashboard_section
from coach_api.services.dashboard.otjh import refresh_otjh_rows
from coach_api.services.dashboard.sections import learner_table_row
from coach_api.services.dashboard.service import CoachDashboardService


class OtjhParityTests(SimpleTestCase):
    def test_source_text_window_and_profile_fallback_do_not_require_contracts(self):
        from coach_api.selectors.otjh import learner_programme_window
        profile = SimpleNamespace(start_date=date(2025,5,1), end_date=date(2027,6,30))
        source = SimpleNamespace(start_date=None, end_date=None,
            learner_start_date="2026-05-29", learner_end_date="2028-08-01")
        self.assertEqual(learner_programme_window(profile, source), ("2026-05-29", "2028-08-01"))
        self.assertEqual(learner_programme_window(profile, None), (date(2025,5,1), date(2027,6,30)))

    def test_midflight_dashboard_profile_consistency_uses_source_window_and_current_day(self):
        from coach_api.views import serialize_case_file_shell, apply_otjh_to_date_metrics

        for actual, planned, start, end, expected_target, expected_progress in (
            (72.0581, 850, "2026-05-29", "2028-08-01", 138.99, 51.84),
            (558.4808, 569, "2025-05-01", "2027-06-30", 376.69, 100),
        ):
            for kind in ("commercial", "apprenticeship"):
                with self.subTest(planned=planned, kind=kind):
                    source = SimpleNamespace(start_date=start, end_date=end,
                        learner_start_date="2026-06-01", learner_type=kind, aptem_id=None)
                    row = SimpleNamespace(id=30, enrolment_id=80, _caseload_source=source,
                        start_date=None, end_date=None,
                        _caseload_contract={"program_start_date": "2020-01-01", "planned_end_date": "2021-01-01"})
                    payload = {"learners": [{"id": "30", "otjhTarget": planned}]}
                    facts = dict(profile_id=30, actual=actual, planned=planned, start_date=None, end_date=None)
                    with patch("coach_api.services.dashboard.otjh.otjh_summary_bulk", return_value={80:facts}):
                        refresh_otjh_rows(payload, [row], today=date(2026,10,6))
                        dashboard = learner_table_row(payload["learners"][0])["otjh"]
                        profile = serialize_case_file_shell(row, source)["profile"]
                        profile_metrics = apply_otjh_to_date_metrics(dict(otjhCompleted=actual,
                            otjhPlanned=planned, otjhProgrammeStartDate=profile["otjhProgrammeStartDate"],
                            plannedEndDate=profile["otjhProgrammeEndDate"]), today=date(2026,10,6))
                        self.assertEqual(dashboard, dict(completed=actual, planned=planned,
                            targetToDate=expected_target, progress=expected_progress,
                            ragStatus=profile_metrics["otjhRagStatus"]))
                        self.assertNotEqual(dashboard["targetToDate"], dashboard["planned"])
                        self.assertEqual(dashboard["targetToDate"], profile_metrics["otjhTargetAsOfToday"])
                        self.assertEqual(dashboard["progress"], profile_metrics["otjhProgressAsOfToday"])
                        refresh_otjh_rows(payload, [row], today=date(2026,10,7))
                        self.assertGreater(payload["learners"][0]["otjhTargetAsOfToday"], expected_target)

    def test_unavailable_window_never_falls_back_to_planned_or_stale_target(self):
        from coach_api.services.dashboard.sections import normalize_otjh_contract
        payload = {"learners": [{"id":"30", "otjhTarget":850, "otjhTargetAsOfToday":850}]}
        facts = dict(profile_id=30, actual=72.0581, planned=850)
        with patch("coach_api.services.dashboard.otjh.otjh_summary_bulk", return_value={80:facts}):
            refresh_otjh_rows(payload, [SimpleNamespace(id=30, enrolment_id=80)], today=date(2026,10,6))
        normalize_otjh_contract(payload)
        self.assertEqual(learner_table_row(payload["learners"][0])["otjh"], dict(
            completed=72.0581, planned=850, targetToDate=None, progress=None, ragStatus="unavailable"))

    def test_repeated_normalization_cannot_turn_missing_actual_into_green_zero(self):
        from coach_api.services.dashboard.sections import normalize_otjh_contract
        payload = {"learners": [dict(otjhCompleted=None, otjhPlanned=850,
            otjhProgrammeStartDate="2026-05-29", plannedEndDate="2028-08-01")]}
        normalize_otjh_contract(payload)
        self.assertIsNone(payload["learners"][0]["otjhProgressAsOfToday"])
        self.assertEqual(payload["learners"][0]["otjhRagStatus"], "unavailable")

    def owner(self, enrolment=80, profile=30, aptem=900):
        return dict(id=profile, enrolment_id=enrolment, aptem_id=aptem,
                    account_record_id=enrolment, email="synthetic@example.test",
                    account_email="synthetic@example.test", account_aptem_id=aptem,
                    programme_id=4, start_date=date(2025, 1, 1), end_date=date(2027, 1, 1))

    def test_legacy_and_current_use_profile_actual_and_monthly_plan(self):
        for aptem in (900, None):
            with self.subTest(aptem=aptem):
                owner = self.owner(aptem=aptem)
                records = [dict(learner_id=30, accepted=True, actual_seconds=36000),
                           dict(learner_id=30, accepted=False, actual_seconds=72000),
                           dict(learner_id=30, accepted=True, actual_seconds=-10)]
                targets = [dict(learner_id=30, report_month="2026-01", target_hours=20)]
                expected = canonical.metrics_from_records(records, {"2026-01": 20})["otjh"]
                with patch.object(canonical, "query", side_effect=[[owner], [dict(learner_id=30, actual_seconds=36000)], targets]) as query:
                    facts = canonical.otjh_summary_bulk([80, 80])[80]
                self.assertEqual(query.call_count, 3)
                self.assertEqual(facts["actual"], expected["actual"])
                self.assertEqual(facts["planned"], expected["planned"])
                payload = {"learners": [{"id": "30", "otjhCompleted": 999, "otjhPlanned": None,
                                         "otjhProgrammeStartDate": "2020-01-01"}]}
                with patch("coach_api.services.dashboard.otjh.otjh_summary_bulk", return_value={80: facts}):
                    refresh_otjh_rows(payload, [SimpleNamespace(**owner)], today=date(2026, 1, 1))
                item = payload["learners"][0]
                self.assertEqual(item["otjhCompleted"], 10)
                self.assertEqual(item["otjhPlanned"], 20)
                self.assertEqual(item["otjhTargetAsOfToday"], 10)
                self.assertEqual(item["otjhProgressAsOfToday"], 100)
                self.assertEqual(item["otjhRagStatus"], "on-track")
                self.assertEqual(set(learner_table_row(item)["otjh"]),
                                 {"completed", "targetToDate", "planned", "progress", "ragStatus"})

    def test_narrow_queries_exclude_deleted_rows_and_scope_target_selection(self):
        with patch.object(canonical, "query", side_effect=[[self.owner()], [], []]) as query:
            canonical.otjh_summary_bulk([80])
        sql = [call.args[0] for call in query.call_args_list]
        self.assertIn("deleted_at IS NULL", sql[1])
        self.assertIn("accepted IS TRUE", sql[1])
        self.assertIn("GROUP BY learner_id", sql[1])
        self.assertIn("GREATEST(COALESCE(actual_seconds,0),0)", sql[1])
        self.assertIn("NaN", sql[1])
        self.assertNotIn("source_payload", sql[1])
        self.assertNotIn("SELECT *", sql[1])
        self.assertIn("DISTINCT ON (t.learner_id,t.report_month)", sql[2])
        self.assertIn("coalesce(t.programme_profile_id,'')=''", sql[2])
        self.assertIn("t.enrolment_id IS NOT DISTINCT FROM l.enrolment_id", sql[2])
        self.assertIn("t.programme_id IS NOT DISTINCT FROM l.programme_id", sql[2])

    def test_identity_mismatch_and_duplicate_enrolments_fail_closed(self):
        invalid = self.owner(); invalid["account_aptem_id"] = 901
        for owners in ([invalid], [self.owner(), self.owner(profile=31)]):
            with self.subTest(owners=owners), patch.object(canonical, "query", return_value=owners) as query:
                self.assertIsNone(canonical.otjh_summary_bulk([80])[80])
                self.assertEqual(query.call_count, 1)

    def test_empty_caseload_performs_no_reads(self):
        with patch.object(canonical, "query") as query:
            self.assertEqual(canonical.otjh_summary_bulk([]), {})
        query.assert_not_called()

    def test_query_count_does_not_grow_with_caseload(self):
        owners = [self.owner(enrolment=80+i, profile=30+i, aptem=900+i) for i in range(25)]
        with patch.object(canonical, "query", side_effect=[owners, [], []]) as query:
            result = canonical.otjh_summary_bulk([o["enrolment_id"] for o in owners])
        self.assertEqual(len(result), 25)
        self.assertEqual(query.call_count, 3)

    def test_cached_snapshot_gets_live_hours_and_plan_on_every_request(self):
        stale = {"learners": [{"id": "30", "otjhCompleted": 1, "otjhPlanned": None,
                               "rawProgramStatus": "Delivery"}]}
        row = SimpleNamespace(id=30, enrolment_id=80, programme_status="Delivery", _caseload_source=None,
                              start_date=date(2025,1,1), end_date=date(2027,1,1))
        facts = dict(profile_id=30, actual=10, planned=20, start_date=date(2025,1,1), end_date=date(2027,1,1))
        request = RequestFactory().get("/coach_api/coach/dashboard/learners")
        request.coach_email = "coach@example.invalid"
        with patch("coach_api.dashboard_cache.get_cached_dashboard_section", side_effect=lambda *a: deepcopy(stale)), \
             patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[row]), \
             patch("coach_api.services.dashboard.otjh.otjh_summary_bulk", side_effect=[{80:facts}, {80:{**facts, "actual":15, "planned":30}}]), \
             patch("coach_api.dashboard_view.schedule_coach_dashboard_refresh"), \
             patch("coach_api.dashboard_view.snapshot_needs_refresh", return_value=False), \
             patch("coach_api.dashboard_cache.cache_dashboard_section"), \
             patch("coach_api.services.dashboard.sections.timezone.localdate", return_value=date(2026,1,1)), \
             patch("coach_api.services.dashboard.service.timezone.localdate", return_value=date(2026,1,1)):
            first = unwrap(coach_dashboard_section)(request, "learners")
            second = unwrap(coach_dashboard_section)(request, "learners")
        import json
        self.assertEqual(first.status_code, 200, first.content)
        self.assertEqual(second.status_code, 200, second.content)
        a, b = [json.loads(response.content)["results"][0]["otjh"] for response in (first, second)]
        self.assertEqual(a["completed"],10)
        self.assertEqual(a["targetToDate"],10)
        self.assertEqual(b["completed"],15)
        self.assertEqual(b["targetToDate"],15)
        self.assertEqual(stale["learners"][0]["otjhCompleted"],1)

    def test_stale_profile_link_never_returns_another_learners_hours(self):
        payload = {"learners": [{"id":"30", "otjhCompleted":123, "otjhPlanned":500}]}
        with patch("coach_api.services.dashboard.otjh.otjh_summary_bulk", return_value={80:dict(profile_id=31, actual=999, planned=999)}):
            refresh_otjh_rows(payload,[SimpleNamespace(id=30,enrolment_id=80)],today=date(2026,1,1))
        self.assertIsNone(payload["learners"][0]["otjhCompleted"])
        self.assertIsNone(payload["learners"][0]["otjhTargetAsOfToday"])
        self.assertEqual(payload["learners"][0]["otjhRagStatus"],"unavailable")
