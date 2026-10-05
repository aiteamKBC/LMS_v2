"""Hourly Coach Dashboard snapshot schedule: claims, isolation and start-up guards."""
import asyncio
from datetime import datetime, timedelta, timezone as dt_timezone
from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from coach_api import dashboard_snapshot_scheduler as scheduler

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=dt_timezone.utc)


def snapshot_rows(*, claimed, exists=True):
    rows = MagicMock()
    rows.filter.return_value.update.return_value = 1 if claimed else 0
    rows.exists.return_value = exists
    return rows


class SnapshotClaimTests(SimpleTestCase):
    @patch("coach_api.models.CoachDashboardSnapshot.objects")
    def test_a_due_snapshot_is_claimed_by_one_conditional_update(self, objects):
        objects.filter.return_value = snapshot_rows(claimed=True)

        self.assertTrue(scheduler.claim("coach@example.invalid", now=NOW))

        objects.filter.assert_called_once_with(owner_email="coach@example.invalid")
        objects.filter.return_value.filter.return_value.update.assert_called_once_with(refreshed_at=NOW)

    @patch("coach_api.models.CoachDashboardSnapshot.objects")
    def test_a_fresh_or_already_claimed_snapshot_is_skipped(self, objects):
        objects.filter.return_value = snapshot_rows(claimed=False, exists=True)

        self.assertFalse(scheduler.claim("coach@example.invalid", now=NOW))

    @patch("django.core.cache.cache.add", return_value=False)
    @patch("coach_api.models.CoachDashboardSnapshot.objects")
    def test_a_first_snapshot_is_claimed_once_through_the_cache(self, objects, add):
        objects.filter.return_value = snapshot_rows(claimed=False, exists=False)

        self.assertFalse(scheduler.claim("coach@example.invalid", now=NOW))
        add.assert_called_once()

    @patch("django.core.cache.cache.add", side_effect=ConnectionError("redis unavailable"))
    @patch("coach_api.models.CoachDashboardSnapshot.objects")
    def test_cache_outage_still_builds_a_missing_first_snapshot(self, objects, _add):
        objects.filter.return_value = snapshot_rows(claimed=False, exists=False)

        self.assertTrue(scheduler.claim("coach@example.invalid", now=NOW))

    @patch.dict("os.environ", {"COACH_DASHBOARD_SNAPSHOT_INTERVAL_SECONDS": "60"})
    def test_interval_defaults_to_hourly_and_never_polls_faster_than_the_wake(self):
        self.assertEqual(scheduler.interval(), timedelta(seconds=scheduler.POLL_SECONDS))
        with patch.dict("os.environ", {"COACH_DASHBOARD_SNAPSHOT_INTERVAL_SECONDS": ""}):
            self.assertEqual(scheduler.interval(), timedelta(hours=1))


@patch("coach_api.dashboard_cache.invalidate_coach_dashboard_cache")
@patch("coach_api.services.dashboard.service.CoachDashboardService.refresh")
class RefreshDueSnapshotsTests(SimpleTestCase):
    def test_only_claimed_coaches_are_rebuilt_and_their_response_cache_dropped(self, refresh, invalidate):
        with patch.object(scheduler, "claim", side_effect=lambda email, now: email == "due@example.invalid"):
            counts = scheduler.refresh_due_snapshots(
                emails=["due@example.invalid", "fresh@example.invalid"], now=NOW,
            )

        self.assertEqual((counts["refreshed"], counts["skipped"], counts["failed"]), (1, 1, 0))
        refresh.assert_called_once_with()
        invalidate.assert_called_once_with("due@example.invalid")

    def test_one_coach_failing_does_not_stop_the_others(self, refresh, invalidate):
        refresh.side_effect = [RuntimeError("source unavailable"), {"learners": []}]
        with patch.object(scheduler, "claim", return_value=True), \
                self.assertLogs("coach_api.dashboard_snapshot_scheduler", level="ERROR"):
            counts = scheduler.refresh_due_snapshots(emails=["a@example.invalid", "b@example.invalid"], now=NOW)

        self.assertEqual((counts["refreshed"], counts["failed"]), (1, 1))
        self.assertEqual(counts["failedCoaches"], ["a@example.invalid"])
        invalidate.assert_called_once_with("b@example.invalid")

    def test_force_rebuilds_without_claiming(self, refresh, _invalidate):
        with patch.object(scheduler, "claim") as claim:
            counts = scheduler.refresh_due_snapshots(emails=["a@example.invalid"], force=True)

        claim.assert_not_called()
        self.assertEqual(counts["refreshed"], 1)
        refresh.assert_called_once_with()


class RefreshCommandTests(SimpleTestCase):
    @patch("coach_api.management.commands.refresh_coach_dashboard_snapshots.refresh_due_snapshots",
           return_value={"refreshed": 2, "skipped": 0, "failed": 0, "failedCoaches": []})
    @patch("coach_api.management.commands.refresh_coach_dashboard_snapshots.coach_emails",
           return_value=["a@example.invalid", "b@example.invalid"])
    def test_command_rebuilds_every_coach_by_default(self, _emails, refresh):
        out = StringIO()
        call_command("refresh_coach_dashboard_snapshots", stdout=out)

        refresh.assert_called_once_with(emails=["a@example.invalid", "b@example.invalid"], force=True)
        self.assertIn("refreshed=2", out.getvalue())

    @patch("coach_api.management.commands.refresh_coach_dashboard_snapshots.refresh_due_snapshots",
           return_value={"refreshed": 0, "skipped": 0, "failed": 1, "failedCoaches": ["a@example.invalid"]})
    @patch("coach_api.management.commands.refresh_coach_dashboard_snapshots.coach_emails",
           return_value=["a@example.invalid"])
    def test_due_only_run_reports_failures_as_a_command_error(self, _emails, refresh):
        with self.assertRaises(CommandError):
            call_command("refresh_coach_dashboard_snapshots", "--due", stdout=StringIO())
        refresh.assert_called_once_with(emails=["a@example.invalid"], force=False)

    @patch("coach_api.management.commands.refresh_coach_dashboard_snapshots.coach_emails", return_value=[])
    def test_unknown_coach_is_refused(self, _emails):
        with self.assertRaises(CommandError):
            call_command("refresh_coach_dashboard_snapshots", "--coach", "nobody@example.invalid", stdout=StringIO())


class SchedulerStartTests(SimpleTestCase):
    def setUp(self):
        patcher = patch.object(scheduler, "_thread", None)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_test_runs_never_start_the_schedule(self):
        with patch("threading.Thread") as thread:
            self.assertFalse(scheduler.start_scheduler())
        thread.assert_not_called()

    @patch.dict("os.environ", {"COACH_DASHBOARD_SNAPSHOT_SCHEDULE": "false"})
    def test_deployments_can_opt_out(self):
        with patch.object(scheduler.sys, "argv", ["daphne"]), patch("threading.Thread") as thread:
            self.assertFalse(scheduler.start_scheduler())
        thread.assert_not_called()

    @override_settings(CHAT_TEST_MODE=False, RUN_APP_ON_TEST_BRANCH=False)
    def test_serving_process_starts_exactly_one_thread(self):
        with patch.object(scheduler.sys, "argv", ["daphne"]), \
                patch.dict("os.environ", {}, clear=False) as env, \
                patch("coach_api.dashboard_snapshot_scheduler.threading.Thread") as thread:
            env.pop("PYTEST_CURRENT_TEST", None)
            env.pop("COACH_DASHBOARD_SNAPSHOT_SCHEDULE", None)
            thread.return_value.is_alive.return_value = True
            self.assertTrue(scheduler.start_scheduler())
            self.assertTrue(scheduler.start_scheduler())
        thread.assert_called_once()
        self.assertTrue(thread.call_args.kwargs["daemon"])

    def test_asgi_wrapper_starts_only_for_http(self):
        calls = []

        async def app(scope, receive, send):
            calls.append(scope["type"])

        wrapped = scheduler.CoachDashboardSnapshotASGI(app)
        with patch.object(scheduler, "start_scheduler") as start:
            asyncio.run(wrapped({"type": "websocket"}, None, None))
            start.assert_not_called()
            asyncio.run(wrapped({"type": "http"}, None, None))
            start.assert_called_once_with()
        self.assertEqual(calls, ["websocket", "http"])

    def test_wsgi_wrapper_starts_the_schedule(self):
        app = MagicMock(return_value=[b"ok"])
        with patch.object(scheduler, "start_scheduler") as start:
            self.assertEqual(scheduler.CoachDashboardSnapshotWSGI(app)({}, None), [b"ok"])
        start.assert_called_once_with()


class ProgressHistoryQueryTests(SimpleTestCase):
    """The snapshot build must not issue one deferred-field query per progress entry."""

    def test_history_query_loads_every_field_the_record_reads(self):
        from coach_api import views

        class Entry:
            def __init__(self):
                object.__setattr__(self, "read", set())

            def __getattr__(self, name):
                self.read.add(name)
                return None

        entry = Entry()
        views.progress_entry_history_record(entry)
        with patch("coach_api.views.LearnerProgressEntry.objects") as objects:
            views.caseload_progress_history([MagicMock(id=7)])
        loaded = set(objects.filter.return_value.exclude.return_value.only.call_args.args)

        self.assertTrue(entry.read)
        self.assertLessEqual(entry.read, loaded, f"deferred per-entry reads: {sorted(entry.read - loaded)}")
