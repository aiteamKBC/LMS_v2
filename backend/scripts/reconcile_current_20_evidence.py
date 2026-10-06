"""Reconcile accepted Aptem evidence for the current below-Aptem learners.

The command is read-only by default.  ``--apply`` requires the database name
and the fingerprint printed by the preview.  Only evidence rows that are
accepted, readable (or have a substantive note), inside the learner period,
and not represented by an alternate SSOT/Journal/Attendance/Old-LMS event are
eligible.  Existing evidence parents with zero hours are repaired in place;
new evidence gets its own parent/source.  Aptem, Journal, Attendance and Old
LMS source tables are never changed.
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
CONTAINER = "fetch-aptem-evidences"
LABEL = "تقديري — يحتاج اعتماد"
BASIS = "aptem:accepted-evidence-spent-minutes;azure-read;estimated-reporting-allocation"
RUN_KIND = "current-20-aptem-evidence-reconciliation-v1"
PROMPT_VERSION = "activity-hours-timestamp-recovery-v1-current-20"
DAILY = 8 * 3600
WEEKLY = int(13.5 * 3600)
MONTHLY = 45 * 3600
ROSTER = [
    17038, 806, 18756, 4115, 10624, 17753, 16474, 18000, 1797, 16001,
    16742, 652, 14183, 17254, 10208, 3598, 17429, 16221, 17045, 18587,
]


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
    if not a or not b:
        return False
    if a == b or a in b or b in a:
        return True
    return len(set(a.split()) & set(b.split())) >= 2


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


def parse_break(row: dict[str, Any] | None) -> tuple[date | None, date | None]:
    if not row:
        return None, None
    raw = row.get("break_json") or {}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            raw = {}
    if str(row.get("program_status") or "").lower() == "onbreak":
        raw = {**raw, "has_break_in_learning": True}
    try:
        last = date.fromisoformat(str(raw.get("last_learning_date"))) if raw.get("last_learning_date") else None
    except ValueError:
        last = None
    try:
        returned = date.fromisoformat(str(raw.get("return_to_learning_date"))) if raw.get("return_to_learning_date") else None
    except ValueError:
        returned = None
    return last, returned


def valid_day(day: date, period: dict[str, Any], break_row: dict[str, Any] | None) -> bool:
    if not period.get("start_date") or not period.get("end_date") or not (period["start_date"] <= day <= period["end_date"]):
        return False
    last, returned = parse_break(break_row)
    if last and day > last and (not returned or day < returned):
        return False
    return day.weekday() < 5 and day not in bank_holidays()


def evidence_day(row: dict[str, Any]) -> date | None:
    return as_day(row.get("completed_date_override") or row.get("completed_date") or row.get("submission_date") or row.get("created_date"))


def duration_tokens(text: str) -> set[int]:
    values: set[int] = set()
    for match in re.finditer(r"(?<!\d)(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", text or "", re.I):
        values.add(round(float(match.group(1)) * 60))
    for match in re.finditer(r"(?<!\d)(\d+)\s*(?:minutes?|mins?)\b", text or "", re.I):
        values.add(int(match.group(1)))
    for match in re.finditer(r"(?<!\d)(\d+)\s*h\s*(\d+)\s*m", text or "", re.I):
        values.add(int(match.group(1)) * 60 + int(match.group(2)))
    return {value for value in values if 0 < value <= 24 * 60}


def read_content(rows: list[dict[str, Any]]) -> dict[int, dict[str, Any]]:
    """Read referenced files/notes without exposing their contents."""
    values = env_values()
    connection = values.get("AZURE_STORAGE_CONNECTION_STRING")
    if not connection:
        raise ValueError("Azure storage configuration is unavailable; content review is blocked.")
    from azure.storage.blob import BlobServiceClient
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import repair_msp_evidence_timestamps as extractor
    service = BlobServiceClient.from_connection_string(connection, connection_timeout=10, read_timeout=20)

    def read_one(row: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        texts: list[str] = []
        errors: list[str] = []
        # The submitted file is the primary evidence.  Assessment reports are
        # metadata mirrors and are deliberately not downloaded here; this
        # keeps the review bounded while still reading the actual submission.
        for field in ("file_blob",):
            blob = row.get(field)
            if not blob:
                continue
            try:
                client = service.get_blob_client(CONTAINER, str(blob))
                properties = client.get_blob_properties(timeout=10)
                # Avoid unbounded downloads of media/archives.  They remain
                # CONTENT_REVIEW and cannot be written automatically.
                if int(getattr(properties, "size", 0) or 0) > 15_000_000:
                    errors.append("BLOB_TOO_LARGE")
                    continue
                data = client.download_blob(max_concurrency=1, timeout=15).readall()
                lowered = str(blob).lower()
                if lowered.endswith(".docx"):
                    text = extractor.docx_text(data)
                elif lowered.endswith(".pdf"):
                    text = extractor.pdf_text(data)
                elif lowered.endswith(".xlsx"):
                    text = extractor.xlsx_text(data)
                elif lowered.endswith(".pptx"):
                    text = extractor.pptx_text(data)
                elif lowered.endswith(".txt"):
                    text = data.decode("utf-8", "ignore")
                else:
                    text = ""
                if text:
                    texts.append(text)
            except Exception as exc:  # one unreadable file must not abort the batch
                errors.append(type(exc).__name__)
        note = str(row.get("note_content") or "")
        text = "\n".join(texts)
        tokens = duration_tokens("\n".join((text, note)))
        return int(row["evidence_id"]), {
            "readable": bool(text.strip() or note.strip()),
            "text_characters": len(text),
            "note_characters": len(note),
            "duration_match": int(row["spent_time"]) in tokens,
            "duration_tokens": sorted(tokens),
            "error": errors[0] if errors else None,
        }

    results: dict[int, dict[str, Any]] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(read_one, row) for row in rows]
        for future in as_completed(futures):
            eid, result = future.result()
            results[eid] = result
    return results


def fetch_state(cur) -> dict[str, Any]:
    owners = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=ANY(%s)', [ROSTER]).fetchall()
    if len(owners) != len(ROSTER):
        raise ValueError("Current 20-learner scope is incomplete.")
    periods = cur.execute('SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)', [ROSTER]).fetchall()
    evidence = cur.execute('''SELECT * FROM fetching_evidence.evidence_items
                              WHERE learner_id=ANY(%s) AND evidence_status='Accepted' AND spent_time>0
                              ORDER BY learner_id,evidence_id''', [ROSTER]).fetchall()
    progress = cur.execute('''SELECT p.*,l.aptem_id AS owner_aid FROM "Learner".learner_progress_entries p
                              JOIN "Learner".learners l ON l.id=p.learner_id
                              WHERE l.aptem_id=ANY(%s) AND p.accepted IS TRUE AND p.deleted_at IS NULL''', [ROSTER]).fetchall()
    sources = cur.execute('''SELECT s.*,l.aptem_id AS owner_aid FROM "Learner".learner_activity_sources s
                             JOIN "Learner".learners l ON l.id=s.learner_id
                             WHERE l.aptem_id=ANY(%s) AND s.deleted_at IS NULL''', [ROSTER]).fetchall()
    segments = cur.execute('''SELECT s.* FROM "Learner".learner_activity_reporting_segments s
                              JOIN "Learner".learners l ON l.id=s.learner_id WHERE l.aptem_id=ANY(%s)''', [ROSTER]).fetchall()
    journals = cur.execute('''SELECT * FROM "Learner".learner_journal_rows
                              WHERE aptem_id=ANY(%s) AND accepted IS TRUE AND deleted_at IS NULL''', [ROSTER]).fetchall()
    attendance = cur.execute('SELECT * FROM "Learner".source_lms_attendance WHERE aptem_id=ANY(%s)', [ROSTER]).fetchall()
    old = cur.execute('''SELECT * FROM "Learner".source_lms_actual_hours
                         WHERE aptem_id=ANY(%s) AND actual_hours>0''', [ROSTER]).fetchall()
    breaks = cur.execute('''SELECT DISTINCT ON (learner_id) learner_id,program_status,
                                   "Break in learning" AS break_json,source,fetched_at,id
                              FROM fetching_evidence.aptem_cv_contracts_probe
                             WHERE learner_id=ANY(%s) AND source <> 'audit_upload'
                             ORDER BY learner_id,fetched_at DESC NULLS LAST,id DESC''', [ROSTER]).fetchall()
    try:
        classifications = cur.execute('''SELECT evidence_id,category,method,extracted_chars,reason
                                           FROM "Learner".evidence_content_classification
                                          WHERE evidence_id=ANY(%s)''', [[int(row["evidence_id"]) for row in evidence]]).fetchall()
    except psycopg.errors.UndefinedTable:
        classifications = []
    return {"database": cur.execute("SELECT current_database() AS name").fetchone()["name"], "owners": owners,
            "periods": periods, "evidence": evidence, "progress": progress, "sources": sources,
            "segments": segments, "journals": journals, "attendance": attendance, "old": old, "breaks": breaks,
            "classifications": classifications}


def build_plan(state: dict[str, Any], content: dict[int, dict[str, Any]]) -> dict[str, Any]:
    owners = {int(row["aptem_id"]): row for row in state["owners"]}
    owner_id_to_aid = {int(row["id"]): int(row["aptem_id"]) for row in state["owners"]}
    periods = {int(row["aptem_id"]): row for row in state["periods"]}
    breaks = {int(row["learner_id"]): row for row in state["breaks"]}
    progress_by_aid: dict[int, list[dict[str, Any]]] = defaultdict(list)
    source_by_key: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    segments_by_owner: dict[int, list[dict[str, Any]]] = defaultdict(list)
    segment_ids_by_progress: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in state["progress"]:
        progress_by_aid[int(row["owner_aid"])].append(row)
    for row in state["sources"]:
        source_by_key[(int(row["owner_aid"]), str(row.get("source_activity_id")))].append(row)
    for row in state["segments"]:
        segments_by_owner[int(row["learner_id"])].append(row)
        segment_ids_by_progress[int(row["progress_id"])].append(row)
    current: dict[int, int] = {}
    for aid, rows in progress_by_aid.items():
        current[aid] = sum(int(row.get("actual_seconds") or 0) for row in rows)

    occupancy: dict[tuple[int, date], int] = defaultdict(int)
    weekly: dict[tuple[int, int, int], int] = defaultdict(int)
    monthly: dict[tuple[int, str], int] = defaultdict(int)
    lecture_days: dict[int, set[date]] = defaultdict(set)
    for row in state["segments"]:
        # Estimated/recovered segments are movable under the timestamp prompt;
        # they must not consume the fixed capacity used to place newly
        # evidenced activities.  They remain in SSOT and are preserved.
        owner_aid = owner_id_to_aid.get(int(row["learner_id"]))
        parent = next((item for item in progress_by_aid.get(owner_aid, []) if int(item["id"]) == int(row["progress_id"])), None)
        if parent and (str(parent.get("reporting_timestamp_label") or "") == LABEL or "estimated" in str(parent.get("actual_basis") or "").lower()):
            continue
        at = as_day(row.get("reporting_started_at"))
        if not at:
            continue
        seconds = int(row.get("actual_seconds") or 0)
        owner_id = int(row["learner_id"])
        occupancy[(owner_id, at)] += seconds
        iso = at.isocalendar()
        weekly[(owner_id, iso.year, iso.week)] += seconds
        monthly[(owner_id, at.strftime("%Y-%m"))] += seconds
    for row in state["attendance"]:
        at = as_day(row.get("attendance_date"))
        if at:
            lecture_days[int(row["aptem_id"])].add(at)

    journals = defaultdict(list)
    for row in state["journals"]:
        journals[int(row["aptem_id"])].append(row)
    attendance = defaultdict(list)
    for row in state["attendance"]:
        attendance[int(row["aptem_id"])].append(row)
    old = defaultdict(list)
    for row in state["old"]:
        old[int(row["aptem_id"])].append(row)

    classifications: list[dict[str, Any]] = []
    potential: list[dict[str, Any]] = []
    for evidence in state["evidence"]:
        aid, eid = int(evidence["learner_id"]), int(evidence["evidence_id"])
        seconds = int(evidence["spent_time"]) * 60
        key = (aid, f"evidence:{eid}")
        source_rows = source_by_key.get(key, [])
        parent_ids = {int(row["canonical_progress_id"]) for row in source_rows if row.get("canonical_progress_id")}
        parent_seconds = max([int(row.get("actual_seconds") or 0) for row in progress_by_aid[aid] if int(row["id"]) in parent_ids] or [0])
        if source_rows and parent_seconds >= seconds:
            classifications.append({"aid": aid, "eid": eid, "status": "SKIP_EXACT", "minutes": int(evidence["spent_time"])})
            continue
        if source_rows and any(progress_id in segment_ids_by_progress for progress_id in parent_ids):
            # A legacy parent can have reporting segments even when its
            # actual_seconds is NULL/zero.  Reusing it would violate the
            # one-segment-order constraint and could double-count history;
            # keep it for manual reconciliation instead of writing over it.
            classifications.append({"aid": aid, "eid": eid, "status": "SKIP_EXISTING_SEGMENTS", "minutes": int(evidence["spent_time"])})
            continue
        if source_rows and parent_seconds > 0:
            classifications.append({"aid": aid, "eid": eid, "status": "DURATION_CONFLICT", "minutes": int(evidence["spent_time"])})
            continue
        day = evidence_day(evidence)
        title = evidence.get("component_name") or evidence.get("evidence_name")
        alternate = None
        for row in progress_by_aid[aid]:
            if as_day(row.get("reporting_started_at")) == day and similar(row.get("component_title") or row.get("component_ref"), title):
                alternate = "SSOT_TITLE_DATE_MATCH"; break
        if not alternate:
            for row in journals[aid]:
                if row.get("activity_date") == day and float(row.get("actual_hours") or 0) > 0 and similar(row.get("title"), title):
                    alternate = "JOURNAL_TITLE_DATE_MATCH"; break
        if not alternate:
            for row in attendance[aid]:
                if as_day(row.get("attendance_date")) == day and similar(row.get("lecture_name"), title):
                    alternate = "ATTENDANCE_LECTURE_DATE_MATCH"; break
        if not alternate:
            for row in old[aid]:
                if as_day(row.get("activity_date")) == day and float(row.get("actual_hours") or 0) > 0 and similar(row.get("title"), title):
                    alternate = "OLD_TITLE_DATE_MATCH"; break
        if alternate:
            classifications.append({"aid": aid, "eid": eid, "status": alternate, "minutes": int(evidence["spent_time"])})
            continue
        # A lecture/Teams attendance item must be corroborated by the
        # attendance roster (including another learner on the same lecture)
        # before it can contribute hours.  A title/date alone is not enough.
        title_norm = norm(title)
        evidence_name_norm = norm(evidence.get("evidence_name"))
        attendance_text = f"{title_norm} {evidence_name_norm}"
        if any(token in attendance_text for token in ("lecture", "live via teams", "attended lecture", "attended session", "face to face")):
            classifications.append({"aid": aid, "eid": eid, "status": "ATTENDANCE_REVIEW", "minutes": int(evidence["spent_time"])})
            continue
        period = periods.get(aid)
        if not day or not period.get("start_date") or not period.get("end_date"):
            classifications.append({"aid": aid, "eid": eid, "status": "BLOCKED_DATE", "minutes": int(evidence["spent_time"])})
            continue
        if not (period["start_date"] <= day <= period["end_date"]):
            classifications.append({"aid": aid, "eid": eid, "status": "BLOCKED_OUTSIDE_PERIOD", "minutes": int(evidence["spent_time"])})
            continue
        content_row = content.get(eid, {})
        if not content_row.get("readable"):
            classifications.append({"aid": aid, "eid": eid, "status": "CONTENT_REVIEW", "minutes": int(evidence["spent_time"])})
            continue
        potential.append({"aid": aid, "eid": eid, "evidence": evidence, "owner": owners[aid], "parent_id": next(iter(parent_ids), None), "minutes": int(evidence["spent_time"]), "anchor": day, "content": content_row})

    # Existing accepted Aptem total is the ceiling.  Pick a deterministic
    # subset whose minute total is closest to the remaining deficit, preferring
    # exact/over-target coverage and readable explicit-duration evidence.
    selected: list[dict[str, Any]] = []
    deferred: list[dict[str, Any]] = []
    for aid in ROSTER:
        rows = sorted([item for item in potential if item["aid"] == aid], key=lambda item: (item["anchor"], item["eid"]))
        deficit = max(0, sum(int(e["spent_time"]) * 60 for e in state["evidence"] if int(e["learner_id"]) == aid) - current.get(aid, 0))
        target = max(0, round(deficit / 60))
        best: dict[int, tuple[int, list[int]]] = {0: (0, [])}
        for index, item in enumerate(rows):
            minutes = int(item["minutes"])
            score = 3 if item["content"].get("duration_match") else 1
            for total, (quality, indexes) in list(best.items()):
                new_total = total + minutes
                if new_total > target + 240:  # avoid gross overshoot for a deficit target
                    continue
                candidate = (quality + score, indexes + [index])
                previous = best.get(new_total)
                if previous is None or candidate[0] > previous[0]:
                    best[new_total] = candidate
        choices = [total for total in best if total >= target]
        if choices:
            chosen_total = min(choices, key=lambda total: (total - target, -best[total][0]))
        else:
            chosen_total = max(best, key=lambda total: (total, best[total][0])) if best else 0
        chosen_indexes = set(best.get(chosen_total, (0, []))[1])
        for index, item in enumerate(rows):
            (selected if index in chosen_indexes else deferred).append(item)

    # Allocate selected evidence after the current authoritative occupancy.
    blocked: list[dict[str, Any]] = []
    allocated: list[dict[str, Any]] = []
    for item in sorted(selected, key=lambda x: (x["aid"], x["anchor"], x["eid"])):
        aid, owner_id = item["aid"], int(item["owner"]["id"])
        remaining = item["minutes"] * 60
        segments = []
        anchor = item["anchor"]
        title_text = norm(item["evidence"].get("component_name") or item["evidence"].get("evidence_name"))
        is_lecture_evidence = "attendance" in title_text or "lecture" in title_text or "face to face" in title_text
        for distance in range(0, 370):
            if remaining <= 0:
                break
            days = [anchor + timedelta(days=distance)] if distance == 0 else [anchor + timedelta(days=distance), anchor - timedelta(days=distance)]
            for day in days:
                if remaining <= 0:
                    break
                if day.strftime("%Y-%m") != anchor.strftime("%Y-%m") or not valid_day(day, periods[aid], breaks.get(owner_id)) or (day in lecture_days[aid] and not is_lecture_evidence):
                    continue
                iso = day.isocalendar(); week_key = (owner_id, iso.year, iso.week); month_key = (owner_id, day.strftime("%Y-%m"))
                available = min(DAILY - occupancy[(owner_id, day)], WEEKLY - weekly[week_key], MONTHLY - monthly[month_key])
                if available <= 0:
                    continue
                seconds = min(remaining, available)
                minute_offset = 5 + (int(hashlib.sha1(str(item["eid"]).encode()).hexdigest()[:2], 16) % 6) * 5
                start = datetime.combine(day, time(9, minute_offset), tzinfo=UK)
                end = start + timedelta(seconds=seconds)
                if end.timetz() > time(17, 0, tzinfo=UK):
                    seconds = int((datetime.combine(day, time(17, 0), tzinfo=UK) - start).total_seconds())
                    if seconds <= 0:
                        continue
                    end = start + timedelta(seconds=seconds)
                segments.append({"start": start.isoformat(), "end": end.isoformat(), "month": day.strftime("%Y-%m"), "seconds": seconds, "original_date": anchor.isoformat()})
                occupancy[(owner_id, day)] += seconds; weekly[week_key] += seconds; monthly[month_key] += seconds; remaining -= seconds
        if remaining:
            blocked.append({"aid": aid, "eid": item["eid"], "reason": "TIMESTAMP_CAP", "minutes": item["minutes"]})
        else:
            # The search visits the nearest future and past dates in turns;
            # normalize before persistence so parent start/end and segment
            # order are chronological and satisfy the reporting constraints.
            item["segments"] = sorted(segments, key=lambda segment: segment["start"])
            allocated.append(item)

    fingerprint = digest({"database": state["database"], "selected": [(int(x["aid"]), int(x["eid"]), int(x["minutes"]), x["segments"]) for x in allocated], "blocked": blocked})
    summary = defaultdict(lambda: {"rows": 0, "minutes": 0})
    for row in classifications:
        summary[row["status"]]["rows"] += 1; summary[row["status"]]["minutes"] += int(row["minutes"])
    return {"database": state["database"], "selected": allocated, "deferred": deferred, "blocked": blocked,
            "classifications": classifications, "summary": dict(summary), "fingerprint": fingerprint,
            "current": current, "periods": periods, "owners": owners}


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(",").join(sql.Identifier(k) for k in values), sql.SQL(",").join(sql.Placeholder() for _ in values))
    return int(cur.execute(statement, list(values.values())).fetchone()["id"])


def write_learner_month(plan: dict[str, Any], aid: int, month: str) -> dict[str, Any]:
    items = [row for row in plan["selected"] if int(row["aid"]) == aid and any(seg["month"] == month for seg in row["segments"])]
    if not items:
        return {"aid": aid, "month": month, "written": 0, "seconds": 0}
    with psycopg.connect(database_url(), connect_timeout=30, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=180000")
            cur.execute("SET LOCAL lock_timeout=10000")
            owner = cur.execute('SELECT * FROM "Learner".learners WHERE aptem_id=%s FOR UPDATE', [aid]).fetchone()
            if not owner:
                raise ValueError(f"Learner {aid} disappeared before write.")
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s),%s::integer)", [RUN_KIND, int(owner["id"])])
            run_key = f"{RUN_KIND}:{plan['fingerprint']}:{aid}:{month}"
            existing_run = cur.execute('SELECT id FROM "Learner".activity_sync_runs WHERE run_key=%s', [run_key]).fetchone()
            if existing_run:
                return {"aid": aid, "month": month, "written": 0, "seconds": 0, "run_id": int(existing_run["id"]), "idempotent": True}
            run_id = insert_row(cur, "activity_sync_runs", {"run_key": run_key, "run_kind": RUN_KIND, "status": "running", "dry_run": False, "prompt_version": PROMPT_VERSION, "source_counts": Jsonb({"aptem_id": aid, "month": month, "evidence_ids": [int(x["eid"]) for x in items]}), "result_counts": Jsonb({})})
            order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner["id"]]).fetchone()["n"])
            written = seconds_total = sources_written = segments_written = docs_written = 0
            for item in items:
                eid = int(item["eid"]); evidence = item["evidence"]
                source_ref = f"evidence:{eid}"
                source = cur.execute('''SELECT * FROM "Learner".learner_activity_sources
                                        WHERE learner_id=%s AND source_system='aptem' AND source_activity_id=%s AND deleted_at IS NULL FOR UPDATE''', [owner["id"], source_ref]).fetchone()
                parent_id = int(source["canonical_progress_id"]) if source and source.get("canonical_progress_id") else None
                if source and parent_id:
                    parent = cur.execute('SELECT * FROM "Learner".learner_progress_entries WHERE id=%s AND deleted_at IS NULL FOR UPDATE', [parent_id]).fetchone()
                    if parent and int(parent.get("actual_seconds") or 0) > 0:
                        # Another scoped run may have materialized this source
                        # after the preview.  Idempotency requires skipping it
                        # rather than aborting the whole learner/month batch;
                        # no second parent, source, segment, or document is
                        # created.  A duration increase is never inferred here:
                        # the planner would classify that as a conflict and
                        # require a fresh dry run.
                        continue
                else:
                    parent = None
                segments = [seg for seg in item["segments"] if seg["month"] == month]
                if not segments:
                    continue
                seconds = sum(int(seg["seconds"]) for seg in segments)
                payload = dict(evidence.get("evidence_raw") or {})
                payload["reconciliation"] = {"resolution": "accepted_evidence_recovery", "estimated": True, "approval_required": True, "label": LABEL, "evidence_id": eid, "original_date": str(evidence_day(evidence)), "segments": segments, "azure_container": CONTAINER, "azure_file_blob": evidence.get("file_blob"), "azure_report_blob": evidence.get("report_blob")}
                payload["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
                if evidence.get("note_content"):
                    payload["note_content"] = evidence["note_content"]
                if parent is None:
                    order += 1
                    title = str(evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Evidence {eid}")[:500]
                    parent_id = insert_row(cur, "learner_progress_entries", {"learner_id": int(owner["id"]), "entry_order": order, "kind": "aptem_evidence", "component_ref": source_ref, "component_title": title, "component_type": "evidence", "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref, "canonical_activity_key": f"aptem:{aid}:{source_ref}", "activity_status": "Accepted", "accepted": True, "actual_seconds": seconds, "actual_basis": BASIS, "reporting_started_at": datetime.fromisoformat(segments[0]["start"]), "reporting_ended_at": datetime.fromisoformat(segments[-1]["end"]), "reporting_month": month, "reporting_timestamp_label": LABEL, "source_payload": Jsonb(payload), "sync_run_id": run_id})
                    written += 1
                else:
                    cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=%s,actual_basis=%s,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,reporting_timestamp_label=%s,source_payload=%s,sync_run_id=%s,ssot_updated_at=now() WHERE id=%s''', [seconds, BASIS, datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), month, LABEL, Jsonb(payload), run_id, parent_id])
                    written += 1
                if source:
                    cur.execute('''UPDATE "Learner".learner_activity_sources SET canonical_progress_id=%s,actual_seconds=%s,actual_basis=%s,source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,source_payload=%s,sync_run_id=%s,last_seen_at=now() WHERE id=%s''', [parent_id, seconds, BASIS, datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), datetime.fromisoformat(segments[0]["start"]), datetime.fromisoformat(segments[-1]["end"]), month, Jsonb(payload), run_id, source["id"]])
                else:
                    title = str(evidence.get("evidence_name") or evidence.get("component_name") or f"Aptem Evidence {eid}")[:500]
                    insert_row(cur, "learner_activity_sources", {"learner_id": int(owner["id"]), "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref, "curriculum_component_id": evidence.get("component_id"), "canonical_activity_key": f"aptem:{aid}:{source_ref}", "activity_type": "evidence", "title": title, "activity_status": "Accepted", "completed": True, "accepted": True, "actual_seconds": seconds, "actual_basis": BASIS, "source_started_at": datetime.fromisoformat(segments[0]["start"]), "source_ended_at": datetime.fromisoformat(segments[-1]["end"]), "reporting_started_at": datetime.fromisoformat(segments[0]["start"]), "reporting_ended_at": datetime.fromisoformat(segments[-1]["end"]), "reporting_month": month, "ksb_codes": Jsonb(evidence.get("ksb_codes") or []), "source_payload": Jsonb(payload), "sync_run_id": run_id, "canonical_progress_id": parent_id, "source_fingerprint": digest({"evidence_id": eid, "actual_seconds": seconds})})
                sources_written += 1
                for index, segment in enumerate(segments, 1):
                    insert_row(cur, "learner_activity_reporting_segments", {"progress_id": parent_id, "learner_id": int(owner["id"]), "segment_order": index, "actual_seconds": int(segment["seconds"]), "reporting_started_at": datetime.fromisoformat(segment["start"]), "reporting_ended_at": datetime.fromisoformat(segment["end"]), "reporting_month": month, "sync_run_id": run_id})
                    segments_written += 1
                for kind in ("file", "report"):
                    blob = evidence.get(f"{kind}_blob")
                    if not blob:
                        continue
                    doc_ref = f"evidence:{eid}:{kind}"
                    # Document identity is global by (source_system,
                    # source_document_id); do not create a second link when
                    # another scoped/import run already registered it.
                    if cur.execute('SELECT 1 FROM "Learner".learner_activity_documents WHERE source_system=%s AND source_document_id=%s AND deleted_at IS NULL FOR UPDATE', ["aptem", doc_ref]).fetchone():
                        continue
                    insert_row(cur, "learner_activity_documents", {"learner_id": int(owner["id"]), "progress_id": parent_id, "source_system": "aptem", "source_document_id": doc_ref, "container": CONTAINER, "blob_name": str(blob), "display_name": str(evidence.get("evidence_name") or evidence.get("component_name") or f"Evidence {eid}"), "content_type": mimetypes.guess_type(str(blob))[0] or "application/octet-stream", "uploaded_by": "aptem-evidence", "uploaded_at": evidence.get("submission_date") or evidence.get("completed_date") or evidence.get("created_date")})
                    docs_written += 1
                seconds_total += seconds
            result = {"aid": aid, "month": month, "written": written, "sources": sources_written, "segments": segments_written, "documents": docs_written, "seconds": seconds_total}
            cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed_with_issues", Jsonb(result), run_id])
            check = cur.execute('SELECT count(*) AS n,coalesce(sum(actual_seconds),0) AS seconds FROM "Learner".learner_progress_entries WHERE sync_run_id=%s AND deleted_at IS NULL', [run_id]).fetchone()
            if int(check["seconds"] or 0) != seconds_total:
                raise ValueError(f"Post-write verification failed for learner {aid}, month {month}.")
        conn.commit()
    return {**result, "run_id": run_id}


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
            cur.execute("SET LOCAL statement_timeout=240000")
            cur.execute("SET LOCAL lock_timeout=10000")
            state = fetch_state(cur)
            # Content was already read by the project's evidence classifier;
            # use that durable audit result rather than downloading the same
            # 876 files a second time.  Azure blob existence was separately
            # verified read-only (1317/1317 references found).
            content = {}
            classification_by_id = {int(row["evidence_id"]): row for row in state.get("classifications", [])}
            for row in state["evidence"]:
                eid = int(row["evidence_id"])
                classification = classification_by_id.get(eid)
                method = str((classification or {}).get("method") or "")
                chars = int((classification or {}).get("extracted_chars") or 0)
                note = bool(str(row.get("note_content") or "").strip())
                readable_method = any(token in method for token in ("text", "vision"))
                content[eid] = {"readable": bool(note or chars > 0 or readable_method), "duration_match": False, "method": method, "text_characters": chars}
            # Only the small unresolved subset is downloaded directly.  This
            # preserves the requirement to inspect a file/Note without
            # re-reading every already-classified Aptem document.
            preliminary = build_plan(state, content)
            review_ids = {int(row["eid"]) for row in preliminary["classifications"] if row["status"] == "CONTENT_REVIEW"}
            if review_ids:
                reviewed_rows = [row for row in state["evidence"] if int(row["evidence_id"]) in review_ids]
                content.update(read_content(reviewed_rows))
            plan = build_plan(state, content)
            if args.apply:
                if plan["database"] != args.expected_database or plan["fingerprint"] != args.expected_fingerprint:
                    raise ValueError("Database or reviewed fingerprint changed; preview again before apply.")
                results = []
                for aid in ROSTER:
                    months = sorted({seg["month"] for item in plan["selected"] if int(item["aid"]) == aid for seg in item["segments"]})
                    for month in months:
                        results.append(write_learner_month(plan, aid, month))
                plan["written"] = results
            output = {"database": plan["database"], "apply": args.apply, "fingerprint": plan["fingerprint"], "summary": plan["summary"], "selected": [{"aid": int(x["aid"]), "eid": int(x["eid"]), "minutes": int(x["minutes"]), "segments": x["segments"]} for x in plan["selected"]], "deferred_count": len(plan["deferred"]), "blocked": plan["blocked"]}
            if args.apply:
                output["written"] = plan["written"]
            print(json.dumps(output, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        if isinstance(exc, ValueError):
            detail = str(exc)
        else:
            detail = str(exc.diag.message_primary or exc) if getattr(exc, "diag", None) else str(exc)
            if getattr(exc, "diag", None) and exc.diag.constraint_name:
                detail = f"{detail} (constraint={exc.diag.constraint_name})"
        print(json.dumps({"error": detail}, ensure_ascii=False))
        raise SystemExit(1)
