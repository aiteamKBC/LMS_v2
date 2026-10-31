"""Read-only before/after benchmark for the learner-detail progress prefetch.

The script compares the former full ORM projection with the current narrowed
projection on the pinned ``lms_ideal_test`` Neon branch.  It reads the
least-privilege Benchmark Reader credential from the existing guarded Django
settings, prints anonymised aggregate evidence only, and never starts HTTP or
executes application writes.
"""
from __future__ import annotations

import gzip
import json
from math import ceil
import os
from pathlib import Path
from statistics import median
import sys
from time import perf_counter
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


def json_bytes(rows: list[tuple]) -> tuple[int, int, float]:
    started = perf_counter()
    raw = json.dumps(rows, default=str, separators=(",", ":")).encode()
    elapsed = (perf_counter() - started) * 1000
    return len(raw), len(gzip.compress(raw)), elapsed


def relation_plan(cursor, sql: str, params: tuple) -> dict[str, object]:
    cursor.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params)
    document = cursor.fetchone()[0]
    if isinstance(document, str):
        document = json.loads(document)
    root = document[0]
    examined = hits = reads = 0

    def visit(node):
        nonlocal examined, hits, reads
        if node.get("Relation Name") == "learner_progress_entries":
            loops = int(node.get("Actual Loops", 1) or 1)
            examined += int(
                (node.get("Actual Rows", 0) + node.get("Rows Removed by Filter", 0))
                * loops
            )
            hits += int(node.get("Shared Hit Blocks", 0))
            reads += int(node.get("Shared Read Blocks", 0))
        for child in node.get("Plans", []):
            visit(child)

    visit(root["Plan"])
    return {
        "planning_ms": round(float(root.get("Planning Time", 0)), 3),
        "execution_ms": round(float(root.get("Execution Time", 0)), 3),
        "progress_rows_examined": examined,
        "shared_hit_blocks": hits,
        "shared_read_blocks": reads,
    }


def execute(cursor, sql: str, params: tuple) -> tuple[list[tuple], float]:
    started = perf_counter()
    cursor.execute(sql, params)
    rows = cursor.fetchall()
    return rows, (perf_counter() - started) * 1000


def peak_fetch_bytes(cursor, sql: str, params: tuple) -> int:
    tracemalloc.start()
    try:
        cursor.execute(sql, params)
        cursor.fetchall()
        _current, peak = tracemalloc.get_traced_memory()
        return peak
    finally:
        tracemalloc.stop()


def representative_profiles(cursor) -> list[tuple[str, int, int]]:
    cursor.execute(
        '''SELECT learner_id,count(*)::int
           FROM "Learner".learner_progress_entries
           GROUP BY learner_id'''
    )
    population = [(int(learner_id), int(count)) for learner_id, count in cursor.fetchall()]
    counts = sorted(count for _learner_id, count in population)
    targets = {
        "small": 50,
        "median": counts[len(counts) // 2],
        "p95": counts[min(len(counts) - 1, ceil(len(counts) * .95) - 1)],
        "maximum": counts[-1],
    }
    selected = []
    used = set()
    for label, target in targets.items():
        learner_id, count = min(
            (item for item in population if item[0] not in used),
            key=lambda item: (abs(item[1] - target), item[1]),
        )
        used.add(learner_id)
        selected.append((label, learner_id, count))
    return selected


def main() -> int:
    configure()
    import django

    django.setup()
    from django.db import connections, transaction
    from learner_api.learner_detail import LEARNER_DETAIL_DEFERRED_PROGRESS_FIELDS
    from learner_api.models import LearnerProgressEntry

    iterations = int(os.environ.get("PHASE4H_ITERATIONS", "20"))
    if iterations < 20:
        raise SystemExit("PHASE4H_ITERATIONS must be at least 20")

    result = {
        "classification": "isolated PostgreSQL/ORM SELECT benchmark; not HTTP",
        "iterations_per_variant": iterations,
        "deferred_fields": list(LEARNER_DETAIL_DEFERRED_PROGRESS_FIELDS),
        "query_count": {"before": 1, "after": 1},
        "samples": [],
    }
    connection = connections["enrolment"]
    with transaction.atomic(using="enrolment"), connection.cursor() as cursor:
        cursor.execute("SET LOCAL statement_timeout='15000ms'")
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
        result["database_identity"] = identity

        all_fields = [field.attname for field in LearnerProgressEntry._meta.concrete_fields]
        kept_fields = [
            field.attname
            for field in LearnerProgressEntry._meta.concrete_fields
            if field.name not in LEARNER_DETAIL_DEFERRED_PROGRESS_FIELDS
        ]
        kept_indexes = [all_fields.index(field) for field in kept_fields]

        for label, learner_id, progress_count in representative_profiles(cursor):
            base = LearnerProgressEntry.objects.using("enrolment").filter(learner_id=learner_id)
            narrowed = base.defer(*LEARNER_DETAIL_DEFERRED_PROGRESS_FIELDS)
            before_sql, before_params = base.query.get_compiler(using="enrolment").as_sql()
            after_sql, after_params = narrowed.query.get_compiler(using="enrolment").as_sql()

            before_rows, _ = execute(cursor, before_sql, before_params)
            after_rows, _ = execute(cursor, after_sql, after_params)
            projected_before = [tuple(row[index] for index in kept_indexes) for row in before_rows]
            if projected_before != after_rows:
                raise AssertionError(f"row/order parity failed for {label}")

            before_times: list[float] = []
            after_times: list[float] = []
            errors = 0
            for iteration in range(iterations):
                try:
                    if iteration % 2:
                        after_rows, after_ms = execute(cursor, after_sql, after_params)
                        before_rows, before_ms = execute(cursor, before_sql, before_params)
                    else:
                        before_rows, before_ms = execute(cursor, before_sql, before_params)
                        after_rows, after_ms = execute(cursor, after_sql, after_params)
                    if [tuple(row[index] for index in kept_indexes) for row in before_rows] != after_rows:
                        raise AssertionError(f"measured parity failed for {label}")
                    before_times.append(before_ms)
                    after_times.append(after_ms)
                except Exception:
                    errors += 1
                    raise

            before_raw, before_gzip, before_serialise = json_bytes(before_rows)
            after_raw, after_gzip, after_serialise = json_bytes(after_rows)
            result["samples"].append({
                "shape": label,
                "progress_rows": progress_count,
                "returned_rows": len(after_rows),
                "parity": True,
                "ordering_parity": True,
                "errors_or_timeouts": errors,
                "before": {
                    "client_wall_median_ms": round(median(before_times), 3),
                    "client_wall_p95_ms": round(percentile(before_times, .95), 3),
                    "sql_result_raw_bytes": before_raw,
                    "sql_result_gzip_bytes": before_gzip,
                    "python_serialise_ms": round(before_serialise, 3),
                    "peak_fetch_bytes": peak_fetch_bytes(cursor, before_sql, before_params),
                    "plan": relation_plan(cursor, before_sql, before_params),
                },
                "after": {
                    "client_wall_median_ms": round(median(after_times), 3),
                    "client_wall_p95_ms": round(percentile(after_times, .95), 3),
                    "sql_result_raw_bytes": after_raw,
                    "sql_result_gzip_bytes": after_gzip,
                    "python_serialise_ms": round(after_serialise, 3),
                    "peak_fetch_bytes": peak_fetch_bytes(cursor, after_sql, after_params),
                    "plan": relation_plan(cursor, after_sql, after_params),
                },
            })

    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
