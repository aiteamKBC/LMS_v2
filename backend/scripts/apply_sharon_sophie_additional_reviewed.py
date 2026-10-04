"""Preview/apply reviewed Sophie evidence that was not counted yet.

Scope is deliberately limited to Sophie Graham (Aptem 4365) and three read
documents: 46439 (25h), 53571 (28h), and 55552 (30h).  Evidence 46439 already
has an Aptem source attached to the existing estimated parent 705301, but the
source has no counted seconds; its new segments are appended to that parent.
The other two items receive new canonical parents.  All allocations remain
``تقديري — يحتاج اعتماد`` and are excluded from authoritative Actual totals.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repair_sharon_evidence_allocations as base

UK = ZoneInfo("Europe/London")
CONTAINER = "fetch-aptem-evidences"
LABEL = "\u062a\u0642\u062f\u064a\u0631\u064a \u2014 \u064a\u062d\u062a\u0627\u062c \u0627\u0639\u062a\u0645\u0627\u062f"
BASIS = "aptem:accepted-evidence-spent-minutes;estimated-reporting-allocation"
RUN_KIND = "sharon-estimated-sophie-reviewed-v1"
APTEM_ID = 4365
OWNER_PARENT = {46439: 705301, 53571: None, 55552: None}

# Blocks are in document order.  The dates are exact where the document states
# one; month/range activities use a nearby weekday and remain estimated.
SCHEDULES = {
    46439: [
        ("2026-06-11", 4 * 3600),
        ("2026-06-24", 8 * 3600),
        ("2026-06-26", 11 * 3600),
        ("2026-06-29", 2 * 3600),
    ],
    53571: [
        ("2026-06-29", 4 * 3600),
        ("2026-07-07", 4 * 3600),
        ("2026-07-14", 4 * 3600),
        ("2026-07-21", 8 * 3600),
        ("2026-08-10", 8 * 3600),
    ],
    55552: [
        ("2026-08-13", 6 * 3600),
        ("2026-08-20", 6 * 3600),
        ("2026-08-21", 2 * 3600),
        ("2026-08-24", 2 * 3600),
        ("2026-08-25", 2 * 3600),
        ("2026-08-26", 2 * 3600),
        ("2026-08-27", 4 * 3600),
        ("2026-08-28", 2 * 3600),
        # 31 August is a UK bank holiday in this reporting period; keep the
        # final four hours on the prior valid weekday rather than shifting
        # outside the evidence cutoff.
        ("2026-08-28", 4 * 3600),
    ],
}
EVIDENCE_IDS = sorted(SCHEDULES)


def digest(value):
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def db_url():
    values = dict(os.environ)
    for raw in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        if raw.strip() and not raw.lstrip().startswith("#") and "=" in raw:
            key, value = raw.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise ValueError("No configured enrolment database.")


def insert_row(cur, table, values):
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def read_evidence(cur):
    rows = cur.execute(
        """SELECT evidence_id,learner_id,component_id,component_name,evidence_name,
                  evidence_status,spent_time,hours_type,spent_time_type,
                  completed_date_override,completed_date,submission_date,
                  file_blob,note_blob,report_blob,note_content,evidence_raw,ksb_codes
             FROM fetching_evidence.evidence_items
            WHERE evidence_id=ANY(%s) ORDER BY evidence_id""", [EVIDENCE_IDS]
    ).fetchall()
    if {int(r["evidence_id"]) for r in rows} != set(EVIDENCE_IDS):
        raise ValueError("A reviewed evidence item is missing.")
    result = {int(r["evidence_id"]): r for r in rows}
    for evidence_id, row in result.items():
        if row["learner_id"] != APTEM_ID or row["evidence_status"] != "Accepted" or row["hours_type"] != "OffTheJobTraining" or row["spent_time_type"] != "PaidWorkingHours":
            raise ValueError(f"Evidence {evidence_id} is not accepted paid OTJ for Sophie.")
        if sum(seconds for _, seconds in SCHEDULES[evidence_id]) != int(row["spent_time"]) * 60:
            raise ValueError(f"Evidence {evidence_id} schedule does not equal source minutes.")
    return result


def occupancy(cur, owner_id):
    usage = defaultdict(int)
    rows = cur.execute(
        """SELECT activity_date,COALESCE(SUM(actual_hours),0) hours
             FROM "Learner".learner_journal_rows
            WHERE canonical_learner_id=%s AND deleted_at IS NULL AND accepted IS TRUE
              AND activity_date <= '2026-08-31'
            GROUP BY activity_date""", [owner_id]
    ).fetchall()
    for row in rows:
        if row["activity_date"]:
            usage[row["activity_date"]] += int(round(float(row["hours"] or 0) * 3600))
    for row in cur.execute(
        """SELECT reporting_started_at,reporting_ended_at
             FROM "Learner".learner_activity_reporting_segments
            WHERE learner_id=%s""", [owner_id]
    ).fetchall():
        start = row["reporting_started_at"].astimezone(UK)
        end = row["reporting_ended_at"].astimezone(UK)
        usage[start.date()] += int((end - start).total_seconds())
    return usage


def allocate(usage, evidence_id):
    selected = defaultdict(int)
    segments = []
    for anchor_text, requested in SCHEDULES[evidence_id]:
        remaining = int(requested)
        anchor = date.fromisoformat(anchor_text)
        # Preserve chronology: exact/nearest later weekday only.
        for offset in range(0, 370):
            if remaining <= 0:
                break
            day = anchor + timedelta(days=offset)
            if day.weekday() >= 5 or day == date(2026, 8, 31):
                continue
            used = usage.get(day, 0) + selected[day]
            capacity = 8 * 3600 - used
            if capacity <= 0:
                continue
            seconds = min(remaining, capacity)
            start = datetime.combine(day, time(9, 0), tzinfo=UK) + timedelta(seconds=used)
            end = start + timedelta(seconds=seconds)
            if end.astimezone(UK).date() != day or end.hour > 17 or (end.hour == 17 and end.minute > 0):
                continue
            segments.append({
                "evidence_id": evidence_id,
                "seconds": seconds,
                "start": start.isoformat(),
                "end": end.isoformat(),
                "date": day.isoformat(),
                "month": day.strftime("%Y-%m"),
                "anchor_date": anchor_text,
            })
            selected[day] += seconds
            remaining -= seconds
        if remaining:
            raise ValueError(f"Could not allocate {remaining} seconds for evidence {evidence_id}.")
    return segments


def payload(evidence, segments, evidence_ids):
    raw = dict(evidence["evidence_raw"] or {})
    raw["component_name"] = evidence["component_name"]
    raw["reconciliation"] = {
        "resolution": "estimated_evidence_hours_repair",
        "estimated": True,
        "approval_required": True,
        "label": LABEL,
        "source_evidence_ids": evidence_ids,
        "reporting_allocation": {
            "estimated": True,
            "approval_required": True,
            "label": LABEL,
            "index_rule": "nearest valid weekday forward, order-preserved",
            "source_evidence_ids": evidence_ids,
            "original_evidence_date": str(evidence["completed_date_override"] or evidence["completed_date"] or evidence["submission_date"]),
            "segments": segments,
        },
    }
    return raw


def build_report(cur):
    evidence = read_evidence(cur)
    owner = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=%s', [APTEM_ID]).fetchone()
    if not owner:
        raise ValueError("Sophie canonical learner missing.")
    usage = occupancy(cur, owner["id"])
    plans = []
    for evidence_id in EVIDENCE_IDS:
        source = cur.execute(
            '''SELECT * FROM "Learner".learner_activity_sources
                WHERE learner_id=%s AND source_system='aptem' AND deleted_at IS NULL
                  AND source_activity_id=%s''', [owner["id"], f"evidence:{evidence_id}"]
        ).fetchone()
        parent_id = OWNER_PARENT[evidence_id]
        if evidence_id == 46439 and (not source or source["id"] != 867429 or source["canonical_progress_id"] != parent_id or source["actual_seconds"] is not None):
            raise ValueError("Evidence 46439 lineage changed; manual review required.")
        if evidence_id != 46439 and source:
            raise ValueError(f"Evidence {evidence_id} unexpectedly has an active source.")
        segments = allocate(usage, evidence_id)
        for seg in segments:
            usage[date.fromisoformat(seg["date"])] += int(seg["seconds"])
        plans.append({"evidence_id": evidence_id, "owner_id": owner["id"], "parent_id": parent_id,
                      "source_id": source["id"] if source else None,
                      "expected_seconds": int(evidence[evidence_id]["spent_time"]) * 60,
                      "segments": segments, "owner_name": owner["full_name"]})
    report = {"database": cur.execute("SELECT current_database() name").fetchone()["name"], "plans": plans,
              "selected_evidence_count": len(plans), "seconds_written": sum(p["expected_seconds"] for p in plans)}
    report["fingerprint"] = digest(report)
    return report


def apply_report(cur, report, expected_database, expected_fingerprint):
    if report["database"] != expected_database or report["fingerprint"] != expected_fingerprint:
        raise ValueError("Database or reviewed fingerprint changed; preview again.")
    evidence = read_evidence(cur)
    owner = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=%s', [APTEM_ID]).fetchone()
    run_id = insert_row(cur, "activity_sync_runs", {
        "run_key": RUN_KIND + ":" + expected_fingerprint, "run_kind": RUN_KIND,
        "status": "running", "dry_run": False, "prompt_version": "v1-reviewed-sophie-evidence",
        "source_counts": Jsonb({"aptem_ids": [APTEM_ID], "evidence_ids": EVIDENCE_IDS, "estimated": True}),
        "result_counts": Jsonb({}),
    })
    segment_count = 0
    source_count = 0
    parents_created = 0
    documents_added = 0
    for plan in report["plans"]:
        eid = plan["evidence_id"]
        ev = evidence[eid]
        segs = plan["segments"]
        first = datetime.fromisoformat(segs[0]["start"])
        last = datetime.fromisoformat(segs[-1]["end"])
        parent_id = plan["parent_id"]
        if parent_id is None:
            max_order = cur.execute('SELECT COALESCE(MAX(entry_order),0) n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner["id"]]).fetchone()["n"]
            parent_id = insert_row(cur, "learner_progress_entries", {
                "learner_id": owner["id"], "entry_order": int(max_order) + 1,
                "kind": "assignment", "component_ref": f"evidence:{eid}",
                "component_title": ev["component_name"] or ev["evidence_name"], "component_type": "assignment",
                "enrolment_id": owner["enrolment_id"], "programme_id": owner["programme_id"], "aptem_id": APTEM_ID,
                "source_system": "aptem", "source_activity_id": f"evidence:{eid}",
                "canonical_activity_key": f"aptem:{APTEM_ID}:evidence:{eid}", "activity_status": "Accepted", "accepted": True,
                "actual_seconds": plan["expected_seconds"], "actual_basis": BASIS,
                "reporting_started_at": first, "reporting_ended_at": last, "reporting_month": segs[0]["month"],
                "reporting_timestamp_label": LABEL, "source_payload": Jsonb(payload(ev, segs, [eid])), "sync_run_id": run_id,
            })
            parents_created += 1
        else:
            # Existing 705301 already contains 43748's approved estimated
            # segment. Append this document's segments without replacing it.
            current = cur.execute('SELECT actual_seconds,source_payload FROM "Learner".learner_progress_entries WHERE id=%s AND learner_id=%s FOR UPDATE', [parent_id, owner["id"]]).fetchone()
            if not current:
                raise ValueError("Existing Sophie parent disappeared.")
            if eid == 46439 and int(current["actual_seconds"] or 0) != 25200:
                raise ValueError("Existing Sophie parent 705301 changed; manual review required.")
            p_payload = dict(current["source_payload"] or {})
            recon = dict(p_payload.get("reconciliation") or {})
            recon["estimated"] = True; recon["approval_required"] = True; recon["label"] = LABEL
            recon["supplemental_estimated_evidence_ids"] = sorted(set((recon.get("supplemental_estimated_evidence_ids") or []) + [eid]))
            recon["supplemental_segments"] = (recon.get("supplemental_segments") or []) + segs
            p_payload["reconciliation"] = recon
            cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=%s,actual_basis=%s,
                          reporting_ended_at=GREATEST(reporting_ended_at,%s),reporting_timestamp_label=%s,
                          source_payload=%s,sync_run_id=%s,ssot_updated_at=now() WHERE id=%s AND learner_id=%s''',
                        [int(current["actual_seconds"] or 0) + plan["expected_seconds"], BASIS, last, LABEL, Jsonb(p_payload), run_id, parent_id, owner["id"]])
        start_order = cur.execute('SELECT COALESCE(MAX(segment_order),0) n FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s', [parent_id]).fetchone()["n"]
        for index, seg in enumerate(segs, int(start_order) + 1):
            insert_row(cur, "learner_activity_reporting_segments", {
                "progress_id": parent_id, "learner_id": owner["id"], "segment_order": index,
                "actual_seconds": seg["seconds"], "reporting_started_at": datetime.fromisoformat(seg["start"]),
                "reporting_ended_at": datetime.fromisoformat(seg["end"]), "reporting_month": seg["month"], "sync_run_id": run_id,
            }); segment_count += 1
        source_id = plan["source_id"]
        ev_payload = payload(ev, segs, [eid])
        if source_id:
            cur.execute('''UPDATE "Learner".learner_activity_sources SET canonical_progress_id=%s,actual_seconds=%s,
                          actual_basis=%s,source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,
                          reporting_ended_at=%s,reporting_month=%s,source_payload=%s,ksb_codes=%s,sync_run_id=%s,last_seen_at=now()
                          WHERE id=%s''', [parent_id, plan["expected_seconds"], BASIS, first, last, first, last, segs[0]["month"], Jsonb(ev_payload), Jsonb(ev["ksb_codes"] or []), run_id, source_id])
        else:
            insert_row(cur, "learner_activity_sources", {
                "learner_id": owner["id"], "enrolment_id": owner["enrolment_id"], "programme_id": owner["programme_id"], "aptem_id": APTEM_ID,
                "source_system": "aptem", "source_activity_id": f"evidence:{eid}", "canonical_progress_id": parent_id,
                "canonical_activity_key": f"aptem:{APTEM_ID}:evidence:{eid}", "activity_type": "assignment", "title": ev["component_name"] or ev["evidence_name"],
                "activity_status": "Accepted", "completed": True, "accepted": True, "actual_seconds": plan["expected_seconds"], "actual_basis": BASIS,
                "source_started_at": first, "source_ended_at": last, "reporting_started_at": first, "reporting_ended_at": last, "reporting_month": segs[0]["month"],
                "source_payload": Jsonb(ev_payload), "ksb_codes": Jsonb(ev["ksb_codes"] or []), "sync_run_id": run_id, "source_fingerprint": digest(ev),
            }); source_count += 1
        if ev["file_blob"] and not cur.execute('SELECT 1 FROM "Learner".learner_activity_documents WHERE source_document_id=%s AND deleted_at IS NULL', [f"evidence:{eid}:file"]).fetchone():
            insert_row(cur, "learner_activity_documents", {
                "learner_id": owner["id"], "progress_id": parent_id, "source_system": "aptem", "source_document_id": f"evidence:{eid}:file",
                "container": CONTAINER, "blob_name": ev["file_blob"], "display_name": ev["evidence_name"],
                "content_type": mimetypes.guess_type(ev["evidence_name"])[0] or "application/octet-stream", "uploaded_at": ev["submission_date"],
            }); documents_added += 1
    result = {"label": LABEL, "estimated": True, "approval_required": True, "evidence_ids": EVIDENCE_IDS,
              "seconds_written": report["seconds_written"], "segments_written": segment_count,
              "source_rows_written": len(EVIDENCE_IDS), "new_parents": parents_created, "documents_added": documents_added}
    cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed_with_issues", Jsonb(result), run_id])
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
            cur.execute("SET LOCAL statement_timeout=30000")
            cur.execute("SET LOCAL lock_timeout=5000")
            report = build_report(cur)
            if args.apply:
                run_id, result = apply_report(cur, report, args.expected_database, args.expected_fingerprint)
                conn.commit()
                print(json.dumps({"database": report["database"], "applied": True, "run_id": run_id, **result}, default=str, ensure_ascii=False, indent=2))
            else:
                print(json.dumps({"database": report["database"], "applied": False, "fingerprint": report["fingerprint"],
                                  "selected_evidence": EVIDENCE_IDS, "seconds_written": report["seconds_written"],
                                  "hours_written": report["seconds_written"] / 3600, "plans": report["plans"]}, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
