"""Reconcile the currently-below-Aptem learners, using only new Additional Evidence.

The script is intentionally two-phase.  The default command builds a read-only
plan from the original 89-learner review and the live database state.  ``--apply``
rebuilds that plan, checks the fingerprint and writes only NEW Additional
Evidence parents/sources/segments/documents.  LMS Activity, Assignment, Journal,
Old LMS and the Aptem mirror are never modified.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
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
import apply_remaining_80_additional as previous  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DRYRUN = ROOT / "reports" / "additional_hours_89_dryrun_2026-10-04.json"
CONTENT = ROOT / "reports" / "additional_hours_89_content_dryrun_2026-10-04.json"
ROSTER_REPORT = ROOT / "reports" / "ssot_below_aptem_supplied_list_2026-10-04.md"
CONTAINER = "fetch-aptem-evidences"
LABEL = "تقديري — يحتاج اعتماد"
BASIS = "aptem:accepted-additional-job-activity-spent-minutes;azure-verified;estimated-reporting-allocation"
RUN_KIND = "additional-hours-current-below-reconciliation-v1"
PROMPT_VERSION = "v3-current-below-additional-evidence"
SAFE_PARENT_CLASSES = {"AGGREGATE_PARENT_REVIEW", "TIMESTAMP_REVIEW", "ADD_ADDITIONAL"}
SAFE_CONTENT_CLASSES = {"CONTENT_MATCH", "CONTENT_NO_EXPLICIT_DURATION"}
# These two files list several activity lines.  They are eligible only when
# the extracted line durations sum exactly to Aptem spent_time; the allocator
# and active-source checks below still decide whether a write is possible.
SAFE_DURATION_SUM_EIDS = {45607, 47747}


def roster_ids() -> list[int]:
    ids: list[int] = []
    for line in ROSTER_REPORT.read_text(encoding="utf-8").splitlines():
        match = re.match(r"\|\s*(\d+)\s*\|", line)
        if match:
            ids.append(int(match.group(1)))
    if len(set(ids)) != 89:
        raise ValueError("The original 89-learner roster could not be verified.")
    return sorted(set(ids))


def current_below(cur, scope_ids: list[int]) -> tuple[set[int], dict[int, dict[str, Any]]]:
    rows = cur.execute(
        '''WITH ev AS (
                 SELECT learner_id, coalesce(sum(spent_time),0) * 60 AS aptem_sec
                   FROM fetching_evidence.evidence_items
                  WHERE learner_id=ANY(%s) AND evidence_status='Accepted' AND spent_time>0
                  GROUP BY learner_id
             ), prog AS (
                 SELECT l.aptem_id, coalesce(sum(p.actual_seconds),0) AS ssot_sec
                   FROM "Learner".learners l
                   LEFT JOIN "Learner".learner_progress_entries p
                     ON p.learner_id=l.id AND p.accepted IS TRUE AND p.deleted_at IS NULL
                  WHERE l.aptem_id=ANY(%s)
                  GROUP BY l.aptem_id
             )
             SELECT l.aptem_id,l.full_name,
                    coalesce(ev.aptem_sec,0)::bigint AS aptem_sec,
                    coalesce(prog.ssot_sec,0)::bigint AS ssot_sec
               FROM "Learner".learners l
               LEFT JOIN ev ON ev.learner_id=l.aptem_id
               LEFT JOIN prog ON prog.aptem_id=l.aptem_id
              WHERE l.aptem_id=ANY(%s)''',
        [scope_ids, scope_ids, scope_ids],
    ).fetchall()
    if len(rows) != len(scope_ids):
        raise ValueError("Current learner scope is incomplete.")
    by_id = {int(row["aptem_id"]): row for row in rows}
    below = {
        aid for aid, row in by_id.items()
        if int(row["ssot_sec"] or 0) < int(row["aptem_sec"] or 0)
    }
    return below, by_id


def source_evidence_id(source: dict[str, Any]) -> int | None:
    return previous.source_evidence_id(source)


def load_actions(cur) -> tuple[list[dict[str, Any]], set[int], dict[int, dict[str, Any]], dict[int, dict[str, Any]]]:
    dry = json.loads(DRYRUN.read_text(encoding="utf-8"))
    content = json.loads(CONTENT.read_text(encoding="utf-8"))
    content_by_id = {int(row["eid"]): row for row in content.get("rows", [])}
    below, live = current_below(cur, roster_ids())
    actions = []
    for row in dry.get("actions", []):
        aid, eid = int(row.get("aid")), int(row.get("eid"))
        content = content_by_id.get(eid, {})
        ordinary_safe = (
            aid in below
            and row.get("classification") in SAFE_PARENT_CLASSES
            and content.get("classification") in SAFE_CONTENT_CLASSES
        )
        duration_sum_safe = (
            aid in below
            and eid in SAFE_DURATION_SUM_EIDS
            and content.get("classification") == "CONTENT_DURATION_CONFLICT"
            and content.get("durations")
            and abs(sum(float(item[0]) for item in content["durations"]) - float(row.get("minutes") or 0)) < 0.01
        )
        if ordinary_safe or duration_sum_safe:
            actions.append(row)
    if not actions:
        raise ValueError("No reviewed Additional Evidence remains in the current below-Aptem scope.")
    return actions, below, live, content_by_id


def candidate_plan(cur, actions: list[dict[str, Any]], below: set[int], content_by_id: dict[int, dict[str, Any]]) -> dict[str, Any]:
    # The state reader is read-only and scopes all progress/source/document rows
    # to the action owners.  It also reads the Aptem mirror without mutating it.
    previous.base.ALL_APTEM_IDS = sorted(below)
    state = previous.read_state(cur, actions)
    owners = state["owners"]
    owner_by_aid = {int(aid): row for aid, row in owners.items()}
    owner_id_by_aid = {aid: int(row["id"]) for aid, row in owner_by_aid.items()}
    active_sources = {
        (int(row["learner_id"]), str(row.get("source_activity_id")))
        for row in state["sources"] if row.get("deleted_at") is None
    }
    active_blobs = {
        (int(row["learner_id"]), str(row.get("blob_name") or ""))
        for row in state["documents"] if row.get("deleted_at") is None
    }
    evidence_by_id = {int(eid): row for eid, row in state["evidence"].items()}
    represented: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    for action in actions:
        aid, eid = int(action["aid"]), int(action["eid"])
        evidence = evidence_by_id.get(eid)
        if not evidence:
            excluded.append({"aid": aid, "eid": eid, "reason": "evidence_missing_from_mirror"})
            continue
        if str(evidence.get("evidence_status") or "").casefold() != "accepted":
            excluded.append({"aid": aid, "eid": eid, "reason": "not_accepted"})
            continue
        if not base.is_additional_component(evidence.get("component_name")):
            excluded.append({"aid": aid, "eid": eid, "reason": "component_not_additional"})
            continue
        minutes = Decimal(str(evidence.get("spent_time") or 0))
        if minutes <= 0 or minutes != minutes.to_integral_value():
            excluded.append({"aid": aid, "eid": eid, "reason": "invalid_spent_time"})
            continue
        owner_id = owner_id_by_aid[aid]
        if (owner_id, f"evidence:{eid}") in active_sources:
            represented.append({"aid": aid, "eid": eid, "reason": "active_source"})
            continue
        blobs = [str(evidence.get("file_blob") or ""), str(evidence.get("report_blob") or "")]
        if any(blob and (owner_id, blob) in active_blobs for blob in blobs):
            represented.append({"aid": aid, "eid": eid, "reason": "active_blob_document"})
            continue
        valid, reason = base.accepted_evidence_day_valid(evidence, state)
        if not valid:
            excluded.append({"aid": aid, "eid": eid, "reason": reason})
            continue
        candidates.append({
            "aid": aid,
            "eid": eid,
            "minutes": int(minutes),
            "evidence": evidence,
            "owner": owner_by_aid[aid],
            "action": action,
            "content": content_by_id.get(eid, {}),
        })

    # Allocate against current occupancy, then against earlier candidates for
    # the same learner.  The allocator enforces London weekdays, bank holidays,
    # break-in-learning, 8h/day, 12h/week and 45h/month.
    used_by: dict[int, dict[date, int]] = {}
    lecture_by: dict[int, set[date]] = {}
    planned_by: dict[int, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    allocated: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for aid in sorted({int(item["aid"]) for item in candidates}):
        owner_id = owner_id_by_aid[aid]
        used_by[owner_id], lecture_by[owner_id] = base.existing_occupancy(state, owner_id, set())
        rows = sorted(
            [item for item in candidates if int(item["aid"]) == aid],
            key=lambda item: (base.evidence_day(item["evidence"]) or date.min, int(item["eid"])),
        )
        for item in rows:
            try:
                segments = base.allocate(
                    owner_id, state, [item["evidence"]], set(), used_by[owner_id],
                    lecture_by[owner_id], planned_by[owner_id],
                )
            except Exception as exc:  # capacity is a review block, never a fabricated write
                blocked.append({"aid": aid, "eid": int(item["eid"]), "minutes": int(item["minutes"]), "reason": str(exc)})
                continue
            item["segments"] = segments
            allocated.append(item)
    flat = [segment for item in allocated for segment in item["segments"]]
    violations = base.allocation_violations([
        {"owner_id": int(item["owner"]["id"]), "evidence_ids": [int(item["eid"])], "segments": item["segments"]}
        for item in allocated
    ])
    if violations:
        raise ValueError(f"Allocator produced timestamp violations: {violations[:3]}")
    fingerprint = previous.digest({
        "below": sorted(below),
        "candidate_ids": [int(item["eid"]) for item in allocated],
        "segments": flat,
        "blocked": blocked,
        "represented": represented,
    })
    return {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "state": state,
        "candidates": allocated,
        "blocked": blocked,
        "represented": represented,
        "excluded": excluded,
        "below": sorted(below),
        "fingerprint": fingerprint,
    }


def evidence_payload(evidence: dict[str, Any], segments: list[dict[str, Any]], parent_id: int | None = None) -> dict[str, Any]:
    payload = dict(evidence.get("evidence_raw") or {})
    payload["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    if evidence.get("note_content"):
        payload["note_content"] = evidence.get("note_content")
    payload["reconciliation"] = {
        "resolution": "new_additional_evidence_current_below",
        "estimated": True,
        "approval_required": True,
        "label": LABEL,
        "source_evidence_id": int(evidence["evidence_id"]),
        "canonical_progress_id": parent_id,
        "segments": segments,
        "azure_container": CONTAINER,
        "azure_file_blob": evidence.get("file_blob"),
        "azure_report_blob": evidence.get("report_blob"),
    }
    return payload


def insert_one_learner(plan: dict[str, Any], aid: int) -> dict[str, Any]:
    items = [item for item in plan["candidates"] if int(item["aid"]) == aid]
    if not items:
        return {"aid": aid, "written": 0, "seconds": 0, "run_id": None}
    with psycopg.connect(previous.database_url(), connect_timeout=30, row_factory=dict_row) as conn:
        conn.read_only = False
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=180000")
            cur.execute("SET LOCAL lock_timeout=10000")
            owner = cur.execute('SELECT * FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [aid]).fetchone()
            if not owner:
                raise ValueError(f"Learner {aid} disappeared before write.")
            for item in items:
                eid = int(item["eid"])
                if cur.execute('''SELECT 1 FROM "Learner".learner_activity_sources
                                  WHERE learner_id=%s AND source_system='aptem' AND source_activity_id=%s
                                    AND deleted_at IS NULL FOR UPDATE''', [owner["id"], f"evidence:{eid}"]).fetchone():
                    raise ValueError(f"Evidence {eid} acquired an active source after dry-run.")
            run_id = previous.insert_row(cur, "activity_sync_runs", {
                "run_key": f"{RUN_KIND}:{plan['fingerprint']}:{aid}",
                "run_kind": RUN_KIND,
                "status": "running",
                "dry_run": False,
                "prompt_version": PROMPT_VERSION,
                "source_counts": Jsonb({"aptem_id": aid, "candidate_evidence": [int(item["eid"]) for item in items], "azure_verified": True}),
                "result_counts": Jsonb({}),
            })
            next_order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner["id"]]).fetchone()["n"])
            parents = sources = segments_count = docs_count = 0
            total_seconds = 0
            for item in items:
                evidence = item["evidence"]
                segments = item["segments"]
                seconds = sum(int(seg["seconds"]) for seg in segments)
                if seconds != int(item["minutes"]) * 60:
                    raise ValueError(f"Evidence {item['eid']} allocation total mismatch.")
                next_order += 1
                title = str(evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Additional Evidence {item['eid']}")[:500]
                parent_payload = evidence_payload(evidence, segments)
                parent_id = previous.insert_row(cur, "learner_progress_entries", {
                    "learner_id": int(owner["id"]), "entry_order": next_order, "kind": "additional_job_activity",
                    "component_ref": f"evidence:{int(item['eid'])}", "component_title": title, "component_type": "aptem_additional",
                    "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid,
                    "source_system": "aptem", "source_activity_id": f"evidence:{int(item['eid'])}", "source_attempt_key": f"evidence:{int(item['eid'])}",
                    "canonical_activity_key": f"aptem:{aid}:evidence:{int(item['eid'])}", "activity_status": "Accepted", "accepted": True,
                    "actual_seconds": seconds, "actual_basis": BASIS,
                    "reporting_started_at": datetime.fromisoformat(segments[0]["start"]),
                    "reporting_ended_at": datetime.fromisoformat(segments[-1]["end"]),
                    "reporting_month": segments[0]["month"], "reporting_timestamp_label": LABEL,
                    "source_payload": Jsonb(parent_payload), "sync_run_id": run_id,
                })
                parent_payload = evidence_payload(evidence, segments, parent_id)
                cur.execute('UPDATE "Learner".learner_progress_entries SET source_payload=%s WHERE id=%s', [Jsonb(parent_payload), parent_id])
                cur.execute('''INSERT INTO "Learner".learner_activity_sources
                    (learner_id,enrolment_id,programme_id,aptem_id,source_system,source_activity_id,source_attempt_key,
                     curriculum_component_id,canonical_activity_key,activity_type,title,activity_status,completed,accepted,
                     actual_seconds,actual_basis,source_started_at,source_ended_at,reporting_started_at,reporting_ended_at,
                     reporting_month,ksb_codes,source_payload,sync_run_id,canonical_progress_id,source_fingerprint)
                    VALUES (%s,%s,%s,%s,'aptem',%s,%s,%s,%s,'additional_job_activity',%s,'Accepted',TRUE,TRUE,
                            %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''', [
                    int(owner["id"]), owner.get("enrolment_id"), owner.get("programme_id"), aid,
                    f"evidence:{int(item['eid'])}", f"evidence:{int(item['eid'])}", evidence.get("component_id"),
                    f"aptem:{aid}:evidence:{int(item['eid'])}", title, seconds, BASIS,
                    datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]),
                    datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]),
                    segments[0]["month"], Jsonb(evidence.get("ksb_codes") or []), Jsonb(parent_payload), run_id, parent_id,
                    previous.digest({"evidence_id": int(item["eid"]), "actual_seconds": seconds, "file_blob": evidence.get("file_blob"), "report_blob": evidence.get("report_blob")}),
                ])
                parents += 1; sources += 1; total_seconds += seconds
                for order, segment in enumerate(segments, 1):
                    previous.insert_row(cur, "learner_activity_reporting_segments", {
                        "progress_id": parent_id, "learner_id": int(owner["id"]), "segment_order": order,
                        "actual_seconds": int(segment["seconds"]), "reporting_started_at": datetime.fromisoformat(segment["start"]),
                        "reporting_ended_at": datetime.fromisoformat(segment["end"]), "reporting_month": segment["month"], "sync_run_id": run_id,
                    })
                    segments_count += 1
                for kind in ("file", "report"):
                    blob = evidence.get(f"{kind}_blob")
                    if not blob:
                        continue
                    doc_ref = f"evidence:{int(item['eid'])}:{kind}"
                    if cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents
                                      WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL FOR UPDATE''', [owner["id"], doc_ref]).fetchone():
                        continue
                    cur.execute('''INSERT INTO "Learner".learner_activity_documents
                        (learner_id,progress_id,source_system,source_document_id,container,blob_name,display_name,content_type,uploaded_by,uploaded_at)
                        VALUES (%s,%s,'aptem',%s,%s,%s,%s,%s,'aptem-evidence',%s)''', [
                        int(owner["id"]), parent_id, doc_ref, CONTAINER, str(blob),
                        title if kind == "file" else f"{title} — Assessment report",
                        mimetypes.guess_type(str(blob))[0] or "application/octet-stream",
                        evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date"),
                    ])
                    docs_count += 1
            result = {"aid": aid, "run_id": run_id, "written": parents, "sources": sources, "segments": segments_count, "documents": docs_count, "seconds": total_seconds}
            cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed", Jsonb(result), run_id])
            check = cur.execute('SELECT count(*) AS n,coalesce(sum(actual_seconds),0) AS seconds FROM "Learner".learner_progress_entries WHERE sync_run_id=%s AND deleted_at IS NULL', [run_id]).fetchone()
            if int(check["n"]) != parents or int(check["seconds"]) != total_seconds:
                raise ValueError(f"Post-write verification failed for learner {aid}.")
        conn.commit()
    return result


def verify_azure(plan: dict[str, Any]) -> dict[str, Any]:
    blobs = []
    for item in plan["candidates"]:
        for kind in ("file", "report"):
            blob = item["evidence"].get(f"{kind}_blob")
            if blob:
                blobs.append((int(item["eid"]), kind, str(blob)))
    if not blobs:
        return {"checked": 0, "found": 0, "missing": [], "status": "notes_only"}
    try:
        from azure.storage.blob import BlobServiceClient
        values = previous.env_values()
        service = BlobServiceClient.from_connection_string(values["AZURE_STORAGE_CONNECTION_STRING"])
    except Exception as exc:
        return {"checked": len(blobs), "found": 0, "missing": [{"evidence_id": eid, "kind": kind, "error": type(exc).__name__} for eid, kind, _ in blobs], "status": "blocked"}
    missing = []
    found = 0
    for eid, kind, blob in blobs:
        try:
            service.get_blob_client(CONTAINER, blob).get_blob_properties()
            found += 1
        except Exception as exc:
            missing.append({"evidence_id": eid, "kind": kind, "error": type(exc).__name__})
    return {"checked": len(blobs), "found": found, "missing": missing, "status": "ok" if not missing else "blocked"}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    apply = "--apply" in sys.argv[1:]
    expected_database = next((arg.split("=", 1)[1] for arg in sys.argv[1:] if arg.startswith("--expected-database=")), None)
    expected_fingerprint = next((arg.split("=", 1)[1] for arg in sys.argv[1:] if arg.startswith("--expected-fingerprint=")), None)
    if apply and (not expected_database or not expected_fingerprint):
        raise ValueError("--apply requires --expected-database and --expected-fingerprint.")
    previous.base.bank_holidays = previous.extended_bank_holidays
    base.bank_holidays = previous.extended_bank_holidays
    with psycopg.connect(previous.database_url(), connect_timeout=30, row_factory=dict_row) as conn:
        conn.read_only = not apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=180000")
            cur.execute("SET LOCAL lock_timeout=10000")
            actions, below, live, content_by_id = load_actions(cur)
            plan = candidate_plan(cur, actions, below, content_by_id)
            azure = verify_azure(plan)
            summary = {
                "database": plan["database"], "read_only": not apply, "below_count": len(below),
                "reviewed_actions": len(actions), "candidate_count": len(plan["candidates"]),
                "candidate_seconds": sum(int(item["minutes"]) * 60 for item in plan["candidates"]),
                "blocked": plan["blocked"], "represented_count": len(plan["represented"]),
                "excluded_count": len(plan["excluded"]), "azure": azure, "fingerprint": plan["fingerprint"],
                "candidate_ids": [int(item["eid"]) for item in plan["candidates"]],
                "learners": sorted({int(item["aid"]) for item in plan["candidates"]}),
                "candidate_details": [
                    {"aid": int(item["aid"]), "eid": int(item["eid"]), "minutes": int(item["minutes"]),
                     "segments": item["segments"]}
                    for item in plan["candidates"]
                ],
                "excluded": plan["excluded"],
            }
            if apply:
                if plan["database"] != expected_database or plan["fingerprint"] != expected_fingerprint:
                    raise ValueError("Database or dry-run fingerprint changed; preview again before apply.")
                if azure["missing"]:
                    raise ValueError("Azure verification blocked the write.")
                # Each learner is committed independently; a failure aborts the
                # failing learner and stops the remaining batch.
                results = []
                for aid in sorted({int(item["aid"]) for item in plan["candidates"]}):
                    results.append(insert_one_learner(plan, aid))
                summary["written"] = results
                summary["hours_added_seconds"] = sum(int(result["seconds"]) for result in results)
        # The dry-run connection is read-only.  Apply connections commit inside
        # insert_one_learner, so this outer connection has no write to commit.
    print(json.dumps(summary, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
