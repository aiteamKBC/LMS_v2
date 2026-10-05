"""Dry-run/apply the explicitly approved closure exception for the remaining 11 learners.

This is deliberately separate from the normal Aptem evidence reconciler.  The
normal policy refuses a number of lineage cases; this command only handles a
small, named exception:

* an accepted Aptem evidence source whose SSOT parent is shared by other
  evidence IDs (the selected evidence is split to a new parent); or
* an accepted source whose parent has zero actual seconds and no reporting
  segments (the existing parent is repaired); or
* an accepted Aptem evidence row with no SSOT source (a new parent/source is
  created).

The Aptem mirror, Journal, Attendance and Old-LMS tables are read-only.  The
command is read-only unless ``--apply`` is supplied with the database name and
the exact preview fingerprint.  No hard deletes are performed.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import hashlib
import json
import mimetypes
import os
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
CONTAINER = "fetch-aptem-evidences"
RUN_KIND = "current-11-closure-exception-v1"
PROMPT_VERSION = "activity-hours-timestamp-recovery-v1-closure-exception"
LABEL = "Closure exception - user approved"
DAILY = 8 * 3600
WEEKLY = 40 * 3600  # closure exception; daily cap and source durations remain
MONTHLY = 90 * 3600  # explicitly narrowed exception
ROSTER = [806, 4115, 10624, 16001, 16474, 16742, 17038, 17045, 18000, 18587, 18756]
# The normal classifier had no durable row for these six selected documents;
# they were downloaded/read in the closure dry-run and found readable.  The
# duration tokens are retained in the report; ``spent_time`` remains the
# authoritative Aptem duration for the user-approved exception.
DIRECT_READ_IDS = {55525, 54878, 56762, 55073, 53690, 56029, 57788, 55504}


def env_values() -> dict[str, str]:
    values = dict(os.environ)
    path = Path(__file__).resolve().parents[1] / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
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


def norm(value: Any) -> str:
    text = unicodedata.normalize("NFKD", str(value or "")).lower()
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def similar(left: Any, right: Any) -> bool:
    a, b = norm(left), norm(right)
    return bool(a and b and (a == b or a in b or b in a or len(set(a.split()) & set(b.split())) >= 2))


def as_day(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.astimezone(UK).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(UK).date()
    except (TypeError, ValueError):
        return None


def bank_holidays() -> set[date]:
    return {
        date(2025, 1, 1), date(2025, 4, 18), date(2025, 4, 21), date(2025, 5, 5),
        date(2025, 5, 26), date(2025, 8, 25), date(2025, 12, 25), date(2025, 12, 26),
        date(2026, 1, 1), date(2026, 4, 3), date(2026, 4, 6), date(2026, 5, 4),
        date(2026, 5, 25), date(2026, 8, 31), date(2026, 12, 25), date(2026, 12, 28),
    }


def valid_day(day: date | None, period: dict[str, Any]) -> bool:
    return bool(day and period.get("start_date") and period.get("end_date") and period["start_date"] <= day <= period["end_date"] and day.weekday() < 5 and day not in bank_holidays())


def is_lecture(row: dict[str, Any]) -> bool:
    text = norm(f"{row.get('component_name') or ''} {row.get('evidence_name') or ''}")
    return any(token in text for token in ("lecture", "attendance", "attended", "live via teams", "face to face", "session"))


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(",").join(sql.Identifier(k) for k in values), sql.SQL(",").join(sql.Placeholder() for _ in values)
    )
    return int(cur.execute(statement, list(values.values())).fetchone()["id"])


def fetch_state(cur) -> dict[str, Any]:
    owners = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=ANY(%s)', [ROSTER]).fetchall()
    if len(owners) != len(ROSTER):
        raise ValueError("Closure-exception learner scope is incomplete.")
    periods = cur.execute('SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)', [ROSTER]).fetchall()
    evidence = cur.execute('''SELECT e.*,coalesce(e.completed_date_override,e.completed_date,e.submission_date,e.created_date) AS evidence_date
                              FROM fetching_evidence.evidence_items e
                              WHERE learner_id=ANY(%s) AND evidence_status='Accepted' AND spent_time>0
                              ORDER BY learner_id,evidence_id''', [ROSTER]).fetchall()
    progress = cur.execute('''SELECT p.*,l.aptem_id AS owner_aid FROM "Learner".learner_progress_entries p
                              JOIN "Learner".learners l ON l.id=p.learner_id
                              WHERE l.aptem_id=ANY(%s) AND p.deleted_at IS NULL
                                AND (p.accepted IS TRUE OR (p.source_system='aptem' AND p.actual_basis LIKE '%%closure-exception%%'))''', [ROSTER]).fetchall()
    sources = cur.execute('''SELECT s.*,l.aptem_id AS owner_aid FROM "Learner".learner_activity_sources s
                             JOIN "Learner".learners l ON l.id=s.learner_id
                             WHERE l.aptem_id=ANY(%s) AND s.deleted_at IS NULL''', [ROSTER]).fetchall()
    segments = cur.execute('''SELECT s.* FROM "Learner".learner_activity_reporting_segments s
                              JOIN "Learner".learners l ON l.id=s.learner_id WHERE l.aptem_id=ANY(%s)''', [ROSTER]).fetchall()
    journals = cur.execute('''SELECT * FROM "Learner".learner_journal_rows
                              WHERE aptem_id=ANY(%s) AND accepted IS TRUE AND deleted_at IS NULL''', [ROSTER]).fetchall()
    attendance = cur.execute('SELECT * FROM "Learner".source_lms_attendance').fetchall()
    try:
        classifications = cur.execute('''SELECT evidence_id,method,extracted_chars
                                           FROM "Learner".evidence_content_classification
                                          WHERE evidence_id=ANY(%s)''', [[int(row["evidence_id"]) for row in evidence]]).fetchall()
    except psycopg.errors.UndefinedTable:
        classifications = []
    return {"database": cur.execute("SELECT current_database() AS name").fetchone()["name"], "owners": owners,
            "periods": periods, "evidence": evidence, "progress": progress, "sources": sources,
            "segments": segments, "journals": journals, "attendance": attendance, "classifications": classifications}


def build_plan(state: dict[str, Any]) -> dict[str, Any]:
    owners = {int(row["aptem_id"]): row for row in state["owners"]}
    periods = {int(row["aptem_id"]): row for row in state["periods"]}
    progress = {int(row["id"]): row for row in state["progress"]}
    sources = [row for row in state["sources"] if str(row.get("source_system")) == "aptem"]
    source_by_ref = {(int(row["owner_aid"]), str(row.get("source_activity_id"))): row for row in sources}
    by_parent: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    seg_count: dict[int, int] = defaultdict(int)
    for row in sources:
        if row.get("canonical_progress_id"):
            by_parent[(int(row["owner_aid"]), int(row["canonical_progress_id"]))].append(row)
    for row in state["segments"]:
        seg_count[int(row["progress_id"])] += 1
    by_journal: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in state["journals"]:
        by_journal[int(row["aptem_id"])].append(row)
    attendance_by_day: dict[date, list[dict[str, Any]]] = defaultdict(list)
    for row in state["attendance"]:
        day = as_day(row.get("attendance_date"))
        if day:
            attendance_by_day[day].append(row)
    current = defaultdict(int)
    aptem = defaultdict(int)
    for row in state["progress"]:
        # An earlier interrupted exception write can leave an Aptem parent
        # materialized but not accepted.  It is visible for lineage repair,
        # but must not count toward the current SSOT total until activated.
        if bool(row.get("accepted")):
            current[int(row["owner_aid"])] += int(row.get("actual_seconds") or 0)
    for row in state["evidence"]:
        aptem[int(row["learner_id"])] += int(Decimal(str(row["spent_time"])) * 60)
    classified = {int(row["evidence_id"]): row for row in state.get("classifications", [])}

    # Collapse same-day/title/duration evidence IDs into one event.  Multiple
    # files for the same event remain in the source mirror but never inflate
    # SSOT hours twice.
    event_rows: dict[tuple[int, str, str, int], list[dict[str, Any]]] = defaultdict(list)
    for row in state["evidence"]:
        aid = int(row["learner_id"]); day = as_day(row.get("evidence_date")); mins = int(Decimal(str(row["spent_time"]))); title = norm(row.get("component_name") or row.get("evidence_name"))
        event_rows[(aid, str(day), title, mins)].append(row)

    candidates: list[dict[str, Any]] = []
    for group_rows in event_rows.values():
        row = max(group_rows, key=lambda item: int(item["evidence_id"]))
        aid = int(row["learner_id"]); eid = int(row["evidence_id"]); day = as_day(row.get("evidence_date")); minutes = int(Decimal(str(row["spent_time"]))); seconds = minutes * 60
        # Date-only evidence may fall on a weekend/bank holiday.  The
        # timestamp prompt permits moving it to the nearest valid weekday
        # while preserving ``original_date`` in source_payload.
        period = periods[aid]
        if not day or not period.get("start_date") or not period.get("end_date") or not (period["start_date"] <= day <= period["end_date"]):
            continue
        source = source_by_ref.get((aid, f"evidence:{eid}"))
        parent_id = int(source["canonical_progress_id"]) if source and source.get("canonical_progress_id") else None
        parent = progress.get(parent_id) if parent_id else None
        parent_rows = by_parent.get((aid, parent_id), []) if parent_id else []
        parent_actual = int(parent.get("actual_seconds") or 0) if parent else 0
        # A source with a positive, unique parent is already represented.  A
        # positive shared parent is a lineage candidate: split this event into
        # its own parent, leaving the original parent and first event intact.
        operation: str | None = None
        if source and parent is not None and not bool(parent.get("accepted")):
            operation = "activate_unaccepted_parent"
        elif source and parent is None and parent_id:
            # The source row survived a legacy soft-delete of its parent.  It
            # still has an authoritative Aptem reference, so relink it to a
            # fresh SSOT parent instead of reviving the deleted row.
            operation = "relink_deleted_parent"
        elif source and parent_actual > 0 and len(parent_rows) <= 1:
            continue
        if operation is None and source and parent_actual > 0 and parent_id and seg_count.get(parent_id, 0) and len(parent_rows) > 1:
            operation = "split_shared_parent"
        elif operation is None and source and parent_id and parent_actual <= 0 and seg_count.get(parent_id, 0) == 0:
            operation = "repair_zero_parent" if len(parent_rows) <= 1 else "split_zero_parent"
        elif operation is None and source is None:
            operation = "new_source"
        elif operation is None:
            continue
        # Do not duplicate a positive journal event.  Attendance is checked by
        # another learner on the same date; the session title is retained in
        # the payload for audit even where Aptem used a different title.
        title = row.get("component_name") or row.get("evidence_name")
        # A missing-source row can be a Journal duplicate.  For an exact
        # Aptem source whose parent is shared, the source lineage itself is
        # the stronger identity: the exception is specifically splitting
        # distinct Aptem events that were collapsed into one SSOT parent.
        if source is None and any(as_day(j.get("activity_date")) == day and float(j.get("actual_hours") or 0) > 0 and similar(j.get("title"), title) for j in by_journal[aid]):
            continue
        is_lecture_row = is_lecture(row)
        attendance_match = any(similar(a.get("lecture_name"), title) or (is_lecture_row and a.get("lecture_name") and day == as_day(a.get("attendance_date"))) for a in attendance_by_day.get(day, []))
        if is_lecture_row and not attendance_match:
            continue
        classification = classified.get(eid) or {}
        content_audited = bool(int(classification.get("extracted_chars") or 0) > 0 or classification.get("method")) or bool(str(row.get("note_content") or "").strip()) or eid in DIRECT_READ_IDS
        candidates.append({"aid": aid, "eid": eid, "minutes": minutes, "seconds": seconds, "day": day, "title": str(title or "")[:500], "operation": operation, "source_id": int(source["id"]) if source else None, "old_parent_id": parent_id, "content_audited": content_audited, "attendance_match": attendance_match, "all_evidence_ids": [int(x["evidence_id"]) for x in group_rows], "evidence": row})

    selected: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    # Select the smallest defensible subset at/above each learner deficit.  A
    # one-activity overshoot is intentional: closure is compared to Aptem and
    # never achieved by fabricating a fractional hour.
    for aid in ROSTER:
        rows = [row for row in candidates if row["aid"] == aid]
        deficit = max(0, aptem[aid] - current[aid])
        target = (deficit + 59) // 60
        dp: dict[int, tuple[int, list[int]]] = {0: (0, [])}
        for index, row in enumerate(rows):
            for total, (quality, indexes) in list(dp.items()):
                new_total = total + int(row["minutes"])
                if new_total > target + 48 * 60:
                    continue
                new_quality = quality + (3 if row["content_audited"] else 1) + (1 if row["operation"] != "new_source" else 0)
                previous = dp.get(new_total)
                if previous is None or new_quality > previous[0]:
                    dp[new_total] = (new_quality, indexes + [index])
        choices = [total for total in dp if total >= target]
        if not choices:
            # If no subset is within the normal overshoot window, pick the
            # smallest single/combined evidence total above the deficit.  A
            # closure exception may overshoot by a real evidence item; it may
            # not invent a fractional duration.
            choices = [total for total in dp if total >= target]
            if not choices and dp:
                choices = [max(dp)]
        chosen_total = min(choices, key=lambda total: (max(0, total - target), -dp[total][0])) if choices else 0
        chosen_indexes = set(dp.get(chosen_total, (0, []))[1])
        for index, row in enumerate(rows):
            (selected if index in chosen_indexes else deferred).append(row)

    # Existing fixed segments are used only for capacity checks.  Existing
    # estimated segments are movable by the timestamp prompt and therefore do
    # not consume the exception capacity.
    prog_by_id = {int(row["id"]): row for row in state["progress"]}
    owner_by_id = {int(row["id"]): int(row["aptem_id"]) for row in state["owners"]}
    occupancy: dict[tuple[int, date], int] = defaultdict(int)
    weekly: dict[tuple[int, int, int], int] = defaultdict(int)
    monthly: dict[tuple[int, str], int] = defaultdict(int)
    for segment in state["segments"]:
        parent = prog_by_id.get(int(segment["progress_id"]))
        day = as_day(segment.get("reporting_started_at"))
        if not parent or not day:
            continue
        if str(parent.get("reporting_timestamp_label") or "") == LABEL or "estimated" in str(parent.get("actual_basis") or "").lower():
            continue
        learner_id = int(segment["learner_id"]); seconds = int(segment.get("actual_seconds") or 0); iso = day.isocalendar()
        occupancy[(learner_id, day)] += seconds; weekly[(learner_id, iso.year, iso.week)] += seconds; monthly[(learner_id, day.strftime("%Y-%m"))] += seconds

    blocked: list[dict[str, Any]] = []
    allocated: list[dict[str, Any]] = []
    for item in sorted(selected, key=lambda row: (row["aid"], row["day"], row["eid"])):
        aid = item["aid"]; owner = owners[aid]; learner_id = int(owner["id"]); remaining = item["seconds"]; segments: list[dict[str, Any]] = []
        for distance in range(0, 370):
            if remaining <= 0:
                break
            days = [item["day"]] if distance == 0 else [item["day"] + timedelta(days=distance), item["day"] - timedelta(days=distance)]
            for candidate_day in days:
                if remaining <= 0 or not valid_day(candidate_day, periods[aid]):
                    continue
                iso = candidate_day.isocalendar(); week_key = (learner_id, iso.year, iso.week); month_key = (learner_id, candidate_day.strftime("%Y-%m"))
                available = min(DAILY - occupancy[(learner_id, candidate_day)], WEEKLY - weekly[week_key], MONTHLY - monthly[month_key])
                if available <= 0:
                    continue
                seconds = min(remaining, available)
                start = datetime.combine(candidate_day, time(9, 5), tzinfo=UK)
                end = start + timedelta(seconds=seconds)
                if end.timetz() > time(17, 0, tzinfo=UK):
                    seconds = int((datetime.combine(candidate_day, time(17, 0), tzinfo=UK) - start).total_seconds())
                    if seconds <= 0:
                        continue
                    end = start + timedelta(seconds=seconds)
                segments.append({"start": start.isoformat(), "end": end.isoformat(), "month": candidate_day.strftime("%Y-%m"), "seconds": seconds, "original_date": item["day"].isoformat()})
                occupancy[(learner_id, candidate_day)] += seconds; weekly[week_key] += seconds; monthly[month_key] += seconds; remaining -= seconds
        if remaining:
            blocked.append({"aid": aid, "eid": item["eid"], "minutes": item["minutes"], "reason": "TIMESTAMP_CAP", "remaining_seconds": remaining})
        else:
            item["segments"] = sorted(segments, key=lambda segment: segment["start"]); allocated.append(item)

    fingerprint = digest({"database": state["database"], "selected": [(x["aid"], x["eid"], x["operation"], x["minutes"], x["segments"]) for x in allocated], "blocked": blocked})
    current_by_aid = {aid: current[aid] for aid in ROSTER}
    aptem_by_aid = {aid: aptem[aid] for aid in ROSTER}
    return {"database": state["database"], "owners": owners, "progress": progress, "sources": sources, "candidates": candidates, "selected": allocated, "deferred": deferred, "blocked": blocked, "current": current_by_aid, "aptem": aptem_by_aid, "fingerprint": fingerprint}


def write_item(cur, plan: dict[str, Any], item: dict[str, Any], owner: dict[str, Any], run_id: int, order: int) -> tuple[int, int]:
    evidence = item["evidence"]; aid = int(item["aid"]); eid = int(item["eid"]); source_ref = f"evidence:{eid}"; segments = item["segments"]; seconds = sum(int(segment["seconds"]) for segment in segments)
    payload = dict(evidence.get("evidence_raw") or {})
    payload["reconciliation"] = {"resolution": "closure_exception_lineage_split", "exception_approved": True, "approval_required": False, "label": LABEL, "evidence_id": eid, "original_date": str(item["day"]), "old_parent_id": item.get("old_parent_id"), "operation": item["operation"], "segments": segments, "azure_container": CONTAINER, "azure_file_blob": evidence.get("file_blob"), "azure_report_blob": evidence.get("report_blob"), "all_event_evidence_ids": item.get("all_evidence_ids") or []}
    title = str(evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Evidence {eid}")[:500]
    parent_id: int | None = None
    source = cur.execute('''SELECT * FROM "Learner".learner_activity_sources WHERE id=%s AND deleted_at IS NULL FOR UPDATE''', [item.get("source_id")]).fetchone() if item.get("source_id") else None
    if item["operation"] in ("repair_zero_parent", "activate_unaccepted_parent") and source and source.get("canonical_progress_id"):
        parent_id = int(source["canonical_progress_id"])
        parent = cur.execute('SELECT * FROM "Learner".learner_progress_entries WHERE id=%s AND deleted_at IS NULL FOR UPDATE', [parent_id]).fetchone()
        if not parent or (item["operation"] == "repair_zero_parent" and int(parent.get("actual_seconds") or 0) != 0):
            raise ValueError(f"Closure exception parent changed for evidence {eid}.")
    else:
        parent_id = insert_row(cur, "learner_progress_entries", {"learner_id": int(owner["id"]), "entry_order": order, "kind": "aptem_evidence", "component_ref": source_ref, "component_title": title, "component_type": "evidence", "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref, "canonical_activity_key": f"aptem:{aid}:{source_ref}:closure", "activity_status": "Accepted", "accepted": True, "actual_seconds": seconds, "actual_basis": "aptem:accepted-evidence-spent-minutes;closure-exception", "reporting_started_at": datetime.fromisoformat(segments[0]["start"]), "reporting_ended_at": datetime.fromisoformat(segments[-1]["end"]), "reporting_month": segments[0]["month"], "reporting_timestamp_label": LABEL, "source_payload": Jsonb(payload), "sync_run_id": run_id})
    if item["operation"] in ("repair_zero_parent", "activate_unaccepted_parent"):
        cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=%s,actual_basis=%s,activity_status='Accepted',accepted=TRUE,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,reporting_timestamp_label=%s,source_payload=%s,sync_run_id=%s,ssot_updated_at=now() WHERE id=%s''', [seconds, "aptem:accepted-evidence-spent-minutes;closure-exception", datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), segments[0]["month"], LABEL, Jsonb(payload), run_id, parent_id])
    if source and item["operation"] in ("repair_zero_parent", "activate_unaccepted_parent"):
        cur.execute('''UPDATE "Learner".learner_activity_sources SET canonical_progress_id=%s,actual_seconds=%s,actual_basis=%s,source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,source_payload=%s,sync_run_id=%s,last_seen_at=now() WHERE id=%s''', [parent_id, seconds, "aptem:accepted-evidence-spent-minutes;closure-exception", datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), segments[0]["month"], Jsonb(payload), run_id, source["id"]])
    elif source:
        # The old parent remains intact; only this evidence's lineage is
        # moved to the exception parent.  This is the key one-to-one repair.
        cur.execute('''UPDATE "Learner".learner_activity_sources SET canonical_progress_id=%s,actual_seconds=%s,actual_basis=%s,source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,source_payload=%s,sync_run_id=%s,last_seen_at=now() WHERE id=%s''', [parent_id, seconds, "aptem:accepted-evidence-spent-minutes;closure-exception", datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), segments[0]["month"], Jsonb(payload), run_id, source["id"]])
    else:
        insert_row(cur, "learner_activity_sources", {"learner_id": int(owner["id"]), "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref, "curriculum_component_id": evidence.get("component_id"), "canonical_activity_key": f"aptem:{aid}:{source_ref}:closure", "activity_type": "evidence", "title": title, "activity_status": "Accepted", "completed": True, "accepted": True, "actual_seconds": seconds, "actual_basis": "aptem:accepted-evidence-spent-minutes;closure-exception", "source_started_at": datetime.fromisoformat(segments[0]["start"]), "source_ended_at": datetime.fromisoformat(segments[-1]["end"]), "reporting_started_at": datetime.fromisoformat(segments[0]["start"]), "reporting_ended_at": datetime.fromisoformat(segments[-1]["end"]), "reporting_month": segments[0]["month"], "ksb_codes": Jsonb(evidence.get("ksb_codes") or []), "source_payload": Jsonb(payload), "sync_run_id": run_id, "canonical_progress_id": parent_id, "source_fingerprint": digest({"evidence_id": eid, "actual_seconds": seconds, "exception": True})})
    existing_segment_count = int(cur.execute('SELECT count(*) AS n FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s', [parent_id]).fetchone()["n"])
    if existing_segment_count == 0:
        for index, segment in enumerate(segments, 1):
            insert_row(cur, "learner_activity_reporting_segments", {"progress_id": parent_id, "learner_id": int(owner["id"]), "segment_order": index, "actual_seconds": int(segment["seconds"]), "reporting_started_at": datetime.fromisoformat(segment["start"]), "reporting_ended_at": datetime.fromisoformat(segment["end"]), "reporting_month": segment["month"], "sync_run_id": run_id})
    for kind in ("file", "report"):
        blob = evidence.get(f"{kind}_blob")
        if not blob:
            continue
        doc_ref = f"evidence:{eid}:{kind}"
        if cur.execute('SELECT 1 FROM "Learner".learner_activity_documents WHERE source_system=%s AND source_document_id=%s AND deleted_at IS NULL FOR UPDATE', ["aptem", doc_ref]).fetchone():
            continue
        insert_row(cur, "learner_activity_documents", {"learner_id": int(owner["id"]), "progress_id": parent_id, "source_system": "aptem", "source_document_id": doc_ref, "container": CONTAINER, "blob_name": str(blob), "display_name": title, "content_type": mimetypes.guess_type(str(blob))[0] or "application/octet-stream", "uploaded_by": "aptem-evidence", "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date")})
    return parent_id, seconds


def apply_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for aid in ROSTER:
        items = [item for item in plan["selected"] if int(item["aid"]) == aid]
        # An evidence item may be spread across adjacent months when its
        # original date is near a capacity boundary.  Persist that item once,
        # under its first segment month, while retaining every segment month.
        first_month = {int(item["eid"]): min(segment["month"] for segment in item["segments"]) for item in items}
        months = sorted(set(first_month.values()))
        for month in months:
            month_items = [item for item in items if first_month[int(item["eid"])] == month]
            with psycopg.connect(database_url(), connect_timeout=30, row_factory=dict_row) as conn:
                with conn.cursor() as cur:
                    cur.execute("SET LOCAL statement_timeout=180000")
                    cur.execute("SET LOCAL lock_timeout=10000")
                    owner = cur.execute('SELECT * FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [aid]).fetchone()
                    if not owner:
                        raise ValueError(f"Learner {aid} disappeared before closure-exception write.")
                    cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s),%s::integer)", [RUN_KIND, int(owner["id"])])
                    run_key = f"{RUN_KIND}:{plan['fingerprint']}:{aid}:{month}"
                    existing = cur.execute('SELECT id FROM "Learner".activity_sync_runs WHERE run_key=%s', [run_key]).fetchone()
                    if existing:
                        results.append({"aid": aid, "month": month, "idempotent": True, "run_id": int(existing["id"])})
                        continue
                    run_id = insert_row(cur, "activity_sync_runs", {"run_key": run_key, "run_kind": RUN_KIND, "status": "running", "dry_run": False, "prompt_version": PROMPT_VERSION, "source_counts": Jsonb({"aptem_id": aid, "month": month, "evidence_ids": [int(item["eid"]) for item in month_items]}), "result_counts": Jsonb({})})
                    order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner["id"]]).fetchone()["n"])
                    seconds_total = 0; details = []
                    for item in month_items:
                        # Keep all segments for a multi-month item; the parent
                        # is created once under its first segment month.
                        item = dict(item)
                        order += 1
                        parent_id, seconds = write_item(cur, plan, item, owner, run_id, order)
                        seconds_total += seconds; details.append({"eid": int(item["eid"]), "parent_id": parent_id, "seconds": seconds, "operation": item["operation"]})
                    result = {"aid": aid, "month": month, "run_id": run_id, "seconds": seconds_total, "items": details}
                    cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed", Jsonb(result), run_id])
                    conn.commit(); results.append(result)
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(database_url(), connect_timeout=30, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            state = fetch_state(cur); plan = build_plan(state)
            if args.apply:
                if plan["database"] != args.expected_database or plan["fingerprint"] != args.expected_fingerprint:
                    raise ValueError("Database or reviewed fingerprint changed; preview again before apply.")
                plan["written"] = apply_plan(plan)
            output = {"database": plan["database"], "apply": args.apply, "fingerprint": plan["fingerprint"], "policy": {"daily_hours": DAILY / 3600, "weekly_hours": WEEKLY / 3600, "monthly_hours": MONTHLY / 3600, "label": LABEL}, "learners": [{"aid": aid, "current_seconds": plan["current"][aid], "aptem_seconds": plan["aptem"][aid], "deficit_seconds": max(0, plan["aptem"][aid] - plan["current"][aid]), "candidate_count": sum(1 for x in plan["candidates"] if x["aid"] == aid), "selected_seconds": sum(int(x["seconds"]) for x in plan["selected"] if x["aid"] == aid), "selected": [{"eid": int(x["eid"]), "minutes": int(x["minutes"]), "operation": x["operation"], "old_parent_id": x.get("old_parent_id"), "source_id": x.get("source_id"), "day": x["day"].isoformat(), "content_audited": bool(x["content_audited"]), "segments": x["segments"]} for x in plan["selected"] if x["aid"] == aid]} for aid in ROSTER], "selected_count": len(plan["selected"]), "deferred_count": len(plan["deferred"]), "blocked": plan["blocked"]}
            if args.apply:
                output["written"] = plan["written"]
            print(json.dumps(output, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        detail = str(exc.diag.message_primary or exc) if getattr(exc, "diag", None) else str(exc)
        if getattr(exc, "diag", None) and exc.diag.constraint_name:
            detail = f"{detail} (constraint={exc.diag.constraint_name})"
        print(json.dumps({"error": detail}, ensure_ascii=False))
        raise SystemExit(1)
