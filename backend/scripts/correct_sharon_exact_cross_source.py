"""Soft-correct exact Aptem/Journal overlaps for the Sharon AI groups.

Only rows with an exact Evidence lineage and equal duration are eligible. The
original source, progress row, evidence and Journal row remain queryable; the
Aptem contribution is marked Referred/zeroed and the Journal contribution is
retained as the canonical actual. Ambiguous and duration-conflict rows are
reported but never changed by this command.
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

RUN_KIND = "sharon-exact-cross-source-correction-v1"
BASIS = "reconciliation:confirmed-aptem-journal-duplicate"
ROSTER = {
    4002, 4110, 4124, 4256, 4275, 4311, 4316, 4317, 4336, 4342,
    4365, 4443, 4445, 4490, 4513, 4521, 4526, 4579, 4605, 4626,
    4660, 4737, 4778, 4783, 4830, 4841, 4886, 4925, 4929, 4937,
    4947, 4988, 5053, 5167, 5170, 5256, 5323,
}
GROUPS = {
    "G1-Sharon Ai in Marketing Tuesday": {4002, 4336, 4365, 4445, 4490, 4521, 4526, 4626, 4783, 4841, 4886, 4937, 4947, 4988, 5170},
    "G2-Sharon Ai in Marketing Wednesday": {4342, 4443, 4579, 4605, 4660, 4925, 5053},
    "G3-Sharon Ai in Marketing Friday": {4110, 4124, 4256, 4275, 4311, 4316, 4317, 4513, 4737, 4778, 4830, 4929, 5167, 5256, 5323},
}


def db_url() -> str:
    values = dict(os.environ)
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return next(values[k] for k in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL") if values.get(k))


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def group_for(aptem_id: int) -> str:
    for name, ids in GROUPS.items():
        if aptem_id in ids:
            return name
    return "OUT_OF_SCOPE"


def plan(cur) -> dict[str, Any]:
    rows = cur.execute(
        r'''
        WITH run AS (
          SELECT s.id source_id,s.aptem_id,s.sync_run_id,s.canonical_progress_id,
                 s.actual_seconds source_seconds,s.source_activity_id,
                 e.evidence_id,e.component_name,e.evidence_name,
                 p.actual_seconds progress_seconds,p.accepted progress_accepted,
                 p.activity_status progress_status,p.source_system progress_source,
                 count(*) OVER (PARTITION BY s.canonical_progress_id) parent_source_count
          FROM "Learner".learner_activity_sources s
          JOIN fetching_evidence.evidence_items e ON e.evidence_id=substring(s.source_activity_id FROM 10)::bigint
          LEFT JOIN "Learner".learner_progress_entries p ON p.id=s.canonical_progress_id
          WHERE s.aptem_id=ANY(%s) AND s.source_system='aptem' AND s.deleted_at IS NULL
            AND s.accepted AND s.actual_seconds>0
        ), journal AS (
          SELECT r.source_id,count(*) journal_rows,sum(j.actual_hours)::numeric journal_hours,
                 array_agg(j.id ORDER BY j.id) journal_ids
          FROM run r JOIN "Learner".learner_journal_rows j
            ON j.aptem_id=r.aptem_id AND j.accepted AND j.deleted_at IS NULL
           AND (j.source_ref LIKE '%%evidence:'||r.evidence_id::text||'%%'
                OR j.source_ref LIKE '%%ev:'||r.evidence_id::text||'%%')
          GROUP BY r.source_id
        ), seg AS (
          SELECT r.source_id,count(seg.id) segment_count,
                 coalesce(sum(seg.actual_seconds),0)::bigint segment_seconds,
                 array_agg(seg.id ORDER BY seg.id) FILTER (WHERE seg.id IS NOT NULL) segment_ids,
                 bool_and(seg.reporting_started_at IS NOT NULL) FILTER (WHERE seg.id IS NOT NULL) segments_have_start
          FROM run r LEFT JOIN "Learner".learner_activity_reporting_segments seg
            ON seg.progress_id=r.canonical_progress_id
          GROUP BY r.source_id
        )
        SELECT r.*,j.journal_rows,j.journal_hours,j.journal_ids,
               seg.segment_count,seg.segment_seconds,seg.segment_ids,seg.segments_have_start,
               CASE WHEN r.source_seconds=round(j.journal_hours*3600)::bigint THEN 'EXACT_DURATION' ELSE 'DURATION_CONFLICT' END duration_status,
               CASE WHEN r.progress_source='aptem' AND r.progress_accepted AND r.parent_source_count=1
                         AND r.progress_seconds=r.source_seconds
                         AND (seg.segment_count=0 OR (seg.segment_count=1 AND seg.segment_seconds=r.source_seconds AND seg.segments_have_start))
                    THEN true ELSE false END applyable
        FROM run r JOIN journal j USING(source_id) JOIN seg USING(source_id)
        ORDER BY r.aptem_id,r.source_id
        ''', [list(sorted(ROSTER))]).fetchall()
    candidates = []
    review = []
    for row in rows:
        item = {k: row[k] for k in row.keys()}
        item["group"] = group_for(int(item["aptem_id"]))
        if item["duration_status"] == "EXACT_DURATION" and item["applyable"]:
            candidates.append(item)
        else:
            review.append(item)
    before = cur.execute(
        '''SELECT l.aptem_id,coalesce(sum(p.actual_seconds) FILTER (WHERE p.accepted),0)::bigint seconds
           FROM "Learner".learners l LEFT JOIN "Learner".learner_progress_entries p
             ON p.learner_id=l.id AND p.deleted_at IS NULL
          WHERE l.aptem_id=ANY(%s) GROUP BY l.aptem_id ORDER BY l.aptem_id''',
        [list(sorted(ROSTER))],
    ).fetchall()
    report = {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "run_kind": RUN_KIND,
        "scope": sorted(ROSTER),
        "candidate_count": len(candidates),
        "candidate_seconds": sum(int(x["source_seconds"]) for x in candidates),
        "review_count": len(review),
        "review_seconds": sum(int(x["source_seconds"] or 0) for x in review),
        "candidates": candidates,
        "review": review,
        "before": {str(int(r["aptem_id"])): int(r["seconds"]) for r in before},
    }
    report["fingerprint"] = digest(report)
    return report


def apply(cur, report: dict[str, Any]) -> dict[str, Any]:
    existing = cur.execute(
        'SELECT id,status,result_counts FROM "Learner".activity_sync_runs WHERE run_key=%s',
        [RUN_KIND + ":" + report["fingerprint"]],
    ).fetchone()
    if existing and existing["status"] == "completed":
        return {"run_id": int(existing["id"]), "idempotent_replay": True, **(existing["result_counts"] or {})}
    if existing:
        raise RuntimeError(f"Existing run {existing['id']} is {existing['status']}; refusing to continue.")
    owner_rows = cur.execute('SELECT id,aptem_id FROM "Learner".learners WHERE aptem_id=ANY(%s)', [list(sorted(ROSTER))]).fetchall()
    owner_ids = {int(r["aptem_id"]): int(r["id"]) for r in owner_rows}
    if len(owner_ids) != len(ROSTER):
        raise RuntimeError("Roster invariant failed.")
    for aptem_id in sorted(ROSTER):
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s),%s::integer)", [RUN_KIND, owner_ids[aptem_id]])
    run_id = cur.execute(
        '''INSERT INTO "Learner".activity_sync_runs
           (run_key,run_kind,status,dry_run,source_counts,result_counts)
           VALUES (%s,%s,'running',false,%s,%s) RETURNING id''',
        [RUN_KIND + ":" + report["fingerprint"], RUN_KIND,
         Jsonb({"scope": report["scope"], "candidate_count": report["candidate_count"], "review_count": report["review_count"]}),
         Jsonb({})],
    ).fetchone()["id"]
    by_learner: dict[int, int] = defaultdict(int)
    corrected = []
    for item in report["candidates"]:
        source = cur.execute(
            '''SELECT id,actual_seconds,accepted,deleted_at,canonical_progress_id,source_payload
                 FROM "Learner".learner_activity_sources WHERE id=%s FOR UPDATE''', [item["source_id"]]
        ).fetchone()
        if not source or source["deleted_at"] is not None or not source["accepted"] or int(source["actual_seconds"] or 0) != int(item["source_seconds"]):
            raise RuntimeError(f"Source {item['source_id']} changed since preview.")
        progress = cur.execute(
            '''SELECT id,actual_seconds,accepted,deleted_at,source_system,source_payload
                 FROM "Learner".learner_progress_entries WHERE id=%s FOR UPDATE''', [item["canonical_progress_id"]]
        ).fetchone()
        if not progress or progress["deleted_at"] is not None or not progress["accepted"] or progress["source_system"] != "aptem" or int(progress["actual_seconds"] or 0) != int(item["progress_seconds"]):
            raise RuntimeError(f"Progress {item['canonical_progress_id']} changed since preview.")
        segment_id = None
        if int(item["segment_count"] or 0) == 1:
            segment_id = int(item["segment_ids"][0])
            seg = cur.execute(
                '''SELECT id,actual_seconds,reporting_started_at FROM "Learner".learner_activity_reporting_segments WHERE id=%s FOR UPDATE''', [segment_id]
            ).fetchone()
            if not seg or int(seg["actual_seconds"] or 0) != int(item["source_seconds"]) or seg["reporting_started_at"] is None:
                raise RuntimeError(f"Segment {segment_id} changed since preview.")
            cur.execute(
                '''UPDATE "Learner".learner_activity_reporting_segments
                      SET actual_seconds=1,reporting_ended_at=reporting_started_at+interval '1 second',sync_run_id=%s,updated_at=now()
                    WHERE id=%s''', [run_id, segment_id]
            )
        audit = Jsonb({"reconciliation": {
            "duplicate_correction_run_id": run_id,
            "duplicate_reason": "exact Aptem Evidence lineage already represented by accepted Journal",
            "evidence_id": int(item["evidence_id"]),
            "journal_row_ids": [int(x) for x in (item["journal_ids"] or [])],
            "previous_actual_seconds": int(item["source_seconds"]),
            "source_sync_run_id": int(item["sync_run_id"]),
        }})
        cur.execute(
            '''UPDATE "Learner".learner_activity_sources
                  SET actual_seconds=0,actual_basis=%s,accepted=false,activity_status='Referred',completed=false,
                      sync_run_id=%s,last_seen_at=now(),source_payload=coalesce(source_payload,'{}'::jsonb)||%s
                WHERE id=%s''', [BASIS, run_id, audit, item["source_id"]]
        )
        cur.execute(
            '''UPDATE "Learner".learner_progress_entries
                  SET actual_seconds=0,actual_basis=%s,accepted=false,activity_status='Referred',
                      sync_run_id=%s,ssot_updated_at=now(),source_payload=coalesce(source_payload,'{}'::jsonb)||%s
                WHERE id=%s''', [BASIS, run_id, audit, item["canonical_progress_id"]]
        )
        by_learner[int(item["aptem_id"])] += int(item["source_seconds"])
        corrected.append({"source_id": int(item["source_id"]), "progress_id": int(item["canonical_progress_id"]), "segment_id": segment_id, "aptem_id": int(item["aptem_id"]), "evidence_id": int(item["evidence_id"]), "seconds": int(item["source_seconds"]), "journal_row_ids": [int(x) for x in (item["journal_ids"] or [])]})
    after_rows = cur.execute(
        '''SELECT l.aptem_id,coalesce(sum(p.actual_seconds) FILTER (WHERE p.accepted),0)::bigint seconds
             FROM "Learner".learners l LEFT JOIN "Learner".learner_progress_entries p
               ON p.learner_id=l.id AND p.deleted_at IS NULL
            WHERE l.aptem_id=ANY(%s) GROUP BY l.aptem_id ORDER BY l.aptem_id''',
        [list(sorted(ROSTER))],
    ).fetchall()
    after_by_learner = {int(r["aptem_id"]): int(r["seconds"]) for r in after_rows}
    result = {
        "run_id": int(run_id),
        "corrected_count": len(corrected),
        "corrected_seconds": sum(by_learner.values()),
        "corrected_hours": str(Decimal(sum(by_learner.values())) / Decimal(3600)),
        "by_learner": {str(k): {"corrected_seconds": v, "corrected_hours": str(Decimal(v) / Decimal(3600)), "before_seconds": report["before"].get(str(k), 0), "after_seconds": after_by_learner.get(k, 0)} for k, v in sorted(by_learner.items())},
        "corrected": corrected,
        "review_count": report["review_count"],
        "review_seconds": report["review_seconds"],
    }
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run_id])
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-database')
    parser.add_argument('--expected-fingerprint')
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error('--apply requires --expected-database and --expected-fingerprint')
    try:
        import sys
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    with psycopg.connect(db_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute('SET LOCAL statement_timeout=120000')
            cur.execute('SET LOCAL lock_timeout=5000')
            report = plan(cur)
            if not args.apply:
                print(json.dumps(report, default=str, ensure_ascii=False, indent=2))
                return
            database = report['database']
            if database != args.expected_database or report['fingerprint'] != args.expected_fingerprint:
                raise RuntimeError('Database or plan fingerprint changed; preview again before applying.')
            print(json.dumps({'preview': {'candidate_count': report['candidate_count'], 'candidate_seconds': report['candidate_seconds'], 'review_count': report['review_count'], 'review_seconds': report['review_seconds'], 'fingerprint': report['fingerprint']}, 'applied': apply(cur, report)}, default=str, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
