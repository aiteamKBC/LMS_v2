"""Compare unscoped and learner-scoped catalogue relation CTEs on the test branch."""
from __future__ import annotations

import gzip
from hashlib import sha256
import json
from math import ceil
import os
from pathlib import Path
from statistics import median
import sys
from time import perf_counter
from unittest.mock import patch
from urllib.parse import urlsplit

import psycopg


EXCLUSION_SQL = """not exists (
    select 1 from "Learner".learner_progress_ksb_exclusions ksb_x
    where ksb_x.progress_id = k.progress_id
      and ksb_x.position = k.position
      and ksb_x.ksb_code = upper(btrim(k.ksb_code))
      and ksb_x.status <> 'released'
)"""


def percentile(values, proportion):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, ceil(len(ordered) * proportion) - 1))]


def direct_test_url() -> tuple[str, str]:
    raw = os.environ.get("LMS_IDEAL_TEST", "").strip()
    expected = os.environ.get("PHASE4E_EXPECTED_ENDPOINT_ID", "").strip()
    if not raw or not expected:
        raise SystemExit("LMS_IDEAL_TEST and PHASE4E_EXPECTED_ENDPOINT_ID are required")
    host = (urlsplit(raw).hostname or "").lower()
    if host not in {
        f"{expected}.eu-west-2.aws.neon.tech",
        f"{expected}-pooler.eu-west-2.aws.neon.tech",
    }:
        raise SystemExit("LMS_IDEAL_TEST does not match the approved endpoint")
    return raw.replace(f"{expected}-pooler.", f"{expected}.", 1), host.replace("-pooler.", ".")


def configure_safe_django(raw_dsn):
    direct = raw_dsn.replace("-pooler.", ".")
    os.environ.update({
        "DJANGO_SETTINGS_MODULE": "config.settings",
        "RUN_APP_ON_TEST_BRANCH": "true",
        "security_Database_url": direct,
        "DATABASE_URL": direct,
        "Database_url": direct,
        "ENROLMENT_DATABASE_URL": direct,
        "CURRICULUM_WARM": "0",
    })
    for key in (
        "AUDIT_DATABASE_URL", "AUDIT_CLONE_DATABASE_URL", "LASR-ADUTIOD-CLNE",
        "KBC_ATTENDANCE_DATABASE_URL",
    ):
        os.environ[key] = ""
    backend = str(Path(__file__).resolve().parents[1])
    if backend not in sys.path:
        sys.path.insert(0, backend)
    import django
    django.setup()
    from django.db import connections
    expected_host = urlsplit(direct).hostname
    aliases = {}
    for alias in ("default", "enrolment"):
        host = connections.databases[alias]["HOST"]
        if host != expected_host:
            raise SystemExit(f"Django alias {alias} is not isolated to the approved endpoint")
        aliases[alias] = host.split(".", 1)[0]
    return aliases


def captured_entries_sql(mode):
    from learner_api import canonical_learning as canonical

    if mode != "catalogue":
        raise ValueError("Phase 4E compares only the optimised catalogue projection")
    calls = []

    def capture(sql, params=()):
        calls.append((sql, params))
        return []

    options = {
        "catalogue": {"lineage_only": True, "monthly_summary": True, "catalogue_summary": True},
        "training": {"training_summary": True},
        "lineage": {"lineage_only": True},
        "full": {},
    }[mode]
    with patch.object(canonical, "query", side_effect=capture), \
         patch.object(canonical, "current_records", return_value=[]), \
         patch.object(canonical, "_ksb_not_excluded", return_value=EXCLUSION_SQL):
        canonical.entries_for({"id": 1, "enrolment_id": 1, "progress_transfer_active": False}, **options)
    if len(calls) != 1:
        raise AssertionError(f"Expected one ledger SQL call for {mode}, got {len(calls)}")
    sql, _params = calls[0]
    reporting_old = (
        "JOIN canonical p ON p.id=s.progress_id AND p.learner_id=s.learner_id\n"
        "            GROUP BY s.progress_id"
    )
    reporting_new = (
        "JOIN canonical p ON p.id=s.progress_id AND p.learner_id=s.learner_id\n"
        "            WHERE s.learner_id=%s\n"
        "            GROUP BY s.progress_id"
    )
    activity_old = (
        "WHERE s.deleted_at IS NULL\n"
        "            GROUP BY s.canonical_progress_id"
    )
    activity_new = (
        "WHERE s.learner_id=%s AND s.deleted_at IS NULL\n"
        "            GROUP BY s.canonical_progress_id"
    )
    journal_old = (
        "WHERE j.deleted_at IS NULL\n"
        "            GROUP BY j.progress_id"
    )
    journal_new = (
        "WHERE j.canonical_learner_id=%s AND j.deleted_at IS NULL\n"
        "            GROUP BY j.progress_id"
    )
    if reporting_new in sql and activity_new in sql and journal_new in sql:
        scoped = sql
        unscoped = sql.replace(reporting_new, reporting_old, 1).replace(
            activity_new, activity_old, 1
        ).replace(journal_new, journal_old, 1)
    else:
        unscoped = sql
        scoped = sql.replace(reporting_old, reporting_new, 1).replace(
            activity_old, activity_new, 1
        ).replace(journal_old, journal_new, 1)
    if scoped.count("%s") != unscoped.count("%s") + 3:
        raise AssertionError("learner relationship scopes were not applied")
    return unscoped, scoped


def representative_profiles(cur):
    cur.execute("""SELECT learner_id,count(*)::int FROM "Learner".learner_progress_entries
        WHERE deleted_at IS NULL GROUP BY learner_id""")
    population = [(int(learner_id), int(count)) for learner_id, count in cur.fetchall()]
    selected, used = [], set()
    for label, target in (("small", 50), ("median", 357), ("p95", 1116), ("maximum", 3617)):
        learner_id, count = min(
            (item for item in population if item[0] not in used),
            key=lambda item: (abs(item[1] - target), item[1]),
        )
        used.add(learner_id)
        selected.append((label, learner_id, count))
    return selected


def execute(cur, sql, params):
    started = perf_counter()
    cur.execute(sql, params)
    rows = cur.fetchall()
    return rows, (perf_counter() - started) * 1000


def plan(cur, sql, params):
    cur.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params)
    document = cur.fetchone()[0]
    if isinstance(document, str):
        document = json.loads(document)
    root = document[0]
    relations = {}

    def visit(node):
        relation = node.get("Relation Name")
        if relation:
            item = relations.setdefault(relation, {
                "rows_examined": 0, "shared_hit_blocks": 0, "shared_read_blocks": 0,
            })
            loops = int(node.get("Actual Loops", 1) or 1)
            item["rows_examined"] += int(
                (node.get("Actual Rows", 0) + node.get("Rows Removed by Filter", 0)) * loops
            )
            item["shared_hit_blocks"] += int(node.get("Shared Hit Blocks", 0))
            item["shared_read_blocks"] += int(node.get("Shared Read Blocks", 0))
        for child in node.get("Plans", []):
            visit(child)

    visit(root["Plan"])
    return {
        "planning_ms": round(float(root.get("Planning Time", 0)), 3),
        "execution_ms": round(float(root.get("Execution Time", 0)), 3),
        "relations": relations,
    }


def serialise(rows):
    started = perf_counter()
    raw = json.dumps(rows, default=str, separators=(",", ":")).encode()
    return {
        "python_ms": round((perf_counter() - started) * 1000, 4),
        "raw_bytes": len(raw),
        "gzip_bytes": len(gzip.compress(raw)),
    }


def main():
    dsn, direct_host = direct_test_url()
    aliases = configure_safe_django(dsn)
    modes = [item for item in os.environ.get(
        "PHASE4E_MODES", "catalogue"
    ).split(",") if item]
    shapes = {
        item for item in os.environ.get(
            "PHASE4E_SHAPES", "small,median,p95,maximum"
        ).split(",") if item
    }
    iterations = int(os.environ.get("PHASE4E_ITERATIONS", "1"))
    sql_by_mode = {mode: captured_entries_sql(mode) for mode in modes}
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        with connection.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute("SET LOCAL statement_timeout='15000ms'")
            cur.execute("""SELECT current_database(),current_setting('transaction_read_only'),
                current_setting('server_version'),pg_is_in_recovery()""")
            database, read_only, version, in_recovery = cur.fetchone()
            results = []
            for label, learner_id, progress_count in representative_profiles(cur):
                if label not in shapes:
                    continue
                for mode in modes:
                    before_sql, after_sql = sql_by_mode[mode]
                    before_params = [learner_id]
                    after_params = [learner_id, learner_id, learner_id, learner_id]
                    before_rows, _ = execute(cur, before_sql, before_params)
                    after_rows, _ = execute(cur, after_sql, after_params)
                    if before_rows != after_rows:
                        raise AssertionError(f"canonical parity failed for {label}/{mode}")
                    before_wall, after_wall = [], []
                    for iteration in range(iterations):
                        if iteration % 2:
                            after_rows, after_ms = execute(cur, after_sql, after_params)
                            before_rows, before_ms = execute(cur, before_sql, before_params)
                        else:
                            before_rows, before_ms = execute(cur, before_sql, before_params)
                            after_rows, after_ms = execute(cur, after_sql, after_params)
                        if before_rows != after_rows:
                            raise AssertionError(f"warm canonical parity failed for {label}/{mode}")
                        before_wall.append(before_ms)
                        after_wall.append(after_ms)
                    results.append({
                        "shape": label,
                        "mode": mode,
                        "progress_entries": progress_count,
                        "returned_rows": len(after_rows),
                        "iterations": iterations,
                        "parity": True,
                        "before": {
                            "client_wall_p50_ms": round(median(before_wall), 3),
                            "client_wall_p95_ms": round(percentile(before_wall, .95), 3),
                            "plan": plan(cur, before_sql, before_params),
                        },
                        "after": {
                            "client_wall_p50_ms": round(median(after_wall), 3),
                            "client_wall_p95_ms": round(percentile(after_wall, .95), 3),
                            "plan": plan(cur, after_sql, after_params),
                        },
                        "median_change_percent": round(
                            ((median(after_wall) - median(before_wall)) / median(before_wall)) * 100, 2
                        ) if median(before_wall) else 0,
                        "sql_result_serialization": serialise(after_rows),
                    })
            document = {
                "classification": "ISOLATED POSTGRESQL MEASUREMENT",
                "database": database,
                "server_version": version,
                "transaction_read_only": read_only,
                "in_recovery": in_recovery,
                "direct_endpoint_id": direct_host.split(".", 1)[0],
                "django_aliases": aliases,
                "sql_fingerprints": {
                    mode: {
                        "before": sha256(" ".join(pair[0].split()).encode()).hexdigest()[:16],
                        "after": sha256(" ".join(pair[1].split()).encode()).hexdigest()[:16],
                    } for mode, pair in sql_by_mode.items()
                },
                "results": results,
                "limitations": [
                    "Measurements cover canonical ledger SQL, not total endpoint latency.",
                    "Serialized bytes cover SQL rows only, not HTTP responses.",
                    "Client wall includes remote network and JSON decoding.",
                ],
            }
            output_path = os.environ.get("PHASE4E_OUTPUT_PATH", "").strip()
            if output_path:
                Path(output_path).write_text(
                    json.dumps(document, indent=2) + "\n", encoding="utf-8"
                )
            if os.environ.get("PHASE4E_COMPACT", "") == "1":
                print(json.dumps({
                    "classification": document["classification"],
                    "transaction_read_only": document["transaction_read_only"],
                    "direct_endpoint_id": document["direct_endpoint_id"],
                    "results": [{
                        "shape": row["shape"],
                        "mode": row["mode"],
                        "progress_entries": row["progress_entries"],
                        "returned_rows": row["returned_rows"],
                        "parity": row["parity"],
                        "before_p50_ms": row["before"]["client_wall_p50_ms"],
                        "after_p50_ms": row["after"]["client_wall_p50_ms"],
                        "before_plan_ms": row["before"]["plan"]["execution_ms"],
                        "after_plan_ms": row["after"]["plan"]["execution_ms"],
                        "median_change_percent": row["median_change_percent"],
                    } for row in results],
                }, indent=2))
            else:
                print(json.dumps(document, indent=2))


if __name__ == "__main__":
    main()
