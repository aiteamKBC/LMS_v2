"""Dedicated Session Results owner lifecycle tests; no database or network."""

import signal
import socket
import sys
import threading
import time
import types
import unittest
from contextlib import contextmanager
from unittest.mock import Mock, patch

from django.conf import settings

if not settings.configured:
    settings.configure(CURRICULUM_HOME_SHARED_READ_MODEL_ENABLED=False)

from curriculum_api import session_sync_runtime
from curriculum_api.apps import CurriculumApiConfig
from curriculum_api.management.commands import run_session_result_scheduler as scheduler


def wait_until(predicate, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return bool(predicate())


class OwnerLifecycleTests(unittest.TestCase):
    def make_owner(self, **kwargs):
        kwargs.setdefault("session_pass", lambda: None)
        kwargs.setdefault("review_pass", lambda: None)
        owner = scheduler.SessionResultSchedulerOwner(
            session_seconds=kwargs.pop("session_seconds", 0.02),
            review_seconds=kwargs.pop("review_seconds", 0.03),
            review_initial_delay=kwargs.pop("review_initial_delay", 0),
            **kwargs,
        )
        self.addCleanup(self.stop_owner, owner)
        return owner

    @staticmethod
    def stop_owner(owner):
        owner.stop(reason="test_cleanup")
        owner.join(timeout=2)

    def test_initial_start_runs_both_independent_loops(self):
        session_started, review_started = threading.Event(), threading.Event()
        owner = self.make_owner(
            session_pass=lambda: session_started.set(),
            review_pass=lambda: review_started.set(),
        )

        self.assertTrue(owner.start())
        self.assertTrue(session_started.wait(1))
        self.assertTrue(review_started.wait(1))
        self.assertEqual(
            {thread.name for thread in owner._threads},
            {"session-result-owner", "session-recording-review-owner"},
        )
        self.assertTrue(all(not thread.daemon for thread in owner._threads))

    def test_defaults_preserve_existing_one_and_five_minute_cadences(self):
        owner = scheduler.SessionResultSchedulerOwner()
        self.assertEqual(owner.session_seconds, 60)
        self.assertEqual(owner.review_seconds, 300)
        self.assertEqual(owner.review_initial_delay, 300)

    def test_cadences_are_independent(self):
        lock = threading.Lock()
        calls = {"session": 0, "review": 0}
        reviewed = threading.Event()

        def session_pass():
            with lock:
                calls["session"] += 1

        def review_pass():
            with lock:
                calls["review"] += 1
            reviewed.set()

        owner = self.make_owner(
            session_pass=session_pass,
            review_pass=review_pass,
            session_seconds=0.01,
            review_seconds=0.05,
            review_initial_delay=0.035,
        )
        owner.start()
        self.assertTrue(reviewed.wait(1))
        with lock:
            self.assertGreaterEqual(calls["session"], 2)
            self.assertEqual(calls["review"], 1)

    def test_empty_queue_completion_keeps_the_loop_healthy(self):
        called = threading.Event()
        owner = self.make_owner(session_pass=lambda: called.set(), review_initial_delay=10)
        owner.start()
        self.assertTrue(called.wait(1))
        health = owner.snapshot()["session_results"]
        self.assertEqual(health["attempts"], 1)
        self.assertEqual(health["invocation_failures"], 0)
        self.assertEqual(health["last_outcome"], "invoked")

    def test_failed_pass_retries_without_stopping_the_owner(self):
        recovered = threading.Event()
        attempts = []

        def flaky():
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("synthetic private detail")
            recovered.set()

        owner = self.make_owner(session_pass=flaky, session_seconds=0.01, review_initial_delay=10)
        with self.assertLogs(scheduler.log, level="ERROR") as logs:
            owner.start()
            self.assertTrue(recovered.wait(1))
        self.assertEqual(owner.snapshot()["session_results"]["invocation_failures"], 1)
        self.assertNotIn("synthetic private detail", "\n".join(logs.output))

    def test_reported_job_and_review_failures_are_not_invocation_failures(self):
        session_done, review_done = threading.Event(), threading.Event()

        def session_pass():
            session_done.set()
            return "jobs_failed"

        def review_pass():
            review_done.set()
            return "review_failed"

        owner = self.make_owner(
            session_pass=session_pass, review_pass=review_pass,
            session_seconds=10, review_seconds=10,
        )
        owner.start()
        self.assertTrue(session_done.wait(1))
        self.assertTrue(review_done.wait(1))
        self.assertTrue(wait_until(
            lambda: all(owner.snapshot()[name]["work_failures"] == 1 for name in (
                "session_results", "recording_review",
            ))
        ))
        snapshot = owner.snapshot()
        for workload in ("session_results", "recording_review"):
            self.assertEqual(snapshot[workload]["invocation_successes"], 1)
            self.assertEqual(snapshot[workload]["invocation_failures"], 0)
            self.assertEqual(snapshot[workload]["work_failures"], 1)

    def test_pass_longer_than_interval_uses_fixed_delay_without_overlap(self):
        starts = []
        active = 0
        maximum_active = 0
        second_pass = threading.Event()
        lock = threading.Lock()

        def slow_pass():
            nonlocal active, maximum_active
            with lock:
                starts.append(time.monotonic())
                active += 1
                maximum_active = max(maximum_active, active)
            time.sleep(0.04)
            with lock:
                active -= 1
                if len(starts) >= 2:
                    second_pass.set()

        owner = self.make_owner(
            session_pass=slow_pass,
            session_seconds=0.02,
            review_initial_delay=10,
        )
        owner.start()
        self.assertTrue(second_pass.wait(1))
        self.assertGreaterEqual(starts[1] - starts[0], 0.055)
        self.assertEqual(maximum_active, 1)

    def test_idle_shutdown_interrupts_long_waits(self):
        first_pass = threading.Event()
        owner = self.make_owner(
            session_pass=lambda: first_pass.set(),
            session_seconds=60,
            review_initial_delay=300,
        )
        owner.start()
        self.assertTrue(first_pass.wait(1))
        started = time.monotonic()
        owner.stop(reason="sigterm")
        owner.join(timeout=1)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertFalse(any(thread.is_alive() for thread in owner._threads))

    def test_shutdown_during_active_processing_waits_for_that_pass(self):
        active, release = threading.Event(), threading.Event()
        calls = []

        def processing():
            calls.append(1)
            active.set()
            release.wait(2)

        owner = self.make_owner(session_pass=processing, session_seconds=0.01, review_initial_delay=300)
        owner.start()
        self.assertTrue(active.wait(1))
        owner.stop(reason="sigterm")
        owner.join(timeout=0.02)
        self.assertTrue(owner._threads[0].is_alive())
        release.set()
        owner.join(timeout=1)
        self.assertEqual(calls, [1])

    def test_only_one_local_owner_and_no_duplicate_start(self):
        first = self.make_owner(review_initial_delay=300)
        second = self.make_owner(review_initial_delay=300)
        self.assertTrue(first.start())
        self.assertFalse(first.start())
        with self.assertRaises(scheduler.OwnerAlreadyRunning):
            second.start()
        self.assertEqual(len(first._threads), 2)

    def test_partial_thread_start_failure_stops_started_loop_and_releases_owner(self):
        real_thread = threading.Thread
        calls = []

        class FailingThread:
            def start(self):
                raise RuntimeError("synthetic private startup detail")

            def is_alive(self):
                return False

            def join(self, _timeout=None):
                return None

        def thread_factory(*args, **kwargs):
            calls.append(kwargs["name"])
            return real_thread(*args, **kwargs) if len(calls) == 1 else FailingThread()

        owner = self.make_owner(session_seconds=10, review_initial_delay=10)
        with patch.object(scheduler.threading, "Thread", side_effect=thread_factory), \
                self.assertLogs(scheduler.log, level="ERROR") as logs:
            with self.assertRaisesRegex(RuntimeError, "synthetic private startup detail"):
                owner.start()

        self.assertFalse(any(thread.is_alive() for thread in owner._threads))
        self.assertNotIn("synthetic private startup detail", "\n".join(logs.output))
        replacement = self.make_owner(review_initial_delay=10)
        self.assertTrue(replacement.start())

    def test_base_exception_marks_fatal_thread_death_and_stops_peer_loop(self):
        def fatal_pass():
            raise SystemExit("synthetic private fatal detail")

        owner = self.make_owner(session_pass=fatal_pass, review_initial_delay=10)
        with self.assertLogs(scheduler.log, level="CRITICAL") as logs:
            owner.start()
            self.assertTrue(wait_until(lambda: owner.failure() is not None))

        self.assertEqual(owner.failure(), ("session_results", "SystemExit"))
        self.assertFalse(owner.is_running())
        self.assertNotIn("synthetic private fatal detail", "\n".join(logs.output))

    def test_new_owner_can_start_after_worker_restart(self):
        first = self.make_owner(review_initial_delay=300)
        first.start()
        first.stop(reason="restart")
        first.join(timeout=1)

        replacement = self.make_owner(review_initial_delay=300)
        self.assertTrue(replacement.start())

    def test_lifecycle_makes_no_external_call_by_itself(self):
        owner = self.make_owner(review_initial_delay=300)
        with patch.object(socket, "socket", side_effect=AssertionError("network forbidden")):
            owner.start()
            self.assertTrue(wait_until(lambda: owner.snapshot()["session_results"]["attempts"] >= 1))


class ExistingWorkerIntegrationTests(unittest.TestCase):
    @patch.object(scheduler, "run_worker", return_value="invoked")
    def test_session_pass_reuses_scheduled_worker_and_its_database_lease(self, run_worker):
        self.assertEqual(scheduler.scheduled_session_pass(), "invoked")
        run_worker.assert_called_once_with(scheduled=True)

    def test_recording_review_keeps_shared_slot_coordination(self):
        with patch.object(session_sync_runtime, "_claim_review_slot", return_value=False), \
                patch.object(session_sync_runtime, "run_reviewer") as review:
            self.assertFalse(session_sync_runtime.run_scheduled_reviewer())
            review.assert_not_called()
        with patch.object(session_sync_runtime, "_claim_review_slot", return_value=True), \
                patch.object(session_sync_runtime, "run_reviewer") as review:
            self.assertTrue(session_sync_runtime.run_scheduled_reviewer())
            review.assert_called_once_with()

    @patch.object(scheduler, "run_scheduled_reviewer_outcome", return_value="skipped_peer")
    def test_owner_reports_peer_owned_review_slot_without_running_a_second_algorithm(self, review):
        self.assertEqual(scheduler.scheduled_recording_review_pass(), "skipped_peer")
        review.assert_called_once_with()

    def test_owner_management_command_does_not_start_curriculum_warming(self):
        package = sys.modules["curriculum_api"]
        config = CurriculumApiConfig("curriculum_api", package)
        read_model = types.ModuleType("curriculum_api.read_model")
        read_model.register_curriculum_home_read_model = Mock()
        views = types.ModuleType("curriculum_api.views")
        views.schedule_curriculum_warm = Mock()

        with patch.object(sys, "argv", ["manage.py", "run_session_result_scheduler"]), \
                patch.dict(sys.modules, {
                    "curriculum_api.read_model": read_model,
                    "curriculum_api.views": views,
                }), patch.object(config, "log_cache_backend") as log_cache:
            config.ready()

        read_model.register_curriculum_home_read_model.assert_called_once_with()
        views.schedule_curriculum_warm.assert_not_called()
        log_cache.assert_not_called()


class SignalAndHealthTests(unittest.TestCase):
    def test_sigterm_and_sigint_request_clean_shutdown(self):
        owner = Mock()
        installed = {}

        def install(signum, handler):
            installed.setdefault(signum, handler)

        with patch.object(scheduler.signal, "getsignal", side_effect=lambda signum: f"old-{signum}"), \
                patch.object(scheduler.signal, "signal", side_effect=install):
            with scheduler.shutdown_signal_handlers(owner):
                installed[signal.SIGTERM](signal.SIGTERM, None)
                installed[signal.SIGINT](signal.SIGINT, None)

        self.assertEqual(
            [call.kwargs["reason"] for call in owner.stop.call_args_list],
            ["sigterm", "sigint"],
        )

    def test_queue_health_is_aggregate_and_uses_the_existing_stale_lease_boundary(self):
        cursor = Mock()
        cursor.__enter__ = Mock(return_value=cursor)
        cursor.__exit__ = Mock(return_value=False)
        cursor.fetchone.return_value = (20, 4, 3, 125, 2, 1, 1)
        connection = Mock()
        connection.cursor.return_value = cursor
        connections = {"default": connection}

        with patch.dict("sys.modules", {
            "django.db": Mock(close_old_connections=Mock(), connections=connections),
        }):
            metrics = scheduler.session_result_queue_metrics()

        self.assertEqual(metrics, {
            "completed_jobs": 20,
            "failed_jobs": 4,
            "due_jobs": 3,
            "oldest_overdue_seconds": 125,
            "running_jobs": 2,
            "stale_running_jobs": 1,
            "exhausted_failed_jobs": 1,
        })
        sql = cursor.execute.call_args.args[0]
        self.assertIn("attempts < 8", sql)
        self.assertIn("interval '2 hours'", sql)
        self.assertIn("min(next_attempt_at)", sql)
        self.assertNotIn("min(requested_at)", sql)
        connection.close.assert_called_once_with()

    def test_health_probe_failure_logs_only_the_exception_type(self):
        owner = Mock()
        owner.thread_liveness.return_value = {"session_results": True, "recording_review": True}
        owner.failure.return_value = None
        owner.stop_event.is_set.return_value = False
        owner.monotonic.return_value = 0
        owner.snapshot.return_value = {
            "session_results": {
                "attempts": 0, "invocation_successes": 0, "invocation_failures": 0,
                "work_failures": 0, "last_outcome": "not_started",
                "last_duration_ms": None, "last_finished_monotonic": None,
            },
            "recording_review": {
                "attempts": 0, "invocation_successes": 0, "invocation_failures": 0,
                "work_failures": 0, "last_outcome": "not_started",
                "last_duration_ms": None, "last_finished_monotonic": None,
            },
        }

        with self.assertLogs(scheduler.log, level="WARNING") as logs:
            scheduler.log_health(owner, queue_probe=Mock(side_effect=RuntimeError("private detail")))
        self.assertIn("RuntimeError", "\n".join(logs.output))
        self.assertNotIn("private detail", "\n".join(logs.output))

    def test_health_log_contains_only_aggregate_liveness_and_queue_lag(self):
        owner = Mock()
        owner.monotonic.return_value = 140
        owner.thread_liveness.return_value = {"session_results": True, "recording_review": True}
        owner.failure.return_value = None
        owner.stop_event.is_set.return_value = False
        owner.snapshot.return_value = {
            "session_results": {
                "attempts": 2, "invocation_successes": 2, "invocation_failures": 0,
                "work_failures": 1, "last_outcome": "jobs_failed",
                "last_duration_ms": 12, "last_finished_monotonic": 130,
            },
            "recording_review": {
                "attempts": 1, "invocation_successes": 0, "invocation_failures": 0,
                "work_failures": 0, "last_outcome": "skipped_peer",
                "last_duration_ms": 2, "last_finished_monotonic": 100,
            },
        }
        queue = {
            "completed_jobs": 20, "failed_jobs": 1, "due_jobs": 3,
            "oldest_overdue_seconds": 125, "running_jobs": 2,
            "stale_running_jobs": 0, "exhausted_failed_jobs": 1,
        }

        with self.assertLogs(scheduler.log, level="INFO") as logs:
            scheduler.log_health(owner, queue_probe=Mock(return_value=queue))

        message = "\n".join(logs.output)
        self.assertIn("state=running", message)
        self.assertIn("session_thread_alive=True", message)
        self.assertIn("session_invocation_successes=2", message)
        self.assertIn("session_job_failure_passes=1", message)
        self.assertIn("completed_jobs=20", message)
        self.assertIn("failed_jobs=1", message)
        self.assertIn("session_last_finished_age_seconds=10", message)
        self.assertIn("review_last_finished_age_seconds=40", message)
        self.assertIn("oldest_overdue_seconds=125", message)


class CommandLifecycleTests(unittest.TestCase):
    def test_signal_handlers_are_installed_before_threads_start(self):
        events = []
        owner = Mock()
        owner.stop_event.is_set.return_value = False
        owner.start.side_effect = lambda: events.append("start") or True
        owner.wait.return_value = True
        owner.failure.return_value = None

        @contextmanager
        def handlers(current):
            self.assertIs(current, owner)
            events.append("handlers_enter")
            try:
                yield
            finally:
                events.append("handlers_exit")

        with patch.object(scheduler, "SessionResultSchedulerOwner", return_value=owner), \
                patch.object(scheduler, "shutdown_signal_handlers", side_effect=handlers), \
                patch.object(scheduler, "log_health"):
            scheduler.Command().handle()

        self.assertEqual(events, ["handlers_enter", "start", "handlers_exit"])
        owner.stop.assert_called_once_with(reason="command_exit")
        owner.join.assert_called_once_with()

    def test_startup_failure_uses_controlled_shutdown_and_safe_command_error(self):
        owner = Mock()
        owner.start.side_effect = RuntimeError("synthetic private startup detail")

        @contextmanager
        def handlers(_owner):
            yield

        with patch.object(scheduler, "SessionResultSchedulerOwner", return_value=owner), \
                patch.object(scheduler, "shutdown_signal_handlers", side_effect=handlers), \
                self.assertRaisesRegex(scheduler.CommandError, "could not start \\(RuntimeError\\)") as raised:
            scheduler.Command().handle()

        self.assertNotIn("synthetic private startup detail", str(raised.exception))
        owner.stop.assert_called_once_with(reason="command_exit")
        owner.join.assert_called_once_with()

    def test_fatal_thread_death_makes_command_fail(self):
        owner = Mock()
        owner.start.return_value = True
        owner.wait.return_value = True
        owner.failure.return_value = ("recording_review", "SystemExit")

        @contextmanager
        def handlers(_owner):
            yield

        with patch.object(scheduler, "SessionResultSchedulerOwner", return_value=owner), \
                patch.object(scheduler, "shutdown_signal_handlers", side_effect=handlers), \
                patch.object(scheduler, "log_health"), \
                self.assertRaisesRegex(scheduler.CommandError, "recording_review.*SystemExit"):
            scheduler.Command().handle()

        owner.stop.assert_called_once_with(reason="command_exit")
        owner.join.assert_called_once_with()


if __name__ == "__main__":
    unittest.main(verbosity=2)
