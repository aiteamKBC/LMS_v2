"""Apply the approved second-pass Aptem Additional Evidence list.

The candidate list is rebuilt from the reviewed dry-run artifacts and the
current database state.  It never imports LMS Activity/Assignment rows and it
refuses existing source/blob identities.  Without ``--apply`` it is read-only;
``--apply`` writes one audited transaction for the currently eligible rows.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import mimetypes
import os
import sys
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DRYRUN = ROOT / "reports" / "additional_hours_89_dryrun_2026-10-04.json"
CONTENT = ROOT / "reports" / "additional_hours_89_content_dryrun_2026-10-04.json"
CONTAINER = "fetch-aptem-evidences"
LABEL = "Estimated — approval required"
BASIS = "aptem:accepted-additional-job-activity-spent-minutes;azure-verified;estimated-reporting-allocation"
RUN_KIND = "additional-hours-remaining-80-evidence-reconciliation-v1"
PROMPT_VERSION = "v2-additional-hours-remaining-80-approved"

# This is the post-run-1683 below-Aptem scope.  It is deliberately explicit so
# a later rerun cannot expand to the nine learners already equal/above Aptem.
CURRENT_BELOW_IDS = {
    4115, 1000, 764, 806, 1521, 739, 18756, 17038, 1132, 1570, 1797,
    10624, 4336, 10208, 3487, 1428, 16474, 8530, 652, 17753, 6473, 6477,
    1573, 18000, 1566, 17254, 16001, 63, 16742, 10122, 16221, 1392,
    1052, 1262, 2371, 10074, 1518, 17429, 6240, 3598, 4035, 1168, 5144,
    15796, 6456, 16749, 6105, 17129, 18962, 1498, 17424, 4065, 6254,
    8162, 6378, 17045, 17922, 6436, 16476, 6333, 1145, 6498, 3274,
    15794, 4407, 8861, 18587, 8635, 17825, 17930, 1277, 14183, 8903,
    75, 6524, 14235, 8580, 10071, 1268, 6203,
}


def env_values() -> dict[str, str]:
    values = dict(os.environ)
    for raw in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def database_url() -> str:
    values = env_values()
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise ValueError("No configured enrolment database.")


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


def load_actions() -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
    dry = json.loads(DRYRUN.read_text(encoding="utf-8"))
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    content_by_id = {int(row["eid"]): row for row in content.get("rows", [])}
    actions = [
        row for row in dry.get("actions", [])
        if int(row.get("aid")) in CURRENT_BELOW_IDS
        and row.get("classification") == "AGGREGATE_PARENT_REVIEW"
        and content_by_id.get(int(row.get("eid")), {}).get("classification")
        in {"CONTENT_MATCH", "CONTENT_NO_EXPLICIT_DURATION"}
    ]
    if not actions:
        raise ValueError("No reviewed second-pass candidates found.")
    return actions, content_by_id


def extended_bank_holidays() -> set[date]:
    return {
        date(y, m, d) for y, m, d in (
            (2025, 1, 1), (2025, 4, 18), (2025, 4, 21), (2025, 5, 5),
            (2025, 5, 26), (2025, 8, 25), (2025, 12, 25), (2025, 12, 26),
            (2026, 1, 1), (2026, 4, 3), (2026, 4, 6), (2026, 5, 4),
            (2026, 5, 25), (2026, 8, 31), (2026, 12, 25), (2026, 12, 28),
            (2027, 1, 1),
        )
    }


def read_state(cur, actions: list[dict[str, Any]]) -> dict[str, Any]:
    aids = sorted({int(row["aid"]) for row in actions})
    eids = sorted({int(row["eid"]) for row in actions})
    owners = cur.execute(
        'SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=ANY(%s)',
        [aids],
    ).fetchall()
    if {int(row["aptem_id"]) for row in owners} != set(aids):
        raise ValueError("Candidate learner identity changed or is incomplete.")
    owner_ids = [int(row["id"]) for row in owners]
    aptem = cur.execute(
        'SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)',
        [aids],
    ).fetchall()
    evidence = cur.execute(
        '''SELECT e.*,coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_at
             FROM fetching_evidence.evidence_items e WHERE e.evidence_id=ANY(%s)''',
        [eids],
    ).fetchall()
    if len(evidence) != len(eids):
        raise ValueError("Reviewed Evidence is missing from the Aptem mirror.")
    progress = cur.execute(
        'SELECT * FROM "Learner".learner_progress_entries WHERE learner_id=ANY(%s) AND deleted_at IS NULL',
        [owner_ids],
    ).fetchall()
    sources = cur.execute(
        'SELECT * FROM "Learner".learner_activity_sources WHERE learner_id=ANY(%s) AND deleted_at IS NULL',
        [owner_ids],
    ).fetchall()
    segments = cur.execute(
        'SELECT * FROM "Learner".learner_activity_reporting_segments WHERE learner_id=ANY(%s)',
        [owner_ids],
    ).fetchall()
    documents = cur.execute(
        'SELECT * FROM "Learner".learner_activity_documents WHERE learner_id=ANY(%s) AND deleted_at IS NULL',
        [owner_ids],
    ).fetchall()
    journals = cur.execute(
        'SELECT * FROM "Learner".learner_journal_rows WHERE canonical_learner_id=ANY(%s) AND deleted_at IS NULL',
        [owner_ids],
    ).fetchall()
    old_ids = base.ALL_APTEM_IDS
    base.ALL_APTEM_IDS = aids
    try:
        breaks = base.read_breaks(cur)
    finally:
        base.ALL_APTEM_IDS = old_ids
    return {
        "owners": {int(row["aptem_id"]): row for row in owners},
        "aptem": {int(row["aptem_id"]): row for row in aptem},
        "breaks": breaks,
        "evidence": {int(row["evidence_id"]): row for row in evidence},
        "progress": progress,
        "sources": sources,
        "segments": segments,
        "documents": documents,
        "journals": journals,
    }


def source_evidence_id(source: dict[str, Any]) -> int | None:
    ref = str(source.get("source_activity_id") or "")
    if ref.startswith("evidence:"):
        try:
            return int(ref.split(":", 1)[1])
        except ValueError:
            pass
    payload = source.get("source_payload") or {}
    reconciliation = payload.get("reconciliation") if isinstance(payload, dict) else {}
    value = reconciliation.get("source_evidence_id") if isinstance(reconciliation, dict) else None
    if value is None and isinstance(payload, dict):
        value = payload.get("Id")
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def build_plan(cur, actions: list[dict[str, Any]], state: dict[str, Any], apply: bool) -> dict[str, Any]:
    # Locks are acquired only in apply mode, after candidate scope is known.
    if apply:
        for aid in sorted({int(row["aid"]) for row in actions}):
            cur.execute('SELECT id FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [aid])
    owners_by_id = {int(row["id"]): row for row in state["owners"].values()}
    sources_by_owner: dict[int, list[dict[str, Any]]] = defaultdict(list)
    docs_by_owner: dict[int, set[str]] = defaultdict(set)
    for source in state["sources"]:
        sources_by_owner[int(source["learner_id"])].append(source)
    for doc in state["documents"]:
        docs_by_owner[int(doc["learner_id"])].add(str(doc.get("blob_name") or ""))
    candidates: list[dict[str, Any]] = []
    represented: list[dict[str, Any]] = []
    for action in actions:
        aid, eid = int(action["aid"]), int(action["eid"])
        evidence = state["evidence"].get(eid)
        if not evidence or int(evidence["learner_id"]) != aid:
            raise ValueError(f"Evidence {eid} learner identity changed.")
        if str(evidence.get("evidence_status") or "").casefold() != "accepted":
            raise ValueError(f"Evidence {eid} is no longer Accepted.")
        if not base.is_additional_component(evidence.get("component_name")):
            raise ValueError(f"Evidence {eid} is no longer Additional job activity.")
        minutes = Decimal(str(evidence.get("spent_time") or 0))
        if minutes <= 0 or minutes != minutes.to_integral_value():
            raise ValueError(f"Evidence {eid} has an invalid duration.")
        owner = state["owners"][aid]
        owner_id = int(owner["id"])
        source_matches = [s for s in sources_by_owner[owner_id] if source_evidence_id(s) == eid]
        blob_matches = [d for d in docs_by_owner[owner_id] if evidence.get("file_blob") and d == str(evidence["file_blob"])]
        if source_matches or blob_matches:
            represented.append({"aid": aid, "eid": eid, "reason": "source_or_blob_already_represented"})
            continue
        day = base.evidence_day(evidence)
        period = state["aptem"].get(aid)
        if not day or not period or not period.get("start_date") or not period.get("end_date"):
            raise ValueError(f"Evidence {eid} has no valid reporting date/period.")
        # Date capacity (including outside Start/End, weekends, breaks, and
        # daily/weekly/monthly limits) is resolved by the allocator below.  A
        # learner with no complete allocation is kept in ``blocked`` rather
        # than being forced into an invalid timestamp.
        candidates.append({"action": action, "evidence": evidence, "owner": owner, "minutes": int(minutes)})

    by_owner: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in candidates:
        by_owner[int(item["owner"]["id"])].append(item)
    segments_by_eid: dict[int, list[dict[str, Any]]] = defaultdict(list)
    blocked: list[dict[str, Any]] = []
    for owner_id, items in sorted(by_owner.items()):
        usage, lecture_days = base.existing_occupancy(state, owner_id, set())
        planned: dict[date, int] = defaultdict(int)
        rows = [item["evidence"] for item in items]
        try:
            allocated = base.allocate(owner_id, state, rows, set(), usage, lecture_days, planned)
        except Exception as error:
            blocked.append({
                "aptem_id": int(owners_by_id[owner_id]["aptem_id"]),
                "learner": owners_by_id[owner_id]["full_name"],
                "evidence_ids": [int(item["evidence"]["evidence_id"]) for item in items],
                "minutes": sum(int(item["minutes"]) for item in items),
                "reason": str(error),
            })
            continue
        for segment in allocated:
            segments_by_eid[int(segment["evidence_id"])].append(segment)

    blocked_eids = {eid for item in blocked for eid in item["evidence_ids"]}
    final = [item for item in candidates if int(item["evidence"]["evidence_id"]) not in blocked_eids]
    for item in final:
        eid = int(item["evidence"]["evidence_id"])
        segments = segments_by_eid[eid]
        expected = int(item["minutes"]) * 60
        if sum(int(seg["seconds"]) for seg in segments) != expected:
            raise ValueError(f"Segment total mismatch for Evidence {eid}.")
        item["segments"] = segments
    return {
        "candidates": final,
        "represented": represented,
        "blocked": blocked,
        "fingerprint": digest({
            "candidate_ids": [int(item["evidence"]["evidence_id"]) for item in final],
            "segments": segments_by_eid,
            "represented": represented,
            "blocked": blocked,
        }),
    }


def payload_for(evidence: dict[str, Any], segments: list[dict[str, Any]], parent_id: int | None) -> dict[str, Any]:
    payload = dict(evidence.get("evidence_raw") or {})
    payload["reconciliation"] = {
        "resolution": "additional_hours_from_accepted_evidence",
        "source_evidence_id": int(evidence["evidence_id"]),
        "source_evidence_ids": [int(evidence["evidence_id"])],
        "basis": BASIS,
        "content_reviewed": True,
        "azure_container": CONTAINER,
        "azure_file_blob": evidence.get("file_blob"),
        "azure_report_blob": evidence.get("report_blob"),
        "segments": segments,
        "estimated_timestamp_allocation": True,
        "approval_required": True,
        "label": LABEL,
        "canonical_progress_id": parent_id,
        "lms_activity_added": False,
        "original_evidence_date": str(evidence.get("evidence_at")),
    }
    payload["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    if evidence.get("note_content"):
        payload["note_content"] = evidence["note_content"]
    return payload


def write_plan(cur, state: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    candidates = plan["candidates"]
    run_id = insert_row(cur, "activity_sync_runs", {
        "run_key": f"{RUN_KIND}:{plan['fingerprint']}",
        "run_kind": RUN_KIND,
        "status": "running",
        "dry_run": False,
        "prompt_version": PROMPT_VERSION,
        "source_counts": Jsonb({"scope": len(CURRENT_BELOW_IDS), "approved_evidence_candidates": len(candidates), "azure_verified": True}),
        "result_counts": Jsonb({}),
    })
    created_parents = created_sources = created_segments = created_docs = 0
    next_order: dict[int, int] = {}
    for item in candidates:
        evidence = item["evidence"]
        owner = item["owner"]
        aid, eid = int(owner["aptem_id"]), int(evidence["evidence_id"])
        owner_id = int(owner["id"])
        source_ref = f"evidence:{eid}"
        # Re-check the exact identity after locks; any race aborts the transaction.
        if cur.execute('''SELECT id,actual_seconds FROM "Learner".learner_activity_sources
                          WHERE learner_id=%s AND source_system='aptem' AND source_activity_id=%s AND deleted_at IS NULL FOR UPDATE''',
                       [owner_id, source_ref]).fetchone():
            raise ValueError(f"Evidence {eid} acquired an active source after dry-run.")
        if owner_id not in next_order:
            next_order[owner_id] = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner_id]).fetchone()["n"])
        next_order[owner_id] += 1
        segments = item["segments"]
        total = sum(int(seg["seconds"]) for seg in segments)
        parent_payload = payload_for(evidence, segments, None)
        title = str(evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Additional Evidence {eid}")[:500]
        parent_id = insert_row(cur, "learner_progress_entries", {
            "learner_id": owner_id, "entry_order": next_order[owner_id], "kind": "additional_job_activity",
            "component_ref": source_ref, "component_title": title, "component_type": "aptem_additional",
            "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid,
            "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref,
            "canonical_activity_key": f"aptem:{aid}:{source_ref}", "activity_status": "Accepted", "accepted": True,
            "actual_seconds": total, "actual_basis": BASIS,
            "reporting_started_at": datetime.fromisoformat(segments[0]["start"]),
            "reporting_ended_at": datetime.fromisoformat(segments[-1]["end"]),
            "reporting_month": segments[0]["month"], "reporting_timestamp_label": LABEL,
            "source_payload": Jsonb(payload_for(evidence, segments, None)), "sync_run_id": run_id,
        })
        cur.execute('''UPDATE "Learner".learner_progress_entries SET source_payload=%s WHERE id=%s''',
                    [Jsonb(payload_for(evidence, segments, parent_id)), parent_id])
        created_parents += 1
        cur.execute('''INSERT INTO "Learner".learner_activity_sources
            (learner_id,enrolment_id,programme_id,aptem_id,source_system,source_activity_id,source_attempt_key,
             curriculum_component_id,canonical_activity_key,activity_type,title,activity_status,completed,accepted,
             actual_seconds,actual_basis,source_started_at,source_ended_at,reporting_started_at,reporting_ended_at,
             reporting_month,ksb_codes,source_payload,sync_run_id,canonical_progress_id,source_fingerprint)
            VALUES (%s,%s,%s,%s,'aptem',%s,%s,%s,%s,'additional_job_activity',%s,'Accepted',TRUE,TRUE,
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''', [
            owner_id, owner.get("enrolment_id"), owner.get("programme_id"), aid, source_ref, source_ref,
            evidence.get("component_id"), f"aptem:{aid}:{source_ref}", title, total, BASIS,
            datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]),
            datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]),
            segments[0]["month"], Jsonb(evidence.get("ksb_codes") or []), Jsonb(payload_for(evidence, segments, parent_id)),
            run_id, parent_id, digest({"evidence_id": eid, "actual_seconds": total, "file_blob": evidence.get("file_blob"), "report_blob": evidence.get("report_blob")}),
        ])
        created_sources += 1
        for segment_order, segment in enumerate(segments, 1):
            insert_row(cur, "learner_activity_reporting_segments", {
                "progress_id": parent_id, "learner_id": owner_id, "segment_order": segment_order,
                "actual_seconds": int(segment["seconds"]),
                "reporting_started_at": datetime.fromisoformat(segment["start"]),
                "reporting_ended_at": datetime.fromisoformat(segment["end"]),
                "reporting_month": segment["month"], "sync_run_id": run_id,
            })
            created_segments += 1
        for kind in ("file", "report"):
            blob = evidence.get(f"{kind}_blob")
            if not blob:
                continue
            doc_ref = f"evidence:{eid}:{kind}"
            if cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents
                              WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL FOR UPDATE''',
                           [owner_id, doc_ref]).fetchone():
                continue
            display = title if kind == "file" else f"{title} — Assessment report"
            insert_row(cur, "learner_activity_documents", {
                "learner_id": owner_id, "progress_id": parent_id, "source_system": "aptem",
                "source_document_id": doc_ref, "container": CONTAINER, "blob_name": str(blob),
                "display_name": display[:500], "content_type": mimetypes.guess_type(str(blob))[0] or "application/octet-stream",
                "uploaded_by": "aptem-evidence", "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date"),
            })
            created_docs += 1
    result = {
        "scope": len(CURRENT_BELOW_IDS), "candidates_written": len(candidates),
        "hours_added_seconds": sum(int(item["minutes"]) * 60 for item in candidates),
        "parents_inserted": created_parents, "sources_inserted": created_sources,
        "segments_inserted": created_segments, "documents_inserted": created_docs,
        "lms_excluded": 0, "represented_skipped": len(plan["represented"]),
        "blocked": plan["blocked"], "label": LABEL, "azure_container": CONTAINER,
        "fingerprint": plan["fingerprint"],
    }
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''',
                ["completed_with_issues" if plan["blocked"] else "completed", Jsonb(result), run_id])
    result["run_id"] = run_id
    return result


def main() -> None:
    apply = "--apply" in sys.argv[1:]
    # Use the same calendar policy as the prior approved run, extended for 2025.
    base.bank_holidays = extended_bank_holidays
    actions, _ = load_actions()
    with psycopg.connect(database_url(), connect_timeout=20, row_factory=dict_row) as conn:
        conn.read_only = not apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=180000")
            cur.execute("SET LOCAL lock_timeout=10000")
            state = read_state(cur, actions)
            plan = build_plan(cur, actions, state, apply)
            summary = {
                "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
                "read_only": not apply,
                "reviewed_actions": len(actions),
                "preliminary_new": len(plan["candidates"]) + len(plan["represented"]),
                "candidates": len(plan["candidates"]),
                "represented_skipped": len(plan["represented"]),
                "blocked": plan["blocked"],
                "hours_candidate_seconds": sum(int(item["minutes"]) * 60 for item in plan["candidates"]),
                "segments_candidate": sum(len(item["segments"]) for item in plan["candidates"]),
                "fingerprint": plan["fingerprint"],
            }
            if apply:
                summary.update(write_plan(cur, state, plan))
        # transaction commits only after all parents, sources, segments, docs,
        # audit rows, and post-insert checks below succeed.
        if apply:
            with conn.cursor() as verify:
                run_id = summary["run_id"]
                verify.execute('''SELECT COUNT(*) AS n, COALESCE(SUM(actual_seconds),0) AS seconds
                                  FROM "Learner".learner_progress_entries WHERE sync_run_id=%s AND deleted_at IS NULL''', [run_id])
                check = verify.fetchone()
                if int(check["n"]) != int(summary["candidates"]):
                    raise ValueError("Post-write parent count verification failed.")
                if int(check["seconds"]) != int(summary["hours_added_seconds"]):
                    raise ValueError("Post-write hours verification failed.")
                verify.execute('''SELECT COUNT(*) AS n FROM "Learner".learner_activity_sources
                                  WHERE sync_run_id=%s AND activity_type <> 'additional_job_activity' ''', [run_id])
                if int(verify.fetchone()["n"]):
                    raise ValueError("A non-Additional source was written.")
    print(json.dumps(summary, default=str, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as error:
        print(json.dumps({"error": str(error) if isinstance(error, ValueError) else type(error).__name__}, ensure_ascii=False))
        raise
