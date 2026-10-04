"""Reconcile Aptem Additional job activities for the two Social Media groups.

The command is deliberately two phase.  The default invocation is a read-only
inventory/dry-run.  ``--apply`` requires the reviewed database name and plan
fingerprint printed by that dry-run.  It only updates the canonical Aptem
lineage and document links for the two named rosters; it never edits the Aptem
mirror and it never deletes an LMS row unless an exact source identity proves
the row is a duplicate.  In the current data set no such LMS identity match
exists, so ambiguous LMS activities are reported and left untouched.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import hashlib
import io
import json
import mimetypes
import os
from pathlib import Path
import re
import sys
import zipfile
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

try:
    from azure.storage.blob import BlobServiceClient
except Exception:  # pragma: no cover - dry-run can still describe missing Azure SDK
    BlobServiceClient = None

UK = ZoneInfo("Europe/London")
CONTAINER = "fetch-aptem-evidences"
LABEL = "\u062a\u0642\u062f\u064a\u0631\u064a \u2014 \u064a\u062d\u062a\u0627\u062c \u0627\u0639\u062a\u0645\u0627\u062f"
BASIS = "aptem:accepted-additional-job-activity-spent-minutes;estimated-reporting-allocation"
RUN_KIND = "additional-hours-social-media-v1"
PROMPT_VERSION = "v2-additional-hours-azure-social-media"
DAILY_SECONDS = 8 * 60 * 60
WEEKLY_SECONDS = 12 * 60 * 60
MONTHLY_SECONDS = 45 * 60 * 60

GROUPS = {
    "G2-Juliane Social Media": {
        "group_id": "GROUP-202609211159360971368DB0592873D3",
        "module_id": "MOD-202609211208476573216D584A576BEF",
        "coach": "Juliane Thieme",
        "aptem_ids": [15825, 15955, 15997, 16146, 17045, 17216, 17370,
                       17403, 17432, 17922, 18123, 18222, 18962, 19320],
    },
    "G1-Julian Social Media": {
        "group_id": "GROUP-20260921115837423561E79D154A1979",
        "module_id": "MOD-20260921081039161503EB58ACC4DD01",
        "coach": "Julian Thomas",
        "aptem_ids": [4609, 6231, 10250, 10625, 14548, 14874, 15021,
                       15069, 15430, 15822, 15825, 16001, 16057, 16456,
                       16930, 17323, 18000],
    },
}
ALL_APTEM_IDS = sorted({aid for group in GROUPS.values() for aid in group["aptem_ids"]})
GROUPS_BY_LEARNER: dict[int, list[str]] = defaultdict(list)
for _group_name, _group in GROUPS.items():
    for _aid in _group["aptem_ids"]:
        GROUPS_BY_LEARNER[_aid].append(_group_name)


def env_values() -> dict[str, str]:
    values = dict(os.environ)
    env_file = Path(__file__).resolve().parents[1] / ".env"
    for raw in env_file.read_text(encoding="utf-8-sig").splitlines():
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


def fmt(seconds: int | None) -> str:
    if seconds is None:
        return "—"
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(seconds))
    return f"{sign}{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def local_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UK)
        return value.astimezone(UK).date()
    if isinstance(value, date):
        return value
    return None


def evidence_day(row: dict[str, Any]) -> date | None:
    return local_date(row.get("evidence_at"))


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def is_additional_component(value: Any) -> bool:
    # Component name is the authoritative classifier.  A note or evidence
    # filename containing these words is intentionally not enough.
    text = norm(value)
    return bool(re.search(r"\badditional\s+job\s+activit(?:y|ies)\b", text))


def bank_holidays() -> set[date]:
    return {
        date(2026, 1, 1), date(2026, 4, 3), date(2026, 4, 6),
        date(2026, 5, 4), date(2026, 5, 25), date(2026, 8, 31),
        date(2026, 12, 25), date(2026, 12, 28), date(2027, 1, 1),
    }


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def read_breaks(cur) -> dict[int, dict[str, Any]]:
    rows = cur.execute(
        '''SELECT DISTINCT ON (learner_id) learner_id,program_status,"Break in learning" AS break_json
             FROM fetching_evidence.aptem_cv_contracts_probe
            WHERE learner_id=ANY(%s) AND source <> 'audit_upload'
            ORDER BY learner_id,fetched_at DESC NULLS LAST,id DESC''', [ALL_APTEM_IDS]
    ).fetchall()
    result: dict[int, dict[str, Any]] = {}
    for row in rows:
        value = row.get("break_json")
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except ValueError:
                value = {}
        value = value if isinstance(value, dict) else {}
        if str(row.get("program_status") or "").strip().lower() == "onbreak":
            value["has_break_in_learning"] = True
        result[int(row["learner_id"])] = value
    return result


def load_state(cur) -> dict[str, Any]:
    owners = cur.execute(
        '''SELECT id,enrolment_id,programme_id,aptem_id,full_name
             FROM "Learner".learners WHERE aptem_id=ANY(%s) ORDER BY aptem_id''', [ALL_APTEM_IDS]
    ).fetchall()
    if {int(row["aptem_id"]) for row in owners} != set(ALL_APTEM_IDS):
        raise ValueError("The two Social Media rosters do not resolve to the expected canonical learners.")
    aptem = cur.execute(
        '''SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date
             FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)''', [ALL_APTEM_IDS]
    ).fetchall()
    if {int(row["aptem_id"]) for row in aptem} != set(ALL_APTEM_IDS):
        raise ValueError("Aptem Start/End rows are incomplete for the requested scope.")
    owner_ids = [row["id"] for row in owners]
    evidence = cur.execute(
        '''SELECT e.*,coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_at
             FROM fetching_evidence.evidence_items e
            WHERE e.learner_id=ANY(%s) AND e.evidence_status='Accepted'
              AND e.spent_time>0 AND e.hours_type='OffTheJobTraining'
              AND e.spent_time_type='PaidWorkingHours'
            ORDER BY e.learner_id,e.evidence_id''', [ALL_APTEM_IDS]
    ).fetchall()
    progress = cur.execute(
        '''SELECT * FROM "Learner".learner_progress_entries
            WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''', [owner_ids]
    ).fetchall()
    sources = cur.execute(
        '''SELECT * FROM "Learner".learner_activity_sources
            WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''', [owner_ids]
    ).fetchall()
    segments = cur.execute(
        '''SELECT * FROM "Learner".learner_activity_reporting_segments
            WHERE learner_id=ANY(%s) ORDER BY learner_id,progress_id,segment_order,id''', [owner_ids]
    ).fetchall()
    documents = cur.execute(
        '''SELECT * FROM "Learner".learner_activity_documents
            WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''', [owner_ids]
    ).fetchall()
    journals = cur.execute(
        '''SELECT * FROM "Learner".learner_journal_rows
            WHERE canonical_learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY canonical_learner_id,id''', [owner_ids]
    ).fetchall()
    return {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "owners": {int(row["aptem_id"]): row for row in owners},
        "aptem": {int(row["aptem_id"]): row for row in aptem},
        "breaks": read_breaks(cur),
        "evidence": evidence,
        "progress": progress,
        "sources": sources,
        "segments": segments,
        "documents": documents,
        "journals": journals,
    }


def accepted_evidence_day_valid(row: dict[str, Any], state: dict[str, Any]) -> tuple[bool, str]:
    aid = int(row["learner_id"])
    day = evidence_day(row)
    period = state["aptem"].get(aid)
    if not is_additional_component(row.get("component_name")):
        return False, "not_additional_component"
    if not day:
        return False, "missing_date"
    if not period or not period["start_date"] or not period["end_date"]:
        return False, "missing_start_end"
    if not (period["start_date"] <= day <= period["end_date"]):
        return False, "outside_start_end"
    break_data = state["breaks"].get(aid) or {}
    last_learning = break_data.get("last_learning_date")
    return_learning = break_data.get("return_to_learning_date")
    try:
        last_learning = date.fromisoformat(str(last_learning)) if last_learning else None
        return_learning = date.fromisoformat(str(return_learning)) if return_learning else None
    except ValueError:
        return False, "invalid_break_date"
    if break_data.get("has_break_in_learning") and last_learning and day > last_learning:
        if not return_learning or day < return_learning:
            return False, "inside_break_in_learning"
    return True, "valid"


def evidence_seconds(row: dict[str, Any]) -> int:
    return int(Decimal(str(row["spent_time"])) * 60)


def evidence_id_from_source(row: dict[str, Any]) -> int | None:
    match = re.fullmatch(r"evidence:(\d+)", str(row.get("source_activity_id") or ""))
    if match:
        return int(match.group(1))
    raw = row.get("source_payload") or {}
    raw_id = raw.get("Id") if isinstance(raw, dict) else None
    try:
        return int(raw_id) if raw_id is not None else None
    except (TypeError, ValueError):
        return None


def parse_break_days(break_data: dict[str, Any], start: date, end: date) -> set[date]:
    if not break_data.get("has_break_in_learning"):
        return set()
    try:
        last = date.fromisoformat(str(break_data.get("last_learning_date"))) if break_data.get("last_learning_date") else start - timedelta(days=1)
        returned = date.fromisoformat(str(break_data.get("return_to_learning_date"))) if break_data.get("return_to_learning_date") else end + timedelta(days=1)
    except ValueError:
        return set()
    return {last + timedelta(days=i) for i in range(1, max(0, (returned - last).days)) if start <= last + timedelta(days=i) <= end}


def existing_occupancy(state: dict[str, Any], owner_id: int, excluded_parent_ids: set[int]) -> tuple[dict[date, int], set[date]]:
    """Return known daily usage and lecture days without double-counting rows.

    Journal and canonical segments can represent the same event.  The daily
    maximum is therefore used rather than summing the two projections.
    """
    per_day: dict[date, list[int]] = defaultdict(list)
    lecture_days: set[date] = set()
    for row in state["journals"]:
        if row["canonical_learner_id"] != owner_id or not row.get("accepted") or not row.get("activity_date"):
            continue
        day = row["activity_date"]
        seconds = int(Decimal(str(row.get("actual_hours") or 0)) * 3600)
        per_day[day].append(seconds)
        if str(row.get("category") or "").lower() in {"attendance", "lecture", "session"}:
            lecture_days.add(day)
    for row in state["segments"]:
        if row["learner_id"] != owner_id:
            continue
        if int(row["progress_id"]) in excluded_parent_ids:
            continue
        start = local_date(row.get("reporting_started_at"))
        if start:
            per_day[start].append(int(row.get("actual_seconds") or 0))
    progress_ids = {int(p["id"]): p for p in state["progress"] if p["learner_id"] == owner_id and int(p["id"]) not in excluded_parent_ids}
    seg_parent_ids = {int(s["progress_id"]) for s in state["segments"] if s["learner_id"] == owner_id}
    for row in progress_ids.values():
        if row.get("actual_seconds") and row.get("reporting_started_at") and int(row["id"]) not in seg_parent_ids:
            day = local_date(row["reporting_started_at"])
            if day:
                per_day[day].append(int(row["actual_seconds"]))
        if str(row.get("kind") or "").lower() == "attendance" or str(row.get("component_type") or "").lower() == "attendance":
            day = local_date(row.get("reporting_started_at"))
            if day:
                lecture_days.add(day)
    return {day: max(values) for day, values in per_day.items()}, lecture_days


def allocate(owner_id: int, state: dict[str, Any], evidence_rows: list[dict[str, Any]], excluded_parent_ids: set[int], used: dict[date, int], lecture_days: set[date], planned: dict[date, int]) -> list[dict[str, Any]]:
    periods = state["aptem"]
    aid = next(int(a) for a, owner in state["owners"].items() if owner["id"] == owner_id)
    period = periods[aid]
    break_days = parse_break_days(state["breaks"].get(aid) or {}, period["start_date"], period["end_date"])
    result: list[dict[str, Any]] = []
    # Evidence/date order is stable and is also the source-index order used in
    # the report.  Within a single parent this keeps the monthly log readable.
    for evidence in sorted(evidence_rows, key=lambda row: (evidence_day(row) or period["start_date"], int(row["evidence_id"]))):
        remaining = evidence_seconds(evidence)
        anchor = evidence_day(evidence)
        if not anchor:
            raise ValueError(f"Evidence {evidence['evidence_id']} has no usable date.")
        for offset in range(0, 370):
            if remaining <= 0:
                break
            day = anchor + timedelta(days=offset)
            if day < period["start_date"] or day > period["end_date"]:
                continue
            if day.weekday() >= 5 or day in bank_holidays() or day in break_days or day in lecture_days:
                continue
            week = day.isocalendar()[:2]
            week_used = sum(int(used.get(d, 0)) + int(planned.get(d, 0))
                            for d in set(used) | set(planned)
                            if d.isocalendar()[:2] == week)
            month_used = sum(int(used.get(d, 0)) + int(planned.get(d, 0))
                             for d in set(used) | set(planned)
                             if d.strftime("%Y-%m") == day.strftime("%Y-%m"))
            # Do not overwrite a day in planned: combine its existing value.
            day_used = int(used.get(day, 0)) + int(planned.get(day, 0))
            capacity = min(DAILY_SECONDS - day_used, WEEKLY_SECONDS - week_used, MONTHLY_SECONDS - month_used)
            if capacity <= 0:
                continue
            allocated = min(remaining, capacity)
            start = datetime.combine(day, time(9, 0), tzinfo=UK) + timedelta(seconds=day_used)
            end = start + timedelta(seconds=allocated)
            if end.astimezone(UK).date() != day or end > datetime.combine(day, time(17, 0), tzinfo=UK):
                continue
            result.append({"evidence_id": int(evidence["evidence_id"]), "seconds": allocated,
                           "start": start.isoformat(), "end": end.isoformat(),
                           "date": day.isoformat(), "month": day.strftime("%Y-%m"),
                           "anchor_date": anchor.isoformat(), "estimated": True})
            planned[day] = int(planned.get(day, 0)) + allocated
            remaining -= allocated
        if remaining:
            raise ValueError(f"No valid weekday capacity for evidence {evidence['evidence_id']} ({remaining}s).")
    return result


def source_payload(evidence: dict[str, Any], group_names: list[str], resolution: str, segments: list[dict[str, Any]], parent_id: int | None) -> dict[str, Any]:
    payload = dict(evidence.get("evidence_raw") or {})
    reconciliation = dict(payload.get("reconciliation") or {})
    reconciliation.update({
        "resolution": resolution,
        "estimated": True,
        "approval_required": True,
        "label": LABEL,
        "source_evidence_id": int(evidence["evidence_id"]),
        "original_evidence_date": str(evidence.get("evidence_at")),
        "group_names": group_names,
        "canonical_progress_id": parent_id,
        "segments": segments,
        "azure_container": CONTAINER,
        "azure_file_blob": evidence.get("file_blob"),
        "azure_report_blob": evidence.get("report_blob"),
    })
    payload["reconciliation"] = reconciliation
    payload["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    if evidence.get("note_content"):
        payload["note_content"] = evidence["note_content"]
    return payload


def allocation_violations(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_owner_day: dict[tuple[int, date], int] = defaultdict(int)
    by_owner_week: dict[tuple[int, tuple[int, int]], int] = defaultdict(int)
    by_owner_month: dict[tuple[int, str], int] = defaultdict(int)
    overlaps: list[dict[str, Any]] = []
    intervals: dict[int, list[tuple[datetime, datetime, int]]] = defaultdict(list)
    for action in actions:
        owner_id = int(action["owner_id"])
        for segment in action["segments"]:
            start = datetime.fromisoformat(segment["start"])
            end = datetime.fromisoformat(segment["end"])
            day = start.astimezone(UK).date()
            seconds = int(segment["seconds"])
            by_owner_day[(owner_id, day)] += seconds
            by_owner_week[(owner_id, day.isocalendar()[:2])] += seconds
            by_owner_month[(owner_id, day.strftime("%Y-%m"))] += seconds
            intervals[owner_id].append((start, end, int(segment["evidence_id"])))
            if day.weekday() >= 5 or day in bank_holidays():
                overlaps.append({"owner_id": owner_id, "evidence_id": segment["evidence_id"], "reason": "weekend_or_bank_holiday", "date": day.isoformat()})
    for (owner_id, day), seconds in by_owner_day.items():
        if seconds > DAILY_SECONDS:
            overlaps.append({"owner_id": owner_id, "date": day.isoformat(), "seconds": seconds, "reason": "daily_over_8h"})
    for (owner_id, week), seconds in by_owner_week.items():
        if seconds > WEEKLY_SECONDS:
            overlaps.append({"owner_id": owner_id, "week": f"{week[0]}-W{week[1]:02d}", "seconds": seconds, "reason": "weekly_over_12h"})
    for (owner_id, month), seconds in by_owner_month.items():
        if seconds > MONTHLY_SECONDS:
            overlaps.append({"owner_id": owner_id, "month": month, "seconds": seconds, "reason": "monthly_over_45h"})
    for owner_id, items in intervals.items():
        items.sort()
        for previous, current in zip(items, items[1:]):
            if current[0] < previous[1]:
                overlaps.append({"owner_id": owner_id, "evidence_id": current[2], "reason": "overlap", "with_evidence_id": previous[2]})
    return overlaps


def azure_inventory(state: dict[str, Any]) -> dict[str, Any]:
    values = env_values()
    blobs: list[dict[str, Any]] = []
    for row in state["evidence"]:
        valid, reason = accepted_evidence_day_valid(row, state)
        if not valid or not is_additional_component(row.get("component_name")):
            continue
        for kind in ("file", "report"):
            blob = row.get(f"{kind}_blob")
            if blob:
                blobs.append({"evidence_id": int(row["evidence_id"]), "kind": kind, "blob": blob})
    if not blobs:
        return {"checked": 0, "found": 0, "missing": [], "sdk": bool(BlobServiceClient)}
    if BlobServiceClient is None or not values.get("AZURE_STORAGE_CONNECTION_STRING"):
        return {"checked": len(blobs), "found": 0, "missing": blobs, "sdk": False, "error": "Azure SDK/config unavailable"}
    service = BlobServiceClient.from_connection_string(values["AZURE_STORAGE_CONNECTION_STRING"])
    missing: list[dict[str, Any]] = []
    found = 0
    for blob in blobs:
        try:
            service.get_blob_client(CONTAINER, blob["blob"]).get_blob_properties()
            found += 1
        except Exception as exc:
            missing.append({"evidence_id": blob["evidence_id"], "kind": blob["kind"], "error": type(exc).__name__})
    return {"checked": len(blobs), "found": found, "missing": missing, "sdk": True}


def build_plan(state: dict[str, Any]) -> dict[str, Any]:
    progress_by_id = {int(row["id"]): row for row in state["progress"]}
    source_by_evidence: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    aptem_by_owner_id = {int(owner["id"]): int(aid) for aid, owner in state["owners"].items()}
    for source in state["sources"]:
        if source.get("source_system") != "aptem":
            continue
        eid = evidence_id_from_source(source)
        if eid is not None:
            source_by_evidence[(aptem_by_owner_id.get(int(source["learner_id"]), -1), eid)].append(source)
    segments_by_parent: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in state["segments"]:
        segments_by_parent[int(row["progress_id"])].append(row)
    docs_by_ref = {(int(row["learner_id"]), str(row["source_document_id"])): row for row in state["documents"]}
    valid: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for row in state["evidence"]:
        if not is_additional_component(row.get("component_name")):
            continue
        okay, reason = accepted_evidence_day_valid(row, state)
        record = {"evidence_id": int(row["evidence_id"]), "aptem_id": int(row["learner_id"]), "minutes": int(row["spent_time"]), "reason": reason}
        (valid if okay else excluded).append(record)
        if okay:
            source_rows = source_by_evidence[(int(row["learner_id"]), int(row["evidence_id"]))]
            if len(source_rows) != 1:
                raise ValueError(f"Evidence {row['evidence_id']} does not have exactly one active Aptem source row.")
            source = source_rows[0]
            if not source.get("canonical_progress_id"):
                raise ValueError(f"Evidence {row['evidence_id']} is missing canonical parent; stop before guessing.")
            parent = progress_by_id.get(int(source["canonical_progress_id"]))
            if not parent or parent.get("deleted_at") or parent.get("source_system") != "aptem":
                raise ValueError(f"Evidence {row['evidence_id']} points to a missing/non-Aptem parent.")
            record.update({"source_id": int(source["id"]), "parent_id": int(source["canonical_progress_id"])})

    evidence_by_id = {int(row["evidence_id"]): row for row in state["evidence"]}
    by_parent: dict[int, list[int]] = defaultdict(list)
    for item in valid:
        by_parent[int(item["parent_id"])].append(int(item["evidence_id"]))
    actions: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    planned_segments_by_owner: dict[int, dict[date, int]] = defaultdict(lambda: defaultdict(int))
    for parent_id, eids in sorted(by_parent.items()):
        parent = progress_by_id[parent_id]
        owner_id = int(parent["learner_id"])
        aid = int(state["owners_by_id"][owner_id]["aptem_id"])
        rows = [evidence_by_id[eid] for eid in sorted(eids, key=lambda eid: (evidence_day(evidence_by_id[eid]) or date.min, eid))]
        expected = sum(evidence_seconds(row) for row in rows)
        current_actual = int(parent["actual_seconds"] or 0)
        if parent.get("actual_seconds") is not None and current_actual > expected:
            blocked.append({"parent_id": parent_id, "aptem_id": aid, "evidence_ids": eids, "reason": "parent_hours_exceed_valid_additional_sum", "parent_seconds": current_actual, "evidence_seconds": expected})
            continue
        existing_segments = segments_by_parent.get(parent_id, [])
        existing_segment_seconds = sum(int(row.get("actual_seconds") or 0) for row in existing_segments)
        if existing_segment_seconds not in (0, current_actual):
            blocked.append({"parent_id": parent_id, "aptem_id": aid, "evidence_ids": eids, "reason": "existing_segment_total_conflict", "parent_seconds": current_actual, "segment_seconds": existing_segment_seconds})
            continue
        owner_usage, lecture_days = existing_occupancy(state, owner_id, {parent_id})
        planned = planned_segments_by_owner[owner_id]
        segments = []
        if existing_segment_seconds == 0:
            segments = allocate(owner_id, state, rows, {parent_id}, owner_usage, lecture_days, planned)
        else:
            # A parent already segmented by a prior approved run is not
            # reallocated.  Its segment total is treated as authoritative.
            if existing_segment_seconds != expected:
                blocked.append({"parent_id": parent_id, "aptem_id": aid, "evidence_ids": eids, "reason": "existing_segments_do_not_cover_evidence", "parent_seconds": current_actual, "segment_seconds": existing_segment_seconds, "evidence_seconds": expected})
                continue
        source_actions = []
        for eid in eids:
            source = next(s for s in state["sources"] if int(s["id"]) == int(next(x["source_id"] for x in valid if x["evidence_id"] == eid)))
            ev = evidence_by_id[eid]
            ev_segments = [seg for seg in segments if int(seg["evidence_id"]) == eid]
            source_actions.append({
                "evidence_id": eid,
                "source_id": int(source["id"]),
                "expected_seconds": evidence_seconds(ev),
                "actual_seconds_before": source.get("actual_seconds"),
                "segments": ev_segments,
                "needs_seconds": int(source.get("actual_seconds") or 0) != evidence_seconds(ev),
                "documents": [kind for kind in ("file", "report") if ev.get(f"{kind}_blob") and (owner_id, f"evidence:{eid}:{kind}") not in docs_by_ref],
                "file_blob": ev.get("file_blob"),
                "report_blob": ev.get("report_blob"),
            })
        after_actual = expected
        first = min((seg["start"] for seg in segments), default=None)
        last = max((seg["end"] for seg in segments), default=None)
        actions.append({
            "parent_id": parent_id, "owner_id": owner_id, "aptem_id": aid,
            "evidence_ids": eids, "expected_seconds": expected,
            "parent_seconds_before": parent["actual_seconds"], "parent_seconds_after": after_actual,
            "parent_delta_seconds": after_actual - current_actual,
            "segments": segments, "source_actions": source_actions,
            "reporting_started_at": first, "reporting_ended_at": last,
            "group_names": GROUPS_BY_LEARNER[aid],
        })

    # Exact LMS identity matches are the only automatic exclusion candidates.
    additional_refs = {f"evidence:{item['evidence_id']}" for item in valid}
    lms_rows: list[dict[str, Any]] = []
    exact_duplicates: list[dict[str, Any]] = []
    ambiguous_lms: list[dict[str, Any]] = []
    for row in state["progress"]:
        title = norm(row.get("component_title"))
        source = str(row.get("source_system") or "")
        if row.get("accepted") is not True or not row.get("actual_seconds") or "lms activity" not in title:
            continue
        if row.get("source_activity_id") in additional_refs:
            exact_duplicates.append({"progress_id": int(row["id"]), "owner_id": int(row["learner_id"]), "seconds": int(row["actual_seconds"]), "reason": "exact_source_activity_id"})
        else:
            ambiguous_lms.append({"progress_id": int(row["id"]), "owner_id": int(row["learner_id"]), "seconds": int(row["actual_seconds"]), "title": row.get("component_title"), "reason": "no_exact_additional_evidence_identity"})
        lms_rows.append(row)

    learners: list[dict[str, Any]] = []
    action_by_owner = defaultdict(list)
    for action in actions:
        action_by_owner[action["owner_id"]].append(action)
    for aid in ALL_APTEM_IDS:
        owner = state["owners"][aid]
        owner_id = int(owner["id"])
        before = sum(int(row.get("actual_seconds") or 0) for row in state["progress"] if int(row["learner_id"]) == owner_id and row.get("accepted") is True)
        add_seconds = sum(int(action["parent_delta_seconds"]) for action in action_by_owner[owner_id])
        additional_rows = [item for item in valid if int(item["aptem_id"]) == aid]
        learners.append({
            "aptem_id": aid, "name": owner["full_name"], "groups": GROUPS_BY_LEARNER[aid],
            "additional_evidence_count": len(additional_rows),
            "additional_accepted_seconds": sum(int(item["minutes"]) * 60 for item in additional_rows),
            "additional_delta_seconds": add_seconds,
            "ssot_before_seconds": before, "ssot_after_seconds": before + add_seconds,
            "difference_after_seconds": before + add_seconds - sum(int(row.get("actual_seconds") or 0) for row in state["progress"] if int(row["learner_id"]) == owner_id and row.get("accepted") is True),
            "action_count": len(action_by_owner[owner_id]),
        })
    groups: dict[str, Any] = {}
    for name, group in GROUPS.items():
        member_rows = [row for row in learners if name in row["groups"]]
        groups[name] = {
            "group_id": group["group_id"], "module_id": group["module_id"], "coach": group["coach"],
            "aptem_learners": len(member_rows), "screenshot_without_aptem_id": ["Aya Aya Test", "Aya Khater"],
            "additional_accepted_seconds": sum(row["additional_accepted_seconds"] for row in member_rows),
            "ssot_before_seconds": sum(row["ssot_before_seconds"] for row in member_rows),
            "additional_delta_seconds": sum(row["additional_delta_seconds"] for row in member_rows),
            "ssot_after_seconds": sum(row["ssot_after_seconds"] for row in member_rows),
            "difference_after_vs_before_seconds": sum(row["ssot_after_seconds"] - row["ssot_before_seconds"] for row in member_rows),
        }
    azure = azure_inventory(state)
    timestamp_violations = allocation_violations(actions)
    report = {
        "database": state["database"], "groups": groups, "learners": learners,
        "valid_additional": valid, "excluded_additional": excluded,
        "actions": actions, "blocked": blocked,
        "azure": azure, "lms": {
            "active_positive_rows": len(lms_rows),
            "active_positive_seconds": sum(int(row["actual_seconds"] or 0) for row in lms_rows),
            "confirmed_duplicates": exact_duplicates,
            "ambiguous_rows": ambiguous_lms,
            "excluded_in_this_run": [],
        },
        "documents_to_add": sum(len(sa["documents"]) for action in actions for sa in action["source_actions"]),
        "source_rows_to_update": sum(1 for action in actions for sa in action["source_actions"] if sa["needs_seconds"]),
        "parent_rows_to_update": sum(1 for action in actions if action["parent_delta_seconds"] or action["segments"]),
    }
    report["timestamp_violations"] = timestamp_violations
    report["decision"] = "READY" if (not report["blocked"] and not report["azure"]["missing"] and not report["lms"]["confirmed_duplicates"] and not timestamp_violations and not report["lms"]["ambiguous_rows"]) else "REVIEW"
    report["ready"] = report["decision"] == "READY"
    report["fingerprint"] = digest({
        "database": report["database"], "groups": report["groups"], "valid_additional": report["valid_additional"],
        "actions": [{k: v for k, v in action.items() if k not in {"source_actions"}} | {"source_actions": action["source_actions"]} for action in report["actions"]],
        "blocked": report["blocked"], "azure": report["azure"], "timestamp_violations": report["timestamp_violations"],
        "decision": report["decision"], "lms": {"confirmed_duplicates": report["lms"]["confirmed_duplicates"], "ambiguous_rows": report["lms"]["ambiguous_rows"]},
    })
    return report


def update_payload(old: Any, evidence: dict[str, Any], group_names: list[str], resolution: str, segments: list[dict[str, Any]], parent_id: int) -> dict[str, Any]:
    payload = dict(old or {})
    payload.update(source_payload(evidence, group_names, resolution, segments, parent_id))
    return payload


def apply_plan(cur, state: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    owner_ids = sorted({int(owner["id"]) for owner in state["owners"].values()})
    for owner_id in owner_ids:
        cur.execute("SELECT pg_advisory_xact_lock(hashtext('additional-hours-social-media'),%s::integer)", [owner_id])
    run_id = insert_row(cur, "activity_sync_runs", {
        "run_key": f"{RUN_KIND}:{report['fingerprint']}", "run_kind": RUN_KIND,
        "status": "running", "dry_run": False, "prompt_version": PROMPT_VERSION,
        "source_counts": Jsonb({"groups": list(GROUPS), "aptem_ids": ALL_APTEM_IDS, "valid_additional": len(report["valid_additional"]), "estimated": True}),
        "result_counts": Jsonb({}),
    })
    evidence_by_id = {int(row["evidence_id"]): row for row in state["evidence"]}
    updated_parents = updated_sources = inserted_segments = documents_added = 0
    for action in report["actions"]:
        parent_id = int(action["parent_id"]); owner_id = int(action["owner_id"])
        parent = cur.execute('SELECT * FROM "Learner".learner_progress_entries WHERE id=%s AND learner_id=%s AND deleted_at IS NULL FOR UPDATE', [parent_id, owner_id]).fetchone()
        if not parent:
            raise ValueError(f"Parent {parent_id} changed or disappeared before apply.")
        current_actual = int(parent["actual_seconds"] or 0)
        expected = int(action["expected_seconds"])
        if current_actual > expected:
            raise ValueError(f"Parent {parent_id} is now greater than the validated evidence total.")
        if action["segments"]:
            existing_segment_count = cur.execute('SELECT count(*) AS n FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s', [parent_id]).fetchone()["n"]
            if existing_segment_count:
                raise ValueError(f"Parent {parent_id} acquired segments after dry-run; preview again.")
        first = datetime.fromisoformat(action["reporting_started_at"]) if action["reporting_started_at"] else parent.get("reporting_started_at")
        last = datetime.fromisoformat(action["reporting_ended_at"]) if action["reporting_ended_at"] else parent.get("reporting_ended_at")
        payload = dict(parent.get("source_payload") or {})
        recon = dict(payload.get("reconciliation") or {})
        recon.update({"resolution": "additional_hours_lineage_reconciled", "estimated": True, "approval_required": True,
                      "label": LABEL, "source_evidence_ids": action["evidence_ids"], "group_names": action["group_names"],
                      "segments": action["segments"], "azure_container": CONTAINER})
        payload["reconciliation"] = recon
        # For existing parents the calculated total is replaced only by the
        # validated evidence sum.  This increases the one known under-count and
        # leaves already counted hours unchanged.
        cur.execute('''UPDATE "Learner".learner_progress_entries
                          SET actual_seconds=%s,actual_basis=%s,
                              reporting_started_at=COALESCE(reporting_started_at,%s),
                              reporting_ended_at=COALESCE(reporting_ended_at,%s),
                              reporting_month=COALESCE(NULLIF(reporting_month,''),%s),
                              reporting_timestamp_label=%s,source_payload=%s,sync_run_id=%s,ssot_updated_at=now()
                        WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
                    [expected, BASIS, first, last, (action["segments"][0]["month"] if action["segments"] else parent.get("reporting_month") or ""), LABEL, Jsonb(payload), run_id, parent_id, owner_id])
        updated_parents += 1
        if action["segments"]:
            start_order = cur.execute('SELECT COALESCE(MAX(segment_order),0) AS n FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s', [parent_id]).fetchone()["n"]
            for offset, segment in enumerate(action["segments"], 1):
                insert_row(cur, "learner_activity_reporting_segments", {
                    "progress_id": parent_id, "learner_id": owner_id, "segment_order": int(start_order) + offset,
                    "actual_seconds": int(segment["seconds"]), "reporting_started_at": datetime.fromisoformat(segment["start"]),
                    "reporting_ended_at": datetime.fromisoformat(segment["end"]), "reporting_month": segment["month"], "sync_run_id": run_id,
                })
                inserted_segments += 1
        for source_action in action["source_actions"]:
            eid = int(source_action["evidence_id"]); evidence = evidence_by_id[eid]
            source = cur.execute('''SELECT * FROM "Learner".learner_activity_sources
                                      WHERE id=%s AND learner_id=%s AND deleted_at IS NULL FOR UPDATE''', [int(source_action["source_id"]), owner_id]).fetchone()
            if not source or str(source.get("source_activity_id")) != f"evidence:{eid}":
                raise ValueError(f"Evidence source {eid} changed before apply.")
            segments = source_action["segments"]
            source_start = datetime.fromisoformat(segments[0]["start"]) if segments else source.get("source_started_at")
            source_end = datetime.fromisoformat(segments[-1]["end"]) if segments else source.get("source_ended_at")
            payload = update_payload(source.get("source_payload"), evidence, action["group_names"], "additional_hours_lineage_reconciled", segments, parent_id)
            cur.execute('''UPDATE "Learner".learner_activity_sources
                              SET actual_seconds=%s,actual_basis=%s,accepted=TRUE,completed=TRUE,activity_status='Accepted',
                                  source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,reporting_ended_at=%s,
                                  reporting_month=%s,canonical_progress_id=%s,source_payload=%s,sync_run_id=%s,last_seen_at=now()
                            WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
                        [int(source_action["expected_seconds"]), BASIS, source_start, source_end, source_start, source_end,
                         (segments[0]["month"] if segments else source.get("reporting_month") or ""), parent_id, Jsonb(payload), run_id, int(source["id"]), owner_id])
            updated_sources += 1
            for kind in ("file", "report"):
                blob = evidence.get(f"{kind}_blob")
                if not blob:
                    continue
                document_ref = f"evidence:{eid}:{kind}"
                existing = cur.execute('''SELECT id FROM "Learner".learner_activity_documents
                                           WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL FOR UPDATE''', [owner_id, document_ref]).fetchone()
                if existing:
                    continue
                display_name = evidence.get("evidence_name") or f"Aptem evidence {eid}"
                if kind == "report":
                    display_name = f"{display_name} — Assessment report"
                insert_row(cur, "learner_activity_documents", {
                    "learner_id": owner_id, "progress_id": parent_id, "source_system": "aptem", "source_document_id": document_ref,
                    "container": CONTAINER, "blob_name": blob, "display_name": display_name,
                    "content_type": mimetypes.guess_type(blob)[0] or mimetypes.guess_type(display_name)[0] or "application/octet-stream",
                    "uploaded_by": "aptem-evidence", "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date"),
                })
                documents_added += 1
    # No LMS row is changed unless exact source identity is present.  The dry
    # run currently proves zero such rows, so this is an explicit zero-write
    # assertion rather than a broad title-based deletion.
    if report["lms"]["confirmed_duplicates"]:
        raise ValueError("Exact LMS duplicate candidates require a separate reviewed exclusion list.")
    result = {"run_id": run_id, "estimated": True, "approval_required": True, "label": LABEL,
              "updated_parents": updated_parents, "updated_sources": updated_sources,
              "segments_inserted": inserted_segments, "documents_added": documents_added,
              "lms_excluded": 0, "valid_additional_seconds": sum(int(item["minutes"]) * 60 for item in report["valid_additional"])}
    cur.execute('''UPDATE "Learner".activity_sync_runs
                      SET status='completed_with_issues',finished_at=now(),updated_at=now(),result_counts=%s
                    WHERE id=%s''', [Jsonb(result), run_id])
    return result


def post_apply_verify(cur, report: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    for action in report["actions"]:
        parent = cur.execute('SELECT actual_seconds FROM "Learner".learner_progress_entries WHERE id=%s AND deleted_at IS NULL', [action["parent_id"]]).fetchone()
        if not parent or int(parent["actual_seconds"] or 0) != int(action["expected_seconds"]):
            errors.append(f"parent:{action['parent_id']}")
        for sa in action["source_actions"]:
            source = cur.execute('SELECT actual_seconds,canonical_progress_id FROM "Learner".learner_activity_sources WHERE id=%s AND deleted_at IS NULL', [sa["source_id"]]).fetchone()
            if not source or int(source["actual_seconds"] or 0) != int(sa["expected_seconds"]) or int(source["canonical_progress_id"]) != int(action["parent_id"]):
                errors.append(f"source:{sa['source_id']}")
            for kind in sa["documents"]:
                if not cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents WHERE learner_id=%s AND source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''', [action["owner_id"], f"evidence:{sa['evidence_id']}:{kind}"]).fetchone():
                    errors.append(f"document:{sa['evidence_id']}:{kind}")
    return {"passed": not errors, "errors": errors}


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(database_url(), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=120000")
            cur.execute("SET LOCAL lock_timeout=10000")
            state = load_state(cur)
            state["owners_by_id"] = {int(row["id"]): row for row in state["owners"].values()}
            report = build_plan(state)
            if args.apply:
                if state["database"] != args.expected_database or report["fingerprint"] != args.expected_fingerprint:
                    raise ValueError("Database or dry-run fingerprint changed; preview again before apply.")
                if report["blocked"] or report["azure"]["missing"]:
                    raise ValueError("Apply blocked by unresolved inventory or Azure-missing evidence.")
                applied = apply_plan(cur, state, report)
                verification = post_apply_verify(cur, report)
                if not verification["passed"]:
                    raise ValueError("Post-write verification failed: " + ",".join(verification["errors"]))
                conn.commit()
                report["applied"] = applied
                report["verification"] = verification
            else:
                report["applied"] = False
            print(json.dumps(report, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
