"""Profile one learner Activity read without emitting learner data or SQL params.

The runner forces every PostgreSQL alias onto a direct, read-only connection.
Attribution mode records normalized SQL, app callers, result row counts and an
approximate decoded payload size. Benchmark mode avoids stack/payload sampling
so repeated wall timings remain comparable.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from contextlib import ExitStack
import gzip
import hashlib
import inspect
import json
import logging
import os
from pathlib import Path
import re
import statistics
import sys
from time import perf_counter, thread_time
from types import SimpleNamespace
from unittest.mock import patch


SQL_SPACE = re.compile(r"\s+")


def normalise_sql(sql):
    return SQL_SPACE.sub(" ", str(sql)).strip()


def decoded_size(value):
    try:
        return len(json.dumps(value, default=str, separators=(",", ":")).encode("utf-8"))
    except (TypeError, ValueError, OverflowError):
        return len(repr(value).encode("utf-8", errors="replace"))


def app_frames():
    frames = []
    for frame in inspect.stack(context=0)[2:]:
        path = Path(frame.filename).resolve()
        parts = {part.lower() for part in path.parts}
        if "backend" not in parts or not ({"learner_api", "curriculum_api", "login", "old_otjh"} & parts):
            continue
        relative = path.as_posix().split("/backend/", 1)[-1]
        if relative == "scripts/profile_activity_read_graph.py":
            continue
        frames.append({"file": relative, "line": frame.lineno, "function": frame.function})
        if len(frames) == 8:
            break
    return frames


def query_category(record):
    stage = record["stage"]
    sql = record["sql"].casefold()
    caller = " ".join(
        f"{frame['file']} {frame['function']}" for frame in record.get("callers", [])
    ).casefold()
    if ("information_schema" in sql or "to_regclass" in sql
            or "pg_database" in sql or "schema_gate" in caller
            or "learning_storage" in caller or "content_cache" in caller):
        return "storage/schema capability checks"
    if (stage.startswith("quiz.") or any(marker in sql for marker in (
            "learner_progress_ksbs", "learner_quiz_answers", "ksb_profile_versions",
            "ksb_definitions", "ksb_mappings", "standard_ksbs",
            "quiz_component_links", "quiz_course_links", "curriculum.quizzes"))):
        return "quiz and KSB mapping"
    if stage.startswith("attendance."):
        return "attendance and live credit"
    if stage.startswith("plan."):
        return "canonical Training Plan"
    if stage.startswith("curriculum."):
        return "Curriculum modules/weeks/components"
    if stage.startswith("identity.") or stage.startswith("authorization.") or stage == "dispatch/source_authorization":
        return "learner identity and authorization"
    if stage.startswith("compatibility.") or any(
            marker in caller or marker in sql
            for marker in ("legacy", "replacement", "progress_transfer", "retained")):
        return "compatibility/legacy readers"
    return "progress and evidence"


class RunTrace:
    def __init__(self, attribution):
        self.attribution = attribution
        self.queries = []
        self.stages = defaultdict(lambda: {
            "calls": 0, "wall_ms": 0.0, "cpu_ms": 0.0,
            "query_count": 0, "execute_ms": 0.0, "fetch_ms": 0.0,
            "rows": 0, "decoded_bytes": 0,
        })
        self.stage_stack = ["dispatch/source_authorization"]

    @property
    def stage(self):
        return self.stage_stack[-1]

    def execute_wrapper(self, alias):
        def observe(execute, sql, params, many, context):
            started = perf_counter()
            try:
                result = execute(sql, params, many, context)
                return result
            finally:
                elapsed_ms = (perf_counter() - started) * 1000
                cursor = context["cursor"]
                raw_cursor = getattr(cursor, "cursor", cursor)
                record = {
                    "sequence": len(self.queries) + 1,
                    "alias": alias,
                    "stage": self.stage,
                    "execute_ms": round(elapsed_ms, 3),
                    "fetch_ms": 0.0,
                    "rows": 0,
                    "decoded_bytes": 0,
                    "rowcount_after_execute": getattr(raw_cursor, "rowcount", -1),
                    "sql": normalise_sql(sql),
                    "param_fingerprint": hashlib.sha256(json.dumps(
                        params, sort_keys=True, separators=(",", ":"), default=str,
                    ).encode()).hexdigest()[:16],
                    "callers": app_frames() if self.attribution else [],
                }
                record["signature"] = hashlib.sha256(record["sql"].encode()).hexdigest()[:16]
                record["category"] = query_category(record)
                self.queries.append(record)
                setattr(cursor, "_activity_trace_record", record)
        return observe

    def timed(self, name, function):
        def wrapped(*args, **kwargs):
            row = self.stages[name]
            row["calls"] += 1
            query_start = len(self.queries)
            wall_started, cpu_started = perf_counter(), thread_time()
            self.stage_stack.append(name)
            try:
                return function(*args, **kwargs)
            finally:
                self.stage_stack.pop()
                row["wall_ms"] += (perf_counter() - wall_started) * 1000
                row["cpu_ms"] += (thread_time() - cpu_started) * 1000
                selected = self.queries[query_start:]
                row["query_count"] += len(selected)
                row["execute_ms"] += sum(item["execute_ms"] for item in selected)
                row["fetch_ms"] += sum(item["fetch_ms"] for item in selected)
                row["rows"] += sum(item["rows"] for item in selected)
                row["decoded_bytes"] += sum(item["decoded_bytes"] for item in selected)
        return wrapped

    def stage_rows(self):
        return [
            {"stage": name, **{
                key: round(value, 3) if isinstance(value, float) else value
                for key, value in values.items()
            }}
            for name, values in self.stages.items()
        ]


def summarise_queries(queries):
    grouped = {}
    for query in queries:
        row = grouped.setdefault(query["signature"], {
            "signature": query["signature"], "sql": query["sql"], "calls": 0,
            "execute_ms": 0.0, "fetch_ms": 0.0, "rows": 0,
            "decoded_bytes": 0, "aliases": Counter(), "stages": Counter(),
            "callers": query["callers"], "categories": Counter(),
            "param_fingerprints": Counter(),
        })
        row["calls"] += 1
        row["execute_ms"] += query["execute_ms"]
        row["fetch_ms"] += query["fetch_ms"]
        row["rows"] += query["rows"]
        row["decoded_bytes"] += query["decoded_bytes"]
        row["aliases"][query["alias"]] += 1
        row["stages"][query["stage"]] += 1
        row["categories"][query["category"]] += 1
        row["param_fingerprints"][query["param_fingerprint"]] += 1
    return [
        {
            **row,
            "execute_ms": round(row["execute_ms"], 3),
            "fetch_ms": round(row["fetch_ms"], 3),
            "aliases": dict(row["aliases"]),
            "stages": dict(row["stages"]),
            "categories": dict(row["categories"]),
            "distinct_param_fingerprints": len(row["param_fingerprints"]),
            "exact_duplicate_calls": sum(
                count - 1 for count in row["param_fingerprints"].values()),
        }
        for row in grouped.values()
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--kind", choices=("commercial", "apprenticeship"), default="commercial")
    parser.add_argument("--learner-id", type=int, default=285)
    parser.add_argument("--component-id", required=True)
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--warmups", type=int, default=0)
    parser.add_argument("--statement-timeout-ms", type=int, default=30000)
    parser.add_argument("--attribution", action="store_true")
    parser.add_argument(
        "--progress-diagnostics", action="store_true",
        help="Record aggregate component-progress shapes without learner identifiers or dates.",
    )
    args = parser.parse_args()
    if args.runs < 1 or args.warmups < 0:
        parser.error("runs must be positive and warmups nonnegative")

    backend_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend_root))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    sys.argv = [sys.argv[0], "shell"]
    from django.conf import settings
    for config in settings.DATABASES.values():
        if config["ENGINE"] != "django.db.backends.postgresql":
            raise RuntimeError("PostgreSQL required for Development profiling")
        config["HOST"] = config.get("HOST", "").replace("-pooler.", ".")
        options = config.setdefault("OPTIONS", {})
        options.pop("pool", None)
        options["options"] = (
            f"-c default_transaction_read_only=on -c statement_timeout={args.statement_timeout_ms}"
        )
        options["connect_timeout"] = 10
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

    import django
    django.setup()
    logging.disable(logging.CRITICAL)

    from django.db import connections
    from django.db.backends.utils import CursorWrapper
    from django.test import RequestFactory
    from learner_api import learner_detail, live_session_progress, progress_transfer_store
    from learner_api import replacement_learning, teams_attendance

    profile_aliases = ("default", "enrolment")
    verification = {}
    for alias in profile_aliases:
        connection = connections[alias]
        connection.close()
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_database(), current_setting('transaction_read_only')")
            database_name, read_only = cursor.fetchone()
        if read_only != "on":
            raise RuntimeError(f"Read-only verification failed for alias {connection.alias}")
        endpoint = connection.settings_dict.get("HOST", "").split(".", 1)[0]
        if not endpoint.startswith("ep-odd-grass-"):
            raise RuntimeError(f"Refusing unapproved endpoint for alias {connection.alias}")
        verification[connection.alias] = {
            "database_name": database_name,
            "endpoint_matches_approved_branch": True,
            "transaction_read_only": read_only,
            "direct_connection": "-pooler." not in connection.settings_dict.get("HOST", ""),
        }

    original_getattr = CursorWrapper.__getattr__

    def traced_getattr(cursor, name):
        operation = original_getattr(cursor, name)
        if name not in {"fetchone", "fetchmany", "fetchall"}:
            return operation

        def fetch(*values, **options):
            started = perf_counter()
            result = operation(*values, **options)
            elapsed_ms = (perf_counter() - started) * 1000
            record = getattr(cursor, "_activity_trace_record", None)
            if record is not None:
                if name == "fetchone":
                    row_count = int(result is not None)
                else:
                    row_count = len(result)
                record["fetch_ms"] += round(elapsed_ms, 3)
                record["rows"] += row_count
                record["decoded_bytes"] += decoded_size(result)
            return result
        return fetch

    timed_targets = [
        (learner_detail, "_linked_profile_ids", "identity.linked_profiles"),
        (learner_detail, "_active_profile_for_source", "identity.profile_progress_prefetch"),
        (learner_detail, "_activity_plan_assignments", "plan.ownership"),
        (learner_detail, "effective_training_plan", "plan.effective_projection"),
        (learner_detail, "to_learner_detail", "progress.serializer_projection"),
        (learner_detail, "_official_planned_hours", "identity.official_hours"),
        (learner_detail, "access_gate", "authorization.access_gate"),
        (learner_detail, "learning_access", "authorization.learning_access"),
        (learner_detail, "_apply_cohort_schedule", "curriculum.cohort_schedule"),
        (learner_detail, "_resolve_from_master", "curriculum.owner_graph"),
        (learner_detail, "_annotate_otjh", "curriculum.otjh"),
        (learner_detail, "_append_week_quizzes", "quiz.week_projection"),
        (learner_detail, "retain_quiz_progress", "quiz.retained_progress"),
        (teams_attendance, "annotate_attendance_completion", "attendance.completion"),
        (replacement_learning, "annotate_replacement_learning", "compatibility.replacement"),
        (replacement_learning, "approved_retained_components", "compatibility.retained_components"),
        (progress_transfer_store, "read_state", "compatibility.transfer_state"),
        (live_session_progress, "read_live_credits", "attendance.live_credits"),
        (learner_detail, "_reading_content", "curriculum.selected_content"),
        (learner_detail, "_lesson_content", "curriculum.selected_lesson"),
        (learner_detail, "JsonResponse", "serialize.response"),
    ]

    records = []
    total_runs = args.warmups + args.runs
    for number in range(total_runs):
        measured = number >= args.warmups
        trace = RunTrace(args.attribution and measured)
        request = RequestFactory().get(
            f"/learner_api/learner-detail/{args.kind}/{args.learner_id}/",
            {"content": "activity", "component_id": args.component_id},
        )
        request.login_account = SimpleNamespace(
            role="learner", subject_id=args.learner_id, subject_type="learner"
        )
        started, cpu_started = perf_counter(), thread_time()
        with ExitStack() as stack:
            for alias in profile_aliases:
                connection = connections[alias]
                stack.enter_context(connection.execute_wrapper(trace.execute_wrapper(connection.alias)))
            if args.attribution and measured:
                stack.enter_context(patch.object(CursorWrapper, "__getattr__", traced_getattr))
            for module, name, stage in timed_targets:
                original = getattr(module, name)
                stack.enter_context(patch.object(module, name, trace.timed(stage, original)))
            stack.enter_context(patch("requests.sessions.Session.request", side_effect=AssertionError("HTTP forbidden")))
            stack.enter_context(patch("urllib.request.urlopen", side_effect=AssertionError("HTTP forbidden")))
            response = learner_detail.learner_detail(
                request, kind=args.kind, pk=args.learner_id
            )
        wall_ms = (perf_counter() - started) * 1000
        cpu_ms = (thread_time() - cpu_started) * 1000
        if not measured:
            continue
        serialization_started = perf_counter()
        raw = bytes(response.content)
        serialization_ms = (perf_counter() - serialization_started) * 1000
        payload = json.loads(raw)
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
        top_level_sha256 = {
            str(key): hashlib.sha256(json.dumps(
                value, sort_keys=True, separators=(",", ":"), default=str,
            ).encode()).hexdigest()
            for key, value in payload.items()
        }
        record = {
            "run": number - args.warmups + 1,
            "status": response.status_code,
            "wall_ms": round(wall_ms, 3),
            "thread_cpu_ms": round(cpu_ms, 3),
            "serialization_access_ms": round(serialization_ms, 3),
            "query_count": len(trace.queries),
            "execute_ms": round(sum(item["execute_ms"] for item in trace.queries), 3),
            "fetch_ms": round(sum(item["fetch_ms"] for item in trace.queries), 3),
            "decoded_bytes": sum(item["decoded_bytes"] for item in trace.queries),
            "raw_bytes": len(raw),
            "gzip_bytes": len(gzip.compress(raw, mtime=0)),
            "canonical_sha256": hashlib.sha256(canonical).hexdigest(),
            "top_level_sha256": top_level_sha256,
            "modules": len(payload.get("modules") or []),
            "weeks": len(payload.get("week") or []),
            "components": len(payload.get("components") or []),
            "selected_components": sum(
                item.get("componentId") == args.component_id
                for item in payload.get("components") or []
            ),
            **({"component_progress_diagnostics": {
                "count": len(payload.get("componentProgress") or []),
                "semantic_counts": dict(Counter(
                    json.dumps({
                        key: item.get(key)
                        for key in (
                            "kind", "componentType", "passed", "reportedTime", "timeTaken",
                            "timeTrackingSource", "claimedSeconds", "verifiedSeconds",
                            "retakeTimeChoice", "retakePreviousSeconds",
                        ) if key in item
                    }, sort_keys=True, separators=(",", ":"), default=str)
                    for item in payload.get("componentProgress") or []
                )),
            }} if args.progress_diagnostics else {}),
            "queries": trace.queries if args.attribution else [],
            "signatures": summarise_queries(trace.queries),
            "stages": trace.stage_rows(),
            "categories": [
                {
                    "category": category,
                    "query_count": len(items),
                    "distinct_signatures": len({item["signature"] for item in items}),
                    "duplicate_calls": len(items) - len({item["signature"] for item in items}),
                    "exact_duplicate_calls": len(items) - len({
                        (item["signature"], item["param_fingerprint"]) for item in items}),
                    "execute_ms": round(sum(item["execute_ms"] for item in items), 3),
                    "fetch_ms": round(sum(item["fetch_ms"] for item in items), 3),
                    "rows": sum(item["rows"] for item in items),
                    "decoded_bytes": sum(item["decoded_bytes"] for item in items),
                }
                for category, items in sorted({
                    name: [item for item in trace.queries if item["category"] == name]
                    for name in {item["category"] for item in trace.queries}
                }.items())
            ],
        }
        records.append(record)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({"verification": verification, "records": records}, indent=2))
        print(json.dumps({key: value for key, value in record.items()
                          if key not in {"queries", "signatures", "stages"}}), flush=True)

    numeric = ("wall_ms", "thread_cpu_ms", "execute_ms", "fetch_ms", "query_count", "raw_bytes")
    summary = {
        key: {
            "median": round(statistics.median(row[key] for row in records), 3),
            "min": min(row[key] for row in records),
            "max": max(row[key] for row in records),
        }
        for key in numeric
    }
    args.output.write_text(json.dumps({
        "verification": verification,
        "summary": summary,
        "records": records,
    }, indent=2))
    print(json.dumps({"summary": summary}), flush=True)


if __name__ == "__main__":
    main()
