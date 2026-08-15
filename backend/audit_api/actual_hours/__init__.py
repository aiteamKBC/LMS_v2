"""Learner Journal Actual Hours review (HOURS-TEST workspace only).

Everything in this package operates on the cloned audit branch reached through
the ``/hours_test_api`` mount. It never writes ``actual_hours`` outside an
approval transaction, never alters a genuine timestamp or source label, and
never generates a value at random.

See ``reports/actual-hours-plan-2026-08-14.md`` for the discovery that shaped
these modules and for the open blockers (branch proof, auditor identity,
timestamp semantics).
"""
