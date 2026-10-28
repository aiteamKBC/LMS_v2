"""Read-only Phase 4E benchmark for canonical activity-source loading.

The script refuses any endpoint other than the explicitly approved Neon test
endpoint, converts its pooled URL to the matching direct endpoint, opens one
READ ONLY transaction, and emits aggregate measurements without learner IDs.
"""
from __future__ import annotations

import gzip
from hashlib import sha256
import json
from math import ceil
import os
from statistics import median
from time import perf_counter
from urllib.parse import urlsplit

import psycopg


OLD_SQL = """
SELECT s.canonical_progress_id AS progress_id,
    s.id AS source_id,s.source_system,s.source_activity_id,s.completed,
    c.source_course_ref,c.id AS source_course_id,
    c.source_course_title AS course_title,a.id AS catalogue_id,
    coalesce(nullif(s.curriculum_component_ref,''),a.curriculum_component_ref) AS component_ref,
    c.curriculum_module_ref AS module_ref,c.curriculum_group_ref AS group_ref,
    a.source_activity_kind,s.activity_status,s.completed
FROM "Learner".learner_activity_sources s
LEFT JOIN curriculum.source_activities a
  ON a.id=s.source_catalog_activity_id AND a.deleted_at IS NULL
LEFT JOIN curriculum.source_courses c
  ON c.id=a.source_course_id AND c.deleted_at IS NULL
WHERE s.canonical_progress_id=ANY(%s) AND s.deleted_at IS NULL
ORDER BY s.canonical_progress_id,s.id
"""


NEW_SQL = """
SELECT s.canonical_progress_id AS progress_id,
    s.id AS source_id,s.source_system,s.source_activity_id,s.completed,
    c.source_course_ref,c.id AS source_course_id,
    c.source_course_title AS course_title,a.id AS catalogue_id,
    coalesce(nullif(s.curriculum_component_ref,''),a.curriculum_component_ref) AS component_ref,
    c.curriculum_module_ref AS module_ref,c.curriculum_group_ref AS group_ref,
    a.source_activity_kind,s.activity_status,s.completed
FROM "Learner".learner_activity_sources s
LEFT JOIN curriculum.source_activities a
  ON a.id=s.source_catalog_activity_id AND a.deleted_at IS NULL
LEFT JOIN curriculum.source_courses c
  ON c.id=a.source_course_id AND c.deleted_at IS NULL
WHERE s.learner_id=ANY(%s) AND s.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM "Learner".learner_progress_entries p
    WHERE p.id=s.canonical_progress_id
      AND p.learner_id=ANY(%s) AND p.deleted_at IS NULL
  )
ORDER BY s.canonical_progress_id,s.id
"""


def direct_test_url() -> tuple[str, str]:
    raw = os.environ.get("LMS_IDEAL_TEST", "").strip()
    expected = os.environ.get("PHASE4E_EXPECTED_ENDPOINT_ID", "").strip()
    if not raw or not expected:
        raise SystemExit("LMS_IDEAL_TEST and PHASE4E_EXPECTED_ENDPOINT_ID are required")
    parsed = urlsplit(raw)
    host = (parsed.hostname or "").lower()
    allowed = {
        f"{expected}.eu-west-2.aws.neon.tech",
        f"{expected}-pooler.eu-west-2.aws.neon.tech",
    }
    if host not in allowed:
        raise SystemExit("LMS_IDEAL_TEST does not match the approved endpoint")
    direct_host = host.replace("-pooler.", ".")
    return raw.replace(f"{expected}-pooler.", f"{expected}.", 1), direct_host


def percentile(values, proportion):
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, ceil(len(ordered) * proportion) - 1))]


def execute(cur, sql, params):
    started = perf_counter()
    cur.execute(sql, params)
    rows = cur.fetchall()
    return rows, (perf_counter() - started) * 1000


def plan_metrics(cur, sql, params):
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
                "rows_examined": 0,
                "shared_hit_blocks": 0,
                "shared_read_blocks": 0,
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


def serialize_size(rows):
    started = perf_counter()
    raw = json.dumps(rows, default=str, separators=(",", ":")).encode()
    elapsed_ms = (perf_counter() - started) * 1000
    return len(raw), len(gzip.compress(raw)), elapsed_ms


def representative_profiles(cur):
    cur.execute("""
        SELECT learner_id,count(*)::int AS progress_count
        FROM "Learner".learner_progress_entries
        WHERE deleted_at IS NULL
        GROUP BY learner_id
    """)
    population = [(int(learner_id), int(count)) for learner_id, count in cur.fetchall()]
    selected = []
    used = set()
    for label, target in (("small", 50), ("median", 357), ("p95", 1116), ("maximum", 3617)):
        learner_id, count = min(
            (item for item in population if item[0] not in used),
            key=lambda item: (abs(item[1] - target), item[1]),
        )
        used.add(learner_id)
        selected.append((label, learner_id, count))
    return selected


def relationship_counts(cur, learner_id):
    cur.execute("""
        SELECT
          (SELECT count(*) FROM "Learner".learner_activity_sources s
             JOIN "Learner".learner_progress_entries p ON p.id=s.canonical_progress_id
           WHERE p.learner_id=%s AND p.deleted_at IS NULL AND s.deleted_at IS NULL),
          (SELECT count(*) FROM "Learner".learner_progress_ksbs k
             JOIN "Learner".learner_progress_entries p ON p.id=k.progress_id
           WHERE p.learner_id=%s AND p.deleted_at IS NULL),
          (SELECT count(*) FROM "Learner".learner_activity_reporting_segments seg
             JOIN "Learner".learner_progress_entries p ON p.id=seg.progress_id
           WHERE p.learner_id=%s AND p.deleted_at IS NULL),
          (SELECT count(*) FROM "Learner".learner_journal_rows j
           WHERE j.canonical_learner_id=%s AND j.deleted_at IS NULL)
    """, [learner_id, learner_id, learner_id, learner_id])
    sources, ksbs, segments, journals = cur.fetchone()
    return {
        "activity_sources": int(sources),
        "ksbs": int(ksbs),
        "segments": int(segments),
        "journal_rows": int(journals),
    }


def main():
    dsn, direct_host = direct_test_url()
    iterations = int(os.environ.get("PHASE4E_ITERATIONS", "20"))
    with psycopg.connect(dsn, connect_timeout=10) as connection:
        with connection.cursor() as cur:
            cur.execute("SET TRANSACTION READ ONLY")
            cur.execute("SET LOCAL statement_timeout='15000ms'")
            cur.execute("""SELECT current_database(),current_setting('transaction_read_only'),
                current_setting('server_version'),pg_is_in_recovery()""")
            database, read_only, server_version, in_recovery = cur.fetchone()
            results = []
            for label, learner_id, progress_count in representative_profiles(cur):
                cur.execute("""SELECT id FROM "Learner".learner_progress_entries
                    WHERE learner_id=%s AND deleted_at IS NULL ORDER BY id""", [learner_id])
                progress_ids = [row[0] for row in cur.fetchall()]
                old_rows, _ = execute(cur, OLD_SQL, [progress_ids])
                new_rows, _ = execute(cur, NEW_SQL, [[learner_id], [learner_id]])
                if old_rows != new_rows:
                    raise AssertionError(f"activity-source parity failed for {label}")

                old_wall, new_wall = [], []
                for iteration in range(iterations):
                    if iteration % 2:
                        new_rows, new_ms = execute(cur, NEW_SQL, [[learner_id], [learner_id]])
                        old_rows, old_ms = execute(cur, OLD_SQL, [progress_ids])
                    else:
                        old_rows, old_ms = execute(cur, OLD_SQL, [progress_ids])
                        new_rows, new_ms = execute(cur, NEW_SQL, [[learner_id], [learner_id]])
                    if old_rows != new_rows:
                        raise AssertionError(f"warm activity-source parity failed for {label}")
                    old_wall.append(old_ms)
                    new_wall.append(new_ms)

                raw_bytes, gzip_bytes, serialization_ms = serialize_size(new_rows)
                results.append({
                    "shape": label,
                    "progress_entries": progress_count,
                    "relationships": relationship_counts(cur, learner_id),
                    "returned_source_rows": len(new_rows),
                    "iterations": iterations,
                    "parity": True,
                    "sql_count": {"before": 1, "after": 1},
                    "before": {
                        "client_wall_p50_ms": round(median(old_wall), 3),
                        "client_wall_p95_ms": round(percentile(old_wall, .95), 3),
                        "plan": plan_metrics(cur, OLD_SQL, [progress_ids]),
                    },
                    "after": {
                        "client_wall_p50_ms": round(median(new_wall), 3),
                        "client_wall_p95_ms": round(percentile(new_wall, .95), 3),
                        "plan": plan_metrics(cur, NEW_SQL, [[learner_id], [learner_id]]),
                    },
                    "median_change_percent": round(
                        ((median(new_wall) - median(old_wall)) / median(old_wall)) * 100, 2
                    ) if median(old_wall) else 0,
                    "sql_result_serialization": {
                        "python_ms": round(serialization_ms, 4),
                        "raw_bytes": raw_bytes,
                        "gzip_bytes": gzip_bytes,
                    },
                })
            print(json.dumps({
                "classification": "ISOLATED POSTGRESQL MEASUREMENT",
                "database": database,
                "server_version": server_version,
                "transaction_read_only": read_only,
                "in_recovery": in_recovery,
                "direct_endpoint_id": direct_host.split(".", 1)[0],
                "sql_fingerprints": {
                    "before": sha256(" ".join(OLD_SQL.split()).encode()).hexdigest()[:16],
                    "after": sha256(" ".join(NEW_SQL.split()).encode()).hexdigest()[:16],
                },
                "results": results,
                "limitations": [
                    "Measurements cover the activity-source SQL used by metrics_bulk, not total endpoint latency.",
                    "Serialized bytes cover this SQL result only, not an HTTP response.",
                    "Client wall includes the remote network round trip.",
                ],
            }, indent=2))


if __name__ == "__main__":
    main()
