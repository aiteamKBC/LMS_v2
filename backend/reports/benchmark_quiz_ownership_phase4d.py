"""Read-only Phase 4D benchmark for quiz ownership SQL.

The caller must export LMS_IDEAL_TEST and PHASE4D_EXPECTED_ENDPOINT_ID.  The
script refuses any other Neon endpoint, converts the pooled URL to the direct
endpoint for stable session-level timings, starts one READ ONLY transaction,
and prints only aggregate JSON.  Module/quiz identifiers never leave process
memory.
"""
from __future__ import annotations

from hashlib import sha256
import json
import os
from statistics import median
from time import perf_counter
from math import ceil
from urllib.parse import urlsplit

import psycopg


STAGED_PAIR_LIMIT = 32


OLD_SQL = """
SELECT c.module_catalogue_id, c.settings_json->>'linkedQuizId'
FROM curriculum.components c
WHERE c.module_catalogue_id = ANY(%s)
  AND c.settings_json->>'linkedQuizId' = ANY(%s)
UNION
SELECT c.module_catalogue_id, link.quiz_id::text
FROM curriculum.quiz_component_links link
JOIN curriculum.components c ON c.id = link.component_id
WHERE c.module_catalogue_id = ANY(%s) AND link.quiz_id = ANY(%s)
UNION
SELECT r.module_catalogue_id, r.snapshot->'settings_json'->>'linkedQuizId'
FROM curriculum.record_revisions r
WHERE r.entity_type = 'component' AND r.module_catalogue_id = ANY(%s)
  AND r.snapshot->'settings_json'->>'linkedQuizId' = ANY(%s)
"""

CURRENT_SQL = """
SELECT c.module_catalogue_id, c.settings_json->>'linkedQuizId'
FROM curriculum.components c
WHERE c.module_catalogue_id = ANY(%s)
  AND c.settings_json->>'linkedQuizId' = ANY(%s)
UNION
SELECT c.module_catalogue_id, link.quiz_id::text
FROM curriculum.quiz_component_links link
JOIN curriculum.components c ON c.id = link.component_id
WHERE c.module_catalogue_id = ANY(%s)
  AND link.quiz_id = ANY(%s)
"""

HISTORY_EXACT_SQL = """
SELECT pending.module_catalogue_id, pending.quiz_id::text
FROM unnest(%s::varchar[], %s::bigint[])
     AS pending(module_catalogue_id, quiz_id)
WHERE EXISTS (
    SELECT 1 FROM curriculum.record_revisions r
    WHERE r.entity_type = 'component'
      AND r.module_catalogue_id = pending.module_catalogue_id
      AND r.snapshot->'settings_json'->>'linkedQuizId' = pending.quiz_id::text
)
"""

PAIR_POOL_SQL = """
WITH current_json AS (
    SELECT DISTINCT module_catalogue_id, settings_json->>'linkedQuizId' AS quiz_id
    FROM curriculum.components
    WHERE settings_json->>'linkedQuizId' ~ '^[0-9]+$'
), normalized AS (
    SELECT DISTINCT c.module_catalogue_id, link.quiz_id::text AS quiz_id
    FROM curriculum.quiz_component_links link
    JOIN curriculum.components c ON c.id = link.component_id
), current_pairs AS (
    SELECT * FROM current_json UNION SELECT * FROM normalized
), history_pairs AS (
    SELECT DISTINCT module_catalogue_id,
           snapshot->'settings_json'->>'linkedQuizId' AS quiz_id
    FROM curriculum.record_revisions
    WHERE entity_type = 'component'
      AND snapshot->'settings_json'->>'linkedQuizId' ~ '^[0-9]+$'
), classified AS (
    SELECT c.module_catalogue_id, c.quiz_id,
           CASE WHEN h.module_catalogue_id IS NULL THEN 'current_only' ELSE 'overlap' END AS category
    FROM current_pairs c
    LEFT JOIN history_pairs h USING (module_catalogue_id, quiz_id)
    UNION ALL
    SELECT h.module_catalogue_id, h.quiz_id, 'history_only'
    FROM history_pairs h
    LEFT JOIN current_pairs c USING (module_catalogue_id, quiz_id)
    WHERE c.module_catalogue_id IS NULL
)
SELECT module_catalogue_id, quiz_id, category
FROM classified
ORDER BY category, md5(module_catalogue_id || ':' || quiz_id)
"""


def direct_test_url() -> tuple[str, str]:
    raw = os.environ.get("LMS_IDEAL_TEST", "").strip()
    expected = os.environ.get("PHASE4D_EXPECTED_ENDPOINT_ID", "").strip()
    if not raw or not expected:
        raise SystemExit("LMS_IDEAL_TEST and PHASE4D_EXPECTED_ENDPOINT_ID are required")
    parsed = urlsplit(raw)
    host = (parsed.hostname or "").lower()
    if host not in {
        f"{expected}.eu-west-2.aws.neon.tech",
        f"{expected}-pooler.eu-west-2.aws.neon.tech",
    }:
        raise SystemExit("LMS_IDEAL_TEST does not match the approved endpoint")
    direct_host = host.replace("-pooler.", ".")
    # Preserve the credential text exactly as supplied. Rebuilding the URL from
    # urlsplit().password could corrupt percent-encoded special characters.
    direct = raw.replace(f"{expected}-pooler.", f"{expected}.", 1)
    return direct, direct_host


def params_for(pairs):
    ordered = sorted(set(pairs), key=lambda pair: (pair[0], int(pair[1])))
    return ordered, [row[0] for row in ordered], [int(row[1]) for row in ordered]


def old_params(pairs):
    _, modules, quiz_ids = params_for(pairs)
    quiz_refs = [str(value) for value in quiz_ids]
    return [sorted(set(modules)), sorted(set(quiz_refs)), sorted(set(modules)),
            sorted(set(quiz_ids)), sorted(set(modules)), sorted(set(quiz_refs))]


def execute(cur, sql, params):
    started = perf_counter()
    cur.execute(sql, params)
    rows = cur.fetchall()
    return rows, (perf_counter() - started) * 1000


def legacy(cur, pairs):
    candidate = {(module_id, str(quiz_id)) for module_id, quiz_id in pairs}
    rows, sql_ms = execute(cur, OLD_SQL, old_params(pairs))
    started_python = perf_counter()
    result = {(str(module_id), str(quiz_id)) for module_id, quiz_id in rows} & candidate
    return result, sql_ms, (perf_counter() - started_python) * 1000


def staged(cur, pairs):
    ordered, modules, quiz_ids = params_for(pairs)
    started_python = perf_counter()
    candidate = {(module_id, str(quiz_id)) for module_id, quiz_id in ordered}
    python_ms = (perf_counter() - started_python) * 1000
    if len(ordered) > STAGED_PAIR_LIMIT:
        rows, sql_ms = execute(cur, OLD_SQL, old_params(pairs))
        started_python = perf_counter()
        result = {(str(module_id), str(quiz_id)) for module_id, quiz_id in rows} & candidate
        python_ms += (perf_counter() - started_python) * 1000
        return result, sql_ms, python_ms, 1, len(ordered)
    current_rows, current_ms = execute(
        cur, CURRENT_SQL, [modules, [str(value) for value in quiz_ids], modules, quiz_ids]
    )
    started_python = perf_counter()
    result = {(str(module_id), str(quiz_id)) for module_id, quiz_id in current_rows}
    unresolved = sorted(candidate - result, key=lambda pair: (pair[0], int(pair[1])))
    python_ms += (perf_counter() - started_python) * 1000
    history_ms = 0.0
    queries = 1
    if unresolved:
        history_params = [
            [row[0] for row in unresolved], [int(row[1]) for row in unresolved]
        ]
        history_rows, history_ms = execute(
            cur, HISTORY_EXACT_SQL, history_params,
        )
        started_python = perf_counter()
        result.update((str(module_id), str(quiz_id)) for module_id, quiz_id in history_rows)
        python_ms += (perf_counter() - started_python) * 1000
        queries += 1
    return result & candidate, current_ms + history_ms, python_ms, queries, len(unresolved)


def explain(cur, sql, params):
    cur.execute("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + sql, params)
    document = cur.fetchone()[0]
    if isinstance(document, str):
        document = json.loads(document)
    root = document[0]
    revision = {"rows_examined": 0, "shared_hit_blocks": 0, "shared_read_blocks": 0}

    def visit(node):
        if node.get("Relation Name") == "record_revisions":
            loops = int(node.get("Actual Loops", 1) or 1)
            revision["rows_examined"] += int(
                (node.get("Actual Rows", 0) + node.get("Rows Removed by Filter", 0)) * loops
            )
            revision["shared_hit_blocks"] += int(node.get("Shared Hit Blocks", 0))
            revision["shared_read_blocks"] += int(node.get("Shared Read Blocks", 0))
        for child in node.get("Plans", []):
            visit(child)

    visit(root["Plan"])
    return {
        "planning_ms": round(float(root.get("Planning Time", 0)), 3),
        "execution_ms": round(float(root.get("Execution Time", 0)), 3),
        "revision": revision,
    }


def percentile(values, proportion):
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, ceil(len(ordered) * proportion) - 1))
    return ordered[index]


def main():
    dsn, direct_host = direct_test_url()
    iterations = int(os.environ.get("PHASE4D_ITERATIONS", "20"))
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        with connection.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute("SET LOCAL statement_timeout = '15000ms'")
            cur.execute("SELECT current_database(), current_setting('transaction_read_only'), current_setting('server_version')")
            database, read_only, server_version = cur.fetchone()
            cur.execute(PAIR_POOL_SQL)
            pools = {"current_only": [], "history_only": [], "overlap": []}
            for module_id, quiz_id, category in cur.fetchall():
                pools[category].append((str(module_id), str(quiz_id)))

            shapes = {
                "small_current_only": pools["current_only"][:1],
                "median_current_only": pools["current_only"][:10],
                "mixed_30_pairs": pools["current_only"][:15] + pools["history_only"][:15],
                "history_heavy_75_pairs": pools["history_only"][:75],
            }
            results = []
            for name, pairs in shapes.items():
                if not pairs:
                    continue
                candidate = set(pairs)
                old_result, _, _ = legacy(cur, pairs)
                new_result, _, _, _, _ = staged(cur, pairs)
                if old_result != new_result:
                    raise AssertionError(f"ownership parity failed for {name}")

                old_wall, old_python_times = [], []
                new_wall, python_times, query_counts, unresolved_counts = [], [], [], []
                for iteration in range(iterations):
                    if iteration % 2:
                        new_result, new_ms, python_ms, query_count, unresolved = staged(cur, pairs)
                        old_result, old_ms, old_python_ms = legacy(cur, pairs)
                    else:
                        old_result, old_ms, old_python_ms = legacy(cur, pairs)
                        new_result, new_ms, python_ms, query_count, unresolved = staged(cur, pairs)
                    if old_result != new_result:
                        raise AssertionError(f"warm ownership parity failed for {name}")
                    old_wall.append(old_ms)
                    old_python_times.append(old_python_ms)
                    new_wall.append(new_ms)
                    python_times.append(python_ms)
                    query_counts.append(query_count)
                    unresolved_counts.append(unresolved)

                ordered, modules, quiz_ids = params_for(pairs)
                strategy = (
                    "single_query_safety_valve"
                    if len(ordered) > STAGED_PAIR_LIMIT
                    else "current_first"
                )
                current_plan = None
                history_plan = None
                safety_valve_plan = None
                if strategy == "single_query_safety_valve":
                    safety_valve_plan = explain(cur, OLD_SQL, old_params(pairs))
                else:
                    current_params = [modules, [str(value) for value in quiz_ids], modules, quiz_ids]
                    current_plan = explain(cur, CURRENT_SQL, current_params)
                    current_rows, _ = execute(cur, CURRENT_SQL, current_params)
                    current_set = {(str(a), str(b)) for a, b in current_rows}
                    unresolved = [
                        pair for pair in ordered if (pair[0], str(pair[1])) not in current_set
                    ]
                    if unresolved:
                        history_plan = explain(
                            cur,
                            HISTORY_EXACT_SQL,
                            [[row[0] for row in unresolved], [int(row[1]) for row in unresolved]],
                        )
                results.append({
                    "shape": name,
                    "candidate_pairs": len(candidate),
                    "iterations": iterations,
                    "parity": True,
                    "old": {
                        "sql_count": 1,
                        "client_wall_p50_ms": round(median(old_wall), 3),
                        "client_wall_p95_ms": round(percentile(old_wall, 0.95), 3),
                        "python_p50_ms": round(median(old_python_times), 4),
                        "plan": explain(cur, OLD_SQL, old_params(pairs)),
                    },
                    "staged": {
                        "strategy": strategy,
                        "sql_count": max(query_counts),
                        "unresolved_pairs": max(unresolved_counts),
                        "client_wall_p50_ms": round(median(new_wall), 3),
                        "client_wall_p95_ms": round(percentile(new_wall, 0.95), 3),
                        "python_p50_ms": round(median(python_times), 4),
                        "current_plan": current_plan,
                        "history_plan": history_plan,
                        "safety_valve_plan": safety_valve_plan,
                    },
                    "median_change_percent": round(
                        ((median(new_wall) - median(old_wall)) / median(old_wall)) * 100, 2
                    ),
                })

            print(json.dumps({
                "classification": "ISOLATED POSTGRESQL MEASUREMENT",
                "database": database,
                "server_version": server_version,
                "transaction_read_only": read_only,
                "direct_endpoint_id": direct_host.split(".", 1)[0],
                "pool_sizes": {key: len(value) for key, value in pools.items()},
                "sql_fingerprints": {
                    "old": sha256(" ".join(OLD_SQL.split()).encode()).hexdigest()[:16],
                    "current": sha256(" ".join(CURRENT_SQL.split()).encode()).hexdigest()[:16],
                    "history_exact": sha256(" ".join(HISTORY_EXACT_SQL.split()).encode()).hexdigest()[:16],
                },
                "results": results,
                "limitations": [
                    "Pair-count shapes are targeted SQL cases, not learner-history percentiles.",
                    "Client wall includes the remote network round trip.",
                    "No authenticated HTTP request is measured.",
                ],
            }, indent=2))


if __name__ == "__main__":
    main()
