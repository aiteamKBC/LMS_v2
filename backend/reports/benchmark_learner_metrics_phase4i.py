"""Read-only Phase 4I benchmark for the default Learner Metrics request.

This is an isolated Django/service benchmark, not an HTTP benchmark.  It uses
the pinned least-privilege Reader target, anonymises learner identities, and
executes SELECT statements only.  The Reader cannot inspect the KSB exclusion
relation, so both variants replace that predicate with TRUE for this benchmark;
the application predicate is unchanged and remains covered by focused tests.
"""
from __future__ import annotations

from contextlib import contextmanager
from math import ceil
import json
import os
from pathlib import Path
from statistics import median
import sys
from time import perf_counter, process_time
import tracemalloc


EXPECTED = {
    "role": "lms_benchmark_reader",
    "database": "neondb",
    "branch_id": "br-orange-shadow-abm8uwwe",
    "endpoint_id": "ep-dawn-block-ab5vob3x",
}


def configure() -> None:
    for key in (
        "LMS_IDEAL_TEST",
        "DATABASE_URL",
        "DATABASEURL",
        "Database_url",
        "ENROLMENT_DATABASE_URL",
        "AUDIT_DATABASE_URL",
        "AUDIT_CLONE_DATABASE_URL",
    ):
        os.environ.pop(key, None)
    os.environ.update(
        DJANGO_SETTINGS_MODULE="config.settings",
        RUN_APP_ON_TEST_BRANCH="true",
        LMS_TEST_ACTIVE="true",
        LMS_TEST_MODE="postgres-read-only",
        LMS_TEST_POSTGRES_BRANCH_NAME="lms_ideal_test",
        LMS_TEST_POSTGRES_BRANCH_ID=EXPECTED["branch_id"],
        LMS_TEST_POSTGRES_ENDPOINT_ID=EXPECTED["endpoint_id"],
        CURRICULUM_WARM="0",
    )
    backend = str(Path(__file__).resolve().parents[1])
    if backend not in sys.path:
        sys.path.insert(0, backend)


def percentile(values: list[float], proportion: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, ceil(len(ordered) * proportion) - 1))]


def payload_measure(payload: dict) -> tuple[int, float]:
    started = perf_counter()
    raw = json.dumps(payload, default=str, separators=(",", ":")).encode()
    return len(raw), (perf_counter() - started) * 1000


def representative_profiles(cursor) -> list[tuple[str, int, int]]:
    cursor.execute(
        '''SELECT l.enrolment_id,count(p.id)::int
             FROM "Learner".learners l
             JOIN enrolment."Created_users" u ON u.id=l.enrolment_id
             JOIN "Learner".learner_progress_entries p
               ON p.learner_id=l.id AND p.deleted_at IS NULL
            WHERE lower(trim(l.email))=lower(trim(u."Email"))
              AND (nullif(ltrim(coalesce(u.aptem_id::text,''),'0'),'') IS NULL
                   OR ltrim(coalesce(u.aptem_id::text,''),'0')=ltrim(coalesce(l.aptem_id::text,''),'0'))
              AND NOT EXISTS (
                  SELECT 1 FROM "Learner".progress_transfer_requests t
                   WHERE t.enrolment_id=l.enrolment_id
              )
            GROUP BY l.enrolment_id'''
    )
    population = [(int(enrolment_id), int(count)) for enrolment_id, count in cursor.fetchall()]
    targets = (("small", 51), ("median", 357), ("large", 1116), ("maximum", 3617))
    selected: list[tuple[str, int, int]] = []
    used: set[int] = set()
    for label, target in targets:
        enrolment_id, count = min(
            (item for item in population if item[0] not in used),
            key=lambda item: (abs(item[1] - target), item[1]),
        )
        used.add(enrolment_id)
        selected.append((label, enrolment_id, count))
    return selected


@contextmanager
def query_measurement(connection):
    state = {"count": 0, "execute_ms": 0.0, "statements": []}

    def wrapper(execute, sql, params, many, context):
        started = perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            state["count"] += 1
            state["execute_ms"] += (perf_counter() - started) * 1000
            state["statements"].append((sql, params))

    with connection.execute_wrapper(wrapper):
        yield state


def measure(function, connection) -> tuple[dict, dict, list[tuple]]:
    cpu_started = process_time()
    wall_started = perf_counter()
    with query_measurement(connection) as queries:
        payload = function()
    measurement = {
        "wall_ms": (perf_counter() - wall_started) * 1000,
        "process_cpu_ms": (process_time() - cpu_started) * 1000,
        "query_count": queries["count"],
        "sql_execute_ms": queries["execute_ms"],
    }
    return payload, measurement, queries["statements"]


def peak_bytes(function) -> int:
    tracemalloc.start()
    try:
        function()
        _current, peak = tracemalloc.get_traced_memory()
        return peak
    finally:
        tracemalloc.stop()


def explain_select(cursor, sql: str, params) -> dict:
    cursor.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params)
    document = cursor.fetchone()[0]
    if isinstance(document, str):
        document = json.loads(document)
    root = document[0]
    examined = 0

    def visit(node):
        nonlocal examined
        if node.get("Relation Name") == "learner_progress_entries":
            loops = int(node.get("Actual Loops", 1) or 1)
            examined += int(
                (node.get("Actual Rows", 0) + node.get("Rows Removed by Filter", 0))
                * loops
            )
        for child in node.get("Plans", []):
            visit(child)

    visit(root["Plan"])
    return {
        "planning_ms": round(float(root.get("Planning Time", 0)), 3),
        "execution_ms": round(float(root.get("Execution Time", 0)), 3),
        "progress_rows_examined": examined,
    }


def summarise(samples: list[dict]) -> dict:
    return {
        "query_count": sorted({sample["query_count"] for sample in samples}),
        "wall_median_ms": round(median(sample["wall_ms"] for sample in samples), 3),
        "wall_p95_ms": round(percentile([sample["wall_ms"] for sample in samples], .95), 3),
        "process_cpu_median_ms": round(median(sample["process_cpu_ms"] for sample in samples), 3),
        "sql_execute_median_ms": round(median(sample["sql_execute_ms"] for sample in samples), 3),
    }


def main() -> int:
    configure()
    import django

    django.setup()
    from django.db import connections, transaction
    from learner_api import canonical_learning, current_learning, journal_sources
    from coach_api.migrated_otjh import include_planned, planned_hours_bulk

    iterations = int(os.environ.get("PHASE4I_ITERATIONS", "20"))
    if iterations < 20:
        raise SystemExit("PHASE4I_ITERATIONS must be at least 20")

    connection = connections["enrolment"]
    shape_filter = os.environ.get("PHASE4I_SHAPE", "").strip()
    skip_extras = os.environ.get("PHASE4I_SKIP_EXTRAS", "").strip().lower() in {"1", "true", "yes"}
    plan_only = os.environ.get("PHASE4I_PLAN_ONLY", "").strip().lower() in {"1", "true", "yes"}
    output = {
        "classification": "isolated read-only Django service benchmark; not HTTP",
        "iterations_per_variant": iterations,
        "shape_filter": shape_filter or None,
        "extras_skipped": skip_extras,
        "plan_only": plan_only,
        "reader_limitations": [
            "the KSB exclusion predicate is TRUE in both measured variants",
            "optional subject attempts are disabled in both variants because the Reader lacks SELECT",
        ],
        "samples": [],
    }
    with transaction.atomic(using="enrolment"), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout='30000ms'")
        cursor.execute("SET LOCAL idle_in_transaction_session_timeout='10min'")
        cursor.execute(
            '''SELECT current_user,current_database(),
                      current_setting('neon.branch_id',true),
                      current_setting('neon.endpoint_id',true),
                      current_setting('transaction_read_only')'''
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

        # Preserve the exact former implementation for reproducible comparison.
        def before(enrolment_id: int, owner: dict) -> dict:
            result = canonical_learning.metrics_from_records(
                canonical_learning.entries_for(owner, lineage_only=True),
                canonical_learning.targets_for(owner),
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

                    def old_call():
                        return before(enrolment_id, owner)

                    def narrow_call():
                        return canonical_learning.metrics(enrolment_id, owner=owner)

                    old_payload, _warm_old, old_statements = measure(old_call, connection)
                    narrow_payload, _warm_new, new_statements = measure(narrow_call, connection)
                    if old_payload != narrow_payload:
                        raise AssertionError(f"warm-up response parity failed for {label}")

                    if plan_only:
                        old_sql, old_params = next(
                            (sql, params) for sql, params in old_statements
                            if "WITH canonical AS" in sql
                        )
                        new_sql, new_params = next(
                            (sql, params) for sql, params in new_statements
                            if "WITH canonical AS" in sql
                        )
                        output["samples"].append({
                            "shape": label,
                            "progress_rows": progress_rows,
                            "parity": True,
                            "plans": {
                                "before_dominant_select": explain_select(cursor, old_sql, old_params),
                                "after_summary_select": explain_select(cursor, new_sql, new_params),
                            },
                        })
                        continue

                    old_samples: list[dict] = []
                    new_samples: list[dict] = []
                    for iteration in range(iterations):
                        if iteration % 2:
                            new_payload, new_sample, _ = measure(narrow_call, connection)
                            old_payload, old_sample, _ = measure(old_call, connection)
                        else:
                            old_payload, old_sample, _ = measure(old_call, connection)
                            new_payload, new_sample, _ = measure(narrow_call, connection)
                        if old_payload != new_payload:
                            raise AssertionError(f"measured response parity failed for {label}")
                        old_samples.append(old_sample)
                        new_samples.append(new_sample)

                    old_bytes, old_serialise = payload_measure(old_payload)
                    new_bytes, new_serialise = payload_measure(new_payload)
                    old_summary = summarise(old_samples)
                    old_summary.update(
                        payload_bytes=old_bytes,
                        serialise_ms=round(old_serialise, 3),
                        peak_allocated_bytes=None if skip_extras else peak_bytes(old_call),
                    )
                    new_summary = summarise(new_samples)
                    new_summary.update(
                        payload_bytes=new_bytes,
                        serialise_ms=round(new_serialise, 3),
                        peak_allocated_bytes=None if skip_extras else peak_bytes(narrow_call),
                    )
                    output["samples"].append({
                        "shape": label,
                        "progress_rows": progress_rows,
                        "parity": True,
                        "before": old_summary,
                        "after": new_summary,
                        "dominant_statement_kinds": {
                            "before": ["canonical-ledger" if "WITH canonical AS" in sql else "support" for sql, _ in old_statements],
                            "after": ["narrow-progress" if "learner_progress_entries p" in sql else "support" for sql, _ in new_statements],
                        },
                    })
                    if label == "maximum" and not skip_extras:
                        old_sql, old_params = next(
                            (sql, params) for sql, params in old_statements
                            if "WITH canonical AS" in sql
                        )
                        new_sql, new_params = next(
                            (sql, params) for sql, params in new_statements
                            if "WITH canonical AS" in sql
                        )
                        output["samples"][-1]["plans"] = {
                            "before_dominant_select": explain_select(cursor, old_sql, old_params),
                            "after_progress_select": explain_select(cursor, new_sql, new_params),
                        }
        finally:
            canonical_learning._ksb_not_excluded = original_exclusion
            current_learning.query = original_current_query

    print(json.dumps(output, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
