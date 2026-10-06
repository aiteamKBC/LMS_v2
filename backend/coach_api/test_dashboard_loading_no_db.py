"""Regressions for the lean overlay and pool health, without live I/O."""
from contextlib import nullcontext
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import OperationalError
from django.db.backends.postgresql.base import DatabaseWrapper
from django.test import RequestFactory, SimpleTestCase
from psycopg.pq import TransactionStatus
from psycopg_pool import ConnectionPool

from coach_api.dashboard_view import coach_dashboard_section
from coach_api.services.dashboard.profile_dates import fetch_dashboard_profile_dates
from coach_api.services.dashboard.service import CoachDashboardService
from coach_api.services.dashboard.timing import dashboard_stage


class DashboardLoadingTests(SimpleTestCase):
    def test_live_snapshot_review_resolution_reuses_supplied_sources(self):
        from coach_api.views import resolve_coach_review_events

        with patch("coach_api.views.fetch_source_schedule_rows") as fetch, \
                patch("coach_api.views.resolve_effective_aptem_ids", return_value=({}, set())), \
                patch("coach_api.views.fetch_aptem_review_events", return_value=([], set())):
            result = resolve_coach_review_events("coach@example.invalid", "Coach", [], source_schedule_rows=({}, {}))
        fetch.assert_not_called()
        self.assertEqual(result["events"], [])

    def test_read_overlay_never_calls_full_profile_or_contract_loaders(self):
        with patch("coach_api.views.fetch_caseload_dashboard_profiles") as full, \
                patch("coach_api.views.attach_caseload_source_rows") as attach, \
                patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates", return_value=[]) as lean:
            CoachDashboardService("coach@example.invalid").normalize_start_dates({"learners": [{"id": "12"}]})
        lean.assert_called_once_with("coach@example.invalid", [12])
        full.assert_not_called()
        attach.assert_not_called()

    def test_empty_projection_does_not_query_profiles(self):
        with patch("coach_api.services.dashboard.profile_dates.fetch_dashboard_profile_dates") as lean:
            CoachDashboardService("coach@example.invalid").normalize_start_dates({"learners": []})
        lean.assert_not_called()

    @patch("coach_api.views.EnrolmentUser.all_learners")
    @patch("coach_api.views.LearnerProfile.objects")
    def test_lean_overlay_selects_only_required_columns_and_snapshot_ids(self, profiles, sources):
        query = profiles.annotate.return_value.filter.return_value.exclude.return_value.exclude.return_value
        query.values.return_value = [{"id": 12, "enrolment_id": 77, "programme_status": "Delivery"}]
        sources.filter.return_value.values.return_value = [{"id": 77, "learner_start_date": "2026-01-01", "learner_end_date": None}]
        rows = fetch_dashboard_profile_dates(" Coach@Example.Invalid ", [12])
        profiles.annotate.return_value.filter.assert_called_once_with(coach_email_key="coach@example.invalid", pk__in=[12])
        query.values.assert_called_once_with("id", "programme_status", "enrolment_id")
        sources.filter.assert_called_once_with(pk__in={77})
        sources.filter.return_value.values.assert_called_once_with("id", "learner_start_date", "learner_end_date")
        self.assertEqual(rows[0]._caseload_source.learner_start_date, "2026-01-01")

    def test_cache_timeout_is_nonfatal_for_learner_section(self):
        request = RequestFactory().get("/coach_api/coach/dashboard/learners")
        request.coach_email = "coach@example.invalid"
        with patch("coach_api.dashboard_cache.cache.get", side_effect=TimeoutError("synthetic")), \
                patch("coach_api.dashboard_cache.cache.set", side_effect=TimeoutError("synthetic")), \
                patch("coach_api.dashboard_view.load_section", return_value={"learners": []}), \
                patch("coach_api.dashboard_view.schedule_coach_dashboard_refresh"):
            self.assertEqual(unwrap(coach_dashboard_section)(request, "learners").status_code, 200)

    def test_failed_query_releases_unusable_connection_and_keeps_exception(self):
        connection = MagicMock(errors_occurred=True, in_atomic_block=False)
        connection.execute_wrapper.return_value = nullcontext()
        with patch("coach_api.services.dashboard.timing.connections.all", return_value=[connection]), \
                patch("coach_api.services.dashboard.timing.logger.info") as metric:
            with self.assertRaisesRegex(OperationalError, "SSL closed"):
                with dashboard_stage("source_schedule_query"):
                    raise OperationalError("SSL closed")
        connection.close_if_unusable_or_obsolete.assert_called_once()
        self.assertEqual(metric.call_args.kwargs["extra"]["outcome"], "failed")

    def test_django_pool_installs_checkout_check_when_health_checks_enabled(self):
        from config.settings import database_from_url
        config = database_from_url("postgresql://synthetic:synthetic@example.invalid/synthetic?sslmode=require")
        config["TIME_ZONE"] = None
        self.assertTrue(config["CONN_HEALTH_CHECKS"])
        self.assertEqual(config["CONN_MAX_AGE"], 0)
        wrapper = DatabaseWrapper(config, alias="dashboard-health-test")
        with patch("psycopg_pool.ConnectionPool") as pool:
            wrapper.pool
        self.assertIs(pool.call_args.kwargs["check"], pool.check_connection)
        DatabaseWrapper._connection_pools.pop("dashboard-health-test", None)

    def test_psycopg_discards_bad_returned_connection(self):
        pool = ConnectionPool(open=False)
        broken = SimpleNamespace(pgconn=SimpleNamespace(transaction_status=TransactionStatus.UNKNOWN))
        with patch.object(pool, "run_task") as replace, patch.object(pool, "_add_to_pool") as reuse:
            pool._return_connection(broken, from_getconn=False)
        replace.assert_called_once()
        reuse.assert_not_called()
