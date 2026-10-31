"""Read-only Phase 4J Learner Dashboard initial-path benchmark.

Measures the minimal Header followed by Weekly Initial on the pinned Benchmark
Reader branch.  This is an isolated Django/service benchmark, not HTTP or a
browser navigation measurement.  It prints no learner identity and performs
SELECT statements only.
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from math import ceil
import json
import os
from pathlib import Path
from statistics import median
import sys
from time import perf_counter, process_time


EXPECTED = {
    "role": "lms_benchmark_reader",
    "database": "neondb",
    "branch_id": "br-orange-shadow-abm8uwwe",
    "endpoint_id": "ep-dawn-block-ab5vob3x",
}
SYNTHETIC_FIXTURE_ENROLMENT_ID = 1602


def configure() -> None:
    for key in (
        "LMS_IDEAL_TEST", "DATABASE_URL", "DATABASEURL", "Database_url",
        "ENROLMENT_DATABASE_URL", "AUDIT_DATABASE_URL", "AUDIT_CLONE_DATABASE_URL",
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


@contextmanager
def query_measurement(connections):
    state = {"count": 0, "execute_ms": 0.0}

    def wrapper(execute, sql, params, many, context):
        started = perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            state["count"] += 1
            state["execute_ms"] += (perf_counter() - started) * 1000

    with ExitStack() as stack:
        for alias in connections:
            stack.enter_context(connections[alias].execute_wrapper(wrapper))
        yield state


def measure(function, connections):
    cpu_started = process_time()
    wall_started = perf_counter()
    with query_measurement(connections) as queries:
        payload = function()
    raw_started = perf_counter()
    raw = json.dumps(payload, default=str, separators=(",", ":"), sort_keys=True).encode()
    serialise_ms = (perf_counter() - raw_started) * 1000
    return payload, {
        "wall_ms": (perf_counter() - wall_started) * 1000,
        "process_cpu_ms": (process_time() - cpu_started) * 1000,
        "query_count": queries["count"],
        "sql_execute_ms": queries["execute_ms"],
        "serialise_ms": serialise_ms,
        "payload_bytes": len(raw),
    }


def summarise(samples):
    return {
        "query_count": sorted({sample["query_count"] for sample in samples}),
        "wall_median_ms": round(median(sample["wall_ms"] for sample in samples), 3),
        "wall_p95_ms": round(percentile([sample["wall_ms"] for sample in samples], .95), 3),
        "sql_execute_median_ms": round(median(sample["sql_execute_ms"] for sample in samples), 3),
        "python_median_ms": round(median(
            sample["wall_ms"] - sample["sql_execute_ms"] - sample["serialise_ms"]
            for sample in samples
        ), 3),
        "process_cpu_median_ms": round(median(sample["process_cpu_ms"] for sample in samples), 3),
        "serialise_median_ms": round(median(sample["serialise_ms"] for sample in samples), 3),
        "payload_bytes": sorted({sample["payload_bytes"] for sample in samples}),
    }


def main() -> int:
    configure()
    import django
    django.setup()

    from django.db import connections, transaction
    from coach_api.weekly_learning import assignment_projection
    from learner_api import dashboard_header as header, dashboard_weekly as weekly, journal_sources
    from learner_api.identity import learner_profile_for_source
    from learner_api.learner_detail import SOURCE_MODELS

    iterations = int(os.environ.get("PHASE4J_ITERATIONS", "20"))
    if iterations < 20:
        raise SystemExit("PHASE4J_ITERATIONS must be at least 20")
    kind = "commercial"
    model = SOURCE_MODELS[kind]
    pk = SYNTHETIC_FIXTURE_ENROLMENT_ID
    connection = connections["enrolment"]

    def header_call(before: bool):
        source = header.read_header_source(model, pk, minimal=True)
        if not before:
            return header.build_minimal_header(source, kind, pk)
        current = header.header_profile

        def former_profile(value, learner_id, *, identity_only=False, delivery_window=False):
            # Former Header resolved placement/cohort separately before this
            # required profile read. Ignoring the new folded projection restores
            # exactly those two SELECT round trips for comparison.
            return current(value, learner_id, identity_only=identity_only)

        header.header_profile = former_profile
        try:
            return header.build_minimal_header(source, kind, pk)
        finally:
            header.header_profile = current

    def weekly_call(module_id, before: bool):
        source = assignment_projection(model.all_learners.only(*weekly.WEEKLY_SOURCE_FIELDS)).get(pk=pk)
        source.training_plan = source._weekly_training_plan
        source.learning_plan = source._weekly_learning_plan
        if before:
            # Former implementation repeated this profile bridge lookup after
            # the canonical owner query. Current code derives the model identity
            # from that already-validated owner instead.
            profile = learner_profile_for_source(
                source, pk, heal=False, fields=("id", "enrolment_id")
            )
            if profile is None:
                raise AssertionError("Synthetic benchmark fixture lost its profile bridge")
        return weekly.read_dashboard_weekly(source, pk, module_id=module_id)

    def measure_path(before: bool):
        header_payload, header_sample = measure(lambda: header_call(before), connections)
        weekly_payload, weekly_sample = measure(
            lambda: weekly_call(header_payload["initialWeeklyModuleId"], before), connections
        )
        combined = {
            key: header_sample[key] + weekly_sample[key]
            for key in ("wall_ms", "process_cpu_ms", "query_count", "sql_execute_ms",
                        "serialise_ms", "payload_bytes")
        }
        return ({"header": header_payload, "weekly": weekly_payload}, combined,
                header_sample, weekly_sample)

    result = {
        "classification": "isolated read-only Django service benchmark; not HTTP or browser",
        "iterations_per_variant": iterations,
        "request_graph": ["minimal-header", "weekly-initial"],
        "critical_sequential_dashboard_requests": 2,
        "fixture": "anonymous synthetic Reader fixture",
        "reader_limitations": [
            "the viable fixture has an empty Weekly plan",
            "the Reader lacks SELECT on live_session_learner_attendance for richer fixtures",
        ],
    }
    with transaction.atomic(using="enrolment"):
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout='120000ms'")
            cursor.execute("SET LOCAL idle_in_transaction_session_timeout='10min'")
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
            result["database_identity"] = identity

        with journal_sources.learner_journal_reads():
            before_payload, *_ = measure_path(True)
            after_payload, *_ = measure_path(False)
            if before_payload != after_payload:
                raise AssertionError("Warm-up response parity failed")

            before_samples = []
            after_samples = []
            before_header_samples = []
            after_header_samples = []
            before_weekly_samples = []
            after_weekly_samples = []
            for iteration in range(iterations):
                if iteration % 2:
                    after_payload, after, after_header, after_weekly = measure_path(False)
                    before_payload, before, before_header, before_weekly = measure_path(True)
                else:
                    before_payload, before, before_header, before_weekly = measure_path(True)
                    after_payload, after, after_header, after_weekly = measure_path(False)
                if before_payload != after_payload:
                    raise AssertionError("Measured response parity failed")
                before_samples.append(before)
                after_samples.append(after)
                before_header_samples.append(before_header)
                after_header_samples.append(after_header)
                before_weekly_samples.append(before_weekly)
                after_weekly_samples.append(after_weekly)

    result.update(
        parity=True,
        weekly_plan_shape="empty",
        before=summarise(before_samples),
        after=summarise(after_samples),
        endpoints={
            "minimal_header": {
                "before": summarise(before_header_samples),
                "after": summarise(after_header_samples),
            },
            "weekly_initial": {
                "before": summarise(before_weekly_samples),
                "after": summarise(after_weekly_samples),
            },
        },
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
