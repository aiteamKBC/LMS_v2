"""Read-only Phase 4K benchmark for the Metrics-specific projection.

Compares the Phase 4I training summary with the Phase 4K Metrics summary.  It
is an isolated Django service benchmark, not an HTTP or browser benchmark.
"""
from __future__ import annotations

import json
import os

from benchmark_learner_metrics_phase4i import (
    EXPECTED,
    configure,
    explain_select,
    measure,
    payload_measure,
    peak_bytes,
    representative_profiles,
    summarise,
)


def main() -> int:
    configure()
    import django

    django.setup()
    from django.db import connections, transaction
    from coach_api.migrated_otjh import include_planned, planned_hours_bulk
    from learner_api import canonical_learning, current_learning, journal_sources

    iterations = int(os.environ.get("PHASE4K_ITERATIONS", "20"))
    if iterations < 20:
        raise SystemExit("PHASE4K_ITERATIONS must be at least 20")
    shape_filter = os.environ.get("PHASE4K_SHAPE", "").strip()
    connection = connections["enrolment"]
    output = {
        "classification": "isolated read-only Django service benchmark; not HTTP",
        "iterations_per_variant": iterations,
        "shape_filter": shape_filter or None,
        "reader_limitations": [
            "the KSB exclusion predicate is TRUE in both measured variants",
            "optional subject attempts are disabled in both variants because the Reader lacks SELECT",
        ],
        "samples": [],
    }

    with transaction.atomic(using="enrolment"), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout='30000ms'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout='15min'")
        cursor.execute(
            """SELECT current_user,current_database(),
                      current_setting('neon.branch_id',true),
                      current_setting('neon.endpoint_id',true),
                      current_setting('transaction_read_only')"""
        )
        role, database, branch_id, endpoint_id, read_only = cursor.fetchone()
        identity = {
            "role": role,
            "database": database,
            "branch_id": branch_id,
            "endpoint_id": endpoint_id,
            "transaction_read_only": read_only,
        }
        if identity != {**EXPECTED, "transaction_read_only": "on"}:
            raise SystemExit("Benchmark database identity did not match the pinned Reader target")
        output["database_identity"] = identity

        def finish(enrolment_id: int, owner: dict, records: list[dict]) -> dict:
            result = canonical_learning.metrics_from_records(
                records, canonical_learning.targets_for(owner),
            )
            if journal_sources.enabled():
                planned = canonical_learning.programme_planned_hours(enrolment_id, owner=owner)
                result["otjh"]["planned"] = planned
                result["aptem_planned_total"] = planned
            return include_planned(
                result,
                planned_hours_bulk([owner]).get(owner["enrolment_id"], 0),
            )

        original_exclusion = canonical_learning._ksb_not_excluded
        original_current_query = current_learning.query

        def reader_safe_current_query(sql, params=None):
            if "to_regclass" in sql and "subject_activity_attempts" in str(params):
                return [{"name": None}]
            return original_current_query(sql, params)

        canonical_learning._ksb_not_excluded = lambda alias="k": "TRUE"
        current_learning.query = reader_safe_current_query
        current_learning.attempts_relation_exists.__dict__.pop("present", None)
        try:
            with journal_sources.learner_journal_reads():
                for label, enrolment_id, progress_rows in representative_profiles(cursor):
                    if shape_filter and label != shape_filter:
                        continue
                    owner = canonical_learning.require_profile(enrolment_id)

                    def before_call():
                        return finish(
                            enrolment_id, owner,
                            canonical_learning.entries_for(owner, training_summary=True),
                        )

                    def after_call():
                        return canonical_learning.metrics(enrolment_id, owner=owner)

                    before_payload, _warm_before, before_statements = measure(before_call, connection)
                    after_payload, _warm_after, after_statements = measure(after_call, connection)
                    if before_payload != after_payload:
                        raise AssertionError(f"warm-up response parity failed for {label}")

                    before_samples = []
                    after_samples = []
                    for iteration in range(iterations):
                        if iteration % 2:
                            after_payload, after_sample, _ = measure(after_call, connection)
                            before_payload, before_sample, _ = measure(before_call, connection)
                        else:
                            before_payload, before_sample, _ = measure(before_call, connection)
                            after_payload, after_sample, _ = measure(after_call, connection)
                        if before_payload != after_payload:
                            raise AssertionError(f"measured response parity failed for {label}")
                        before_samples.append(before_sample)
                        after_samples.append(after_sample)

                    before_summary = summarise(before_samples)
                    after_summary = summarise(after_samples)
                    before_bytes, before_serialise = payload_measure(before_payload)
                    after_bytes, after_serialise = payload_measure(after_payload)
                    before_summary.update(
                        payload_bytes=before_bytes,
                        serialise_ms=round(before_serialise, 3),
                        peak_allocated_bytes=peak_bytes(before_call),
                    )
                    after_summary.update(
                        payload_bytes=after_bytes,
                        serialise_ms=round(after_serialise, 3),
                        peak_allocated_bytes=peak_bytes(after_call),
                    )
                    sample = {
                        "shape": label,
                        "progress_rows": progress_rows,
                        "parity": True,
                        "before": before_summary,
                        "after": after_summary,
                    }
                    if label == "maximum":
                        before_sql, before_params = next(
                            (sql, params) for sql, params in before_statements
                            if "WITH canonical AS" in sql
                        )
                        after_sql, after_params = next(
                            (sql, params) for sql, params in after_statements
                            if "WITH canonical AS" in sql
                        )
                        sample["plans"] = {
                            "before_training_summary": explain_select(cursor, before_sql, before_params),
                            "after_metrics_summary": explain_select(cursor, after_sql, after_params),
                        }
                    output["samples"].append(sample)
        finally:
            canonical_learning._ksb_not_excluded = original_exclusion
            current_learning.query = original_current_query

    print(json.dumps(output, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
