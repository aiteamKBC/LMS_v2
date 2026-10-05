"""Scoped, idempotent repair of missing accepted Aptem evidence hours.

The plan is deliberately explicit.  It only touches the reviewed Sharon
historical learners and the evidence IDs listed below.  Reporting dates are
an estimated allocation (nearest valid weekday, order preserved) and are
labelled ``Estimated — approval required``; estimated rows are intentionally excluded
from authoritative Actual totals until approved by the normal review flow.

Preview is read-only.  Apply requires the database name and preview
fingerprint, so the operator cannot accidentally write a different database
or a changed plan.
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
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
CONTAINER = "fetch-aptem-evidences"
LABEL = "Estimated — approval required"
BASIS = "aptem:accepted-evidence-spent-minutes;estimated-reporting-allocation"
RUN_KIND = "sharon-estimated-evidence-repair-v1"
# Keep the persisted label UTF-8 even when this source file is opened through a
# legacy Windows console.
LABEL = "Estimated — approval required"

# Parent IDs already created by the Aptem source reconciliation.  A None
# parent means that the selected evidence has no canonical source and must get
# its own parent row.
PLAN = {
    4336: {704792: [34444, 39286, 42999], 704808: [51630]},
    4445: {705110: [38942, 40967], 705113: [47596]},
    4365: {705301: [43748], 705302: [43756]},
}

# Evidence-backed allocations.  Exact dates in the source document are kept
# where available; ranges/category totals without exact dates are distributed
# over the nearest valid weekdays and remain estimated.
SCHEDULES = {
    34444: [("2026-03-30", 4 * 3600), ("2026-03-31", 4 * 3600)],
    39286: [("2026-04-01", 5 * 3600)],
    42999: [("2026-03-24", 6 * 3600)],
    38942: [
        ("2026-04-27", 6 * 3600), ("2026-04-28", 8 * 3600),
        ("2026-04-29", 5 * 3600), ("2026-04-30", 8 * 3600),
        ("2026-05-01", 4 * 3600), ("2026-05-04", 2 * 3600),
    ],
    40967: [("2026-05-14", int(4.5 * 3600))],
    47596: [
        ("2026-05-11", 6 * 3600), ("2026-05-12", 6 * 3600),
        ("2026-05-13", 6 * 3600), ("2026-05-14", 6 * 3600),
        ("2026-05-15", 6 * 3600),
        ("2026-06-05", 8 * 3600),
        ("2026-06-08", 7 * 3600), ("2026-06-09", 7 * 3600),
        ("2026-06-10", 7 * 3600), ("2026-06-11", 7 * 3600),
        ("2026-06-12", 7 * 3600),
        ("2026-06-23", 2 * 3600),
    ],
    # The document says 7h on 5 June.  The existing journal already has
    # 1h21m on that date, so the estimated reporting split uses the nearest
    # weekday to keep each day below the 8h working limit.
    43748: [("2026-06-04", 3 * 3600), ("2026-06-05", 4 * 3600)],
    # The May document contains four explicit category totals (10h + 8h +
    # 8h + 8h).  The exact category dates are not a single continuous log,
    # therefore the reporting split remains estimated and weekday-only.
    43756: [
        # May 18-22 already carry journal time; these nearest weekdays keep
        # the combined learner day under the 8h rule (May 26-Jun 2).
        ("2026-05-26", 19800), ("2026-05-27", 21600),
        ("2026-05-28", 17100), ("2026-05-29", 22920),
        ("2026-06-01", 18000), ("2026-06-02", 22980),
    ],
    51630: [],  # built from the dated category schedule below
}

# Nicholas's July evidence has four documented category totals.  Splits are
# intentionally even and preserve the document's date order.
def _split(total: int, days: list[str]) -> list[tuple[str, int]]:
    base, remainder = divmod(total, len(days))
    return [(day, base + (1 if index < remainder else 0))
            for index, day in enumerate(days)]


SCHEDULES[51630] = (
    _split(11 * 3600, ["2026-07-08", "2026-07-14", "2026-07-15", "2026-07-22",
                        "2026-07-23", "2026-07-29", "2026-07-30", "2026-07-31"])
    + _split(6 * 3600, ["2026-07-06", "2026-07-08"])
    + _split(7 * 3600, ["2026-07-02", "2026-07-20", "2026-07-21", "2026-07-30"])
    + _split(14 * 3600 + 30 * 60, ["2026-07-02", "2026-07-03", "2026-07-07", "2026-07-09",
                                   "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-17",
                                   "2026-07-20", "2026-07-24", "2026-07-28", "2026-07-29",
                                   "2026-07-30", "2026-07-31"])
)


def env_values() -> dict[str, str]:
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def database_url() -> str:
    values = env_values()
    url = values.get("ENROLMENT_DATABASE_URL") or values.get("Database_url") or values.get("DATABASE_URL")
    if not url:
        raise ValueError("No configured enrolment database.")
    return url


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def local_datetime(day: str, offset_seconds: int = 0) -> datetime:
    parsed = date.fromisoformat(day)
    if parsed.weekday() >= 5:
        raise ValueError(f"Weekend allocation is forbidden: {day}")
    return datetime.combine(parsed, time(9, 0), tzinfo=UK) + timedelta(seconds=offset_seconds)


def evidence_rows(cur):
    selected = sorted({eid for groups in PLAN.values() for ids in groups.values() for eid in ids})
    rows = cur.execute('''SELECT evidence_id,learner_id,component_id,component_name,
            evidence_name,evidence_status,spent_time,hours_type,spent_time_type,
            completed_date_override,completed_date,submission_date,source_fetched_at,
            source_synced_at,file_blob,note_blob,report_blob,note_content,evidence_raw,ksb_codes
        FROM fetching_evidence.evidence_items WHERE evidence_id=ANY(%s) ORDER BY evidence_id''', [selected]).fetchall()
    by_id = {int(row["evidence_id"]): row for row in rows}
    if set(by_id) != set(selected):
        raise ValueError("Selected evidence is missing from fetching_evidence.")
    for row in rows:
        if row["evidence_status"] != "Accepted" or row["hours_type"] != "OffTheJobTraining" or row["spent_time_type"] != "PaidWorkingHours":
            raise ValueError(f"Evidence {row['evidence_id']} is not accepted paid OTJ.")
        minutes = int(row["spent_time"])
        scheduled = sum(seconds for _, seconds in SCHEDULES[int(row["evidence_id"])])
        if scheduled != minutes * 60:
            raise ValueError(f"Evidence {row['evidence_id']} schedule does not equal source minutes.")
    return by_id


def allocation_payload(evidence, segments, group_ids, evidence_id=None):
    raw = dict(evidence.get("evidence_raw") or {})
    allocation = {
        "estimated": True,
        "approval_required": True,
        "label": LABEL,
        "index_rule": "nearest valid weekday, order-preserved",
        "source_evidence_ids": group_ids,
        "original_evidence_date": str(evidence.get("completed_date_override") or evidence.get("completed_date") or evidence.get("submission_date")),
        "segments": segments,
    }
    raw["reconciliation"] = {
        "resolution": "estimated_evidence_hours_repair",
        "estimated": True,
        "approval_required": True,
        "reporting_allocation": allocation,
        "source_evidence_ids": group_ids,
    }
    raw["component_name"] = evidence.get("component_name")
    if evidence.get("note_content"):
        raw["note_content"] = evidence["note_content"]
    if evidence_id is not None:
        raw["reconciliation"]["evidence_id"] = evidence_id
    return raw


DAILY_SECONDS = 8 * 60 * 60


def make_segments(evidence_ids, by_id, journal_usage=None, selected_usage=None):
    result = []
    # A document can contain several category allocations on the same day
    # (Nicholas's July evidence), and historical Journal rows may already use
    # part of the 8h learner-day.  Allocate each requested block to the nearest
    # valid weekday with remaining capacity, splitting only when necessary.
    journal_usage = journal_usage or {}
    selected_usage = selected_usage if selected_usage is not None else defaultdict(int)
    for evidence_id in evidence_ids:
        evidence = by_id[evidence_id]
        for day, seconds in SCHEDULES[evidence_id]:
            preferred = date.fromisoformat(day)
            remaining = int(seconds)
            # Search in nearest-date order, preferring the documented date,
            # then later dates before earlier dates to retain chronology.
            distances = [0]
            for distance in range(1, 370):
                distances.extend((distance, -distance))
            for offset in distances:
                if remaining <= 0:
                    break
                candidate = preferred + timedelta(days=offset)
                if candidate.weekday() >= 5:
                    continue
                candidate_text = candidate.isoformat()
                used = int(journal_usage.get(candidate, 0)) + int(selected_usage.get(candidate, 0))
                capacity = DAILY_SECONDS - used
                if capacity <= 0:
                    continue
                allocated = min(remaining, capacity)
                cursor = local_datetime(candidate_text, int(selected_usage.get(candidate, 0)))
                end = cursor + timedelta(seconds=allocated)
                if end.astimezone(UK).date() != candidate or end.hour > 17 or (end.hour == 17 and end.minute > 0):
                    continue
                result.append({"evidence_id": evidence_id, "seconds": allocated,
                               "start": cursor.isoformat(), "end": end.isoformat(),
                               "date": candidate_text, "month": candidate_text[:7],
                               "anchor_date": day})
                selected_usage[candidate] = int(selected_usage.get(candidate, 0)) + allocated
                remaining -= allocated
            if remaining:
                raise ValueError(f"No weekday capacity remains for evidence {evidence_id} ({remaining}s).")
    return result


def read_plan(cur):
    by_evidence = evidence_rows(cur)
    owners = {}
    for aptem_id in PLAN:
        owner_rows = cur.execute('''SELECT id,enrolment_id,programme_id,aptem_id,full_name
                                    FROM "Learner".learners WHERE aptem_id=%s''', [aptem_id]).fetchall()
        if len(owner_rows) != 1:
            raise ValueError(f"Expected one learner for Aptem {aptem_id}.")
        owners[aptem_id] = owner_rows[0]
    parents = {}
    sources = {}
    segments = {}
    documents = {}
    for aptem_id, groups in PLAN.items():
        owner_id = owners[aptem_id]["id"]
        parent_ids = [pid for pid in groups if pid is not None]
        if parent_ids:
            rows = cur.execute('''SELECT * FROM "Learner".learner_progress_entries
                                  WHERE id=ANY(%s) AND learner_id=%s AND deleted_at IS NULL''', [parent_ids, owner_id]).fetchall()
            parents.update({int(row["id"]): row for row in rows})
            if set(parents) & set(parent_ids) != set(parent_ids):
                raise ValueError(f"A reviewed parent is missing for Aptem {aptem_id}.")
        for parent_id, evidence_ids in groups.items():
            source_rows = cur.execute('''SELECT * FROM "Learner".learner_activity_sources
                                         WHERE learner_id=%s AND source_system='aptem' AND deleted_at IS NULL
                                           AND source_activity_id=ANY(%s) ORDER BY id''',
                                      [owner_id, [f"evidence:{eid}" for eid in evidence_ids]]).fetchall()
            sources.update({int(row["id"]): row for row in source_rows})
            for row in source_rows:
                if parent_id is not None and row["canonical_progress_id"] != parent_id:
                    raise ValueError(f"Evidence source {row['source_activity_id']} points to a different parent.")
                if parent_id is None:
                    raise ValueError(f"Evidence source unexpectedly exists for new parent {row['source_activity_id']}.")
            if parent_id is not None:
                existing_segments = cur.execute('''SELECT * FROM "Learner".learner_activity_reporting_segments
                                                   WHERE progress_id=%s ORDER BY segment_order,id''', [parent_id]).fetchall()
                if existing_segments:
                    raise ValueError(f"Parent {parent_id} already has reporting segments; manual review required.")
                segments[parent_id] = existing_segments
    return owners, by_evidence, parents, sources, segments, documents


def build_report(cur):
    owners, by_evidence, parents, sources, segments, _ = read_plan(cur)
    journal_usage_by_owner: dict[int, dict[date, int]] = {}
    for owner in owners.values():
        rows = cur.execute('''SELECT activity_date,COALESCE(SUM(actual_hours),0) AS hours
                                FROM "Learner".learner_journal_rows
                               WHERE canonical_learner_id=%s AND deleted_at IS NULL
                                 AND accepted IS TRUE AND activity_date <= '2026-08-31'
                               GROUP BY activity_date''', [owner["id"]]).fetchall()
        journal_usage_by_owner[int(owner["id"])] = {
            row["activity_date"]: int(round(float(row["hours"] or 0) * 3600))
            for row in rows
        }
    selected_usage_by_owner: dict[int, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    plans = []
    for aptem_id, groups in PLAN.items():
        for parent_id, evidence_ids in groups.items():
            owner_id = int(owners[aptem_id]["id"])
            group_segments = sorted(
                make_segments(evidence_ids, by_evidence,
                              journal_usage_by_owner[owner_id],
                              selected_usage_by_owner[owner_id]),
                key=lambda seg: (seg["start"], seg["evidence_id"]),
            )
            expected_seconds = sum(int(by_evidence[eid]["spent_time"]) * 60 for eid in evidence_ids)
            if sum(int(seg["seconds"]) for seg in group_segments) != expected_seconds:
                raise ValueError(f"Group total mismatch for Aptem {aptem_id}.")
            parent = parents.get(parent_id) if parent_id is not None else None
            source_ids = [int(sid) for sid, row in sources.items()
                          if row["source_activity_id"] in {f"evidence:{eid}" for eid in evidence_ids}]
            plans.append({"aptem_id": aptem_id, "owner_id": owners[aptem_id]["id"],
                          "owner_name": owners[aptem_id]["full_name"], "parent_id": parent_id,
                          "evidence_ids": evidence_ids, "expected_seconds": expected_seconds,
                          "segments": group_segments, "source_ids": source_ids,
                          "existing_parent_seconds": parent["actual_seconds"] if parent else None})
    database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
    totals = {}
    for aptem_id, owner in owners.items():
        journal = cur.execute('''SELECT COALESCE(SUM(actual_hours),0) AS hours
                                  FROM "Learner".learner_journal_rows
                                 WHERE canonical_learner_id=%s AND deleted_at IS NULL AND accepted IS TRUE
                                   AND activity_date <= '2026-08-31' ''', [owner["id"]]).fetchone()["hours"]
        aptem = cur.execute('''SELECT COALESCE(SUM(spent_time),0) AS minutes
                                 FROM fetching_evidence.evidence_items
                                WHERE learner_id=%s AND evidence_status='Accepted'
                                  AND hours_type='OffTheJobTraining' AND spent_time_type='PaidWorkingHours'
                                  AND COALESCE(completed_date_override,completed_date,submission_date)::date <= '2026-08-31' ''', [aptem_id]).fetchone()["minutes"]
        added = sum(item["expected_seconds"] for item in plans if item["aptem_id"] == aptem_id)
        totals[aptem_id] = {"journal_hours": float(journal or 0), "aptem_hours": float(aptem or 0) / 60,
                            "planned_estimated_added_hours": added / 3600,
                            "planned_estimated_after_hours": float(journal or 0) + added / 3600}
    report = {"database": database, "plans": plans, "totals": totals,
              "selected_evidence_count": len(by_evidence), "selected_source_count": len(sources)}
    report["fingerprint"] = digest(report)
    return report


def insert_row(cur, table, values):
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values))
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def apply_report(cur, report, expected_database, expected_fingerprint):
    if report["database"] != expected_database or report["fingerprint"] != expected_fingerprint:
        raise ValueError("Database or reviewed fingerprint changed; preview again.")
    run = insert_row(cur, "activity_sync_runs", {
        "run_key": "sharon-estimated-evidence-repair:" + expected_fingerprint,
        "run_kind": RUN_KIND, "status": "running", "dry_run": False,
        "prompt_version": "v1-evidence-doc-hours", "source_counts": Jsonb({
            "aptem_ids": sorted(PLAN), "evidence_ids": sorted({eid for groups in PLAN.values() for ids in groups.values() for eid in ids}),
            "estimated": True}),
        "result_counts": Jsonb({}),
    })
    by_evidence = evidence_rows(cur)
    owners, _, parents, sources, _, _ = read_plan(cur)
    created_parents = 0
    source_updates = 0
    segment_count = 0
    documents_added = 0
    for item in report["plans"]:
        aptem_id = item["aptem_id"]
        owner = owners[aptem_id]
        parent_id = item["parent_id"]
        evidence_ids = item["evidence_ids"]
        group_segments = item["segments"]
        parent_segments = [{k: v for k, v in seg.items() if k != "evidence_id"} for seg in group_segments]
        payload = allocation_payload(by_evidence[evidence_ids[0]], parent_segments, evidence_ids)
        if parent_id is None:
            first = by_evidence[evidence_ids[0]]
            max_order = cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner["id"]]).fetchone()["n"]
            parent_id = insert_row(cur, "learner_progress_entries", {
                "learner_id": owner["id"], "entry_order": int(max_order) + 1,
                "kind": "assignment", "component_ref": f"evidence:{first['evidence_id']}",
                "component_title": first["component_name"] or first["evidence_name"],
                "component_type": "assignment", "enrolment_id": owner["enrolment_id"],
                "programme_id": owner["programme_id"], "aptem_id": owner["aptem_id"],
                "source_system": "aptem", "source_activity_id": f"evidence:{first['evidence_id']}",
                "canonical_activity_key": f"aptem:{aptem_id}:evidence:{first['evidence_id']}",
                "activity_status": "Accepted", "accepted": True,
                "actual_seconds": item["expected_seconds"], "actual_basis": BASIS,
                "reporting_started_at": datetime.fromisoformat(parent_segments[0]["start"]),
                "reporting_ended_at": datetime.fromisoformat(parent_segments[-1]["end"]),
                "reporting_month": min(seg["month"] for seg in parent_segments),
                "reporting_timestamp_label": LABEL, "source_payload": Jsonb(payload),
                "sync_run_id": run,
            })
            created_parents += 1
        else:
            current = cur.execute('SELECT actual_seconds,deleted_at FROM "Learner".learner_progress_entries WHERE id=%s AND learner_id=%s FOR UPDATE', [parent_id, owner["id"]]).fetchone()
            if not current or current["deleted_at"] is not None:
                raise ValueError(f"Parent {parent_id} changed or was deleted.")
            cur.execute('''UPDATE "Learner".learner_progress_entries
                              SET actual_seconds=%s,actual_basis=%s,reporting_started_at=%s,
                                  reporting_ended_at=%s,reporting_month=%s,reporting_timestamp_label=%s,
                                  source_payload=%s,sync_run_id=%s,ssot_updated_at=now()
                            WHERE id=%s''', [item["expected_seconds"], BASIS,
                                datetime.fromisoformat(parent_segments[0]["start"]),
                                datetime.fromisoformat(parent_segments[-1]["end"]),
                                min(seg["month"] for seg in parent_segments), LABEL,
                                Jsonb(payload), run, parent_id])
        for index, seg in enumerate(parent_segments, 1):
            insert_row(cur, "learner_activity_reporting_segments", {
                "progress_id": parent_id, "learner_id": owner["id"], "segment_order": index,
                "actual_seconds": seg["seconds"], "reporting_started_at": datetime.fromisoformat(seg["start"]),
                "reporting_ended_at": datetime.fromisoformat(seg["end"]), "reporting_month": seg["month"],
                "sync_run_id": run,
            })
            segment_count += 1
        for evidence_id in evidence_ids:
            evidence = by_evidence[evidence_id]
            evidence_segments = [{k: v for k, v in seg.items() if k != "evidence_id"}
                                 for seg in group_segments if seg["evidence_id"] == evidence_id]
            evidence_payload = allocation_payload(evidence, evidence_segments, evidence_ids, evidence_id)
            source = next((row for row in sources.values() if row["source_activity_id"] == f"evidence:{evidence_id}"), None)
            started = datetime.fromisoformat(evidence_segments[0]["start"])
            ended = datetime.fromisoformat(evidence_segments[-1]["end"])
            if source:
                cur.execute('''UPDATE "Learner".learner_activity_sources
                                  SET canonical_progress_id=%s,actual_seconds=%s,actual_basis=%s,
                                      source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,
                                      reporting_ended_at=%s,reporting_month=%s,source_payload=%s,
                                      ksb_codes=%s,sync_run_id=%s,last_seen_at=now()
                                WHERE id=%s''', [parent_id, int(evidence["spent_time"]) * 60, BASIS,
                                    started, ended, started, ended, min(seg["month"] for seg in evidence_segments),
                                    Jsonb(evidence_payload), Jsonb(evidence["ksb_codes"] or []), run, source["id"]])
            else:
                insert_row(cur, "learner_activity_sources", {
                    "learner_id": owner["id"], "enrolment_id": owner["enrolment_id"],
                    "programme_id": owner["programme_id"], "aptem_id": owner["aptem_id"],
                    "source_system": "aptem", "source_activity_id": f"evidence:{evidence_id}",
                    "canonical_activity_key": f"aptem:{aptem_id}:evidence:{evidence_id}",
                    "activity_type": "assignment", "title": evidence["component_name"] or evidence["evidence_name"],
                    "activity_status": "Accepted", "completed": True, "accepted": True,
                    "actual_seconds": int(evidence["spent_time"]) * 60, "actual_basis": BASIS,
                    "source_started_at": started, "source_ended_at": ended,
                    "reporting_started_at": started, "reporting_ended_at": ended,
                    "reporting_month": min(seg["month"] for seg in evidence_segments),
                    "source_payload": Jsonb(evidence_payload), "ksb_codes": Jsonb(evidence["ksb_codes"] or []),
                    "sync_run_id": run, "canonical_progress_id": parent_id,
                    "source_fingerprint": digest(evidence),
                })
            source_updates += 1
            if evidence["file_blob"]:
                exists = cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents
                                         WHERE source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''', [f"evidence:{evidence_id}:file"]).fetchone()
                if not exists:
                    insert_row(cur, "learner_activity_documents", {
                        "learner_id": owner["id"], "progress_id": parent_id, "source_system": "aptem",
                        "source_document_id": f"evidence:{evidence_id}:file", "container": CONTAINER,
                        "blob_name": evidence["file_blob"], "display_name": evidence["evidence_name"],
                        "content_type": mimetypes.guess_type(evidence["evidence_name"])[0] or "application/octet-stream",
                        "uploaded_at": evidence["submission_date"],
                    })
                    documents_added += 1
    result = {"estimated": True, "approval_required": True, "label": LABEL,
              "parents_updated_or_created": len(report["plans"]), "created_parents": created_parents,
              "source_rows_written": source_updates, "segments_written": segment_count,
              "documents_added": documents_added,
              "evidence_ids": sorted({eid for groups in PLAN.values() for ids in groups.values() for eid in ids}),
              "seconds_written": sum(item["expected_seconds"] for item in report["plans"])}
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed_with_issues',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run])
    return run, result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not args.expected_database or args.apply and not args.expected_fingerprint:
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(database_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=30000")
            cur.execute("SET LOCAL lock_timeout=5000")
            if args.apply:
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('sharon-estimated-evidence-repair'))")
            report = build_report(cur)
            if args.apply:
                run_id, result = apply_report(cur, report, args.expected_database, args.expected_fingerprint)
                report["applied"] = True
                report["run_id"] = run_id
                report["result"] = result
            print(json.dumps(report, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
