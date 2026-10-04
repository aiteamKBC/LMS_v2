"""Apply the reviewed, Azure-verified Additional Hours candidate list.

This is intentionally narrow: it consumes the reviewed dry-run artifact for
the 89 below-Aptem learners and writes only rows classified ``ADD_ADDITIONAL``.
The Aptem mirror is read-only.  Existing source identities, exact Journal
matches, and duration conflicts are never overwritten.  Re-running the
command is idempotent.

Reporting is kept at the evidence month/date level.  No synthetic start/end
time or daily allocation is invented; those rows remain clearly labelled for
any later reporting allocation decision.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import mimetypes
import re
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402

REPORT = Path(__file__).resolve().parents[1] / "reports" / "additional_hours_89_dryrun_2026-10-04.json"
CONTAINER = "fetch-aptem-evidences"
LABEL = "تقديري — يحتاج اعتماد"
BASIS = "aptem:accepted-additional-job-activity-spent-minutes;azure-verified;month-only-reporting"
RUN_KIND = "additional-hours-approved-candidates-v1"
PROMPT_VERSION = "v2-additional-hours-azure-approved-candidates"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql

    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return int(cur.execute(statement, list(values.values())).fetchone()["id"])


def month_of(value: Any) -> str:
    if isinstance(value, datetime):
        return value.strftime("%Y-%m")
    if isinstance(value, date):
        return value.strftime("%Y-%m")
    text = str(value or "")
    return text[:7] if len(text) >= 7 else ""


def as_json(value: Any) -> Any:
    if value is None:
        return []
    if isinstance(value, (list, dict)):
        return value
    try:
        parsed = json.loads(str(value))
        return parsed if isinstance(parsed, (list, dict)) else [parsed]
    except (TypeError, ValueError):
        return [str(value)]


def safe_component(value: Any) -> str:
    text = " ".join(str(value or "").split())
    return text[:500]


def load_actions() -> tuple[list[dict[str, Any]], str]:
    report = json.loads(REPORT.read_text(encoding="utf-8"))
    actions = [row for row in report.get("actions", []) if row.get("classification") == "ADD_ADDITIONAL"]
    if not actions:
        raise ValueError("The reviewed report contains no ADD_ADDITIONAL rows.")
    return actions, str(report.get("fingerprint") or digest(actions))


def load_evidence(cur, evidence_ids: list[int]) -> dict[int, dict[str, Any]]:
    rows = cur.execute(
        '''SELECT e.*, coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_at
             FROM fetching_evidence.evidence_items e
            WHERE e.evidence_id=ANY(%s)''',
        [evidence_ids],
    ).fetchall()
    return {int(row["evidence_id"]): row for row in rows}


def validate_and_lock(cur, action: dict[str, Any], evidence: dict[str, Any], *, lock_rows: bool) -> dict[str, Any]:
    eid = int(action["eid"])
    aid = int(action["aid"])
    if int(evidence.get("learner_id")) != aid:
        raise ValueError(f"Evidence {eid} learner mismatch.")
    if str(evidence.get("evidence_status") or "").strip().casefold() != "accepted":
        raise ValueError(f"Evidence {eid} is no longer Accepted.")
    if not base.is_additional_component(evidence.get("component_name")):
        raise ValueError(f"Evidence {eid} no longer has an Additional job activity component.")
    minutes = Decimal(str(evidence.get("spent_time") or 0))
    if minutes <= 0:
        raise ValueError(f"Evidence {eid} has no positive spent_time.")
    evidence_day = base.evidence_day(evidence)
    if not evidence_day:
        raise ValueError(f"Evidence {eid} has no evidence date.")
    owner_sql = '''SELECT id,enrolment_id,programme_id,aptem_id,full_name
             FROM "Learner".learners WHERE aptem_id=%s''' + (" FOR UPDATE" if lock_rows else "")
    owner = cur.execute(owner_sql, [aid]).fetchone()
    if not owner:
        raise ValueError(f"Aptem learner {aid} has no canonical owner.")
    period = cur.execute(
        '''SELECT "Start-Date" AS start_date,"End-Date" AS end_date
             FROM "Learner"."Aptem_users" WHERE "ID"=%s''', [aid]
    ).fetchone()
    if not period or not period["start_date"] or not period["end_date"]:
        raise ValueError(f"Aptem learner {aid} has no complete period.")
    if not (period["start_date"] <= evidence_day <= period["end_date"]):
        raise ValueError(f"Evidence {eid} is outside the Aptem period.")
    if evidence_day.weekday() >= 5 or evidence_day in base.bank_holidays():
        raise ValueError(f"Evidence {eid} falls on a non-working day.")
    source_ref = f"evidence:{eid}"
    source_sql = '''SELECT id,actual_seconds,canonical_progress_id FROM "Learner".learner_activity_sources
            WHERE learner_id=%s AND source_system='aptem' AND source_activity_id=%s AND deleted_at IS NULL
            ''' + (" FOR UPDATE" if lock_rows else "")
    active_source = cur.execute(source_sql, [owner["id"], source_ref]).fetchall()
    if active_source:
        expected = int(minutes * 60)
        if len(active_source) != 1 or int(active_source[0]["actual_seconds"] or 0) != expected:
            raise ValueError(f"Evidence {eid} already has a conflicting active source.")
        return {"state": "already_present", "owner": owner, "source": active_source[0], "minutes": int(minutes), "day": evidence_day}
    journal_sql = '''SELECT id,actual_hours FROM "Learner".learner_journal_rows
            WHERE canonical_learner_id=%s AND accepted IS TRUE AND deleted_at IS NULL
              AND source_ref=%s AND coalesce(actual_hours,0)>0
            ''' + (" FOR UPDATE" if lock_rows else "")
    exact_journal = cur.execute(journal_sql, [owner["id"], f"asg:{evidence.get('component_id')}:evidence:{eid}"]).fetchall()
    if exact_journal:
        raise ValueError(f"Evidence {eid} has an exact accepted Journal representation.")
    return {"state": "new", "owner": owner, "minutes": int(minutes), "day": evidence_day}


def create_one(cur, action: dict[str, Any], evidence: dict[str, Any], checked: dict[str, Any], run_id: int) -> dict[str, Any]:
    eid = int(action["eid"]); aid = int(action["aid"])
    owner = checked["owner"]; owner_id = int(owner["id"]); seconds = int(checked["minutes"] * 60)
    day = checked["day"]; month = day.strftime("%Y-%m"); source_ref = f"evidence:{eid}"
    next_order = int(cur.execute('''SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s''', [owner_id]).fetchone()["n"]) + 1
    payload = dict(evidence.get("evidence_raw") or {})
    payload["reconciliation"] = {
        "resolution": "accepted_additional_hours_new_source",
        "source_evidence_id": eid,
        "component_name": evidence.get("component_name"),
        "original_evidence_date": str(evidence.get("evidence_at")),
        "azure_container": CONTAINER,
        "azure_file_blob": evidence.get("file_blob"),
        "azure_report_blob": evidence.get("report_blob"),
        "reporting_allocation": "month_only_no_synthetic_timestamp",
        "estimated": False,
        "approval_required": False,
    }
    title = safe_component(evidence.get("component_name") or evidence.get("evidence_name") or f"Aptem Additional Hours {eid}")
    parent_id = insert_row(cur, "learner_progress_entries", {
        "learner_id": owner_id, "entry_order": next_order, "kind": "aptem_evidence",
        "component_ref": source_ref, "component_title": title, "component_type": "evidence",
        "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid,
        "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref,
        "canonical_activity_key": f"aptem:{aid}:{source_ref}", "activity_status": "Accepted", "accepted": True,
        "actual_seconds": seconds, "actual_basis": BASIS, "reporting_month": month,
        "reporting_timestamp_label": LABEL, "source_payload": Jsonb(payload), "sync_run_id": run_id,
    })
    source_payload = dict(payload)
    source_payload["additional_hours"] = {"category": "additional_hours", "component_name": evidence.get("component_name")}
    cur.execute('''INSERT INTO "Learner".learner_activity_sources
        (learner_id,enrolment_id,programme_id,aptem_id,source_system,source_activity_id,source_attempt_key,
         curriculum_component_id,canonical_activity_key,activity_type,title,activity_status,completed,accepted,
         actual_seconds,actual_basis,reporting_month,ksb_codes,source_payload,sync_run_id,canonical_progress_id,source_fingerprint)
        VALUES (%s,%s,%s,%s,'aptem',%s,%s,%s,%s,'additional_hours',%s,'Accepted',TRUE,TRUE,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT DO NOTHING''', [owner_id, owner.get("enrolment_id"), owner.get("programme_id"), aid, source_ref, source_ref,
        evidence.get("component_id"), f"aptem:{aid}:{source_ref}", title, seconds, BASIS, month,
        Jsonb(as_json(evidence.get("ksb_codes"))), Jsonb(source_payload), run_id, parent_id,
        digest({"evidence_id": eid, "actual_seconds": seconds, "file_blob": evidence.get("file_blob"), "report_blob": evidence.get("report_blob")})])
    if cur.rowcount != 1:
        raise ValueError(f"Evidence source {eid} was not inserted.")
    docs = 0
    for kind in ("file", "report"):
        blob = evidence.get(f"{kind}_blob")
        if not blob:
            continue
        doc_ref = f"evidence:{eid}:{kind}"
        if cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents
                           WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL FOR UPDATE''', [owner_id, doc_ref]).fetchone():
            continue
        display = safe_component(evidence.get("evidence_name") or title)
        if kind == "report":
            display = f"{display} — Assessment report"
        insert_row(cur, "learner_activity_documents", {
            "learner_id": owner_id, "progress_id": parent_id, "source_system": "aptem", "source_document_id": doc_ref,
            "container": CONTAINER, "blob_name": str(blob), "display_name": display,
            "content_type": mimetypes.guess_type(str(blob))[0] or "application/octet-stream",
            "uploaded_by": "aptem-evidence", "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date"),
        }); docs += 1
    return {"aid": aid, "eid": eid, "parent_id": parent_id, "seconds": seconds, "documents": docs}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    actions, report_fingerprint = load_actions()
    eids = sorted({int(row["eid"]) for row in actions})
    with psycopg.connect(base.database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=120000")
            cur.execute("SET LOCAL lock_timeout=10000")
            database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            evidence = load_evidence(cur, eids)
            if len(evidence) != len(eids):
                raise ValueError("Reviewed evidence list changed or is incomplete.")
            checked = []
            for action in actions:
                checked.append((action, validate_and_lock(cur, action, evidence[int(action["eid"])], lock_rows=args.apply)))
            new_rows = [(a, c) for a, c in checked if c["state"] == "new"]
            run_key = f"{RUN_KIND}:{report_fingerprint}"
            if not args.apply:
                print(json.dumps({"database": database, "read_only": True, "reviewed_actions": len(actions), "new_rows": len(new_rows), "already_present": len(actions)-len(new_rows), "report_fingerprint": report_fingerprint}, ensure_ascii=False))
                return 0
            run_id = insert_row(cur, "activity_sync_runs", {
                "run_key": run_key, "run_kind": RUN_KIND, "status": "running", "dry_run": False,
                "prompt_version": PROMPT_VERSION, "source_counts": Jsonb({"reviewed_actions": len(actions), "azure_verified": True, "report_fingerprint": report_fingerprint}), "result_counts": Jsonb({}),
            })
            results = []
            for action, checked_row in new_rows:
                results.append(create_one(cur, action, evidence[int(action["eid"])], checked_row, run_id))
            result_counts = {"created_rows": len(results), "documents_added": sum(int(r["documents"]) for r in results), "seconds_added": sum(int(r["seconds"]) for r in results), "already_present": len(actions)-len(new_rows)}
            cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result_counts), run_id])
            conn.commit()
            print(json.dumps({"database": database, "read_only": False, "run_id": run_id, **result_counts}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
