"""Repair two existing Nicholas Banks Additional Evidence projections.

The Aptem files and assessment reports were read from Azure.  Evidence 45607
contains three activity lines totalling 32 hours; evidence 47747 contains four
activity lines totalling 31 hours.  The existing source rows are active but have
no counted seconds and point at stale/placeholder parents.  This script
reparents or repairs those rows idempotently; it never creates a second active
source for an Evidence ID and never touches LMS/Assignment/Journal rows.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import hashlib
import json
import mimetypes
from pathlib import Path
import sys

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402
import apply_remaining_80_additional as previous  # noqa: E402

CONTAINER = "fetch-aptem-evidences"
RUN_KIND = "additional-hours-existing-source-repair-v1"
PROMPT_VERSION = "v4-nicholas-azure-duration-sum-repair"
BASIS = "aptem:accepted-additional-job-activity;azure-file-and-assessment-duration-sum;estimated-london-allocation"
TARGETS = {
    45607: {"aid": 4336, "content_duration_minutes": 1920},
    47747: {"aid": 4336, "content_duration_minutes": 1860},
}


def digest(value: object) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def insert_row(cur, table: str, values: dict) -> int:
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return int(cur.execute(statement, list(values.values())).fetchone()["id"])


def load_plan(cur) -> dict:
    actions = [{"aid": item["aid"], "eid": eid} for eid, item in TARGETS.items()]
    state = previous.read_state(cur, actions)
    owner = state["owners"][4336]
    owner_id = int(owner["id"])
    usage, lecture_days = base.existing_occupancy(state, owner_id, set())
    planned: dict = defaultdict(int)
    rows = [state["evidence"][eid] for eid in sorted(TARGETS)]
    segments = base.allocate(owner_id, state, rows, set(), usage, lecture_days, planned)
    by_eid: dict[int, list[dict]] = defaultdict(list)
    for segment in segments:
        by_eid[int(segment["evidence_id"])].append(segment)
    for eid, meta in TARGETS.items():
        expected = int(state["evidence"][eid]["spent_time"]) * 60
        if meta["content_duration_minutes"] * 60 != expected:
            raise ValueError(f"Evidence {eid} content duration basis does not equal Aptem spent_time.")
        if sum(int(s["seconds"]) for s in by_eid[eid]) != expected:
            raise ValueError(f"Evidence {eid} allocation total mismatch.")
    actions_for_check = [{"owner_id": owner_id, "evidence_ids": sorted(TARGETS), "segments": segments}]
    violations = base.allocation_violations(actions_for_check)
    if violations:
        raise ValueError(f"Allocator produced timestamp violations: {violations[:3]}")
    existing = {}
    for eid in TARGETS:
        source = cur.execute(
            '''SELECT * FROM "Learner".learner_activity_sources
               WHERE learner_id=%s AND source_system='aptem' AND source_activity_id=%s AND deleted_at IS NULL''', [owner_id, f"evidence:{eid}"]
        ).fetchone()
        if not source:
            raise ValueError(f"Evidence {eid} has no existing active source to repair.")
        expected_seconds = int(state["evidence"][eid]["spent_time"]) * 60
        if source["actual_seconds"] not in (None, 0, expected_seconds):
            raise ValueError(f"Evidence {eid} already has different counted source seconds; refusing overwrite.")
        parent_id = source.get("canonical_progress_id")
        parent = cur.execute(
            'SELECT * FROM "Learner".learner_progress_entries WHERE id=%s AND deleted_at IS NULL', [parent_id]
        ).fetchone() if parent_id else None
        if not parent:
            raise ValueError(f"Evidence {eid} has no active canonical parent.")
        parent_segments = cur.execute(
            'SELECT * FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s', [parent_id]
        ).fetchall()
        if parent_segments and (parent.get("actual_seconds") or 0) == 0:
            raise ValueError(f"Evidence {eid} placeholder parent already has segments; refusing duplicate allocation.")
        reuse_parent = str(parent.get("source_activity_id") or "") == f"evidence:{eid}"
        existing[eid] = {"source": source, "parent": parent, "parent_segments": parent_segments, "reuse_parent": reuse_parent}
    payload = {
        "candidate_evidence": sorted(TARGETS),
        "segments": segments,
        "content_duration_minutes": {str(eid): meta["content_duration_minutes"] for eid, meta in TARGETS.items()},
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
    }
    payload["fingerprint"] = digest(payload)
    payload["state"] = state
    payload["by_eid"] = by_eid
    payload["owner"] = owner
    payload["existing"] = existing
    return payload


def evidence_payload(evidence: dict, segments: list[dict], parent_id: int, old_parent_id: int | None) -> dict:
    payload = dict(evidence.get("evidence_raw") or {})
    payload["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    payload["reconciliation"] = {
        "resolution": "existing_additional_source_repaired_from_azure_duration_sum",
        "estimated": True,
        "approval_required": True,
        "source_evidence_id": int(evidence["evidence_id"]),
        "canonical_progress_id": parent_id,
        "previous_canonical_progress_id": old_parent_id,
        "content_duration_sum_verified": True,
        "azure_container": CONTAINER,
        "azure_file_blob": evidence.get("file_blob"),
        "azure_report_blob": evidence.get("report_blob"),
        "segments": segments,
    }
    if evidence.get("note_content"):
        payload["note_content"] = evidence["note_content"]
    return payload


def verify_azure(evidence: dict) -> None:
    from azure.storage.blob import BlobServiceClient
    values = previous.env_values()
    service = BlobServiceClient.from_connection_string(values["AZURE_STORAGE_CONNECTION_STRING"])
    for kind in ("file", "report"):
        blob = evidence.get(f"{kind}_blob")
        if blob:
            service.get_blob_client(CONTAINER, str(blob)).get_blob_properties()


def repair_one(eid: int, expected_database: str, expected_fingerprint: str | None = None) -> dict:
    with psycopg.connect(previous.database_url(), connect_timeout=30, row_factory=dict_row) as conn:
        conn.read_only = False
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=180000")
            cur.execute("SET LOCAL lock_timeout=10000")
            cur.execute('SELECT id FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [4336])
            plan = load_plan(cur)
            if plan["database"] != expected_database:
                raise ValueError("Database target changed before repair.")
            if expected_fingerprint and plan["fingerprint"] != expected_fingerprint:
                raise ValueError("Repair fingerprint changed; rerun the dry run.")
            owner = plan["owner"]
            item = plan["existing"][eid]
            evidence = plan["state"]["evidence"][eid]
            verify_azure(evidence)
            segments = plan["by_eid"][eid]
            run_id = insert_row(cur, "activity_sync_runs", {
                "run_key": f"{RUN_KIND}:{plan['fingerprint']}:{eid}",
                "run_kind": RUN_KIND,
                "status": "running",
                "dry_run": False,
                "prompt_version": PROMPT_VERSION,
                "source_counts": Jsonb({"aptem_id": int(owner["aptem_id"]), "evidence_id": eid, "azure_verified": True}),
                "result_counts": Jsonb({}),
            })
            old_parent_id = int(item["parent"]["id"])
            if item["reuse_parent"]:
                parent_id = old_parent_id
                parent_payload = evidence_payload(evidence, segments, parent_id, old_parent_id)
                cur.execute(
                    '''UPDATE "Learner".learner_progress_entries
                       SET kind='additional_job_activity', component_ref=%s, component_title=%s,
                           component_type='aptem_additional', source_system='aptem', source_activity_id=%s,
                           source_attempt_key=%s, canonical_activity_key=%s, activity_status='Accepted', accepted=TRUE,
                           actual_seconds=%s, actual_basis=%s, reporting_started_at=%s, reporting_ended_at=%s,
                           reporting_month=%s, reporting_timestamp_label=%s, source_payload=%s, sync_run_id=%s
                     WHERE id=%s''', [
                        f"evidence:{eid}", evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Additional Evidence {eid}",
                        f"evidence:{eid}", f"evidence:{eid}", f"aptem:{owner['aptem_id']}:evidence:{eid}",
                        sum(int(s["seconds"]) for s in segments), BASIS,
                        datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]),
                        segments[0]["month"], "تقديري — يحتاج اعتماد", Jsonb(parent_payload), run_id, parent_id,
                    ]
                )
            else:
                next_order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner["id"]]).fetchone()["n"]) + 1
                title = str(evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Additional Evidence {eid}")[:500]
                parent_payload = evidence_payload(evidence, segments, 0, old_parent_id)
                parent_id = insert_row(cur, "learner_progress_entries", {
                    "learner_id": int(owner["id"]), "entry_order": next_order, "kind": "additional_job_activity",
                    "component_ref": f"evidence:{eid}", "component_title": title, "component_type": "aptem_additional",
                    "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": int(owner["aptem_id"]),
                    "source_system": "aptem", "source_activity_id": f"evidence:{eid}", "source_attempt_key": f"evidence:{eid}",
                    "canonical_activity_key": f"aptem:{owner['aptem_id']}:evidence:{eid}", "activity_status": "Accepted", "accepted": True,
                    "actual_seconds": sum(int(s["seconds"]) for s in segments), "actual_basis": BASIS,
                    "reporting_started_at": datetime.fromisoformat(segments[0]["start"]), "reporting_ended_at": datetime.fromisoformat(segments[-1]["end"]),
                    "reporting_month": segments[0]["month"], "reporting_timestamp_label": "تقديري — يحتاج اعتماد",
                    "source_payload": Jsonb(parent_payload), "sync_run_id": run_id,
                })
                parent_payload = evidence_payload(evidence, segments, parent_id, old_parent_id)
                cur.execute('UPDATE "Learner".learner_progress_entries SET source_payload=%s WHERE id=%s', [Jsonb(parent_payload), parent_id])
            source_payload = evidence_payload(evidence, segments, parent_id, old_parent_id)
            cur.execute(
                '''UPDATE "Learner".learner_activity_sources
                   SET source_attempt_key=%s, canonical_activity_key=%s, activity_type='additional_job_activity',
                       title=%s, activity_status='Accepted', completed=TRUE, accepted=TRUE, actual_seconds=%s,
                       actual_basis=%s, source_started_at=%s, source_ended_at=%s, reporting_started_at=%s,
                       reporting_ended_at=%s, reporting_month=%s, source_payload=%s, sync_run_id=%s,
                       canonical_progress_id=%s, source_fingerprint=%s, last_seen_at=now()
                 WHERE id=%s''', [
                    f"evidence:{eid}", f"aptem:{owner['aptem_id']}:evidence:{eid}",
                    evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Additional Evidence {eid}",
                    sum(int(s["seconds"]) for s in segments), BASIS,
                    datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]),
                    datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]),
                    segments[0]["month"], Jsonb(source_payload), run_id, parent_id,
                    digest({"evidence_id": eid, "actual_seconds": sum(int(s["seconds"]) for s in segments), "file_blob": evidence.get("file_blob"), "report_blob": evidence.get("report_blob")}),
                    int(item["source"]["id"]),
                ]
            )
            target_segments = cur.execute(
                'SELECT * FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s', [parent_id]
            ).fetchall()
            if not target_segments:
                for order, segment in enumerate(segments, 1):
                    insert_row(cur, "learner_activity_reporting_segments", {
                        "progress_id": parent_id, "learner_id": int(owner["id"]), "segment_order": order,
                        "actual_seconds": int(segment["seconds"]), "reporting_started_at": datetime.fromisoformat(segment["start"]),
                        "reporting_ended_at": datetime.fromisoformat(segment["end"]), "reporting_month": segment["month"], "sync_run_id": run_id,
                    })
            elif sum(int(row.get("actual_seconds") or 0) for row in target_segments) != sum(int(s["seconds"]) for s in segments):
                raise ValueError(f"Evidence {eid} has conflicting existing reporting segments.")
            docs = 0
            for kind in ("file", "report"):
                blob = evidence.get(f"{kind}_blob")
                if not blob:
                    continue
                doc_ref = f"evidence:{eid}:{kind}"
                doc = cur.execute('''SELECT id,progress_id FROM "Learner".learner_activity_documents
                                     WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''', [owner["id"], doc_ref]).fetchone()
                if doc:
                    if int(doc["progress_id"]) != parent_id:
                        cur.execute('UPDATE "Learner".learner_activity_documents SET progress_id=%s,updated_at=now() WHERE id=%s', [parent_id, doc["id"]])
                    continue
                insert_row(cur, "learner_activity_documents", {
                    "learner_id": int(owner["id"]), "progress_id": parent_id, "source_system": "aptem", "source_document_id": doc_ref,
                    "container": CONTAINER, "blob_name": str(blob), "display_name": str(evidence.get("evidence_name") or f"Evidence {eid}")[:500] if kind == "file" else f"Evidence {eid} — Assessment report",
                    "content_type": mimetypes.guess_type(str(blob))[0] or "application/octet-stream", "uploaded_by": "aptem-evidence",
                    "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date"),
                }); docs += 1
            result = {"aid": int(owner["aptem_id"]), "eid": eid, "run_id": run_id, "parent_id": parent_id, "seconds": sum(int(s["seconds"]) for s in segments), "segments": len(segments), "documents_added": docs}
            cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed", Jsonb(result), run_id])
        conn.commit()
        return result


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    apply = "--apply" in sys.argv[1:]
    expected_database = next((arg.split("=", 1)[1] for arg in sys.argv[1:] if arg.startswith("--expected-database=")), None)
    expected_fingerprint = next((arg.split("=", 1)[1] for arg in sys.argv[1:] if arg.startswith("--expected-fingerprint=")), None)
    if apply and (not expected_database or not expected_fingerprint):
        raise ValueError("--apply requires --expected-database and --expected-fingerprint.")
    base.bank_holidays = previous.extended_bank_holidays
    previous.base.bank_holidays = previous.extended_bank_holidays
    with psycopg.connect(previous.database_url(), connect_timeout=30, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            plan = load_plan(cur)
            for eid in TARGETS:
                verify_azure(plan["state"]["evidence"][eid])
            summary = {"database": plan["database"], "read_only": not apply, "candidate_ids": sorted(TARGETS), "candidate_seconds": 226800, "fingerprint": plan["fingerprint"], "segments": plan["segments"]}
    if apply:
        summary["read_only"] = False
        summary["written"] = [repair_one(eid, expected_database, expected_fingerprint) for eid in sorted(TARGETS)]
    print(json.dumps(summary, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
