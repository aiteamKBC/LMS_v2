"""Read-only Phase 4L benchmark for Weekly's progress hydration stage.

The preserved synthetic fixture has progress history but no rich Weekly plan,
so this measures the exact shared stage changed by Phase 4L: canonical hour
records plus the completion index.  It is not HTTP or full-response timing.
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
    summarise,
)


SYNTHETIC_ENROLMENT_ID = 1602
EXPECTED_PROGRESS_ROWS = 357


def main() -> int:
    configure()
    import django

    django.setup()
    from django.db import connections, transaction
    from django.db.models import Q
    from learner_api import canonical_learning, current_learning, journal_sources
    from learner_api.models import LearnerProfile
    from coach_api.weekly_learning import progress_index, weekly_completion_records

    iterations = int(os.environ.get("PHASE4L_ITERATIONS", "20"))
    if iterations < 20:
        raise SystemExit("PHASE4L_ITERATIONS must be at least 20")

    connection = connections["enrolment"]
    output = {
        "classification": "isolated read-only Weekly progress-hydration benchmark; not HTTP or full response",
        "iterations_per_variant": iterations,
        "fixture": "preserved synthetic fixture",
        "reader_limitations": [
            "the fixture has progress history but no rich Weekly plan",
            "optional subject attempts are disabled in both variants because the Reader lacks SELECT",
        ],
    }

    with transaction.atomic(using="enrolment"), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout='30000ms'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout='10min'")
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

        owner = canonical_learning.require_profile(SYNTHETIC_ENROLMENT_ID)
        if owner.get("progress_transfer_active"):
            raise SystemExit("Synthetic fixture unexpectedly has an active progress transfer")
        cursor.execute(
            '''SELECT count(*)::int,array_remove(array_agg(DISTINCT component_ref),NULL)
                 FROM "Learner".learner_progress_entries
                WHERE learner_id=%s AND deleted_at IS NULL''',
            [owner["id"]],
        )
        progress_rows, component_ids = cursor.fetchone()
        if progress_rows != EXPECTED_PROGRESS_ROWS:
            raise SystemExit("Synthetic fixture progress population changed")
        component_ids = list(component_ids or [])
        profile = LearnerProfile(id=owner["id"], enrolment_id=owner["enrolment_id"])

        def old_completion_rows():
            return list(
                profile.progress_entries.filter(
                    kind__in=["quiz", "video", "component", "quiz_reading"],
                ).filter(
                    Q(component_ref__in=component_ids) | Q(kind="quiz"),
                ).values("kind", "component_ref", "quiz_ref", "passed", "submitted_at")
            )

        def before_call():
            hours = canonical_learning.weekly_hour_records(owner)
            completion = old_completion_rows()
            return {"hours": hours, "completion": progress_index(completion),
                    "completion_row_count": len(completion)}

        def after_call():
            hours, stored = canonical_learning.weekly_hour_records(owner, include_stored=True)
            completion = weekly_completion_records(stored, component_ids)
            return {"hours": hours, "completion": progress_index(completion),
                    "completion_row_count": len(completion)}

        original_current_query = current_learning.query

        def reader_safe_current_query(sql, params=None):
            if "to_regclass" in sql and "subject_activity_attempts" in str(params):
                return [{"name": None}]
            return original_current_query(sql, params)

        current_learning.query = reader_safe_current_query
        current_learning.attempts_relation_exists.__dict__.pop("present", None)
        try:
            with journal_sources.learner_journal_reads():
                before_payload, _before_warm, before_statements = measure(before_call, connection)
                after_payload, _after_warm, _after_statements = measure(after_call, connection)
                if before_payload != after_payload:
                    raise AssertionError("Warm-up response parity failed")

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
                        raise AssertionError("Measured response parity failed")
                    before_samples.append(before_sample)
                    after_samples.append(after_sample)

                before_summary = summarise(before_samples)
                after_summary = summarise(after_samples)
                before_bytes, before_serialise = payload_measure(before_payload)
                after_bytes, after_serialise = payload_measure(after_payload)
                before_summary.update(
                    internal_result_bytes=before_bytes,
                    serialise_ms=round(before_serialise, 3),
                    peak_allocated_bytes=peak_bytes(before_call),
                )
                after_summary.update(
                    internal_result_bytes=after_bytes,
                    serialise_ms=round(after_serialise, 3),
                    peak_allocated_bytes=peak_bytes(after_call),
                )

                removed = next(
                    ((sql, params) for sql, params in before_statements
                     if "learner_progress_entries" in sql
                     and '"kind" IN' in sql and '"component_ref" IN' in sql),
                    None,
                )
                output.update(
                    parity=True,
                    progress_rows=progress_rows,
                    selected_component_refs=len(component_ids),
                    completion_rows=before_payload["completion_row_count"],
                    before=before_summary,
                    after=after_summary,
                    removed_completion_plan=(
                        explain_select(cursor, removed[0], removed[1]) if removed else None
                    ),
                    errors=0,
                    timeouts=0,
                )
        finally:
            current_learning.query = original_current_query

    print(json.dumps(output, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
