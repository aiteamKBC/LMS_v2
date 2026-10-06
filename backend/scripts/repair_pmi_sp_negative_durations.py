"""Repair the scoped PMI-SP negative-hour artifacts without duplicate activities.

This is intentionally narrow and requires an explicit preview fingerprint before
writing.  It only:

* normalises four existing Journal/SSOT rows to the accepted Aptem attendance
  duration for the same event (150 minutes); and
* records the non-overlapping portions of two accepted Rhiannon attendance
  windows.  The portions already represented by Old LMS are retained there and
  are not counted a second time.

No evidence row is changed and no existing activity is hard-deleted.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


GROUP_ID = "145544"
MODULE_ID = "MOD-20261001105703419367E214F45713C3"
TARGET_JOURNALS = {
    6524: {"journal_ids": [42716, 42717, 42718], "evidence_ids": [26250, 26251, 27585]},
    7217: {"journal_ids": [48461], "evidence_ids": [50940]},
}

RHIANNON_WINDOWS = {
    56304: {
        "start": datetime(2026, 9, 2, 11, 0, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 2, 13, 30, tzinfo=timezone.utc),
        "segments": [
            (datetime(2026, 9, 2, 11, 0, tzinfo=timezone.utc), datetime(2026, 9, 2, 11, 23, tzinfo=timezone.utc)),
            (datetime(2026, 9, 2, 11, 41, tzinfo=timezone.utc), datetime(2026, 9, 2, 11, 48, tzinfo=timezone.utc)),
            (datetime(2026, 9, 2, 12, 0, tzinfo=timezone.utc), datetime(2026, 9, 2, 12, 7, tzinfo=timezone.utc)),
            (datetime(2026, 9, 2, 12, 25, tzinfo=timezone.utc), datetime(2026, 9, 2, 13, 30, tzinfo=timezone.utc)),
        ],
    },
    56305: {
        "start": datetime(2026, 9, 9, 11, 0, tzinfo=timezone.utc),
        "end": datetime(2026, 9, 9, 13, 30, tzinfo=timezone.utc),
        "segments": [
            (datetime(2026, 9, 9, 11, 28, tzinfo=timezone.utc), datetime(2026, 9, 9, 12, 2, 34, tzinfo=timezone.utc)),
            (datetime(2026, 9, 9, 12, 22, 22, tzinfo=timezone.utc), datetime(2026, 9, 9, 13, 30, tzinfo=timezone.utc)),
        ],
    },
}


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def database_url() -> str:
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = values.get("ENROLMENT_DATABASE_URL") or values.get("Database_url") or values.get("DATABASEURL") or values.get("DATABASE_URL")
    if not url:
        raise ValueError("No configured enrolment database.")
    return url


def group_membership(cur, aptem_id: int) -> dict[str, Any]:
    row = cur.execute(
        '''SELECT l.id, l.aptem_id, l.full_name, l.enrolment_id, l.programme_id
           FROM "Learner".learners l
           WHERE l.aptem_id=%s''',
        [aptem_id],
    ).fetchall()
    if len(row) != 1:
        raise ValueError(f"Expected one learner for Aptem ID {aptem_id}.")
    owner = row[0]
    membership = cur.execute(
        '''SELECT id, source_payload
           FROM "Learner".learner_source_course_memberships
           WHERE learner_id=%s AND deleted_at IS NULL
             AND source_payload->>'group_id'=%s
           ORDER BY id DESC LIMIT 1''',
        [owner["id"], GROUP_ID],
    ).fetchone()
    if not membership:
        raise ValueError(f"Aptem ID {aptem_id} is not an active PMI-SP group member.")
    return owner


def read_state(cur) -> dict[str, Any]:
    owners = {aptem_id: group_membership(cur, aptem_id) for aptem_id in [*TARGET_JOURNALS, 10803]}
    journal_ids = [jid for spec in TARGET_JOURNALS.values() for jid in spec["journal_ids"]]
    evidence_ids = [eid for spec in TARGET_JOURNALS.values() for eid in spec["evidence_ids"]] + list(RHIANNON_WINDOWS)
    journals = cur.execute(
        '''SELECT j.*, p.actual_seconds AS progress_actual_seconds,
                  p.source_system AS progress_source_system,
                  p.source_activity_id AS progress_source_activity_id,
                  p.deleted_at AS progress_deleted_at,
                  s.id AS source_id, s.actual_seconds AS source_actual_seconds,
                  s.deleted_at AS source_deleted_at
           FROM "Learner".learner_journal_rows j
           JOIN "Learner".learner_progress_entries p ON p.id=j.progress_id
           LEFT JOIN "Learner".learner_activity_sources s
             ON s.canonical_progress_id=p.id AND s.deleted_at IS NULL
           WHERE j.id=ANY(%s) ORDER BY j.id''',
        [journal_ids],
    ).fetchall()
    if len(journals) != len(journal_ids):
        raise ValueError("A targeted Journal row is missing.")
    evidence = cur.execute(
        '''SELECT evidence_id, learner_id, component_id, component_name,
                  evidence_status, spent_time, hours_type, spent_time_type,
                  completed_date, completed_date_override, submission_date,
                  evidence_name, ksb_codes, evidence_raw
           FROM fetching_evidence.evidence_items
           WHERE evidence_id=ANY(%s) ORDER BY evidence_id''',
        [evidence_ids],
    ).fetchall()
    if len(evidence) != len(evidence_ids):
        raise ValueError("A targeted Aptem Evidence row is missing.")
    existing_rhiannon = cur.execute(
        '''SELECT source_activity_id, canonical_progress_id
           FROM "Learner".learner_activity_sources
           WHERE learner_id=%s AND source_system='aptem'
             AND source_payload->>'Id'=ANY(%s)''',
        [owners[10803]["id"], [str(eid) for eid in RHIANNON_WINDOWS]],
    ).fetchall()
    if existing_rhiannon:
        raise ValueError("Rhiannon attendance evidence already has an Aptem source; refusing a duplicate.")
    progress = cur.execute(
        '''SELECT id, entry_order FROM "Learner".learner_progress_entries
           WHERE learner_id=%s ORDER BY entry_order DESC LIMIT 1''',
        [owners[10803]["id"]],
    ).fetchone()
    return {"owners": owners, "journals": journals, "evidence": evidence, "last_entry": progress}


def seconds(start: datetime, end: datetime) -> int:
    return int((end - start).total_seconds())


def build_plan(state: dict[str, Any]) -> dict[str, Any]:
    journals = []
    for row in state["journals"]:
        if row["deleted_at"] is not None or row["progress_deleted_at"] is not None or row["source_deleted_at"] is not None:
            raise ValueError(f"Targeted row {row['id']} is deleted; refusing a replacement.")
        if Decimal(str(row["actual_hours"])) != Decimal("2.0") or row["progress_actual_seconds"] != 7200 or row["source_actual_seconds"] != 7200:
            raise ValueError(f"Targeted row {row['id']} changed since review.")
        journals.append({"journal_id": row["id"], "progress_id": row["progress_id"], "source_id": row["source_id"], "before_seconds": 7200, "after_seconds": 9000})
    evidence = {row["evidence_id"]: row for row in state["evidence"]}
    for evidence_id in [*sum((spec["evidence_ids"] for spec in TARGET_JOURNALS.values()), []), *RHIANNON_WINDOWS]:
        row = evidence[evidence_id]
        if row["evidence_status"] != "Accepted" or Decimal(str(row["spent_time"])) != Decimal("150"):
            raise ValueError(f"Evidence {evidence_id} is not the reviewed 150-minute Accepted record.")
        if row["hours_type"] != "OffTheJobTraining" or row["spent_time_type"] != "PaidWorkingHours":
            raise ValueError(f"Evidence {evidence_id} is not countable paid OTJ evidence.")
    attendance = []
    for evidence_id, window in RHIANNON_WINDOWS.items():
        net = sum(seconds(start, end) for start, end in window["segments"])
        raw = 9000
        attendance.append({
            "evidence_id": evidence_id,
            "raw_seconds": raw,
            "counted_seconds": net,
            "excluded_seconds": raw - net,
            "start": window["start"],
            "end": window["end"],
            "segments": [{"start": start, "end": end, "seconds": seconds(start, end)} for start, end in window["segments"]],
        })
    return {"journal_duration_repairs": journals, "attendance_repairs": attendance}


def insert_run(cur, plan: dict[str, Any], fingerprint: str, dry_run: bool) -> int:
    result = {
        "group_id": GROUP_ID,
        "module_id": MODULE_ID,
        "journal_duration_repairs": plan["journal_duration_repairs"],
        "attendance_repairs": plan["attendance_repairs"],
        "total_counted_seconds": sum(item["counted_seconds"] for item in plan["attendance_repairs"]),
        "total_duration_correction_seconds": sum(item["after_seconds"] - item["before_seconds"] for item in plan["journal_duration_repairs"]),
    }
    cur.execute(
        '''INSERT INTO "Learner".activity_sync_runs
           (run_key, run_kind, status, dry_run, source_counts, result_counts,
            started_at, finished_at, created_at, updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,now(),CASE WHEN %s THEN now() ELSE NULL END,now(),now())
           RETURNING id''',
        ["pmi-sp-negative-repair:" + fingerprint, "pmi-sp-negative-repair", "completed" if dry_run else "running", dry_run,
         Jsonb({"learners": [6524, 7217, 10803], "evidence_ids": [*sum((spec["evidence_ids"] for spec in TARGET_JOURNALS.values()), []), *RHIANNON_WINDOWS]}), Jsonb(json_safe(result)), dry_run],
    )
    return cur.fetchone()["id"]


def apply(cur, state: dict[str, Any], plan: dict[str, Any], fingerprint: str) -> int:
    run_id = insert_run(cur, plan, fingerprint, False)
    for item in plan["journal_duration_repairs"]:
        cur.execute('UPDATE "Learner".learner_journal_rows SET actual_hours=%s,updated_at=now(),updated_by=%s WHERE id=%s AND actual_hours=%s RETURNING id', [Decimal("2.5"), "pmi-sp-negative-repair", item["journal_id"], Decimal("2.0")])
        if cur.fetchone() is None:
            raise ValueError(f"Journal update did not affect row {item['journal_id']}.")
        current_progress = cur.execute('SELECT actual_seconds, deleted_at FROM "Learner".learner_progress_entries WHERE id=%s', [item["progress_id"]]).fetchone()
        if current_progress is None:
            raise ValueError(f"Progress row {item['progress_id']} disappeared.")
        if current_progress["actual_seconds"] != 9000 or current_progress["deleted_at"] is not None:
            raise ValueError(f"Journal trigger did not normalize progress row {item['progress_id']} (current={current_progress}).")
        cur.execute('UPDATE "Learner".learner_progress_entries SET actual_basis=%s,ssot_updated_at=now(),sync_run_id=%s WHERE id=%s AND actual_seconds=%s RETURNING id', ["journal:accepted-manual-hours:aptem-150m-normalized", run_id, item["progress_id"], 9000])
        if cur.fetchone() is None:
            raise ValueError(f"Progress update did not affect row {item['progress_id']} (current={current_progress}).")
        cur.execute('UPDATE "Learner".learner_activity_sources SET actual_basis=%s,sync_run_id=%s,last_seen_at=now() WHERE id=%s AND actual_seconds=%s AND deleted_at IS NULL RETURNING id', ["journal:accepted-manual-hours:aptem-150m-normalized", run_id, item["source_id"], 9000])
        if cur.fetchone() is None:
            raise ValueError(f"Source update did not affect row {item['source_id']}.")

    owner = state["owners"][10803]
    next_order = int(state["last_entry"]["entry_order"] or 0)
    evidence = {row["evidence_id"]: row for row in state["evidence"]}
    for item in plan["attendance_repairs"]:
        next_order += 1
        raw = dict(evidence[item["evidence_id"]]["evidence_raw"] or {})
        raw["reconciliation"] = {
            "resolution": "new_attendance_partial_nonoverlap",
            "source_table": "fetching_evidence.evidence_items",
            "evidence_id": item["evidence_id"],
            "raw_evidence_seconds": item["raw_seconds"],
            "counted_seconds": item["counted_seconds"],
            "excluded_overlap_seconds": item["excluded_seconds"],
            "segments": json_safe(item["segments"]),
        }
        key = "activity:v1:" + digest({"aptem_id": owner["aptem_id"], "evidence_id": item["evidence_id"], "segments": item["segments"]})
        e = evidence[item["evidence_id"]]
        progress_id = cur.execute(
            '''INSERT INTO "Learner".learner_progress_entries
               (learner_id,entry_order,kind,component_ref,component_title,component_type,
                feed_kind,feed_action,feed_title,programme_ref,time_tracking_source,
                time_tracking_calculation,enrolment_id,programme_id,aptem_id,source_system,
                source_activity_id,canonical_activity_key,activity_status,accepted,actual_seconds,
                actual_basis,reporting_started_at,reporting_ended_at,reporting_month,
                reporting_timestamp_label,source_payload,sync_run_id)
               VALUES (%s,%s,'attendance',%s,%s,'attendance','attendance','Accepted',%s,%s,
                       'aptem','aptem:accepted-evidence-spent-minutes-minus-overlap',%s,%s,%s,
                       'aptem',%s,%s,'Accepted',true,%s,%s,%s,%s,%s,%s,%s,%s)
               RETURNING id''',
            [owner["id"], next_order, f"evidence:{item['evidence_id']}", e["component_name"] or e["evidence_name"], e["component_name"] or e["evidence_name"], owner["programme_id"], owner["enrolment_id"], owner["programme_id"], owner["aptem_id"], f"evidence:{item['evidence_id']}", key, item["counted_seconds"], "aptem:accepted-evidence-spent-minutes-minus-overlap", item["segments"][0]["start"], item["segments"][-1]["end"], item["segments"][0]["start"].strftime("%Y-%m"), "non-overlap segments; Aptem 150m", Jsonb(raw), run_id],
        ).fetchone()["id"]
        for order, segment in enumerate(item["segments"], start=1):
            cur.execute(
                '''INSERT INTO "Learner".learner_activity_reporting_segments
                   (progress_id,learner_id,segment_order,actual_seconds,
                    reporting_started_at,reporting_ended_at,reporting_month,sync_run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                [progress_id, owner["id"], order, segment["seconds"], segment["start"], segment["end"], segment["start"].strftime("%Y-%m"), run_id],
            )
        cur.execute(
            '''INSERT INTO "Learner".learner_activity_sources
               (learner_id,enrolment_id,programme_id,aptem_id,source_system,
                source_activity_id,canonical_activity_key,activity_type,title,
                activity_status,completed,accepted,actual_seconds,actual_basis,
                source_started_at,source_ended_at,reporting_started_at,reporting_ended_at,
                reporting_month,ksb_codes,source_payload,sync_run_id,canonical_progress_id,
                source_fingerprint)
               VALUES (%s,%s,%s,%s,'aptem',%s,%s,'attendance',%s,'Accepted',true,true,%s,%s,
                       %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            [owner["id"], owner["enrolment_id"], owner["programme_id"], owner["aptem_id"], f"evidence:{item['evidence_id']}", key, e["component_name"] or e["evidence_name"], item["counted_seconds"], "aptem:accepted-evidence-spent-minutes-minus-overlap", item["start"], item["end"], item["segments"][0]["start"], item["segments"][-1]["end"], item["segments"][0]["start"].strftime("%Y-%m"), Jsonb(e["ksb_codes"] or []), Jsonb(raw), run_id, progress_id, digest(e)],
        )
    result = {"journal_duration_repairs": plan["journal_duration_repairs"], "attendance_repairs": plan["attendance_repairs"], "total_added_seconds": sum(item["after_seconds"] - item["before_seconds"] for item in plan["journal_duration_repairs"]) + sum(item["counted_seconds"] for item in plan["attendance_repairs"]), "verification": "passed"}
    cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed", Jsonb(json_safe(result)), run_id])
    return run_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=20000")
            cur.execute("SET LOCAL lock_timeout=5000")
            database = cur.execute("SELECT current_database() name").fetchone()["name"]
            state = read_state(cur)
            plan = build_plan(state)
            fingerprint = digest({"state": state, "plan": plan})
            output = {"database": database, "fingerprint": fingerprint, "plan": plan}
            if args.apply:
                if database != args.expected_database or fingerprint != args.expected_fingerprint:
                    raise ValueError("Database or reviewed fingerprint changed; preview again.")
                for owner in state["owners"].values():
                    cur.execute('SELECT id FROM "Learner".learners WHERE id=%s FOR UPDATE', [owner["id"]])
                run_id = apply(cur, state, plan, fingerprint)
                output.update(applied=True, run_id=run_id, verification="passed")
            else:
                output["applied"] = False
    print(json.dumps(output, default=str))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}))
        raise SystemExit(1)
