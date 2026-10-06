"""Correct two confirmed duplicate Aptem source rows for Nicholas Banks.

Evidence 42796 is an older identical upload superseded by 42798; evidence
44393 is an older duplicate of attendance evidence 49786.  The canonical
parents already retain the Journal-backed six-hour and 2.5-hour totals, so
this correction only marks the duplicate Aptem source rows referred/zeroed.
Original rows and payloads remain queryable; no progress or evidence row is
deleted.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

EXPECTED = {
    1078146: {"aptem_id": 4336, "evidence_id": 42796, "seconds": 14400, "parent": 483183},
    1078148: {"aptem_id": 4336, "evidence_id": 44393, "seconds": 9000, "parent": 483188},
}
RUN_KIND = "sharon-confirmed-aptem-duplicate-correction-v1"


def db_url() -> str:
    values = dict(os.environ)
    for raw in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return next(values[k] for k in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL") if values.get(k))


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def plan(cur) -> dict[str, Any]:
    rows = cur.execute(
        '''SELECT s.id,s.learner_id,s.aptem_id,s.source_activity_id,s.canonical_progress_id,
                  s.actual_seconds,s.actual_basis,s.accepted,s.activity_status,s.source_payload,
                  e.evidence_id,e.component_id,e.evidence_name,e.file_blob,e.spent_time
           FROM "Learner".learner_activity_sources s
           JOIN fetching_evidence.evidence_items e
             ON e.evidence_id=substring(s.source_activity_id from 10)::bigint
          WHERE s.id=ANY(%s) AND s.deleted_at IS NULL
          ORDER BY s.id''', [list(EXPECTED)]).fetchall()
    if len(rows) != len(EXPECTED):
        raise ValueError("A confirmed duplicate source row is missing or already corrected.")
    items = []
    for row in rows:
        wanted = EXPECTED[int(row["id"])]
        if (int(row["aptem_id"]) != wanted["aptem_id"] or int(row["evidence_id"]) != wanted["evidence_id"]
                or int(row["actual_seconds"] or 0) != wanted["seconds"]
                or int(row["canonical_progress_id"] or 0) != wanted["parent"]
                or not row["accepted"]):
            raise ValueError(f"Duplicate source {row['id']} changed; manual review required.")
        items.append({
            "source_id": int(row["id"]), "aptem_id": int(row["aptem_id"]),
            "evidence_id": int(row["evidence_id"]), "parent_id": int(row["canonical_progress_id"]),
            "seconds": int(row["actual_seconds"]), "evidence_name": row["evidence_name"],
            "component_id": int(row["component_id"]),
        })
    report = {"database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
              "run_kind": RUN_KIND, "sources": items,
              "duplicate_seconds": sum(x["seconds"] for x in items)}
    report["fingerprint"] = digest(report)
    return report


def apply(cur, report: dict[str, Any]) -> dict[str, Any]:
    run_id = cur.execute(
        '''INSERT INTO "Learner".activity_sync_runs
           (run_key,run_kind,status,dry_run,source_counts,result_counts)
           VALUES (%s,%s,'running',false,%s,%s) RETURNING id''',
        [RUN_KIND + ":" + report["fingerprint"], RUN_KIND,
         Jsonb({"sources": [x["source_id"] for x in report["sources"]], "evidence_ids": [x["evidence_id"] for x in report["sources"]]}),
         Jsonb({})],
    ).fetchone()["id"]
    corrected = []
    for item in report["sources"]:
        cur.execute(
            '''UPDATE "Learner".learner_activity_sources
                  SET actual_seconds=0,actual_basis=%s,accepted=false,activity_status='Referred',
                      completed=false,sync_run_id=%s,last_seen_at=now(),
                      source_payload=coalesce(source_payload,'{}'::jsonb) || %s
                WHERE id=%s AND deleted_at IS NULL AND accepted IS TRUE
                  AND actual_seconds=%s AND canonical_progress_id=%s
            RETURNING id''',
            ["reconciliation:duplicate-aptem-evidence-correction", run_id,
             Jsonb({"reconciliation": {"duplicate_correction_run_id": run_id,
                                        "duplicate_reason": "identical evidence upload; newer accepted evidence retained",
                                        "duplicate_of_evidence_id": 42798 if item["evidence_id"] == 42796 else 49786,
                                        "previous_actual_seconds": item["seconds"]}}),
             item["source_id"], item["seconds"], item["parent_id"]],
        )
        if cur.fetchone() is None:
            raise ValueError(f"Source {item['source_id']} changed during apply.")
        corrected.append(item["source_id"])
    result = {"corrected_sources": corrected, "corrected_seconds": report["duplicate_seconds"],
              "parents_unchanged": [483183, 483188], "evidence_preserved": [42796, 42798, 44393, 49786]}
    cur.execute('''UPDATE "Learner".activity_sync_runs
                      SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s
                    WHERE id=%s''', [Jsonb(result), run_id])
    return {"run_id": run_id, **result}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    with psycopg.connect(db_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=5000")
            report = plan(cur)
            if args.apply:
                if report["database"] != args.expected_database or report["fingerprint"] != args.expected_fingerprint:
                    raise ValueError("Database or duplicate fingerprint changed; preview again.")
                report["applied"] = apply(cur, report)
            print(json.dumps(report, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
