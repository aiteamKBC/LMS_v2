"""Reparent one accepted Aptem evidence from a non-accepted parent.

The main Femi write deliberately repairs accepted parents only.  Evidence 28320
was already linked to a Referred parent, so this narrow, idempotent correction
gives it an independent accepted Aptem row while preserving the old parent and
source row in audit history.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime
import hashlib
import json
from pathlib import Path
import mimetypes
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402

EVIDENCE_ID = 28320
APTTEM_ID = 10173
OLD_PARENT_ID = 701836
SOURCE_ID = 859836
CONTAINER = "fetch-aptem-evidences"
ACTOR_DEFAULT = "Ayman"
RUN_KIND = "femi-commercial-intelligence-reparent-nonaccepted-v1"
DEFAULT_RESULT = Path(__file__).resolve().parents[1] / "reports" / "femi_nonaccepted_parent_correction.json"
BASIS = "aptem:accepted-additional-job-activity-spent-minutes;reparented-from-nonaccepted-parent"
LABEL = "Aptem evidence date — no synthetic timestamp"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql
    stmt = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return int(cur.execute(stmt, list(values.values())).fetchone()["id"])


def month_of(value: Any) -> str:
    if isinstance(value, (date, datetime)):
        return value.strftime("%Y-%m")
    return str(value or "")[:7]


def ksb_codes(evidence: dict[str, Any]) -> list[Any]:
    value = evidence.get("ksb_codes")
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def plan(cur) -> tuple[dict[str, Any], str]:
    owner = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=%s', [APTTEM_ID]).fetchone()
    evidence = cur.execute('''SELECT e.*, coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_at
        FROM fetching_evidence.evidence_items e WHERE e.evidence_id=%s''', [EVIDENCE_ID]).fetchone()
    parent = cur.execute('''SELECT id,learner_id,kind,component_type,source_system,source_activity_id,actual_seconds,accepted,activity_status,source_payload
        FROM "Learner".learner_progress_entries WHERE id=%s AND deleted_at IS NULL''', [OLD_PARENT_ID]).fetchone()
    source = cur.execute('''SELECT id,learner_id,source_system,source_activity_id,actual_seconds,accepted,activity_status,canonical_progress_id,source_payload
        FROM "Learner".learner_activity_sources WHERE id=%s AND deleted_at IS NULL''', [SOURCE_ID]).fetchone()
    docs = cur.execute('''SELECT id,progress_id,source_document_id,blob_name,deleted_at
        FROM "Learner".learner_activity_documents WHERE learner_id=%s AND source_document_id IN (%s,%s) AND deleted_at IS NULL''', [owner["id"], f"evidence:{EVIDENCE_ID}:file", f"evidence:{EVIDENCE_ID}:report"]).fetchall() if owner else []
    if not owner or not evidence or not parent or not source:
        raise ValueError("Expected owner, evidence, parent, or source is missing.")
    expected_seconds = int(evidence["spent_time"] or 0) * 60
    payload = {
        "evidence_id": EVIDENCE_ID,
        "aptem_id": APTTEM_ID,
        "old_parent_id": OLD_PARENT_ID,
        "source_id": SOURCE_ID,
        "old_parent_status": {"accepted": bool(parent["accepted"]), "activity_status": parent["activity_status"]},
        "expected_seconds": expected_seconds,
        "existing_source_actual_seconds": int(source["actual_seconds"] or 0),
        "existing_source_canonical_progress_id": int(source["canonical_progress_id"] or 0),
        "file_blob": evidence.get("file_blob"),
        "report_blob": evidence.get("report_blob"),
    }
    return payload, digest(payload)


def evidence_payload(evidence: dict[str, Any], actor: str, run_key: str, new_parent_id: int) -> dict[str, Any]:
    payload = dict(evidence.get("evidence_raw") or {})
    payload["reconciliation"] = {
        "resolution": "reparented_from_nonaccepted_parent",
        "source_evidence_id": EVIDENCE_ID,
        "old_parent_id": OLD_PARENT_ID,
        "new_parent_id": new_parent_id,
        "azure_container": CONTAINER,
        "azure_file_blob": evidence.get("file_blob"),
        "azure_report_blob": evidence.get("report_blob"),
        "estimated": False,
        "actor": actor,
        "run_key": run_key,
    }
    return payload


def ensure_docs(cur, owner_id: int, progress_id: int, evidence: dict[str, Any]) -> int:
    title = " ".join(str(evidence.get("evidence_name") or evidence.get("component_name") or "Aptem evidence").split())[:500]
    added = 0
    for kind in ("file", "report"):
        blob = evidence.get(f"{kind}_blob")
        if not blob:
            continue
        ref = f"evidence:{EVIDENCE_ID}:{kind}"
        existing = cur.execute('''SELECT id FROM "Learner".learner_activity_documents WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''', [owner_id, ref]).fetchone()
        if existing:
            cur.execute('UPDATE "Learner".learner_activity_documents SET progress_id=%s WHERE id=%s', [progress_id, existing["id"]])
            continue
        insert_row(cur, "learner_activity_documents", {
            "learner_id": owner_id,
            "progress_id": progress_id,
            "source_system": "aptem",
            "source_document_id": ref,
            "container": CONTAINER,
            "blob_name": str(blob),
            "display_name": f"{title} — Assessment report" if kind == "report" else title,
            "content_type": mimetypes.guess_type(str(blob))[0] or "application/octet-stream",
            "uploaded_by": "aptem-evidence",
            "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date"),
        })
        added += 1
    return added


def apply(cur, actor: str, expected_fingerprint: str) -> dict[str, Any]:
    payload, fingerprint = plan(cur)
    if fingerprint != expected_fingerprint:
        raise ValueError("Correction fingerprint changed; regenerate the dry-run plan.")
    owner = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [APTTEM_ID]).fetchone()
    evidence = cur.execute('''SELECT e.*, coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_at
        FROM fetching_evidence.evidence_items e WHERE e.evidence_id=%s FOR SHARE''', [EVIDENCE_ID]).fetchone()
    parent = cur.execute('SELECT * FROM "Learner".learner_progress_entries WHERE id=%s AND deleted_at IS NULL FOR UPDATE', [OLD_PARENT_ID]).fetchone()
    source = cur.execute('SELECT * FROM "Learner".learner_activity_sources WHERE id=%s AND deleted_at IS NULL FOR UPDATE', [SOURCE_ID]).fetchone()
    expected_seconds = int(evidence["spent_time"] or 0) * 60
    if bool(parent["accepted"]) or str(parent["activity_status"]) == "Accepted":
        raise ValueError("Old parent is no longer non-accepted; stop and inspect before writing.")
    if int(source["actual_seconds"] or 0) != expected_seconds or int(source["canonical_progress_id"] or 0) != OLD_PARENT_ID:
        raise ValueError("Existing source is not in the expected post-write state.")
    run_key = f"{RUN_KIND}:{fingerprint}"
    if cur.execute('SELECT id FROM "Learner".activity_sync_runs WHERE run_key=%s AND status=\'completed\'', [run_key]).fetchone():
        raise ValueError("This correction was already completed.")
    run_id = insert_row(cur, "activity_sync_runs", {
        "run_key": run_key,
        "run_kind": RUN_KIND,
        "status": "running",
        "dry_run": False,
        "prompt_version": "ADDITIONAL_HOURS_RECONCILIATION_PROMPT.md:femi-reparent-v1",
        "source_counts": Jsonb({"evidence_id": EVIDENCE_ID, "aptem_id": APTTEM_ID, "old_parent_id": OLD_PARENT_ID, "source_id": SOURCE_ID, "actor": actor, "fingerprint": fingerprint}),
        "result_counts": Jsonb({}),
    })
    owner_id = int(owner["id"])
    cur.execute("SELECT pg_advisory_xact_lock(hashtext('femi-commercial-intelligence-additional-hours'),%s::integer)", [owner_id])
    old_payload = dict(parent.get("source_payload") or {})
    old_recon = dict(old_payload.get("reconciliation") or {})
    old_recon.update({"resolution": "reparented_nonaccepted_parent_zeroed", "correction_run_key": run_key, "actor": actor, "old_actual_seconds": int(parent["actual_seconds"] or 0), "new_actual_seconds": 0})
    old_payload["reconciliation"] = old_recon
    cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=0,actual_basis=%s,source_payload=%s,sync_run_id=%s,ssot_updated_at=now() WHERE id=%s''', ["reconciliation:nonaccepted-parent-zeroed", Jsonb(old_payload), run_id, OLD_PARENT_ID])
    order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner_id]).fetchone()["n"]) + 1
    source_ref = f"evidence:{EVIDENCE_ID}"
    new_payload = evidence_payload(evidence, actor, run_key, 0)
    new_parent = insert_row(cur, "learner_progress_entries", {
        "learner_id": owner_id, "entry_order": order, "kind": "additional_job_activity",
        "component_ref": source_ref, "component_title": " ".join(str(evidence.get("component_name") or "Aptem Additional Hours").split())[:500], "component_type": "aptem_additional",
        "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": APTTEM_ID,
        "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref,
        "canonical_activity_key": f"aptem:{APTTEM_ID}:{source_ref}", "activity_status": "Accepted", "accepted": True,
        "actual_seconds": expected_seconds, "actual_basis": BASIS, "reporting_month": month_of(evidence.get("evidence_at")),
        "reporting_timestamp_label": LABEL, "source_payload": Jsonb(new_payload), "sync_run_id": run_id,
    })
    new_payload = evidence_payload(evidence, actor, run_key, new_parent)
    cur.execute('''UPDATE "Learner".learner_progress_entries SET source_payload=%s WHERE id=%s''', [Jsonb(new_payload), new_parent])
    source_payload = dict(source.get("source_payload") or {})
    source_payload["reconciliation"] = {"resolution": "reparented_from_nonaccepted_parent", "old_parent_id": OLD_PARENT_ID, "new_parent_id": new_parent, "actor": actor, "run_key": run_key, "estimated": False}
    cur.execute('''UPDATE "Learner".learner_activity_sources SET canonical_progress_id=%s,source_payload=%s,sync_run_id=%s,last_seen_at=now() WHERE id=%s''', [new_parent, Jsonb(source_payload), run_id, SOURCE_ID])
    docs = ensure_docs(cur, owner_id, new_parent, evidence)
    result = {"read_only": False, "status": "COMPLETED", "run_id": run_id, "evidence_id": EVIDENCE_ID, "old_parent_id": OLD_PARENT_ID, "new_parent_id": new_parent, "source_id": SOURCE_ID, "seconds_reparented": expected_seconds, "documents_added": docs}
    cur.execute('UPDATE "Learner".activity_sync_runs SET status=\'completed\',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', [Jsonb(result), run_id])
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", default=str(DEFAULT_RESULT))
    parser.add_argument("--actor", default=ACTOR_DEFAULT)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    with psycopg.connect(base.database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=120000")
            cur.execute("SET LOCAL lock_timeout=10000")
            db = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            payload, fingerprint = plan(cur)
            result = {"read_only": not args.apply, "database": db, "fingerprint": fingerprint, "actor": args.actor, "plan": payload, "status": "DRY_RUN"}
            if args.apply:
                if args.expected_database != db or args.expected_fingerprint != fingerprint:
                    raise ValueError("Database or correction fingerprint changed; regenerate the dry-run plan.")
                result = {"database": db, "fingerprint": fingerprint, "actor": args.actor, **apply(cur, args.actor, fingerprint)}
                conn.commit()
    Path(args.result).write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
