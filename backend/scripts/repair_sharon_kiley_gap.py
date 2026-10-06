"""Repair the reviewed negative Aptem/SSOT gap for Kiley Brown only.

This is intentionally narrower than the group reconciler.  It records only
explicitly dated sub-allocations read from two Accepted Aptem evidence files;
it does not import Referred, duplicate, or aggregate/unallocated minutes.
Preview is read-only.  Apply requires the preview database and fingerprint.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
GROUP_ID = "GROUP-202609210905110684506B246BDED88E"
MODULE_ID = "MOD-20260921085233798880517CB0D243D0"
APTEM_ID = 4579
LEARNER_NAME = "Kiley Brown"
EVIDENCE_IDS = (38303, 38306)
SOURCE_IDS = (859014, 859016)
PARENT_IDS = (701337, 701339)
CONTAINER = "fetch-aptem-evidences"
BASIS = "aptem:accepted-evidence-explicit-suballocation"
LABEL = "Evidence-backed explicit suballocation"
RUN_KIND = "sharon-kiley-explicit-evidence-gap-v1"
ALLOCATIONS = {
    38303: [
        {"date": "2025-11-06", "start": "11:00", "end": "12:30", "label": "Meeting with Warwick Conferences"},
        {"date": "2025-11-13", "start": "10:00", "end": "12:00", "label": "UK Corporate Games partner/networking meeting"},
    ],
    38306: [
        {"date": "2026-01-23", "start": "10:00", "end": "12:00", "label": "Product review meeting with BDM"},
    ],
}


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def db_url() -> str:
    values = dict(os.environ)
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise RuntimeError("No configured enrolment database")


def insert_row(cur, table: str, values: dict):
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def dt(day: str, clock: str) -> datetime:
    return datetime.combine(date.fromisoformat(day), time.fromisoformat(clock), tzinfo=UK)


def evidence_payload(evidence: dict, evidence_id: int, selected_seconds: int, excluded_seconds: int, segments: list[dict]) -> dict:
    raw = dict(evidence.get("evidence_raw") or {})
    raw["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    if evidence.get("note_content"):
        raw["note_content"] = evidence["note_content"]
    raw["reconciliation"] = {
        "resolution": "explicit_evidence_suballocation",
        "group_id": GROUP_ID,
        "module_id": MODULE_ID,
        "evidence_id": evidence_id,
        "original_spent_seconds": int(evidence["spent_time"]) * 60,
        "selected_seconds": selected_seconds,
        "excluded_unallocated_seconds": excluded_seconds,
        "allocation_label": LABEL,
        "segments": segments,
    }
    return raw


def fetch_plan(cur):
    owner = cur.execute(
        '''SELECT l.id,l.enrolment_id,l.programme_id,l.aptem_id,l.full_name,l.programme
             FROM "Learner".learners l
             JOIN "Learner".learner_training_plan_modules t
               ON t.learner_id=l.id AND t.module_ref=%s
            WHERE l.aptem_id=%s''', [MODULE_ID, APTEM_ID]).fetchone()
    if not owner or owner["full_name"] != LEARNER_NAME:
        raise ValueError("Kiley Brown/module membership invariant failed")
    evidence_rows = cur.execute(
        '''SELECT * FROM fetching_evidence.evidence_items
           WHERE learner_id=%s AND evidence_id=ANY(%s)
           ORDER BY evidence_id''', [APTEM_ID, list(EVIDENCE_IDS)]).fetchall()
    if {int(r["evidence_id"]) for r in evidence_rows} != set(EVIDENCE_IDS):
        raise ValueError("Selected evidence is missing")
    evidence = {int(r["evidence_id"]): r for r in evidence_rows}
    for eid, row in evidence.items():
        if row["evidence_status"] != "Accepted" or row["hours_type"] != "OffTheJobTraining" or row["spent_time_type"] != "PaidWorkingHours":
            raise ValueError(f"Evidence {eid} is not Accepted paid OTJ")
        if date.fromisoformat(str((row.get("completed_date_override") or row.get("completed_date") or row.get("submission_date")).date())) > date(2026, 8, 31):
            raise ValueError(f"Evidence {eid} outside reviewed period")
    sources = cur.execute(
        '''SELECT * FROM "Learner".learner_activity_sources
           WHERE id=ANY(%s) AND learner_id=%s AND deleted_at IS NULL
           ORDER BY id''', [list(SOURCE_IDS), owner["id"]]).fetchall()
    if {int(r["id"]) for r in sources} != set(SOURCE_IDS):
        raise ValueError("Selected active source lineage is missing")
    source_by_eid = {int(str(r["source_activity_id"]).split(":", 1)[1]): r for r in sources}
    for eid in EVIDENCE_IDS:
        if source_by_eid[eid]["canonical_progress_id"] != PARENT_IDS[EVIDENCE_IDS.index(eid)]:
            raise ValueError(f"Source {eid} changed parent")
        if source_by_eid[eid]["actual_seconds"] not in (None, 0):
            raise ValueError(f"Source {eid} already has hours; refusing duplicate write")
    parents = cur.execute(
        '''SELECT * FROM "Learner".learner_progress_entries
           WHERE id=ANY(%s) AND learner_id=%s AND deleted_at IS NULL
           ORDER BY id''', [list(PARENT_IDS), owner["id"]]).fetchall()
    if {int(r["id"]) for r in parents} != set(PARENT_IDS):
        raise ValueError("Selected parent lineage is missing")
    parent_by_id = {int(r["id"]): r for r in parents}
    if parent_by_id[701337]["actual_seconds"] not in (None, 0) or parent_by_id[701339]["actual_seconds"] != 28800:
        raise ValueError("Parent totals changed; refusing to write")
    segments = []
    for eid, blocks in ALLOCATIONS.items():
        for block in blocks:
            start = dt(block["date"], block["start"])
            end = dt(block["date"], block["end"])
            if start.weekday() >= 5 or end <= start or end - start > timedelta(hours=8):
                raise ValueError(f"Invalid allocation for evidence {eid}")
            segments.append({"evidence_id": eid, "date": block["date"], "start": start.isoformat(), "end": end.isoformat(), "seconds": int((end - start).total_seconds()), "label": block["label"]})
    if any(a["date"] == b["date"] and not (a["end"] <= b["start"] or b["end"] <= a["start"]) for i, a in enumerate(segments) for b in segments[i + 1:]):
        raise ValueError("Selected allocations overlap")
    journal_evidence = cur.execute(
        '''SELECT count(*) AS n FROM "Learner".learner_journal_rows
           WHERE canonical_learner_id=%s AND deleted_at IS NULL AND accepted IS TRUE
             AND source_ref LIKE ANY(%s)''', [owner["id"], [f"%%evidence:{eid}%%" for eid in EVIDENCE_IDS]]).fetchone()["n"]
    if journal_evidence:
        raise ValueError("Selected evidence already has accepted Journal lineage")
    before = cur.execute(
        '''SELECT COALESCE(SUM(CASE WHEN s.id IS NOT NULL THEN s.actual_seconds ELSE p.actual_seconds END),0) AS seconds
             FROM "Learner".learner_progress_entries p
             LEFT JOIN "Learner".learner_activity_reporting_segments s ON s.progress_id=p.id
            WHERE p.learner_id=%s AND p.deleted_at IS NULL AND p.accepted IS TRUE
              AND NOT EXISTS (SELECT 1 FROM "Learner".learner_activity_reporting_segments s2 WHERE s2.progress_id=p.id AND s2.id <> s.id)''', [owner["id"]]).fetchone()["seconds"]
    # Same canonical rule used by the application: segments replace a parent
    # total; otherwise the accepted parent seconds are counted once.
    total_row = cur.execute('''SELECT COALESCE(SUM(CASE WHEN EXISTS (
                                  SELECT 1 FROM "Learner".learner_activity_reporting_segments s
                                   WHERE s.progress_id=p.id AND s.learner_id=p.learner_id)
                                THEN (SELECT COALESCE(SUM(s.actual_seconds),0)
                                        FROM "Learner".learner_activity_reporting_segments s
                                       WHERE s.progress_id=p.id AND s.learner_id=p.learner_id)
                                ELSE COALESCE(p.actual_seconds,0) END),0) AS seconds
                              FROM "Learner".learners l
                              JOIN "Learner".learner_progress_entries p ON p.learner_id=l.id
                             WHERE l.aptem_id=%s AND p.deleted_at IS NULL AND p.accepted IS TRUE''', [APTEM_ID]).fetchone()
    before_seconds = int(total_row["seconds"] or 0)
    added = sum(int(s["seconds"]) for s in segments)
    report = {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "learner_id": int(owner["id"]), "aptem_id": APTEM_ID, "name": owner["full_name"],
        "group_id": GROUP_ID, "module_id": MODULE_ID, "evidence_ids": list(EVIDENCE_IDS),
        "source_ids": list(SOURCE_IDS), "parent_ids": list(PARENT_IDS),
        "before_seconds": before_seconds, "added_seconds": added, "after_seconds": before_seconds + added,
        "segments": segments,
        "evidence_original_seconds": {str(eid): int(evidence[eid]["spent_time"]) * 60 for eid in EVIDENCE_IDS},
        "excluded_seconds": {str(eid): int(evidence[eid]["spent_time"]) * 60 - sum(int(s["seconds"]) for s in segments if s["evidence_id"] == eid) for eid in EVIDENCE_IDS},
    }
    report["fingerprint"] = digest(report)
    return owner, evidence, sources, report


def apply(cur, owner, evidence, sources, report, expected_database, expected_fingerprint):
    if report["database"] != expected_database or report["fingerprint"] != expected_fingerprint:
        raise ValueError("Database or reviewed fingerprint changed; preview again")
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [RUN_KIND])
    run_id = insert_row(cur, "activity_sync_runs", {
        "run_key": RUN_KIND + ":" + expected_fingerprint, "run_kind": RUN_KIND,
        "status": "running", "dry_run": False,
        "source_counts": Jsonb({"group_id": GROUP_ID, "module_id": MODULE_ID, "learner": APTEM_ID, "evidence_ids": list(EVIDENCE_IDS)}),
        "result_counts": Jsonb({}),
    })
    max_order = cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner["id"]]).fetchone()["n"]
    source_by_eid = {int(str(r["source_activity_id"]).split(":", 1)[1]): r for r in sources}
    created = []
    segments_by_eid = {eid: [s for s in report["segments"] if s["evidence_id"] == eid] for eid in EVIDENCE_IDS}
    for eid in EVIDENCE_IDS:
        segs = segments_by_eid[eid]
        total = sum(int(s["seconds"]) for s in segs)
        payload = evidence_payload(evidence[eid], eid, total, int(report["excluded_seconds"][str(eid)]), segs)
        max_order += 1
        progress_id = insert_row(cur, "learner_progress_entries", {
            "learner_id": owner["id"], "entry_order": max_order, "kind": "aptem_evidence",
            "module_title": evidence[eid].get("component_name") or evidence[eid].get("evidence_name") or "Aptem evidence",
            "week_title": "", "component_ref": str(evidence[eid].get("component_id") or ""),
            "component_title": evidence[eid].get("component_name") or evidence[eid].get("evidence_name") or "Aptem evidence",
            "component_type": "evidence", "programme_id": owner["programme_id"], "aptem_id": owner["aptem_id"],
            "enrolment_id": owner["enrolment_id"], "source_system": "aptem",
            "source_activity_id": f"evidence:{eid}:explicit-suballocation", "source_attempt_key": f"evidence:{eid}:explicit-suballocation",
            "canonical_activity_key": f"aptem:{APTEM_ID}:evidence:{eid}:explicit-suballocation",
            "activity_status": "Accepted", "accepted": True, "actual_seconds": total, "actual_basis": BASIS,
            "reporting_started_at": datetime.fromisoformat(segs[0]["start"]), "reporting_ended_at": datetime.fromisoformat(segs[-1]["end"]),
            "reporting_month": min(s["date"][:7] for s in segs), "reporting_timestamp_label": LABEL,
            "source_payload": Jsonb(payload), "sync_run_id": run_id,
        })
        created.append(progress_id)
        for order, seg in enumerate(segs, 1):
            insert_row(cur, "learner_activity_reporting_segments", {
                "progress_id": progress_id, "learner_id": owner["id"], "segment_order": order,
                "actual_seconds": seg["seconds"], "reporting_started_at": datetime.fromisoformat(seg["start"]),
                "reporting_ended_at": datetime.fromisoformat(seg["end"]), "reporting_month": seg["date"][:7], "sync_run_id": run_id,
            })
        source = source_by_eid[eid]
        cur.execute('''UPDATE "Learner".learner_activity_sources SET
             canonical_progress_id=%s,actual_seconds=%s,actual_basis=%s,source_started_at=%s,source_ended_at=%s,
             reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,accepted=TRUE,activity_status='Accepted',
             completed=TRUE,source_payload=%s,sync_run_id=%s,last_seen_at=now()
           WHERE id=%s AND deleted_at IS NULL''', [progress_id, total, BASIS,
            datetime.fromisoformat(segs[0]["start"]), datetime.fromisoformat(segs[-1]["end"]),
            datetime.fromisoformat(segs[0]["start"]), datetime.fromisoformat(segs[-1]["end"]),
            min(s["date"][:7] for s in segs), Jsonb(payload), run_id, source["id"]])
        if evidence[eid].get("file_blob"):
            exists = cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents
                                    WHERE source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''', [f"evidence:{eid}:file"]).fetchone()
            if not exists:
                insert_row(cur, "learner_activity_documents", {
                    "learner_id": owner["id"], "progress_id": progress_id, "source_system": "aptem",
                    "source_document_id": f"evidence:{eid}:file", "container": CONTAINER, "blob_name": evidence[eid]["file_blob"],
                    "display_name": evidence[eid].get("evidence_name") or "Aptem evidence",
                    "content_type": mimetypes.guess_type(evidence[eid].get("evidence_name") or "")[0] or "application/octet-stream",
                    "uploaded_at": evidence[eid].get("submission_date"),
                })
    result = {"new_progress_rows": len(created), "progress_ids": created, "segments_written": len(report["segments"]), "source_rows_updated": len(EVIDENCE_IDS), "seconds_written": report["added_seconds"], "evidence_ids": list(EVIDENCE_IDS)}
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run_id])
    return run_id, result


def main():
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
            owner, evidence, sources, report = fetch_plan(cur)
            if args.apply:
                run_id, result = apply(cur, owner, evidence, sources, report, args.expected_database, args.expected_fingerprint)
                report.update({"applied": True, "run_id": run_id, "result": result})
            print(json.dumps(report, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
