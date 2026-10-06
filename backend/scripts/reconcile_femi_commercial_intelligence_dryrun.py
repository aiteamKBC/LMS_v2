"""Read-only Inventory/Dry Run for the three Femi Commercial Intelligence groups.

This deliberately stops before any database write.  It reuses the project's
Additional Hours validation/allocation helpers, but supplies the three target
rosters explicitly.  The user-provided roster is the reporting scope; current
canonical group fields are reported separately so a stale/missing membership
does not silently move a learner.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date
import hashlib
import json
from pathlib import Path
import sys

import psycopg
from psycopg.rows import dict_row

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import reconcile_additional_hours_social_media as base  # noqa: E402


TARGET_GROUPS = {
    "G1 - Femi Commercial Intelligence Wednesday": {
        "group_id": "GROUP-20260919124138417113A1DF3F878219",
        "module_id": "MOD-20261002145217180409FC6342F2CE88",
        "coach": "Femi Falodun",
        "names": [
            "Aarthi Dhanasekaran", "Abikaye Mehat", "Andrew Moores",
            "Corinna Denbow", "Elys Brooks", "Emily Budgen", "Helena Davies",
            "Rebecca Stocks", "Yuri Michaels",
        ],
    },
    "G2 - Femi Commercial Intelligence Thursday": {
        "group_id": "GROUP-20260919124937500707B11B559601EF",
        "module_id": "MOD-202610030949476057995921FD6A1D0C",
        "coach": "Femi Falodun",
        "names": [
            "Callum Price", "Charlotte Garner", "Clowance Lawton",
            "Connor Hewitson", "Caterina Zucca", "Daniel Welton",
            "Ellie Hewitt", "Ellis Smith", "Harry Horne", "Jennifer Fundell",
            "Jack Spickett", "Joanne Mason", "Julia Bysshe", "Mark Holdsworth",
            "Samantha Mathie", "Siobhan Gadiot", "Yasmin Pritchard",
        ],
    },
    "G3 - Femi Commercial Intelligence Friday": {
        "group_id": "GROUP-20260919125108849156FE1CA3BFB3B4",
        "module_id": "MOD-20260912131150211624",
        "coach": "Femi Falodun",
        "names": [
            "Adam Collins", "Cassius Gontijo", "Claire Canu", "David Barnett",
            "Emily Palmer", "Francesca Armstrong", "Hayley Nicholson",
            "James Parsons", "Jemima Crow", "Jennifer Davies", "Kelly Chan",
            "Kerry Ireland", "Kerry Sommers", "Laura Beasley", "Suzanne Parnham",
            "Neve Leason", "Nicola Mansfield", "Peter Morris", "Helena Davies",
            "Emily Dowd", "Abbie Ridgway",
        ],
    },
}


def fmt(seconds: int) -> str:
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(seconds))
    return f"{sign}{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def norm_name(value: str) -> str:
    return " ".join(str(value or "").split()).casefold()


def safe_evidence_label(value: object) -> tuple[str, dict]:
    text = str(value or "").strip()
    digest = hashlib.sha256(text.encode("utf-8", "ignore")).hexdigest() if text else None
    if len(text) > 180 or "\n" in text or "\r" in text:
        return "[evidence text redacted]", {"characters": len(text), "sha256": digest}
    return text, {"characters": len(text), "sha256": digest}


def source_evidence_id(source: dict) -> int | None:
    return base.evidence_id_from_source(source)


def load_state_fast(cur, target_ids: list[int]) -> dict:
    """Load only columns needed by this inventory; SELECT * pulls large payloads."""
    owners = cur.execute(
        '''SELECT id,enrolment_id,programme_id,aptem_id,full_name,group_id,group_name,
                  programme,cohort,cohort_id
             FROM "Learner".learners WHERE aptem_id=ANY(%s) ORDER BY aptem_id''',
        [target_ids],
    ).fetchall()
    owner_ids = [int(row["id"]) for row in owners]
    aptem = cur.execute(
        '''SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date
             FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)''',
        [target_ids],
    ).fetchall()
    evidence = cur.execute(
        '''SELECT evidence_id,learner_id,component_id,component_name,evidence_name,evidence_status,
                  evidence_kind,evidence_type,feedbacks,hours_type,spent_time,spent_time_type,
                  submission_date,completed_date,created_date,
                  completed_date_override,file_blob,note_blob,report_blob,note_content,ksb_codes,
                  coalesce(completed_date_override,completed_date,submission_date,created_date) AS evidence_at
             FROM fetching_evidence.evidence_items
            WHERE learner_id=ANY(%s) AND evidence_status='Accepted'
              AND spent_time>0 AND hours_type='OffTheJobTraining'
              AND spent_time_type='PaidWorkingHours'
            ORDER BY learner_id,evidence_id''',
        [target_ids],
    ).fetchall()
    progress = cur.execute(
        '''SELECT id,learner_id,kind,module_ref,module_title,component_ref,component_title,component_type,
                  started_at,submitted_at,feed_occurred_at,group_ref,group_title,source_system,source_activity_id,
                  activity_status,accepted,actual_seconds,actual_basis,reporting_started_at,reporting_ended_at,
                  reporting_month,reporting_timestamp_label,deleted_at
             FROM "Learner".learner_progress_entries
            WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''',
        [owner_ids],
    ).fetchall()
    sources = cur.execute(
        '''SELECT id,learner_id,source_system,source_activity_id,
                  source_payload->>'ComponentId' AS component_id,
                  accepted,actual_seconds,canonical_progress_id,deleted_at
             FROM "Learner".learner_activity_sources
            WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''',
        [owner_ids],
    ).fetchall()
    journals = cur.execute(
        '''SELECT id,canonical_learner_id,accepted,activity_date,actual_hours,category,source_ref,progress_id,deleted_at
             FROM "Learner".learner_journal_rows
            WHERE canonical_learner_id=ANY(%s) AND deleted_at IS NULL
             ORDER BY canonical_learner_id,id''',
        [owner_ids],
    ).fetchall()
    assignments = cur.execute(
        '''SELECT learner_id,aptem_id,component_id,component_name,component_type,
                  planned_hours,assignment_month,status,actual_hours,updated_at
             FROM "Last_audit".learner_assignments
            WHERE aptem_id=ANY(%s)
            ORDER BY aptem_id,assignment_month,component_id''',
        [target_ids],
    ).fetchall()
    actual_ledger = cur.execute(
        '''SELECT learner_id,aptem_id,month,kind,ref,title,actual_hours,reported_hours,
                  reporting_method,activity_date,start_time,end_time,timestamp_label,source,updated_at
             FROM "Last_audit".activity_actual_hours
            WHERE aptem_id=ANY(%s)
            ORDER BY aptem_id,month,activity_date,ref''',
        [target_ids],
    ).fetchall()
    attendance = cur.execute(
        '''SELECT learner_id,aptem_id,source_key,attendance_date,attendance_value,activity_hours,
                  attendance_status,module,lecture_name
             FROM "Last_audit".learner_attendance
            WHERE aptem_id=ANY(%s)
            ORDER BY aptem_id,attendance_date,source_key''',
        [target_ids],
    ).fetchall()
    attendance_details = cur.execute(
        '''SELECT learner_id,session_id,session_date,attendance_status,attended_seconds,
                  module_title,group_id,group_name,source_record_id
             FROM "Learner".learner_attendance_details
            WHERE learner_id=ANY(%s)
            ORDER BY learner_id,session_date,session_id''',
        [owner_ids],
    ).fetchall()
    documents = cur.execute(
        '''SELECT id,learner_id,progress_id,source_system,source_document_id,container,blob_name,
                  display_name,content_type,size_bytes,deleted_at
             FROM "Learner".learner_activity_documents
            WHERE learner_id=ANY(%s) AND deleted_at IS NULL
            ORDER BY learner_id,id''',
        [owner_ids],
    ).fetchall()
    segments = cur.execute(
        '''SELECT progress_id,learner_id,actual_seconds,reporting_started_at,reporting_ended_at
             FROM "Learner".learner_activity_reporting_segments
            WHERE learner_id=ANY(%s) ORDER BY learner_id,progress_id,reporting_started_at''',
        [owner_ids],
    ).fetchall()
    return {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "owners": {int(row["aptem_id"]): row for row in owners},
        "aptem": {int(row["aptem_id"]): row for row in aptem},
        "breaks": base.read_breaks(cur),
        "evidence": evidence,
        "progress": progress,
        "sources": sources,
        "segments": segments,
        "journals": journals,
        "assignments": assignments,
        "actual_ledger": actual_ledger,
        "attendance": attendance,
        "attendance_details": attendance_details,
        "documents": documents,
    }


def bounded_azure_inventory(state: dict) -> dict:
    """Check referenced blobs without allowing one unavailable blob to hang the run."""
    values = base.env_values()
    refs = []
    for row in state["evidence"]:
        ok, _ = base.accepted_evidence_day_valid(row, state)
        if not ok or not base.is_additional_component(row.get("component_name")):
            continue
        for kind in ("file", "report"):
            if row.get(f"{kind}_blob"):
                refs.append((int(row["evidence_id"]), kind, row[f"{kind}_blob"]))
    if not refs:
        return {"checked": 0, "found": 0, "missing": [], "sdk": bool(base.BlobServiceClient)}
    if base.BlobServiceClient is None or not values.get("AZURE_STORAGE_CONNECTION_STRING"):
        return {"checked": len(refs), "found": 0,
                "missing": [{"evidence_id": eid, "kind": kind, "error": "Azure SDK/config unavailable"} for eid, kind, _ in refs],
                "sdk": False}
    try:
        service = base.BlobServiceClient.from_connection_string(
            values["AZURE_STORAGE_CONNECTION_STRING"], connection_timeout=5, read_timeout=5
        )
    except Exception as exc:
        return {"checked": len(refs), "found": 0,
                "missing": [{"evidence_id": eid, "kind": kind, "error": type(exc).__name__} for eid, kind, _ in refs],
                "sdk": True}
    found = 0
    missing = []
    for eid, kind, blob in refs:
        try:
            service.get_blob_client(base.CONTAINER, blob).get_blob_properties(timeout=5)
            found += 1
        except Exception as exc:
            missing.append({"evidence_id": eid, "kind": kind, "error": type(exc).__name__})
    return {"checked": len(refs), "found": found, "missing": missing, "sdk": True}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parents[1] / "reports" / "femi_commercial_intelligence_dryrun.json"),
    )
    args = parser.parse_args()

    requested_names = [name for group in TARGET_GROUPS.values() for name in group["names"]]
    unique_names = sorted(set(requested_names), key=norm_name)
    with psycopg.connect(base.database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            print("[dry-run] connected; resolving roster", file=sys.stderr, flush=True)
            cur.execute("SET LOCAL statement_timeout=120000")
            cur.execute("SET LOCAL lock_timeout=10000")
            owner_rows = cur.execute(
                '''SELECT id,enrolment_id,programme_id,aptem_id,full_name,group_id,group_name,
                          programme,programme_id AS canonical_programme_id,cohort,cohort_id
                     FROM "Learner".learners
                    WHERE full_name = ANY(%s)
                    ORDER BY full_name,aptem_id''',
                [unique_names],
            ).fetchall()
            by_name: dict[str, list[dict]] = defaultdict(list)
            for row in owner_rows:
                by_name[norm_name(row["full_name"])].append(row)

            missing_names = [name for name in unique_names if not by_name.get(norm_name(name))]
            duplicate_name_rows = {
                name: [int(row["aptem_id"]) for row in rows]
                for name, rows in by_name.items() if len(rows) != 1
            }
            if missing_names or duplicate_name_rows:
                report = {
                    "read_only": True,
                    "decision": "BLOCKED",
                    "scope": list(TARGET_GROUPS),
                    "missing_names": missing_names,
                    "duplicate_name_rows": duplicate_name_rows,
                    "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
                }
                Path(args.output).parent.mkdir(parents=True, exist_ok=True)
                Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                print(json.dumps(report, ensure_ascii=False, indent=2))
                return 2

            name_to_owner = {norm_name(name): rows[0] for name, rows in by_name.items()}
            target_group_rows: dict[str, dict] = {}
            target_ids_by_group: dict[str, list[int]] = {}
            for group_name, group in TARGET_GROUPS.items():
                rows = [name_to_owner[norm_name(name)] for name in group["names"]]
                target_group_rows[group_name] = group
                target_ids_by_group[group_name] = [int(row["aptem_id"]) for row in rows]

            target_ids = sorted({aid for ids in target_ids_by_group.values() for aid in ids})
            base.ALL_APTEM_IDS = target_ids
            print(f"[dry-run] loading sources for {len(target_ids)} learners", file=sys.stderr, flush=True)
            state = load_state_fast(cur, target_ids)
            print(f"[dry-run] loaded evidence={len(state['evidence'])} progress={len(state['progress'])} sources={len(state['sources'])}", file=sys.stderr, flush=True)
            state["owners_by_id"] = {int(row["id"]): row for row in state["owners"].values()}
            database = cur.execute("SELECT current_database() AS name").fetchone()["name"]

            group_for: dict[int, list[str]] = defaultdict(list)
            for group_name, ids in target_ids_by_group.items():
                for aid in ids:
                    group_for[aid].append(group_name)

            evidence_by_aid: dict[int, list[dict]] = defaultdict(list)
            for evidence in state["evidence"]:
                aid = int(evidence["learner_id"])
                if aid in target_ids and base.is_additional_component(evidence.get("component_name")):
                    evidence_by_aid[aid].append(evidence)

            owner_id_to_aid = {int(row["id"]): int(aid) for aid, row in state["owners"].items()}
            sources_by_aid_eid: dict[tuple[int, int], list[dict]] = defaultdict(list)
            for source in state["sources"]:
                if source.get("source_system") != "aptem" or source.get("deleted_at"):
                    continue
                aid = owner_id_to_aid.get(int(source["learner_id"]))
                eid = source_evidence_id(source)
                if aid in target_ids and eid is not None:
                    sources_by_aid_eid[(aid, int(eid))].append(source)

            progress_by_owner = defaultdict(list)
            for row in state["progress"]:
                if row.get("deleted_at"):
                    continue
                progress_by_owner[int(row["learner_id"])].append(row)

            journals_by_owner = defaultdict(list)
            for row in state["journals"]:
                if row.get("deleted_at"):
                    continue
                journals_by_owner[int(row["canonical_learner_id"])].append(row)

            assignments_by_aid = defaultdict(list)
            for row in state["assignments"]:
                if row.get("aptem_id") is not None:
                    assignments_by_aid[int(row["aptem_id"])].append(row)
            actual_ledger_by_aid = defaultdict(list)
            for row in state["actual_ledger"]:
                if row.get("aptem_id") is not None:
                    actual_ledger_by_aid[int(row["aptem_id"])].append(row)
            attendance_by_aid = defaultdict(list)
            for row in state["attendance"]:
                if row.get("aptem_id") is not None:
                    attendance_by_aid[int(row["aptem_id"])].append(row)
            documents_by_owner = defaultdict(list)
            for row in state["documents"]:
                documents_by_owner[int(row["learner_id"])].append(row)

            learner_reports: list[dict] = []
            all_candidates: list[dict] = []
            all_blocked: list[dict] = []
            for aid in target_ids:
                owner = state["owners"][aid]
                owner_id = int(owner["id"])
                period = state["aptem"][aid]
                evidence_rows = evidence_by_aid[aid]
                accepted_valid = []
                excluded = []
                candidates = []
                timestamp_violations = []
                expected_seconds_by_eid = {
                    int(row["evidence_id"]): int(row["spent_time"]) * 60
                    for row in evidence_rows
                }
                # A single canonical Aptem parent can legitimately contain
                # several evidence items (for example two meetings in one
                # weekly entry).  Compare the aggregate before calling an
                # individual line a duration conflict.
                parent_lineage: dict[int, list[tuple[int, dict]]] = defaultdict(list)
                for candidate_evidence in evidence_rows:
                    candidate_eid = int(candidate_evidence["evidence_id"])
                    candidate_sources = sources_by_aid_eid[(aid, candidate_eid)]
                    if len(candidate_sources) == 1 and candidate_sources[0].get("canonical_progress_id"):
                        parent_lineage[int(candidate_sources[0]["canonical_progress_id"])].append(
                            (candidate_eid, candidate_sources[0])
                        )
                for evidence in evidence_rows:
                    ok, reason = base.accepted_evidence_day_valid(evidence, state)
                    day = base.evidence_day(evidence)
                    if ok and day and (day.weekday() >= 5 or day in base.bank_holidays()):
                        timestamp_violations.append({"evidence_id": int(evidence["evidence_id"]), "date": day.isoformat(), "reason": "weekend_or_bank_holiday"})
                    if not ok:
                        excluded_item = {"evidence_id": int(evidence["evidence_id"]), "minutes": int(evidence["spent_time"]), "reason": reason}
                        excluded.append(excluded_item)
                        if reason in {"missing_start_end", "invalid_break_date"}:
                            all_blocked.append({
                                "aptem_id": aid,
                                "learner": owner["full_name"],
                                "evidence_id": int(evidence["evidence_id"]),
                                "component_id": evidence.get("component_id"),
                                "spent_minutes": int(evidence["spent_time"]),
                                "evidence_date": day.isoformat() if day else None,
                                "status": "BLOCKED",
                                "reason": reason,
                                "resolution": "SUPPLY_AUTHORITATIVE_START_END_OR_BREAK_DATES",
                                "source_ids": [],
                                "parent_ids": [],
                            })
                        continue
                    accepted_valid.append(evidence)
                    eid = int(evidence["evidence_id"])
                    expected = int(evidence["spent_time"]) * 60
                    source_rows = sources_by_aid_eid[(aid, eid)]
                    exact_journal = [
                        row for row in journals_by_owner[owner_id]
                        if row.get("accepted") and row.get("actual_hours")
                        and row.get("source_ref") == f"asg:{evidence.get('component_id')}:evidence:{eid}"
                    ]
                    status = "NEW_LEGITIMATE"
                    reason_text = "no_active_aptem_source"
                    resolution = None
                    parent_ids = sorted({int(row["canonical_progress_id"]) for row in source_rows if row.get("canonical_progress_id")})
                    source_actual_seconds = [int(row.get("actual_seconds") or 0) for row in source_rows]
                    parent_actual_seconds = None
                    aggregate_expected_seconds = None
                    aggregate_source_actual_seconds = None
                    if len(source_rows) > 1:
                        status = "BLOCKED"
                        reason_text = "multiple_active_aptem_sources_for_evidence"
                    elif source_rows:
                        source = source_rows[0]
                        parent = next((row for row in progress_by_owner[owner_id] if int(row["id"]) == int(source.get("canonical_progress_id") or -1)), None)
                        actual = int((parent or {}).get("actual_seconds") or 0)
                        source_actual = int(source.get("actual_seconds") or 0)
                        parent_entries = parent_lineage.get(int(source.get("canonical_progress_id") or -1), [])
                        aggregate_expected = sum(expected_seconds_by_eid.get(entry_eid, 0) for entry_eid, _ in parent_entries)
                        aggregate_source_actual = sum(int(entry_source.get("actual_seconds") or 0) for _, entry_source in parent_entries)
                        aggregate_expected_seconds = aggregate_expected
                        aggregate_source_actual_seconds = aggregate_source_actual
                        parent_actual_seconds = actual
                        aggregate_lines_match = bool(parent_entries) and all(
                            int(entry_source.get("actual_seconds") or 0) == expected_seconds_by_eid.get(entry_eid, -1)
                            for entry_eid, entry_source in parent_entries
                        )
                        if parent and len(parent_entries) > 1 and actual == aggregate_expected and aggregate_lines_match and aggregate_source_actual == aggregate_expected:
                            status = "ALREADY_REPRESENTED"
                            reason_text = "active_aptem_parent_matches_aggregate_of_evidence_lines"
                            resolution = "KEEP_EXISTING_AGGREGATE_PARENT"
                        elif parent and source_actual == expected and actual == expected:
                            status = "ALREADY_REPRESENTED"
                            reason_text = "active_aptem_source_and_parent_match_evidence_duration"
                            resolution = "KEEP_EXISTING_LINEAGE"
                        elif parent and source_actual == 0 and actual == expected:
                            status = "ALREADY_REPRESENTED"
                            reason_text = "parent_matches_evidence_but_line_source_has_no_actual_seconds"
                            resolution = "KEEP_PARENT_REVIEW_SOURCE_LINE"
                        elif parent and not source_actual and len(parent_entries) > 1 and actual == aggregate_expected:
                            status = "ALREADY_REPRESENTED"
                            reason_text = "parent_matches_aggregate_but_line_sources_have_no_actual_seconds"
                            resolution = "KEEP_PARENT_REVIEW_SOURCE_LINES"
                        elif parent and source_actual == 0 and actual == 0:
                            status = "PARENT_NEEDS_ACTUAL_REPAIR"
                            reason_text = "exact_evidence_lineage_exists_but_parent_and_source_have_zero_actual_seconds"
                            resolution = "UPDATE_EXISTING_PARENT_NO_NEW_ACTIVITY"
                        elif parent:
                            status = "DURATION_CONFLICT"
                            reason_text = "active_aptem_lineage_duration_differs_from_evidence"
                            resolution = "DO_NOT_ADD_UNTIL_DURATION_REVIEW"
                        else:
                            status = "BLOCKED"
                            reason_text = "active_source_points_to_missing_parent"
                            resolution = "RECOVER_PARENT_AFTER_EVIDENCE_REVIEW"
                    elif exact_journal:
                        status = "ALREADY_REPRESENTED"
                        reason_text = "exact_accepted_journal_evidence_already_represents_event"
                        resolution = "KEEP_JOURNAL_LINEAGE"
                    else:
                        same_component = [
                            row for row in state["sources"]
                            if int(row["learner_id"]) == owner_id and not row.get("deleted_at")
                            and str(row.get("component_id") or "") == str(evidence.get("component_id"))
                            and int(row.get("actual_seconds") or 0) > 0
                        ]
                        if same_component:
                            status = "AMBIGUOUS"
                            reason_text = "component_already_counted_without_exact_evidence_identity"
                            resolution = "MATCH_COMPONENT_DATE_DURATION_BEFORE_ADD"
                    item = {
                        "aptem_id": aid,
                        "learner": owner["full_name"],
                        "evidence_id": eid,
                        "component_id": evidence.get("component_id"),
                        "component_name": evidence.get("component_name"),
                        "evidence_name": safe_evidence_label(evidence.get("evidence_name"))[0],
                        "evidence_name_metadata": safe_evidence_label(evidence.get("evidence_name"))[1],
                        "spent_minutes": int(evidence["spent_time"]),
                        "evidence_date": day.isoformat() if day else None,
                        "status": status,
                        "reason": reason_text,
                        "resolution": resolution,
                        "source_ids": [int(row["id"]) for row in source_rows],
                        "parent_ids": parent_ids,
                        "source_actual_seconds": source_actual_seconds,
                        "parent_actual_seconds": parent_actual_seconds,
                        "aggregate_expected_seconds": aggregate_expected_seconds,
                        "aggregate_source_actual_seconds": aggregate_source_actual_seconds,
                        "journal_ids": [int(row["id"]) for row in exact_journal],
                        "file_blob_present": bool(evidence.get("file_blob")),
                        "report_blob_present": bool(evidence.get("report_blob")),
                        "note_present": bool(str(evidence.get("note_content") or "").strip()),
                        "evidence_kind": evidence.get("evidence_kind"),
                        "evidence_type": evidence.get("evidence_type"),
                        "feedback_present": bool(evidence.get("feedbacks")),
                    }
                    candidates.append(item)
                    all_candidates.append(item)
                    if status == "BLOCKED":
                        all_blocked.append(item)

                before = sum(int(row.get("actual_seconds") or 0) for row in progress_by_owner[owner_id] if row.get("accepted") is True)
                # Preview a compliant Europe/London allocation for only the
                # NEW_LEGITIMATE candidates. This remains read-only and gives
                # the eventual approval gate exact proposed segments.
                evidence_by_id = {int(row["evidence_id"]): row for row in accepted_valid}
                owner_usage, lecture_days = base.existing_occupancy(state, owner_id, set())
                planned_usage = defaultdict(int)
                allocation_blocked = []
                for item in candidates:
                    if item["status"] != "NEW_LEGITIMATE":
                        continue
                    try:
                        item["proposed_segments"] = base.allocate(
                            owner_id, state, [evidence_by_id[item["evidence_id"]]], set(),
                            owner_usage, lecture_days, planned_usage,
                        )
                        item["allocation_status"] = "READY"
                    except Exception as exc:
                        item["allocation_status"] = "BLOCKED"
                        item["allocation_reason"] = type(exc).__name__ + ": " + str(exc)
                        allocation_blocked.append(item)
                        all_blocked.append(item)
                additional_seconds = sum(int(row["spent_time"]) * 60 for row in accepted_valid)
                new_seconds = sum(int(item["spent_minutes"]) * 60 for item in candidates if item["status"] == "NEW_LEGITIMATE" and item.get("allocation_status") == "READY")
                parent_repair_seconds = sum(
                    int(item["spent_minutes"]) * 60
                    for item in candidates
                    if item["status"] == "PARENT_NEEDS_ACTUAL_REPAIR"
                )
                source_conflicts = [item for item in candidates if item["status"] in {"DURATION_CONFLICT", "AMBIGUOUS", "PARENT_NEEDS_ACTUAL_REPAIR"}]
                assignment_rows = assignments_by_aid[aid]
                actual_rows = actual_ledger_by_aid[aid]
                attendance_rows = attendance_by_aid[aid]
                learner_documents = documents_by_owner[owner_id]
                candidate_evidence_ids = {int(item["evidence_id"]) for item in candidates}
                linked_document_ids = {
                    int(doc["id"])
                    for doc in learner_documents
                    if str(doc.get("source_document_id") or "").removeprefix("evidence:").isdigit()
                    and int(str(doc.get("source_document_id")).removeprefix("evidence:")) in candidate_evidence_ids
                }
                group_mismatch = []
                for group_name in group_for[aid]:
                    group = target_group_rows[group_name]
                    if owner.get("group_id") != group["group_id"]:
                        group_mismatch.append({"target_group": group_name, "canonical_group_id": owner.get("group_id"), "canonical_group_name": owner.get("group_name")})
                learner_reports.append({
                    "aptem_id": aid,
                    "learner": owner["full_name"],
                    "target_groups": group_for[aid],
                    "canonical_group_id": owner.get("group_id"),
                    "canonical_group_name": owner.get("group_name"),
                    "cohort": owner.get("cohort"),
                    "programme": owner.get("programme"),
                    "period": {"start": str(period.get("start_date")), "end": str(period.get("end_date"))},
                    "membership_review": group_mismatch,
                    "additional_accepted_valid_count": len(accepted_valid),
                    "additional_accepted_valid_seconds": additional_seconds,
                    "additional_accepted_valid": fmt(additional_seconds),
                    "additional_excluded": excluded,
                    "candidates": candidates,
                    "source_inventory": {
                        "assignment_rows": len(assignment_rows),
                        "assignment_actual_hours": sum(float(row.get("actual_hours") or 0) for row in assignment_rows),
                        "activity_actual_rows": len(actual_rows),
                        "activity_actual_hours": sum(float(row.get("actual_hours") or 0) for row in actual_rows),
                        "journal_rows": len(journals_by_owner[owner_id]),
                        "journal_actual_hours": sum(float(row.get("actual_hours") or 0) for row in journals_by_owner[owner_id]),
                        "attendance_rows": len(attendance_rows),
                        "attendance_present_rows": sum(
                            int(row.get("attendance_value") or 0) == 1
                            or str(row.get("attendance_status") or "").lower() in {"present", "attended", "attend"}
                            for row in attendance_rows
                        ),
                        "manual_documents": len(learner_documents),
                        "candidate_documents_linked": len(linked_document_ids),
                    },
                    "counts": {
                        "already_represented": sum(item["status"] == "ALREADY_REPRESENTED" for item in candidates),
                        "new_legitimate": sum(item["status"] == "NEW_LEGITIMATE" for item in candidates),
                        "lineage_only": sum(item["status"] == "LINEAGE_ONLY" for item in candidates),
                        "duration_conflict": sum(item["status"] == "DURATION_CONFLICT" for item in candidates),
                        "ambiguous": sum(item["status"] == "AMBIGUOUS" for item in candidates),
                        "parent_needs_actual_repair": sum(item["status"] == "PARENT_NEEDS_ACTUAL_REPAIR" for item in candidates),
                        "blocked": sum(item["status"] == "BLOCKED" for item in candidates),
                    },
                    "ssot_accepted_before_seconds": before,
                    "ssot_accepted_before": fmt(before),
                    "additional_new_candidate_seconds": new_seconds,
                    "parent_repair_candidate_seconds": parent_repair_seconds,
                    "expected_after_if_approved_seconds": before + new_seconds + parent_repair_seconds,
                    "expected_after_if_approved": fmt(before + new_seconds + parent_repair_seconds),
                    "raw_diff_after_vs_aptem_additional_seconds": before + new_seconds + parent_repair_seconds - additional_seconds,
                    "timestamp_violations": timestamp_violations,
                    "decision": "BLOCKED" if (allocation_blocked or any(item["status"] == "BLOCKED" for item in candidates) or any(item["reason"] in {"missing_start_end", "invalid_break_date"} for item in excluded)) else ("REVIEW" if (excluded or source_conflicts or timestamp_violations) else "READY"),
                })

            print("[dry-run] checking Azure references with 5s per blob timeout", file=sys.stderr, flush=True)
            azure = bounded_azure_inventory(state)
            print(f"[dry-run] Azure checked={azure.get('checked', 0)}", file=sys.stderr, flush=True)
            group_reports = {}
            for group_name, group in target_group_rows.items():
                members = [row for row in learner_reports if group_name in row["target_groups"]]
                group_reports[group_name] = {
                    "group_id": group["group_id"],
                    "module_id": group["module_id"],
                    "coach": group["coach"],
                    "requested_roster_count": len(group["names"]),
                    "unique_aptem_learners": len(members),
                    "additional_valid_seconds": sum(row["additional_accepted_valid_seconds"] for row in members),
                    "additional_valid": fmt(sum(row["additional_accepted_valid_seconds"] for row in members)),
                    "ssot_before_seconds": sum(row["ssot_accepted_before_seconds"] for row in members),
                    "ssot_before": fmt(sum(row["ssot_accepted_before_seconds"] for row in members)),
                    "new_candidate_seconds": sum(row["additional_new_candidate_seconds"] for row in members),
                    "new_candidate": fmt(sum(row["additional_new_candidate_seconds"] for row in members)),
                    "parent_repair_candidate_seconds": sum(row["parent_repair_candidate_seconds"] for row in members),
                    "parent_repair_candidate": fmt(sum(row["parent_repair_candidate_seconds"] for row in members)),
                    "expected_after_seconds": sum(row["expected_after_if_approved_seconds"] for row in members),
                    "expected_after": fmt(sum(row["expected_after_if_approved_seconds"] for row in members)),
                    "review_learners": sum(row["decision"] != "READY" for row in members),
                    "membership_review_count": sum(bool(row["membership_review"]) for row in members),
                }

            report = {
                "read_only": True,
                "scope": {
                    "groups": list(TARGET_GROUPS),
                    "requested_names": len(requested_names),
                    "unique_names": len(unique_names),
                    "duplicate_requested_names": sorted({name for name in requested_names if requested_names.count(name) > 1}),
                    "target_months": "ALL",
                },
                "database": database,
                "groups": group_reports,
                "learners": sorted(learner_reports, key=lambda row: (row["learner"].casefold(), row["aptem_id"])),
                "candidates": all_candidates,
                "blocked": all_blocked,
                "azure": azure,
                "summary": {
                    "unique_learners": len(target_ids),
                    "additional_valid_seconds": sum(row["additional_accepted_valid_seconds"] for row in learner_reports),
                    "additional_valid": fmt(sum(row["additional_accepted_valid_seconds"] for row in learner_reports)),
                    "ssot_before_seconds": sum(row["ssot_accepted_before_seconds"] for row in learner_reports),
                    "ssot_before": fmt(sum(row["ssot_accepted_before_seconds"] for row in learner_reports)),
                    "new_candidate_seconds": sum(row["additional_new_candidate_seconds"] for row in learner_reports),
                    "new_candidate": fmt(sum(row["additional_new_candidate_seconds"] for row in learner_reports)),
                    "parent_repair_candidate_seconds": sum(row["parent_repair_candidate_seconds"] for row in learner_reports),
                    "parent_repair_candidate": fmt(sum(row["parent_repair_candidate_seconds"] for row in learner_reports)),
                    "review_learners": sum(row["decision"] != "READY" for row in learner_reports),
                    "blocked_candidates": len(all_blocked),
                    "azure_missing": len(azure.get("missing", [])),
                },
                "decision": "BLOCKED" if all_blocked or azure.get("missing") else ("REVIEW" if any(row["decision"] != "READY" for row in learner_reports) else "READY"),
                "write_performed": False,
                "evidence_content_review": {
                    "artifact": "backend/reports/femi_commercial_intelligence_evidence_review.json",
                    "read_required_before_write": True,
                    "raw_text_saved": False,
                },
                "module_scope_note": "Current learner progress contains many legacy rows with null or unrelated module_ref/group_ref values. SSOT-before is therefore a learner-wide accepted ledger total for this read-only comparison, not proof of current-module-only hours. No membership or historical row was changed.",
                "source_inventory_note": "Last_audit assignments, activity_actual_hours, learner_attendance, Learner journals, activity sources, progress, documents, and attendance details were inventoried read-only.",
                "membership_scope_note": "The supplied roster and target curriculum group IDs are authoritative for this dry run. Existing Learner.group_id values are legacy/missing for several learners and were not changed.",
                "next_safe_step": "Review this Dry Run and explicitly approve rows before any Write/Soft Delete.",
            }
            output = Path(args.output)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(report, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps({
                "read_only": True,
                "database": database,
                "output": str(output),
                "decision": report["decision"],
                "summary": report["summary"],
                "azure": {"checked": azure.get("checked", 0), "found": azure.get("found", 0), "missing": len(azure.get("missing", []))},
            }, ensure_ascii=False, indent=2))
            return 0


if __name__ == "__main__":
    raise SystemExit(main())
