"""Apply the reviewed Femi Commercial Intelligence Additional Hours plan.

The command is read-only by default.  ``--apply`` requires the database name
and the fingerprint of the immediately preceding dry-run report.  It writes
only NEW_LEGITIMATE Aptem evidence and PARENT_NEEDS_ACTUAL_REPAIR lineage;
ambiguous, duration-conflict, blocked, and LMS rows are never changed here.
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


DEFAULT_REPORT = Path(__file__).resolve().parents[1] / "reports" / "femi_commercial_intelligence_dryrun_before_write.json"
DEFAULT_RESULT = Path(__file__).resolve().parents[1] / "reports" / "femi_commercial_intelligence_write_result.json"
RUN_KIND = "femi-commercial-intelligence-additional-hours-v1"
PROMPT_VERSION = "ADDITIONAL_HOURS_RECONCILIATION_PROMPT.md:femi-over60-safe-write-v1"
CONTAINER = "fetch-aptem-evidences"
BASIS = "aptem:accepted-additional-job-activity-spent-minutes;azure-verified;date-evidenced-no-synthetic-timestamp"
LABEL = "Aptem evidence date — no synthetic timestamp"
ACTOR_DEFAULT = "Ayman"


def digest(value: Any) -> str:
    raw = json.dumps(value, default=str, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def fmt(seconds: int) -> str:
    seconds = int(seconds)
    return f"{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


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
    text = str(value or "")
    return text[:7] if len(text) >= 7 else ""


def load_report(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]], str]:
    report = json.loads(path.read_text(encoding="utf-8"))
    if not report.get("read_only") or report.get("write_performed"):
        raise ValueError("The input report is not a read-only dry run.")
    learners = {int(row["aptem_id"]): row for row in report.get("learners", [])}
    new_rows: dict[int, dict[str, Any]] = {}
    repairs: dict[int, dict[str, Any]] = {}
    for row in report.get("candidates", []):
        aid = int(row["aptem_id"])
        learner = learners.get(aid)
        if not learner:
            raise ValueError(f"Evidence {row.get('evidence_id')} has no learner report.")
        diff = int(learner["ssot_accepted_before_seconds"]) - int(learner["additional_accepted_valid_seconds"])
        if diff <= 60 * 60 * 60:
            continue
        status = row.get("status")
        if status == "NEW_LEGITIMATE":
            if row.get("allocation_status") not in (None, "READY"):
                raise ValueError(f"Evidence {row['evidence_id']} has a blocked allocation.")
            new_rows[int(row["evidence_id"])] = row
        elif status == "PARENT_NEEDS_ACTUAL_REPAIR":
            repairs[int(row["evidence_id"])] = row
    # Every eligible write is keyed by Evidence ID, preventing a shared learner
    # (Helena Davies) or repeated group membership from being written twice.
    selected = list(new_rows.values()) + list(repairs.values())
    plan = {
        "database": report.get("database"),
        "report_scope": report.get("scope"),
        "new_evidence_ids": sorted(new_rows),
        "repair_evidence_ids": sorted(repairs),
        "statuses_held": ["ALREADY_REPRESENTED", "DURATION_CONFLICT", "AMBIGUOUS", "BLOCKED"],
        "lms_excluded": 0,
    }
    return report, list(new_rows.values()), list(repairs.values()), digest(plan)


def load_evidence(cur, eids: list[int]) -> dict[int, dict[str, Any]]:
    rows = cur.execute(
        '''SELECT e.*, coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_at
             FROM fetching_evidence.evidence_items e
            WHERE e.evidence_id=ANY(%s)''',
        [eids],
    ).fetchall()
    return {int(row["evidence_id"]): row for row in rows}


def validate_evidence(cur, row: dict[str, Any], owners: dict[int, dict[str, Any]], state: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    eid = int(row["evidence_id"]); aid = int(row["learner_id"])
    if aid not in owners:
        raise ValueError(f"Evidence {eid} learner {aid} is outside the Femi roster.")
    if str(row.get("evidence_status") or "").casefold() != "accepted":
        raise ValueError(f"Evidence {eid} is no longer Accepted.")
    if not base.is_additional_component(row.get("component_name")):
        raise ValueError(f"Evidence {eid} is not an Additional job activity component.")
    minutes = int(row.get("spent_time") or 0)
    if minutes <= 0:
        raise ValueError(f"Evidence {eid} has no positive spent_time.")
    ok, reason = base.accepted_evidence_day_valid(row, state)
    if not ok:
        raise ValueError(f"Evidence {eid} failed date validation: {reason}.")
    return owners[aid], {"eid": eid, "aid": aid, "minutes": minutes, "seconds": minutes * 60, "day": base.evidence_day(row)}


def evidence_payload(evidence: dict[str, Any], actor: str, resolution: str, run_key: str, parent_id: int | None = None) -> dict[str, Any]:
    payload = dict(evidence.get("evidence_raw") or {})
    payload["reconciliation"] = {
        "resolution": resolution,
        "source_evidence_id": int(evidence["evidence_id"]),
        "component_name": evidence.get("component_name"),
        "original_evidence_date": str(evidence.get("evidence_at")),
        "azure_container": CONTAINER,
        "azure_file_blob": evidence.get("file_blob"),
        "azure_report_blob": evidence.get("report_blob"),
        "reporting_allocation": "date-evidenced-no-synthetic-timestamp",
        "estimated": False,
        "actor": actor,
        "run_key": run_key,
        "canonical_progress_id": parent_id,
    }
    return payload


def ksb_codes(evidence: dict[str, Any]) -> list[Any]:
    """Carry only KSB metadata present in the Aptem mirror; never infer codes."""
    value = evidence.get("ksb_codes")
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


def ensure_documents(cur, owner_id: int, progress_id: int, evidence: dict[str, Any]) -> int:
    count = 0
    title = " ".join(str(evidence.get("evidence_name") or evidence.get("component_name") or "Aptem evidence").split())[:500]
    for kind in ("file", "report"):
        blob = evidence.get(f"{kind}_blob")
        if not blob:
            continue
        ref = f"evidence:{int(evidence['evidence_id'])}:{kind}"
        exists = cur.execute(
            '''SELECT id FROM "Learner".learner_activity_documents
               WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''',
            [owner_id, ref],
        ).fetchone()
        if exists:
            continue
        display = f"{title} — Assessment report" if kind == "report" else title
        insert_row(cur, "learner_activity_documents", {
            "learner_id": owner_id,
            "progress_id": progress_id,
            "source_system": "aptem",
            "source_document_id": ref,
            "container": CONTAINER,
            "blob_name": str(blob),
            "display_name": display[:500],
            "content_type": mimetypes.guess_type(str(blob))[0] or "application/octet-stream",
            "uploaded_by": "aptem-evidence",
            "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date"),
        })
        count += 1
    return count


def make_parent(cur, owner: dict[str, Any], aid: int, evidence: dict[str, Any], seconds: int, run_id: int, actor: str, run_key: str) -> int:
    owner_id = int(owner["id"])
    order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner_id]).fetchone()["n"]) + 1
    source_ref = f"evidence:{int(evidence['evidence_id'])}"
    month = month_of(evidence.get("evidence_at"))
    title = " ".join(str(evidence.get("component_name") or evidence.get("evidence_name") or "Aptem Additional Hours").split())[:500]
    payload = evidence_payload(evidence, actor, "accepted_additional_hours_new_source", run_key)
    parent_id = insert_row(cur, "learner_progress_entries", {
        "learner_id": owner_id, "entry_order": order, "kind": "additional_job_activity",
        "component_ref": source_ref, "component_title": title, "component_type": "aptem_additional",
        "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid,
        "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref,
        "canonical_activity_key": f"aptem:{aid}:{source_ref}", "activity_status": "Accepted", "accepted": True,
        "actual_seconds": seconds, "actual_basis": BASIS, "reporting_month": month,
        "reporting_timestamp_label": LABEL, "source_payload": Jsonb(payload), "sync_run_id": run_id,
    })
    cur.execute('''INSERT INTO "Learner".learner_activity_sources
        (learner_id,enrolment_id,programme_id,aptem_id,source_system,source_activity_id,source_attempt_key,
         curriculum_component_id,canonical_activity_key,activity_type,title,activity_status,completed,accepted,
         actual_seconds,actual_basis,reporting_month,ksb_codes,source_payload,sync_run_id,canonical_progress_id,source_fingerprint)
        VALUES (%s,%s,%s,%s,'aptem',%s,%s,%s,%s,'additional_hours',%s,'Accepted',TRUE,TRUE,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT DO NOTHING''', [owner_id, owner.get("enrolment_id"), owner.get("programme_id"), aid,
        source_ref, source_ref, evidence.get("component_id"), f"aptem:{aid}:{source_ref}", title, seconds, BASIS,
        month, Jsonb(ksb_codes(evidence)), Jsonb({**payload, "additional_hours": {"category": "additional_hours", "component_name": evidence.get("component_name")}}),
        run_id, parent_id, digest({"evidence_id": int(evidence["evidence_id"]), "seconds": seconds})])
    if cur.rowcount != 1:
        raise ValueError(f"Evidence {evidence['evidence_id']} source was not inserted.")
    return parent_id


def apply_parent_repair(cur, owner: dict[str, Any], evidence_rows: list[dict[str, Any]], run_id: int, actor: str, run_key: str) -> dict[str, int]:
    owner_id = int(owner["id"])
    by_parent: dict[int, list[dict[str, Any]]] = {}
    for evidence in evidence_rows:
        eid = int(evidence["evidence_id"])
        source = cur.execute('''SELECT id,actual_seconds,canonical_progress_id FROM "Learner".learner_activity_sources
          WHERE learner_id=%s AND source_system='aptem' AND source_activity_id=%s AND deleted_at IS NULL FOR UPDATE''', [owner_id, f"evidence:{eid}"]).fetchone()
        if not source or not source["canonical_progress_id"]:
            raise ValueError(f"Repair source missing for evidence {eid}.")
        item = dict(evidence); item["_source"] = source
        by_parent.setdefault(int(source["canonical_progress_id"]), []).append(item)
    updated_parents = updated_sources = 0
    for parent_id, items in by_parent.items():
        parent = cur.execute('''SELECT * FROM "Learner".learner_progress_entries WHERE id=%s AND learner_id=%s AND deleted_at IS NULL FOR UPDATE''', [parent_id, owner_id]).fetchone()
        if not parent or str(parent.get("source_system") or "") != "aptem":
            raise ValueError(f"Repair parent {parent_id} missing/non-Aptem.")
        if not bool(parent.get("accepted")) or str(parent.get("activity_status") or "") != "Accepted":
            raise ValueError(
                f"Repair parent {parent_id} is not an Accepted parent; create an independent Aptem row instead."
            )
        expected = sum(int(e["spent_time"] or 0) * 60 for e in items)
        current_parent = int(parent.get("actual_seconds") or 0)
        if current_parent not in (0, expected):
            raise ValueError(f"Repair parent {parent_id} has conflicting actual {current_parent}; expected 0/{expected}.")
        if current_parent == 0:
            payload = dict(parent.get("source_payload") or {})
            recon = dict(payload.get("reconciliation") or {})
            recon.update({"resolution": "existing_parent_actual_repair", "source_evidence_ids": [int(e["evidence_id"]) for e in items], "actor": actor, "run_key": run_key, "estimated": False, "label": LABEL})
            payload["reconciliation"] = recon
            cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=%s,actual_basis=%s,
                reporting_month=COALESCE(NULLIF(reporting_month,''),%s),reporting_timestamp_label=%s,source_payload=%s,
                sync_run_id=%s,ssot_updated_at=now() WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
                [expected, BASIS, month_of(items[0].get("evidence_at")), LABEL, Jsonb(payload), run_id, parent_id, owner_id])
            updated_parents += 1
        for evidence in items:
            src = evidence["_source"]; seconds = int(evidence["spent_time"] or 0) * 60
            if int(src.get("actual_seconds") or 0) not in (0, seconds):
                raise ValueError(f"Repair source {src['id']} has conflicting actual.")
            payload = evidence_payload(evidence, actor, "existing_parent_actual_repair", run_key, parent_id)
            if int(src.get("actual_seconds") or 0) == 0:
                cur.execute('''UPDATE "Learner".learner_activity_sources SET actual_seconds=%s,actual_basis=%s,
                    accepted=TRUE,completed=TRUE,activity_status='Accepted',source_payload=%s,sync_run_id=%s,last_seen_at=now()
                    WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''', [seconds, BASIS, Jsonb(payload), run_id, int(src["id"]), owner_id])
                updated_sources += 1
    return {"updated_parents": updated_parents, "updated_sources": updated_sources}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--result", default=str(DEFAULT_RESULT))
    parser.add_argument("--actor", default=ACTOR_DEFAULT)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    report, new_candidates, repair_candidates, fingerprint = load_report(Path(args.report))
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    result: dict[str, Any] = {"read_only": not args.apply, "database": report.get("database"), "fingerprint": fingerprint,
                              "actor": args.actor, "new_candidates": len(new_candidates), "repair_candidates": len(repair_candidates),
                              "lms_excluded": 0, "status": "DRY_RUN"}
    if not args.apply:
        Path(args.result).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False, indent=2)); return 0
    with psycopg.connect(base.database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = False
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=120000")
            cur.execute("SET LOCAL lock_timeout=10000")
            db = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            if db != args.expected_database or fingerprint != args.expected_fingerprint:
                raise ValueError("Database or dry-run fingerprint changed; regenerate the report before apply.")
            # The report's Azure inventory is a prerequisite; no upload is done.
            if report.get("azure", {}).get("missing"):
                raise ValueError("Azure inventory has missing blobs; write is blocked.")
            aids = sorted({int(row["aptem_id"]) for row in new_candidates + repair_candidates})
            owners_rows = cur.execute('''SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=ANY(%s) FOR UPDATE''', [aids]).fetchall()
            owners = {int(row["aptem_id"]): row for row in owners_rows}
            if len(owners) != len(aids):
                raise ValueError("A learner owner changed or disappeared before write.")
            periods = {int(row["aptem_id"]): row for row in cur.execute('''SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)''', [aids]).fetchall()}
            state = {"aptem": periods, "breaks": base.read_breaks(cur)}
            evidence = load_evidence(cur, sorted({int(row["evidence_id"]) for row in new_candidates + repair_candidates}))
            if len(evidence) != len(new_candidates) + len(repair_candidates):
                raise ValueError("One or more evidence rows changed or disappeared.")
            validated = {}
            for row in evidence.values():
                owner, checked = validate_evidence(cur, row, owners, state)
                validated[int(row["evidence_id"])] = (owner, checked)
            plan_key = f"{RUN_KIND}:{fingerprint}"
            existing_run = cur.execute('SELECT id,status FROM "Learner".activity_sync_runs WHERE run_key=%s', [plan_key]).fetchone()
            if existing_run and existing_run["status"] == "completed":
                raise ValueError(f"This exact plan was already completed as run {existing_run['id']}.")
            run_id = insert_row(cur, "activity_sync_runs", {
                "run_key": plan_key, "run_kind": RUN_KIND, "status": "running", "dry_run": False,
                "prompt_version": PROMPT_VERSION,
                "source_counts": Jsonb({"scope": report.get("scope"), "actor": args.actor, "new_candidates": len(new_candidates), "parent_repairs": len(repair_candidates), "azure_verified": True, "lms_excluded": 0, "fingerprint": fingerprint}),
                "result_counts": Jsonb({}),
            })
            for owner_id in sorted({int(owner["id"]) for owner in owners.values()}):
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('femi-commercial-intelligence-additional-hours'),%s::integer)", [owner_id])
            created = docs = seconds_added = 0
            for candidate in new_candidates:
                eid = int(candidate["evidence_id"]); ev = evidence[eid]; owner, checked = validated[eid]; owner_id = int(owner["id"]); source_ref = f"evidence:{eid}"
                active = cur.execute('''SELECT id,actual_seconds FROM "Learner".learner_activity_sources WHERE learner_id=%s AND source_system='aptem' AND source_activity_id=%s AND deleted_at IS NULL FOR UPDATE''', [owner_id, source_ref]).fetchall()
                expected = int(checked["seconds"])
                if active:
                    if len(active) != 1 or int(active[0].get("actual_seconds") or 0) != expected:
                        raise ValueError(f"Evidence {eid} has a conflicting active source.")
                    continue
                parent_id = make_parent(cur, owner, int(candidate["aptem_id"]), ev, expected, run_id, args.actor, plan_key)
                docs += ensure_documents(cur, owner_id, parent_id, ev); created += 1; seconds_added += expected
            by_owner: dict[int, list[dict[str, Any]]] = {}
            for candidate in repair_candidates:
                eid = int(candidate["evidence_id"]); ev = evidence[eid]; owner, _ = validated[eid]
                by_owner.setdefault(int(owner["id"]), []).append(ev)
            repaired_parents = repaired_sources = 0
            for owner_id, evs in by_owner.items():
                outcome = apply_parent_repair(cur, owners[int(evs[0]["learner_id"])], evs, run_id, args.actor, plan_key)
                repaired_parents += outcome["updated_parents"]; repaired_sources += outcome["updated_sources"]
            result.update({"read_only": False, "status": "COMPLETED", "run_id": run_id, "created_rows": created,
                           "documents_added": docs, "seconds_added": seconds_added, "parent_rows_updated": repaired_parents,
                           "source_rows_updated": repaired_sources, "lms_excluded": 0})
            cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run_id])
            conn.commit()
    Path(args.result).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2)); return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
