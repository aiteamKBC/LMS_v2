"""Soft-correct Kiley Brown's newly-added evidence allocation timestamps.

The first scoped repair used the right 5:30 total but two blocks overlapped
existing Journal timestamps.  This correction replaces only those two new
canonical rows (soft-delete, never hard-delete) with a non-overlapping
allocation of the same 19,800 seconds.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time
import hashlib
import json
import mimetypes
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
APTEM_ID = 4579
LEARNER_ID = 516
EVIDENCE_IDS = (38303, 38306)
OLD_PROGRESS = {38303: 883855, 38306: 883856}
SOURCE_IDS = {38303: 859014, 38306: 859016}
GROUP_ID = "GROUP-202609210905110684506B246BDED88E"
MODULE_ID = "MOD-20260921085233798880517CB0D243D0"
CONTAINER = "fetch-aptem-evidences"
BASIS = "aptem:accepted-evidence-explicit-suballocation-v2"
LABEL = "Evidence-backed explicit suballocation (non-overlapping correction)"
RUN_KIND = "sharon-kiley-explicit-evidence-overlap-correction-v1"
ALLOCATIONS = {
    38303: [
        {"date": "2025-11-06", "start": "11:00", "end": "12:30", "label": "Meeting with Warwick Conferences"},
        {"date": "2025-11-13", "start": "11:00", "end": "12:00", "label": "UK Corporate Games meeting preparation and scheduling"},
    ],
    38306: [
        {"date": "2026-01-23", "start": "12:00", "end": "14:00", "label": "Product review setup, review and follow-up"},
        {"date": "2026-01-29", "start": "15:00", "end": "16:00", "label": "Rory Sutherland LinkedIn session"},
    ],
}


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def db_url():
    values = dict(os.environ)
    for raw in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise RuntimeError("No configured enrolment database")


def insert_row(cur, table, values):
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(",").join(sql.Identifier(k) for k in values), sql.SQL(",").join(sql.Placeholder() for _ in values))
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def dt(day, clock):
    return datetime.combine(date.fromisoformat(day), time.fromisoformat(clock), tzinfo=UK)


def payload(evidence, eid, segments):
    total = sum(int(s["seconds"]) for s in segments)
    raw = dict(evidence.get("evidence_raw") or {})
    raw["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    raw["reconciliation"] = {
        "resolution": "explicit_evidence_suballocation_overlap_correction",
        "group_id": GROUP_ID, "module_id": MODULE_ID, "evidence_id": eid,
        "selected_seconds": total, "allocation_label": LABEL,
        "segments": segments,
    }
    return raw


def plan(cur):
    owner = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE id=%s AND aptem_id=%s', [LEARNER_ID, APTEM_ID]).fetchone()
    if not owner or owner["full_name"] != "Kiley Brown":
        raise ValueError("Kiley owner invariant failed")
    evidence_rows = cur.execute('SELECT * FROM fetching_evidence.evidence_items WHERE learner_id=%s AND evidence_id=ANY(%s)', [APTEM_ID, list(EVIDENCE_IDS)]).fetchall()
    evidence = {int(r["evidence_id"]): r for r in evidence_rows}
    if set(evidence) != set(EVIDENCE_IDS):
        raise ValueError("Evidence invariant failed")
    sources = cur.execute('SELECT * FROM "Learner".learner_activity_sources WHERE id=ANY(%s) AND learner_id=%s AND deleted_at IS NULL', [list(SOURCE_IDS.values()), LEARNER_ID]).fetchall()
    by_eid = {int(str(r["source_activity_id"]).split(":", 1)[1]): r for r in sources}
    if set(by_eid) != set(EVIDENCE_IDS):
        raise ValueError("Source invariant failed")
    old = cur.execute('SELECT * FROM "Learner".learner_progress_entries WHERE id=ANY(%s) AND learner_id=%s AND deleted_at IS NULL', [list(OLD_PROGRESS.values()), LEARNER_ID]).fetchall()
    old_by_eid = {eid: next((r for r in old if int(r["id"]) == pid), None) for eid, pid in OLD_PROGRESS.items()}
    if any(not old_by_eid[eid] for eid in EVIDENCE_IDS):
        raise ValueError("Old progress invariant failed")
    expected = {38303: 12600, 38306: 7200}
    if any(int(by_eid[eid]["actual_seconds"] or 0) != expected[eid] or int(old_by_eid[eid]["actual_seconds"] or 0) != expected[eid] for eid in EVIDENCE_IDS):
        raise ValueError("Current correction rows changed; refusing repeat")
    segments = []
    for eid, blocks in ALLOCATIONS.items():
        for block in blocks:
            start, end = dt(block["date"], block["start"]), dt(block["date"], block["end"])
            segments.append({"evidence_id": eid, "date": block["date"], "start": start.isoformat(), "end": end.isoformat(), "seconds": int((end - start).total_seconds()), "label": block["label"]})
    if sum(s["seconds"] for s in segments) != sum(expected.values()):
        raise ValueError("Replacement total changed")
    # Check exact interval overlap against every other active canonical row.
    conflicts = cur.execute('''WITH active AS (
        SELECT p.id,COALESCE(s.reporting_started_at,p.reporting_started_at) st,COALESCE(s.reporting_ended_at,p.reporting_ended_at) en
          FROM "Learner".learner_progress_entries p
          LEFT JOIN "Learner".learner_activity_reporting_segments s ON s.progress_id=p.id
         WHERE p.learner_id=%s AND p.deleted_at IS NULL AND p.accepted IS TRUE AND p.id<>ALL(%s))
      SELECT count(*) n FROM active a WHERE a.st IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_to_recordset(%s::jsonb) x(start timestamptz,ending timestamptz)
         WHERE x.start < a.en AND a.st < x.ending)''', [LEARNER_ID, list(OLD_PROGRESS.values()), json.dumps([{"start": s["start"], "end": s["end"]} for s in segments])]).fetchone()["n"]
    if conflicts:
        raise ValueError(f"Replacement allocation overlaps {conflicts} active intervals")
    total = cur.execute('''SELECT COALESCE(SUM(CASE WHEN EXISTS (SELECT 1 FROM "Learner".learner_activity_reporting_segments s WHERE s.progress_id=p.id AND s.learner_id=p.learner_id) THEN (SELECT COALESCE(SUM(s.actual_seconds),0) FROM "Learner".learner_activity_reporting_segments s WHERE s.progress_id=p.id AND s.learner_id=p.learner_id) ELSE COALESCE(p.actual_seconds,0) END),0) seconds FROM "Learner".learner_progress_entries p WHERE p.learner_id=%s AND p.deleted_at IS NULL AND p.accepted IS TRUE''', [LEARNER_ID]).fetchone()["seconds"]
    report = {"database": cur.execute("SELECT current_database() name").fetchone()["name"], "learner_id": LEARNER_ID, "aptem_id": APTEM_ID, "old_progress": OLD_PROGRESS, "source_ids": SOURCE_IDS, "before_seconds": int(total), "replacement_seconds": sum(expected.values()), "segments": segments}
    report["fingerprint"] = digest(report)
    return owner, evidence, by_eid, report


def apply(cur, owner, evidence, sources, report, expected_database, expected_fingerprint):
    if report["database"] != expected_database or report["fingerprint"] != expected_fingerprint:
        raise ValueError("Database or fingerprint changed; preview again")
    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [RUN_KIND])
    run_id = insert_row(cur, "activity_sync_runs", {"run_key": RUN_KIND + ":" + expected_fingerprint, "run_kind": RUN_KIND, "status": "running", "dry_run": False, "source_counts": Jsonb({"learner": APTEM_ID, "old_progress": list(OLD_PROGRESS.values()), "evidence_ids": list(EVIDENCE_IDS)}), "result_counts": Jsonb({})})
    next_order = cur.execute('SELECT COALESCE(MAX(entry_order),0) n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [LEARNER_ID]).fetchone()["n"]
    new_ids = []
    for eid in EVIDENCE_IDS:
        blocks = [s for s in report["segments"] if s["evidence_id"] == eid]
        total = sum(int(s["seconds"]) for s in blocks)
        raw = payload(evidence[eid], eid, blocks)
        old_id = OLD_PROGRESS[eid]
        cur.execute('''UPDATE "Learner".learner_progress_entries SET deleted_at=now(),accepted=FALSE,activity_status='Referred',actual_basis=%s,sync_run_id=%s,source_payload=source_payload || %s,ssot_updated_at=now() WHERE id=%s AND deleted_at IS NULL''', ["reconciliation:soft-replaced-overlap-correction", run_id, Jsonb({"reconciliation": {"soft_replaced_by_run_id": run_id, "replacement_reason": "non_overlapping_explicit_suballocation"}}), old_id])
        next_order += 1
        pid = insert_row(cur, "learner_progress_entries", {"learner_id": LEARNER_ID, "entry_order": next_order, "kind": "aptem_evidence", "module_title": evidence[eid].get("component_name") or evidence[eid].get("evidence_name") or "Aptem evidence", "week_title": "", "component_ref": str(evidence[eid].get("component_id") or ""), "component_title": evidence[eid].get("component_name") or evidence[eid].get("evidence_name") or "Aptem evidence", "component_type": "evidence", "programme_id": owner["programme_id"], "aptem_id": APTEM_ID, "enrolment_id": owner["enrolment_id"], "source_system": "aptem", "source_activity_id": f"evidence:{eid}:explicit-suballocation:v2", "source_attempt_key": f"evidence:{eid}:explicit-suballocation:v2", "canonical_activity_key": f"aptem:{APTEM_ID}:evidence:{eid}:explicit-suballocation:v2", "activity_status": "Accepted", "accepted": True, "actual_seconds": total, "actual_basis": BASIS, "reporting_started_at": datetime.fromisoformat(blocks[0]["start"]), "reporting_ended_at": datetime.fromisoformat(blocks[-1]["end"]), "reporting_month": min(s["date"][:7] for s in blocks), "reporting_timestamp_label": LABEL, "source_payload": Jsonb(raw), "sync_run_id": run_id})
        new_ids.append(pid)
        for order, seg in enumerate(blocks, 1):
            insert_row(cur, "learner_activity_reporting_segments", {"progress_id": pid, "learner_id": LEARNER_ID, "segment_order": order, "actual_seconds": seg["seconds"], "reporting_started_at": datetime.fromisoformat(seg["start"]), "reporting_ended_at": datetime.fromisoformat(seg["end"]), "reporting_month": seg["date"][:7], "sync_run_id": run_id})
        source = sources[eid]
        cur.execute('''UPDATE "Learner".learner_activity_sources SET canonical_progress_id=%s,actual_seconds=%s,actual_basis=%s,source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,source_payload=%s,sync_run_id=%s,last_seen_at=now() WHERE id=%s AND deleted_at IS NULL''', [pid, total, BASIS, datetime.fromisoformat(blocks[0]["start"]), datetime.fromisoformat(blocks[-1]["end"]), datetime.fromisoformat(blocks[0]["start"]), datetime.fromisoformat(blocks[-1]["end"]), min(s["date"][:7] for s in blocks), Jsonb(raw), run_id, source["id"]])
        cur.execute('UPDATE "Learner".learner_activity_documents SET progress_id=%s WHERE source_system=\'aptem\' AND source_document_id=%s AND deleted_at IS NULL', [pid, f"evidence:{eid}:file"])
    result = {"soft_deleted_progress": list(OLD_PROGRESS.values()), "new_progress_ids": new_ids, "segments_written": len(report["segments"]), "seconds_preserved": report["replacement_seconds"], "sources_relinked": list(SOURCE_IDS.values())}
    cur.execute('UPDATE "Learner".activity_sync_runs SET status=\'completed\',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', [Jsonb(result), run_id])
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
            owner, evidence, sources, report = plan(cur)
            if args.apply:
                run_id, result = apply(cur, owner, evidence, sources, report, args.expected_database, args.expected_fingerprint)
                report.update({"applied": True, "run_id": run_id, "result": result})
            print(json.dumps(report, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
