"""Database-free regressions for the F05/F07 session safety gate."""
from unittest import TestCase

from .run import (
    Refused,
    enforce_session_guard,
    summarize_session_guard,
    verified_tls_diagnostics,
)


def row(pid, *, app="pgbouncer", state="idle", backend="client backend",
        wait_type="Client", wait="ClientRead", xact_age=None, backend_age=10):
    return (pid, app, state, backend, wait_type, wait, xact_age, backend_age)


class SessionGuardTests(TestCase):
    def report(self, rows, **overrides):
        values = dict(
            observer_pid=10,
            rows=rows,
            waiting_locks=0,
            lock_waiters=0,
            blocking_sessions=0,
            endpoint_host="ep-patient-paper-abu3q4y6.eu-west-2.aws.neon.tech",
        )
        values.update(overrides)
        return summarize_session_guard(**values)

    def test_current_active_observer_is_not_counted_as_external(self):
        report = self.report([row(10, state="active", wait_type="", wait="")])
        self.assertEqual(report["observer"]["pid"], 10)
        self.assertEqual(report["other_client_sessions"], 0)
        enforce_session_guard(report)

    def test_idle_pgbouncer_session_is_unidentified_not_assumed_runner_owned(self):
        report = self.report([
            row(10, state="active", wait_type="", wait=""),
            row(11, app="pgbouncer", state="idle"),
        ])
        self.assertEqual(report["other_sessions_by_state"], {"idle": 1})
        self.assertEqual(report["other_sessions_by_application"], {"pgbouncer": 1})
        with self.assertRaisesRegex(Refused, "unidentified client sessions"):
            enforce_session_guard(report)

    def test_matching_application_name_does_not_bypass_guard(self):
        report = self.report([
            row(10, state="active", wait_type="", wait=""),
            row(12, app="f05-f07-closure-runner", state="idle"),
        ])
        with self.assertRaises(Refused):
            enforce_session_guard(report)

    def test_pooled_hostname_is_rejected_even_when_quiet(self):
        report = self.report(
            [row(10, state="active", wait_type="", wait="")],
            endpoint_host="ep-patient-paper-abu3q4y6-pooler.eu-west-2.aws.neon.tech",
        )
        self.assertEqual(report["endpoint_connection_type"], "pooled")
        with self.assertRaisesRegex(Refused, "direct endpoint"):
            enforce_session_guard(report)

    def test_each_lock_signal_blocks_execution(self):
        base = [row(10, state="active", wait_type="", wait="")]
        for field in ("waiting_locks", "lock_waiters", "blocking_sessions"):
            with self.subTest(field=field):
                report = self.report(base, **{field: 1})
                with self.assertRaises(Refused):
                    enforce_session_guard(report)

    def test_observer_must_be_in_snapshot(self):
        with self.assertRaisesRegex(Refused, "monitoring connection"):
            self.report([row(11)])

    def test_client_tls_facts_are_used_for_a_direct_neon_proxy_connection(self):
        class PgConn:
            ssl_in_use = True

        class Connection:
            pgconn = PgConn()

        self.assertEqual(verified_tls_diagnostics(Connection())["verification"], "verify-full")

    def test_missing_client_tls_is_refused(self):
        class PgConn:
            ssl_in_use = False

        class Connection:
            pgconn = PgConn()

        with self.assertRaisesRegex(Refused, "TLS is not active"):
            verified_tls_diagnostics(Connection())
