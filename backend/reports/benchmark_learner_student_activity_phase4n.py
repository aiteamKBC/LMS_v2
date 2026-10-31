"""Read-only Phase 4N benchmark for the default Student Activity response.

The comparison keeps the complete service response while replacing the broad
canonical progress projection with a dedicated display/lineage projection.
It measures the Django/service boundary, not HTTP, middleware or browser time.
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from math import ceil
import json
import os
from statistics import median
from time import perf_counter, process_time
import tracemalloc

from benchmark_learner_metrics_phase4i import EXPECTED, configure, explain_select


SYNTHETIC_ENROLMENT_ID = 1602
EXPECTED_PROGRESS_ROWS = 357


def percentile(values, proportion):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, ceil(len(ordered) * proportion) - 1))]


@contextmanager
def query_measurement(connections):
    state = {"count": 0, "execute_ms": 0.0, "statements": []}

    def wrapper(execute, sql, params, many, context):
        started = perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            state["count"] += 1
            state["execute_ms"] += (perf_counter() - started) * 1000
            state["statements"].append((str(sql), params))

    with ExitStack() as stack:
        for alias in connections:
            stack.enter_context(connections[alias].execute_wrapper(wrapper))
        yield state


def measure(function, connections):
    cpu_started = process_time()
    wall_started = perf_counter()
    with query_measurement(connections) as queries:
        payload = function()
    serialise_started = perf_counter()
    raw = json.dumps(payload, default=str, separators=(",", ":"), sort_keys=True).encode()
    serialise_ms = (perf_counter() - serialise_started) * 1000
    wall_ms = (perf_counter() - wall_started) * 1000
    return payload, {
        "wall_ms": wall_ms,
        "process_cpu_ms": (process_time() - cpu_started) * 1000,
        "query_count": queries["count"],
        "sql_execute_ms": queries["execute_ms"],
        "python_ms": max(0.0, wall_ms - queries["execute_ms"] - serialise_ms),
        "serialise_ms": serialise_ms,
        "payload_bytes": len(raw),
    }, queries["statements"]


def peak_bytes(function):
    tracemalloc.start()
    try:
        function()
        return tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()


def summarise(samples):
    return {
        "query_count": sorted({sample["query_count"] for sample in samples}),
        "wall_median_ms": round(median(sample["wall_ms"] for sample in samples), 3),
        "wall_p95_ms": round(percentile([sample["wall_ms"] for sample in samples], .95), 3),
        "sql_execute_median_ms": round(median(sample["sql_execute_ms"] for sample in samples), 3),
        "python_median_ms": round(median(sample["python_ms"] for sample in samples), 3),
        "python_p95_ms": round(percentile([sample["python_ms"] for sample in samples], .95), 3),
        "process_cpu_median_ms": round(median(sample["process_cpu_ms"] for sample in samples), 3),
        "serialise_median_ms": round(median(sample["serialise_ms"] for sample in samples), 3),
        "payload_bytes": sorted({sample["payload_bytes"] for sample in samples}),
    }


def main() -> int:
    configure()
    import django

    django.setup()
    from django.db import connections, transaction
    from learner_api import canonical_learning, current_learning, journal_sources, subject_store
    from learner_api.learner_detail import SOURCE_MODELS
    from learner_api.replacement_hours import read_replacement_hours
    from learner_api.student_activity import _cover_url
    from learner_api.student_activity_data import summarize_activities

    iterations = int(os.environ.get("PHASE4N_ITERATIONS", "20"))
    if iterations < 20:
        raise SystemExit("PHASE4N_ITERATIONS must be at least 20")
    connection = connections["enrolment"]
    model = SOURCE_MODELS["commercial"]

    def call(compact):
        source = model.all_learners.only("id", "aptem_id", "email").get(
            pk=SYNTHETIC_ENROLMENT_ID)
        owner = canonical_learning.profile(SYNTHETIC_ENROLMENT_ID)
        records = canonical_learning.entries_for(owner, student_activity_summary=compact)
        payload = canonical_learning.source_subjects(
            SYNTHETIC_ENROLMENT_ID, summarize_activities, owner=owner,
            records=records, include_ledger=True)
        payload["verification_status"] = "verified"
        payload["replacement_hours"] = read_replacement_hours(
            SYNTHETIC_ENROLMENT_ID, source, owner, records, payload)
        allowed = {f"legacy:{item['id']}" for item in payload["subjects"]}
        covers = subject_store.covers_for(sorted(allowed)) if payload["aptem_id"] else {}
        payload["covers"] = {
            key: _cover_url(value) for key, value in covers.items() if key in allowed
        }
        return payload

    def canonical_materialisation(compact):
        original_query = canonical_learning.query
        captured = {}

        def capture(sql, params=None):
            rows = original_query(sql, params)
            if "WITH canonical AS" in sql:
                captured.update(
                    rows=len(rows),
                    json_bytes=len(json.dumps(
                        rows, default=str, separators=(",", ":"), sort_keys=True).encode()),
                )
            return rows

        canonical_learning.query = capture
        try:
            call(compact)
        finally:
            canonical_learning.query = original_query
        return captured

    output = {
        "classification": "isolated read-only Django/service benchmark; not HTTP or browser",
        "endpoint": "/learner_api/student-activity/{kind}/{id}/",
        "iterations_per_variant": iterations,
        "fixture": "preserved synthetic Reader fixture",
        "reader_limitations": [
            "the fixture has 357 progress rows but no owned old-LMS courses",
            "the KSB exclusion predicate is TRUE in both variants",
            "optional subject attempts are absent in both variants because the Reader lacks SELECT",
        ],
    }

    original_exclusion = canonical_learning._ksb_not_excluded
    original_current_query = current_learning.query

    def reader_safe_current_query(sql, params=None):
        if "to_regclass" in sql and "subject_activity_attempts" in str(params):
            return [{"name": None}]
        return original_current_query(sql, params)

    with transaction.atomic(using="enrolment"), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout='120000ms'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout='15min'")
        cursor.execute(
            """SELECT current_user,current_database(),
                      current_setting('neon.branch_id',true),
                      current_setting('neon.endpoint_id',true),
                      current_setting('transaction_read_only')"""
        )
        role, database, branch_id, endpoint_id, read_only = cursor.fetchone()
        identity = {
            "role": role, "database": database, "branch_id": branch_id,
            "endpoint_id": endpoint_id, "transaction_read_only": read_only,
        }
        if identity != {**EXPECTED, "transaction_read_only": "on"}:
            raise SystemExit("Benchmark database identity did not match the pinned Reader target")
        output["database_identity"] = identity
        cursor.execute(
            '''SELECT count(*)::int FROM "Learner".learner_progress_entries
               WHERE learner_id=(SELECT id FROM "Learner".learners WHERE enrolment_id=%s)
                 AND deleted_at IS NULL''',
            [SYNTHETIC_ENROLMENT_ID],
        )
        progress_rows = cursor.fetchone()[0]
        if progress_rows != EXPECTED_PROGRESS_ROWS:
            raise SystemExit("Synthetic fixture progress population changed")

        canonical_learning._ksb_not_excluded = lambda alias="k": "TRUE"
        current_learning.query = reader_safe_current_query
        current_learning.attempts_relation_exists.__dict__.pop("present", None)
        try:
            with journal_sources.learner_journal_reads():
                before_payload, _before_warm, before_statements = measure(
                    lambda: call(False), connections)
                after_payload, _after_warm, after_statements = measure(
                    lambda: call(True), connections)
                if before_payload != after_payload:
                    raise AssertionError("Warm-up response parity failed")

                before_samples = []
                after_samples = []
                for iteration in range(iterations):
                    if iteration % 2:
                        after_payload, after_sample, _ = measure(lambda: call(True), connections)
                        before_payload, before_sample, _ = measure(lambda: call(False), connections)
                    else:
                        before_payload, before_sample, _ = measure(lambda: call(False), connections)
                        after_payload, after_sample, _ = measure(lambda: call(True), connections)
                    if before_payload != after_payload:
                        raise AssertionError("Measured response parity failed")
                    before_samples.append(before_sample)
                    after_samples.append(after_sample)

                before_summary = summarise(before_samples)
                after_summary = summarise(after_samples)
                before_summary["peak_allocated_bytes"] = peak_bytes(lambda: call(False))
                after_summary["peak_allocated_bytes"] = peak_bytes(lambda: call(True))
                before_summary["canonical_result"] = canonical_materialisation(False)
                after_summary["canonical_result"] = canonical_materialisation(True)
                before_progress = next(
                    ((sql, params) for sql, params in before_statements
                     if 'WITH canonical AS' in sql), None)
                after_progress = next(
                    ((sql, params) for sql, params in after_statements
                     if 'WITH canonical AS' in sql), None)
                output.update(
                    parity=True,
                    progress_rows=progress_rows,
                    subjects=len(after_payload.get("subjects", [])),
                    activities=len(after_payload.get("activities", [])),
                    ledger_activities=len(after_payload.get("canonical_otjh_activities", [])),
                    before=before_summary,
                    after=after_summary,
                    before_progress_plan=(explain_select(cursor, *before_progress)
                                          if before_progress else None),
                    after_progress_plan=(explain_select(cursor, *after_progress)
                                         if after_progress else None),
                    errors=0,
                    timeouts=0,
                )
        finally:
            canonical_learning._ksb_not_excluded = original_exclusion
            current_learning.query = original_current_query

    print(json.dumps(output, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
