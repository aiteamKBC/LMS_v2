"""Soft-correct cross-source duplicate hours from Sharon AI reconciliation run 1266.

The original import created Aptem evidence rows without checking whether the same
event already existed in accepted Journal data.  This command is deliberately
scoped to run 1266 and the seven Sharon learners.  It previews exact Journal
lineage matches and attendance evidence on a day that already has accepted
Journal attendance.  ``--apply`` requires the reviewed database and fingerprint.
No source, evidence document, progress row, or reporting segment is deleted.
Duplicate rows are retained with zero accepted seconds and a correction audit
run so the original lineage remains inspectable.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

GROUP_ID = "GROUP-202609210905110684506B246BDED88E"
MODULE_ID = "MOD-20260921085233798880517CB0D243D0"
SOURCE_RUN_ID = 1266
ROSTER = {
    4342: "John McCarthy",
    4443: "Amy Wilkinson",
    4579: "Kiley Brown",
    4605: "Cheska Hardie",
    4660: "Joseph Shemeld",
    4925: "Elisei Sergevnin",
    5053: "Leigh Millington",
}


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def db_url() -> str:
    values = dict(os.environ)
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return next(values[k] for k in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL") if values.get(k))


def candidate_rows(cur) -> list[dict[str, Any]]:
    return cur.execute(
        '''
        WITH run AS (
          SELECT s.id AS source_id,s.learner_id,s.aptem_id,s.canonical_progress_id,
                 s.actual_seconds,s.source_started_at,s.source_ended_at,
                 e.evidence_id,e.spent_time,e.component_name,e.evidence_name,
                 lower(concat_ws(' ',e.component_name,e.evidence_name,e.hours_type))
                   LIKE ANY(ARRAY['%%attendance%%','%%lecture%%']) AS is_attendance,
                 (s.source_started_at AT TIME ZONE 'Europe/London')::date AS run_day
          FROM "Learner".learner_activity_sources s
          JOIN fetching_evidence.evidence_items e
            ON e.evidence_id=substring(s.source_activity_id FROM 10)::bigint
          WHERE s.aptem_id=ANY(%s) AND s.source_activity_id LIKE 'evidence:%%'
            AND s.sync_run_id=%s AND s.deleted_at IS NULL
            AND s.accepted AND coalesce(s.actual_seconds,0)>0
        ), direct AS (
          SELECT DISTINCT r.source_id
          FROM run r
          JOIN "Learner".learner_journal_rows j
            ON j.aptem_id=r.aptem_id AND j.accepted AND j.deleted_at IS NULL
           AND j.source_ref LIKE '%%evidence:'||r.evidence_id::text||'%%'
        ), same_day_attendance AS (
          SELECT DISTINCT r.source_id
          FROM run r
          JOIN "Learner".learner_journal_rows j
            ON j.aptem_id=r.aptem_id AND j.activity_date=r.run_day
           AND j.category='attendance' AND j.accepted AND j.deleted_at IS NULL
          WHERE r.is_attendance
        )
        SELECT r.*,
               CASE WHEN d.source_id IS NOT NULL THEN 'journal_lineage'
                    WHEN a.source_id IS NOT NULL THEN 'attendance_same_day' END AS reason,
               p.actual_seconds AS progress_actual_seconds,
               p.accepted AS progress_accepted,
               p.activity_status AS progress_status,
               p.ssot_created_at AS progress_created_at
        FROM run r
        LEFT JOIN direct d USING(source_id)
        LEFT JOIN same_day_attendance a USING(source_id)
        LEFT JOIN "Learner".learner_progress_entries p ON p.id=r.canonical_progress_id
        WHERE d.source_id IS NOT NULL OR a.source_id IS NOT NULL
        ORDER BY r.aptem_id,r.source_id
        ''',
        [list(ROSTER), SOURCE_RUN_ID],
    ).fetchall()


def segment_matches(cur, rows: list[dict[str, Any]]) -> dict[int, int]:
    """Return one-to-one segment IDs for run-created segments.

    New progress rows from run 1266 have their duration on the parent row, while
    attached evidence has a segment.  Matching by the exact source window and
    duration avoids touching a pre-existing segment for the same component.
    """
    matches: dict[int, int] = {}
    for row in rows:
        if not row["canonical_progress_id"]:
            continue
        segs = cur.execute(
            '''SELECT id,actual_seconds,reporting_started_at,reporting_ended_at
               FROM "Learner".learner_activity_reporting_segments
               WHERE progress_id=%s AND sync_run_id=%s AND actual_seconds>0
               ORDER BY id''',
            [row["canonical_progress_id"], SOURCE_RUN_ID],
        ).fetchall()
        for seg in segs:
            if seg["id"] in matches.values():
                continue
            if (
                int(seg["actual_seconds"]) == int(row["actual_seconds"])
                and seg["reporting_started_at"] == row["source_started_at"]
                and seg["reporting_ended_at"] == row["source_ended_at"]
            ):
                matches[row["source_id"]] = seg["id"]
                break
    return matches


def plan(cur) -> dict[str, Any]:
    run = cur.execute(
        '''SELECT id,run_key,run_kind,status,dry_run,result_counts
           FROM "Learner".activity_sync_runs WHERE id=%s''',
        [SOURCE_RUN_ID],
    ).fetchone()
    if not run or run["status"] != "completed" or run["dry_run"]:
        raise ValueError("Source reconciliation run 1266 is not a completed write run.")
    rows = candidate_rows(cur)
    matches = segment_matches(cur, rows)
    duplicate_by_learner: dict[int, int] = defaultdict(int)
    correction_by_learner: dict[int, int] = defaultdict(int)
    duplicate_by_progress: dict[int, int] = defaultdict(int)
    reason_counts: dict[str, int] = defaultdict(int)
    for row in rows:
        seconds = int(row["actual_seconds"])
        duplicate_by_learner[row["aptem_id"]] += seconds
        correction_by_learner[row["aptem_id"]] += seconds - (1 if row["source_id"] in matches else 0)
        duplicate_by_progress[row["canonical_progress_id"]] += seconds - (1 if row["source_id"] in matches else 0)
        reason_counts[row["reason"]] += 1

    owners = cur.execute(
        '''SELECT id,aptem_id FROM "Learner".learners WHERE aptem_id=ANY(%s)''',
        [list(ROSTER)],
    ).fetchall()
    owner_ids = {row["aptem_id"]: row["id"] for row in owners}
    if len(owner_ids) != len(ROSTER):
        raise ValueError("Sharon roster invariant failed while preparing correction.")
    before_rows = cur.execute(
        '''SELECT l.aptem_id,coalesce(sum(p.actual_seconds) FILTER (WHERE p.accepted),0) AS seconds
           FROM "Learner".learners l
           LEFT JOIN "Learner".learner_progress_entries p
             ON p.learner_id=l.id AND p.deleted_at IS NULL
           WHERE l.aptem_id=ANY(%s) GROUP BY l.aptem_id''',
        [list(ROSTER)],
    ).fetchall()
    before = {row["aptem_id"]: int(row["seconds"]) for row in before_rows}
    after = {aptem_id: before.get(aptem_id, 0) - correction_by_learner.get(aptem_id, 0) for aptem_id in ROSTER}
    report = {
        "group_id": GROUP_ID,
        "module_id": MODULE_ID,
        "source_run_id": SOURCE_RUN_ID,
        "candidate_count": len(rows),
        "candidate_seconds": sum(int(row["actual_seconds"]) for row in rows),
        "candidate_hours": str(Decimal(sum(int(row["actual_seconds"]) for row in rows)) / Decimal(3600)),
        "corrected_seconds": sum(correction_by_learner.values()),
        "corrected_hours": str(Decimal(sum(correction_by_learner.values())) / Decimal(3600)),
        "reason_counts": dict(sorted(reason_counts.items())),
        "learners": [
            {
                "aptem_id": aptem_id,
                "name": ROSTER[aptem_id],
                "before_seconds": before.get(aptem_id, 0),
                "duplicate_seconds": duplicate_by_learner.get(aptem_id, 0),
                "corrected_seconds": correction_by_learner.get(aptem_id, 0),
                "after_seconds": after[aptem_id],
            }
            for aptem_id in sorted(ROSTER)
        ],
        "sources": [
            {
                "source_id": row["source_id"],
                "aptem_id": row["aptem_id"],
                "evidence_id": row["evidence_id"],
                "progress_id": row["canonical_progress_id"],
                "seconds": int(row["actual_seconds"]),
                "correction_seconds": int(row["actual_seconds"]) - (1 if row["source_id"] in matches else 0),
                "reason": row["reason"],
                "segment_id": matches.get(row["source_id"]),
            }
            for row in rows
        ],
    }
    report["fingerprint"] = digest(report)
    return report


def apply(cur, report: dict[str, Any]) -> dict[str, Any]:
    if report["candidate_count"] == 0:
        raise ValueError("No active duplicate candidates remain for run 1266.")
    run_id = cur.execute(
        '''INSERT INTO "Learner".activity_sync_runs
           (run_key,run_kind,status,dry_run,source_counts,result_counts)
           VALUES (%s,%s,'running',false,%s,%s) RETURNING id''',
        [
            "sharon-ai-run1266-duplicate-correction:" + report["fingerprint"],
            "scoped-duplicate-correction",
            Jsonb({"group_id": GROUP_ID, "module_id": MODULE_ID, "source_run_id": SOURCE_RUN_ID,
                   "candidate_count": report["candidate_count"]}),
            Jsonb({"planned_sources": report["candidate_count"]}),
        ],
    ).fetchone()["id"]
    sources = report["sources"]
    progress_seconds: dict[int, int] = defaultdict(int)
    for source in sources:
        if source["progress_id"] is not None:
            progress_seconds[source["progress_id"]] += source["correction_seconds"]
    source_ids = [source["source_id"] for source in sources]
    segment_audit: list[dict[str, Any]] = []
    for source in sources:
        if source["segment_id"] is None:
            continue
        old = cur.execute(
            '''SELECT reporting_started_at,reporting_ended_at,actual_seconds
               FROM "Learner".learner_activity_reporting_segments WHERE id=%s FOR UPDATE''',
            [source["segment_id"]],
        ).fetchone()
        if not old:
            raise ValueError(f"Segment {source['segment_id']} disappeared during apply.")
        segment_audit.append({
            "segment_id": source["segment_id"],
            "reporting_started_at": str(old["reporting_started_at"]),
            "reporting_ended_at": str(old["reporting_ended_at"]),
            "actual_seconds": int(old["actual_seconds"]),
        })
        # The table enforces an exact-positive-duration interval. Keep the
        # original row as an auditable one-second tombstone instead of deleting
        # it or violating that invariant.
        cur.execute(
            '''UPDATE "Learner".learner_activity_reporting_segments
               SET actual_seconds=1,reporting_ended_at=reporting_started_at+interval '1 second',
                   sync_run_id=%s,updated_at=now() WHERE id=%s''',
            [run_id, source["segment_id"]],
        )
    for source in sources:
        cur.execute(
            '''UPDATE "Learner".learner_activity_sources
               SET actual_seconds=0,actual_basis=%s,accepted=false,activity_status='Referred',
                   completed=false,sync_run_id=%s,last_seen_at=now(),
                   source_payload=source_payload || %s
               WHERE id=%s AND deleted_at IS NULL AND sync_run_id=%s''',
            [
                "reconciliation:duplicate-journal-correction",
                run_id,
                Jsonb({"reconciliation": {"duplicate_correction_run_id": run_id,
                                          "duplicate_reason": source["reason"],
                                          "duplicate_of_source_run_id": SOURCE_RUN_ID,
                                          "duplicate_of_evidence_id": source["evidence_id"]}}),
                source["source_id"], SOURCE_RUN_ID,
            ],
        )
    for progress_id, duplicate_seconds in progress_seconds.items():
        cur.execute(
            '''UPDATE "Learner".learner_progress_entries
               SET actual_seconds=GREATEST(coalesce(actual_seconds,0)-%s,0),
                   accepted=(GREATEST(coalesce(actual_seconds,0)-%s,0)>0),
                   activity_status=CASE WHEN GREATEST(coalesce(actual_seconds,0)-%s,0)>0
                                        THEN 'Accepted' ELSE 'Referred' END,
                   actual_basis=%s,sync_run_id=%s,ssot_updated_at=now()
               WHERE id=%s AND deleted_at IS NULL''',
            [duplicate_seconds, duplicate_seconds, duplicate_seconds,
             "reconciliation:duplicate-journal-correction", run_id, progress_id],
        )
    result = {
        "corrected_sources": len(source_ids),
        "corrected_segments": sum(1 for source in sources if source["segment_id"] is not None),
        "corrected_progress": len(progress_seconds),
        "detected_duplicate_seconds": report["candidate_seconds"],
        "detected_duplicate_hours": report["candidate_hours"],
        "corrected_seconds": report["corrected_seconds"],
        "corrected_hours": report["corrected_hours"],
        "segment_tombstones": segment_audit,
        "by_learner": {
            str(learner["aptem_id"]): {
                "name": learner["name"],
                "detected_seconds": learner["duplicate_seconds"],
                "detected_hours": str(Decimal(learner["duplicate_seconds"]) / Decimal(3600)),
                "corrected_seconds": learner["corrected_seconds"],
                "corrected_hours": str(Decimal(learner["corrected_seconds"]) / Decimal(3600)),
            }
            for learner in report["learners"] if learner["duplicate_seconds"]
        },
    }
    cur.execute(
        '''UPDATE "Learner".activity_sync_runs
           SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s
           WHERE id=%s''',
        [Jsonb(result), run_id],
    )
    return {"run_id": run_id, **result}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(db_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=5000")
            database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            report = plan(cur)
            if not args.apply:
                print(json.dumps({**report, "database": database}, default=str, indent=2))
                return
            if database != args.expected_database:
                raise ValueError("Database differs from reviewed preview.")
            if report["fingerprint"] != args.expected_fingerprint:
                raise ValueError("Data changed since preview; preview again before applying.")
            for aptem_id in ROSTER:
                owner = cur.execute('SELECT id FROM "Learner".learners WHERE aptem_id=%s', [aptem_id]).fetchone()
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('sharon-ai-run1266-duplicate-correction'),%s::integer)", [owner["id"]])
            print(json.dumps({"database": database, "preview": report, "applied": apply(cur, report)}, default=str, indent=2))


if __name__ == "__main__":
    main()
