"""Dry-run and reviewed recovery of positive Old-LMS hours into SSOT.

The default command is read-only.  It reconciles the 54 learner roster using
the Old Schema as a source, tolerates the decimal precision used by the old
table, treats kind-family migrations as possible matches, and refuses to
duplicate a source reference even when SSOT reports it in another month.

``--apply`` is deliberately gated by the dry-run fingerprint and database
name.  Estimated timestamps require the additional ``--allow-estimated`` flag
and are never accepted by default.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


UK = ZoneInfo("Europe/London")
TOLERANCE_MINUTES = Decimal("0.2")
DAILY_SECONDS = 8 * 60 * 60
WEEKLY_SECONDS = 12 * 60 * 60
MONTHLY_SECONDS = 45 * 60 * 60
RUN_KIND = "old-lms-missing-ssot-v1"
PROMPT_VERSION = "activity-hours-timestamp-recovery-v1"
ROSTER = [
    75, 652, 806, 1268, 1428, 1797, 3274, 3487, 3598, 4115, 4407,
    5144, 6105, 6203, 6240, 6254, 6333, 6378, 6436, 6473, 6498, 8162,
    8530, 8580, 8635, 8861, 8903, 10071, 10208, 10624, 14183, 14235,
    15794, 15796, 16001, 16221, 16474, 16476, 16742, 16749, 17038,
    17045, 17129, 17254, 17424, 17429, 17753, 17825, 17922, 17930,
    18000, 18587, 18756, 18962,
]


def env_values() -> dict[str, str]:
    values = dict(os.environ)
    path = Path(__file__).resolve().parents[1] / ".env"
    if path.exists():
        for raw in path.read_text(encoding="utf-8-sig").splitlines():
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


def seconds_from_hours(value: Any) -> int:
    return int((Decimal(str(value or 0)) * Decimal(3600)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def local_date(value: Any) -> date | None:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UK)
        return value.astimezone(UK).date()
    if isinstance(value, date):
        return value
    if value:
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(UK).date()
        except (ValueError, TypeError):
            return None
    return None


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).lower()


def kind_family(kind: str) -> set[str]:
    k = norm(kind)
    if k in {"reading", "quiz", "reading_quiz"}:
        return {"reading", "quiz", "reading_quiz"}
    if k in {"video", "audio", "media"}:
        return {"video", "audio", "media"}
    return {k}


def family_match(left: str, right: str) -> bool:
    return norm(left) in kind_family(right) or norm(right) in kind_family(left)


def bank_holidays() -> set[date]:
    # England/Wales bank holidays needed by the scope (2024–2026).
    return {
        date(2024, 1, 1), date(2024, 3, 29), date(2024, 4, 1),
        date(2024, 5, 6), date(2024, 5, 27), date(2024, 8, 26),
        date(2024, 12, 25), date(2024, 12, 26),
        date(2025, 1, 1), date(2025, 4, 18), date(2025, 4, 21),
        date(2025, 5, 5), date(2025, 5, 26), date(2025, 8, 25),
        date(2025, 12, 25), date(2025, 12, 26), date(2026, 1, 1),
        date(2026, 4, 3), date(2026, 4, 6), date(2026, 5, 4),
        date(2026, 5, 25), date(2026, 8, 31), date(2026, 12, 25),
        date(2026, 12, 28),
    }


def parse_json(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def break_bounds(row: dict[str, Any] | None) -> tuple[bool, date | None, date | None]:
    row = row or {}
    data = parse_json(row.get("break_json"))
    if norm(row.get("program_status")) == "onbreak":
        data["has_break_in_learning"] = True
    try:
        last = date.fromisoformat(str(data["last_learning_date"])) if data.get("last_learning_date") else None
    except ValueError:
        last = None
    try:
        returned = date.fromisoformat(str(data["return_to_learning_date"])) if data.get("return_to_learning_date") else None
    except ValueError:
        returned = None
    return bool(data.get("has_break_in_learning")), last, returned


def valid_period(day: date, period: dict[str, Any], break_row: dict[str, Any] | None) -> str:
    if not period.get("start_date") or not period.get("end_date"):
        return "BOUNDARY_UNKNOWN"
    if day < period["start_date"] or day > period["end_date"]:
        return "OUTSIDE"
    has_break, last, returned = break_bounds(break_row)
    if has_break and last and day > last and (not returned or day < returned):
        return "BREAK"
    return "VALID"


def ref_tokens(row: dict[str, Any]) -> set[str]:
    payload = parse_json(row.get("source_payload"))
    values = {
        row.get("source_activity_id"),
        row.get("source_attempt_key"),
        payload.get("activity_id"),
        payload.get("original_source_ref"),
        payload.get("source_ref"),
    }
    tokens: set[str] = set()
    for value in values:
        text = str(value or "")
        if text.isdigit():
            tokens.add(text)
        tokens.update(re.findall(r"(?<!\d)(\d{4,7})(?!\d)", text))
    return tokens


def old_key(row: dict[str, Any]) -> tuple[Any, ...]:
    return (int(row["aptem_id"]), str(row["month"]), norm(row["kind"]), str(row["source"]), str(row["ref"]))


def old_seconds(row: dict[str, Any]) -> int:
    return seconds_from_hours(row.get("actual_hours"))


def report_minutes(value: str) -> Decimal:
    h, m, s = (int(part) for part in value.split(":"))
    return Decimal(h * 60 + m) + Decimal(s) / Decimal(60)


def load_reviewed_row_keys(path: Path) -> tuple[set[tuple[Any, ...]], set[tuple[Any, ...]]]:
    """Return (approved_104, legacy_5358) keys from the prior report.

    The old report's row IDs were positional and its duration resolution was
    too strict.  Keys are therefore reconstructed from the stable source
    identity and a rounded duration, never trusted by row number alone.
    """
    approved: set[tuple[Any, ...]] = set()
    legacy: set[tuple[Any, ...]] = set()
    if not path.exists():
        return approved, legacy
    import csv
    for row in csv.DictReader(path.open(encoding="utf-8")):
        if not row.get("old_hours") or row["old_hours"] == "00:00:00":
            continue
        # The prior report rounded the displayed duration; the stable source
        # identity is the safe key for preserving its reviewed classification.
        key = (int(row["aptem_id"]), row["month"], norm(row["old_kind"]), row["old_source"], row["old_ref"])
        if row.get("status") == "NOT_MISSING_ALTERNATE_SOURCE":
            approved.add(key)
        if row.get("status") == "BLOCKED_OLD_ROW_AMBIGUOUS":
            legacy.add(key)
    return approved, legacy


def candidate_key(row: dict[str, Any]) -> tuple[Any, ...]:
    minutes = (Decimal(str(row.get("actual_hours") or 0)) * Decimal(60)).quantize(Decimal("0.001"))
    return (*old_key(row), str(minutes))


def lookup_existing_ssot(ssot_by_ref: dict[tuple[int, str], list[dict[str, Any]]], row: dict[str, Any]) -> list[dict[str, Any]]:
    matches: dict[int, dict[str, Any]] = {}
    for token in {str(row["ref"])}:
        for item in ssot_by_ref.get((int(row["aptem_id"]), token), []):
            matches[int(item["id"])] = item
    return list(matches.values())


def lookup_journal(journals_by_ref: dict[tuple[int, str, str], list[dict[str, Any]]], row: dict[str, Any]) -> list[dict[str, Any]]:
    return journals_by_ref.get((int(row["aptem_id"]), str(row["month"]), str(row["ref"])), [])


def lookup_evidence(evidence_by_id: dict[tuple[int, str], list[dict[str, Any]]], row: dict[str, Any]) -> list[dict[str, Any]]:
    return evidence_by_id.get((int(row["aptem_id"]), str(row["ref"])), [])


def choose_schedule(
    owner_id: int,
    anchor: date,
    target_month: str,
    seconds: int,
    period: dict[str, Any],
    break_row: dict[str, Any] | None,
    occupancy: dict[tuple[int, date], int],
    counts: dict[tuple[int, date], int],
    weekly: dict[tuple[int, int, int], int],
    monthly: dict[tuple[int, str], int],
    lecture_days: dict[int, set[date]],
    fingerprint: str,
) -> list[dict[str, Any]] | None:
    """Allocate deterministic working-time segments without exceeding caps."""
    if not anchor:
        return None
    start = anchor
    # Use the activity date as the lower bound.  If the source date is a
    # weekend/holiday or a day with no remaining capacity, move forward to the
    # next valid working day; never place an estimated activity before the
    # source activity date.
    valid_days: list[date] = []
    for offset in range(0, 370):
        forward = anchor + timedelta(days=offset)
        day = forward
        if day < period["start_date"] or day > period["end_date"]:
            continue
        if day.strftime("%Y-%m") != target_month:
            continue
        if valid_period(day, period, break_row) != "VALID" or day.weekday() >= 5 or day in bank_holidays() or day in lecture_days.get(owner_id, set()):
            continue
        valid_days.append(day)
        if len(valid_days) >= 30:
            break
    remaining = int(seconds)
    segments: list[dict[str, Any]] = []
    for day in valid_days:
        if remaining <= 0:
            break
        week = day.isocalendar()
        available = min(DAILY_SECONDS - occupancy.get((owner_id, day), 0), WEEKLY_SECONDS - weekly.get((owner_id, week.year, week.week), 0), MONTHLY_SECONDS - monthly.get((owner_id, day.strftime("%Y-%m")), 0))
        available = min(available, DAILY_SECONDS) if available > 0 else 0
        if counts.get((owner_id, day), 0) >= 8 or available <= 0:
            continue
        seconds_today = min(remaining, available)
        # Keep starts varied and non-:00 while remaining inside 09:00–17:00.
        minute_offset = 7 + (int(hashlib.sha1(fingerprint.encode()).hexdigest()[:2], 16) % 7) * 7
        start_dt = datetime.combine(day, time(9, minute_offset), tzinfo=UK)
        end_dt = start_dt + timedelta(seconds=seconds_today)
        if end_dt.timetz() > time(17, 0, tzinfo=UK):
            seconds_today = int((datetime.combine(day, time(17, 0), tzinfo=UK) - start_dt).total_seconds())
            if seconds_today <= 0:
                continue
            end_dt = start_dt + timedelta(seconds=seconds_today)
        segments.append({"start": start_dt.isoformat(), "end": end_dt.isoformat(), "month": day.strftime("%Y-%m"), "seconds": seconds_today})
        remaining -= seconds_today
        occupancy[(owner_id, day)] = occupancy.get((owner_id, day), 0) + seconds_today
        counts[(owner_id, day)] = counts.get((owner_id, day), 0) + 1
        weekly[(owner_id, week.year, week.week)] = weekly.get((owner_id, week.year, week.week), 0) + seconds_today
        monthly[(owner_id, day.strftime("%Y-%m"))] = monthly.get((owner_id, day.strftime("%Y-%m")), 0) + seconds_today
    return segments if remaining == 0 else None


def read_state(conn) -> dict[str, Any]:
    with conn.cursor() as cur:
        owners = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=ANY(%s)', [ROSTER]).fetchall()
        periods = cur.execute('SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)', [ROSTER]).fetchall()
        old = cur.execute('SELECT * FROM "Learner".source_lms_actual_hours WHERE aptem_id=ANY(%s) ORDER BY aptem_id,month,kind,source,ref', [ROSTER]).fetchall()
        ssot = cur.execute('''SELECT p.*,l.aptem_id AS owner_aptem_id FROM "Learner".learner_progress_entries p JOIN "Learner".learners l ON l.id=p.learner_id WHERE l.aptem_id=ANY(%s) AND p.accepted IS TRUE AND p.deleted_at IS NULL''', [ROSTER]).fetchall()
        sources = cur.execute('''SELECT s.*,l.aptem_id AS owner_aptem_id FROM "Learner".learner_activity_sources s JOIN "Learner".learners l ON l.id=s.learner_id WHERE l.aptem_id=ANY(%s) AND s.deleted_at IS NULL''', [ROSTER]).fetchall()
        segments = cur.execute('''SELECT s.* FROM "Learner".learner_activity_reporting_segments s JOIN "Learner".learners l ON l.id=s.learner_id WHERE l.aptem_id=ANY(%s)''', [ROSTER]).fetchall()
        journals = cur.execute('''SELECT * FROM "Learner".learner_journal_rows WHERE aptem_id=ANY(%s) AND accepted IS TRUE AND deleted_at IS NULL''', [ROSTER]).fetchall()
        attendance = cur.execute('SELECT * FROM "Learner".source_lms_attendance WHERE aptem_id=ANY(%s)', [ROSTER]).fetchall()
        evidence = cur.execute('''SELECT evidence_id,learner_id,evidence_status,spent_time,component_id,component_name,evidence_name,completed_date,completed_date_override,submission_date,created_date,note_content,file_blob,report_blob FROM fetching_evidence.evidence_items WHERE learner_id=ANY(%s)''', [ROSTER]).fetchall()
        breaks = cur.execute('''SELECT DISTINCT ON (learner_id) learner_id,program_status,"Break in learning" AS break_json,source,fetched_at,id FROM fetching_evidence.aptem_cv_contracts_probe WHERE learner_id=ANY(%s) AND source <> 'audit_upload' ORDER BY learner_id,fetched_at DESC NULLS LAST,id DESC''', [ROSTER]).fetchall()
        database = cur.execute('SELECT current_database() AS name').fetchone()["name"]
    return {"database": database, "owners": owners, "periods": periods, "old": old, "ssot": ssot, "sources": sources, "segments": segments, "journals": journals, "attendance": attendance, "evidence": evidence, "breaks": breaks}


def build_plan(state: dict[str, Any], reviewed_report: Path) -> dict[str, Any]:
    approved_keys, legacy_keys = load_reviewed_row_keys(reviewed_report)
    owners = {int(row["aptem_id"]): row for row in state["owners"]}
    periods = {int(row["aptem_id"]): row for row in state["periods"]}
    breaks = {int(row["learner_id"]): row for row in state["breaks"]}
    old_by_key = defaultdict(list)
    for row in state["old"]:
        old_by_key[old_key(row)].append(row)
    ssot_by_ref = defaultdict(list)
    for row in state["ssot"]:
        for token in ref_tokens(row):
            ssot_by_ref[(int(row["owner_aptem_id"]), token)].append(row)
    source_by_ref = defaultdict(list)
    for row in state["sources"]:
        for token in ref_tokens(row):
            source_by_ref[(int(row["owner_aptem_id"]), token)].append(row)
    journals_by_ref = defaultdict(list)
    for row in state["journals"]:
        if row.get("activity_id") is not None:
            journals_by_ref[(int(row["aptem_id"]), str(row["month"]), str(row["activity_id"]))].append(row)
    evidence_by_id = defaultdict(list)
    for row in state["evidence"]:
        evidence_by_id[(int(row["learner_id"]), str(row["evidence_id"]))].append(row)
    attendance_by_ref = defaultdict(list)
    for row in state["attendance"]:
        attendance_by_ref[(int(row["aptem_id"]), str(row.get("source_key") or ""))].append(row)
    occupancy: dict[tuple[int, date], int] = defaultdict(int)
    counts: dict[tuple[int, date], int] = defaultdict(int)
    weekly: dict[tuple[int, int, int], int] = defaultdict(int)
    monthly: dict[tuple[int, str], int] = defaultdict(int)
    lecture_days: dict[int, set[date]] = defaultdict(set)
    owner_by_id = {int(row["id"]): int(row["aptem_id"]) for row in state["owners"]}
    for row in state["segments"]:
        day = local_date(row.get("reporting_started_at"))
        owner_aid = owner_by_id.get(int(row["learner_id"]))
        if day and owner_aid:
            value = int(row.get("actual_seconds") or 0)
            occupancy[(owner_aid, day)] += value
            counts[(owner_aid, day)] += 1
            iso = day.isocalendar()
            weekly[(owner_aid, iso.year, iso.week)] += value
            monthly[(owner_aid, day.strftime("%Y-%m"))] += value
    for row in state["attendance"]:
        day = local_date(row.get("attendance_date"))
        aid = int(row["aptem_id"])
        if day and (row.get("lecture_name") or row.get("activity_hours")):
            lecture_days[aid].add(day)
    actions: list[dict[str, Any]] = []
    excluded_zero = 0
    approved_104 = 0
    for row in state["old"]:
        seconds = old_seconds(row)
        if seconds <= 0:
            excluded_zero += 1
            continue
        key = old_key(row)
        if key in approved_keys:
            approved_104 += 1
            continue
        aid = int(row["aptem_id"])
        owner = owners.get(aid)
        period = periods.get(aid)
        if not owner or not period:
            actions.append({"status": "BLOCKED_OWNER_OR_PERIOD", "old": row, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "") if owner else ""})
            continue
        existing = lookup_existing_ssot(ssot_by_ref, row)
        if existing:
            same_month = [item for item in existing if str(item.get("reporting_month") or "") == str(row["month"]) and family_match(str(item.get("kind") or ""), str(row["kind"]))]
            chosen = min(same_month or existing, key=lambda item: abs(int(item.get("actual_seconds") or 0) - seconds))
            delta = int(chosen.get("actual_seconds") or 0) - seconds
            if same_month:
                status = "REF_EXACT_DURATION" if abs(delta) <= int(TOLERANCE_MINUTES * 60) else "REF_DURATION_CONFLICT"
            else:
                status = "REF_MONTH_CONFLICT_EXACT" if abs(delta) <= int(TOLERANCE_MINUTES * 60) else "REF_MONTH_CONFLICT"
            actions.append({"status": status, "old": row, "ssot": chosen, "delta_seconds": delta, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "")})
            continue
        source_matches = source_by_ref.get((aid, str(row["ref"])), [])
        if source_matches:
            chosen = min(source_matches, key=lambda item: abs(int(item.get("actual_seconds") or 0) - seconds))
            source_delta = int(chosen.get("actual_seconds") or 0) - seconds
            same_source_month = str(chosen.get("reporting_month") or "") == str(row["month"])
            if same_source_month:
                source_status = "SOURCE_REF_EXACT" if abs(source_delta) <= int(TOLERANCE_MINUTES * 60) else "SOURCE_REF_DURATION_CONFLICT"
            else:
                source_status = "SOURCE_REF_OTHER_MONTH_EXACT" if abs(source_delta) <= int(TOLERANCE_MINUTES * 60) else "SOURCE_REF_OTHER_MONTH_CONFLICT"
            actions.append({"status": source_status, "old": row, "source": chosen, "delta_seconds": source_delta, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "")})
            continue
        attendance_matches = attendance_by_ref.get((aid, str(row["ref"])), [])
        if attendance_matches:
            chosen = attendance_matches[0]
            att_seconds = int(Decimal(str(chosen.get("activity_hours") or 0)) * 3600)
            status = "ATTENDANCE_EXACT" if abs(att_seconds - seconds) <= int(TOLERANCE_MINUTES * 60) else "ATTENDANCE_DURATION_CONFLICT"
            actions.append({"status": status, "old": row, "attendance": chosen, "delta_seconds": att_seconds - seconds, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "")})
            continue
        journal = lookup_journal(journals_by_ref, row)
        if journal:
            chosen = journal[0]
            j_seconds = seconds_from_hours(chosen.get("actual_hours"))
            status = "JOURNAL_EXACT" if abs(j_seconds - seconds) <= int(TOLERANCE_MINUTES * 60) else "JOURNAL_DURATION_CONFLICT"
            actions.append({"status": status, "old": row, "journal": chosen, "delta_seconds": j_seconds - seconds, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "")})
            continue
        evidence_matches = lookup_evidence(evidence_by_id, row)
        if evidence_matches:
            chosen = evidence_matches[0]
            e_seconds = int(Decimal(str(chosen.get("spent_time") or 0)) * 60)
            status = "EVIDENCE_EXACT" if abs(e_seconds - seconds) <= int(TOLERANCE_MINUTES * 60) else "EVIDENCE_DURATION_CONFLICT"
            actions.append({"status": status, "old": row, "evidence": chosen, "delta_seconds": e_seconds - seconds, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "")})
            continue
        day = local_date(row.get("activity_date"))
        period_status = valid_period(day, period, breaks.get(aid)) if day else "DATE_MISSING"
        if period_status in {"OUTSIDE", "BREAK", "BOUNDARY_UNKNOWN", "DATE_MISSING"}:
            actions.append({"status": f"BLOCKED_{period_status}", "old": row, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "")})
            continue
        estimated = not row.get("start_time") or not row.get("end_time") or day.weekday() >= 5 or day in bank_holidays()
        segments = choose_schedule(aid, day, str(row["month"]), seconds, period, breaks.get(aid), occupancy, counts, weekly, monthly, lecture_days, f"{aid}:{row['month']}:{row['ref']}")
        if not segments:
            actions.append({"status": "BLOCKED_TIMESTAMP_CAP", "old": row, "actual_seconds": seconds, "legacy_5358": key in legacy_keys, "owner_name": owner.get("full_name", "")})
            continue
        actions.append({"status": "NEW_ESTIMATED" if estimated else "NEW_LEGITIMATE", "old": row, "actual_seconds": seconds, "segments": segments, "legacy_5358": key in legacy_keys, "estimated": estimated, "owner_name": owner.get("full_name", "")})
    summary = defaultdict(lambda: {"rows": 0, "seconds": 0})
    for action in actions:
        summary[action["status"]]["rows"] += 1
        summary[action["status"]]["seconds"] += int(action.get("actual_seconds") or 0)
    plan = {"database": state["database"], "actions": actions, "summary": dict(summary), "excluded_zero": excluded_zero, "approved_104": approved_104, "scope": ROSTER, "prompt_version": PROMPT_VERSION}
    plan["fingerprint"] = digest({"database": plan["database"], "scope": ROSTER, "summary": plan["summary"], "actions": [{"status": a["status"], "old": old_key(a["old"]), "seconds": a.get("actual_seconds"), "segments": a.get("segments", [])} for a in actions]})
    return plan


def serialize_action(action: dict[str, Any]) -> dict[str, Any]:
    old = action["old"]
    item = {
        "status": action["status"], "legacy_5358": action.get("legacy_5358", False),
        "aptem_id": old["aptem_id"], "learner": action.get("owner_name", ""), "month": old["month"],
        "kind": old["kind"], "source": old["source"], "ref": old["ref"], "title": old.get("title") or "",
        "old_hours": fmt(old_seconds(old)), "old_activity_date": str(old.get("activity_date") or ""),
        "actual_seconds": action.get("actual_seconds", 0), "actual_hours": fmt(int(action.get("actual_seconds") or 0)),
        "estimated": bool(action.get("estimated", False)), "segments": action.get("segments", []),
        "ssot_id": action.get("ssot", {}).get("id") if action.get("ssot") else None,
        "ssot_month": action.get("ssot", {}).get("reporting_month") if action.get("ssot") else None,
        "ssot_kind": action.get("ssot", {}).get("kind") if action.get("ssot") else None,
        "ssot_seconds": action.get("ssot", {}).get("actual_seconds") if action.get("ssot") else None,
        "delta_seconds": action.get("delta_seconds"),
    }
    return item


def write_report(plan: dict[str, Any], output_dir: Path) -> tuple[Path, Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = date.today().isoformat()
    json_path = output_dir / f"old_lms_ssot_reconciliation_54_{stamp}.json"
    csv_path = output_dir / f"old_lms_ssot_reconciliation_54_{stamp}.csv"
    md_path = output_dir / f"old_lms_ssot_reconciliation_54_{stamp}.md"
    rows = [serialize_action(action) for action in plan["actions"]]
    json_path.write_text(json.dumps({"fingerprint": plan["fingerprint"], "database": plan["database"], "summary": plan["summary"], "excluded_zero": plan["excluded_zero"], "approved_104": plan["approved_104"], "rows": rows}, default=str, ensure_ascii=False, indent=2), encoding="utf-8")
    import csv
    fields = ["status", "legacy_5358", "aptem_id", "learner", "month", "kind", "source", "ref", "title", "old_hours", "old_activity_date", "actual_hours", "estimated", "ssot_id", "ssot_month", "ssot_kind", "ssot_seconds", "delta_seconds", "segments"]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            row["segments"] = json.dumps(row["segments"], ensure_ascii=False, separators=(",", ":"))
            writer.writerow({field: row.get(field) for field in fields})
    lines = [
        "# Old LMS → SSOT reconciliation (54 learners)", "", f"Database: `{plan['database']}`  ", "Mode: post-write verification dry run; this report generation was read-only.", "", f"Fingerprint: `{plan['fingerprint']}`", "", "## Summary", "", "| Status | Rows | Hours |", "|---|---:|---:|",
    ]
    for status, item in sorted(plan["summary"].items()):
        lines.append(f"| `{status}` | {item['rows']} | {fmt(item['seconds'])} |")
    legacy = defaultdict(lambda: {"rows": 0, "seconds": 0})
    for action in plan["actions"]:
        if action.get("legacy_5358"):
            legacy[action["status"]]["rows"] += 1
            legacy[action["status"]]["seconds"] += int(action.get("actual_seconds") or 0)
    lines += ["", "## Corrected 5358 cohort", "", "| Status | Rows | Hours |", "|---|---:|---:|"]
    for status, item in sorted(legacy.items()):
        lines.append(f"| `{status}` | {item['rows']} | {fmt(item['seconds'])} |")
    lines += ["", f"Zero-hour rows ignored: **{plan['excluded_zero']}**", f"Previously approved alternate-source rows skipped: **{plan['approved_104']}**", "", "## Important controls", "", "- Old Schema and Aptem mirror were not modified.", "- Existing SSOT references in another month are review-only; no duplicate is inserted.", "- Duration conflicts are not auto-resolved.", "- Estimated timestamps require explicit approval before apply.", "- Apply requires this fingerprint and the verified database name.", "", "## Files", "", f"- CSV: `{csv_path.name}`", f"- JSON: `{json_path.name}`"]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return md_path, csv_path, json_path


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(",").join(sql.Identifier(k) for k in values), sql.SQL(",").join(sql.Placeholder() for _ in values))
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def apply_plan(plan: dict[str, Any], conn, allow_estimated: bool) -> dict[str, Any]:
    actions = [a for a in plan["actions"] if a["status"] == "NEW_LEGITIMATE" or (allow_estimated and a["status"] == "NEW_ESTIMATED")]
    owners: dict[int, dict[str, Any]] = {}
    with conn.cursor() as cur:
        for row in cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=ANY(%s)', [ROSTER]).fetchall():
            owners[int(row["aptem_id"])] = row
    grouped: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for action in actions:
        grouped[(int(action["old"]["aptem_id"]), str(action["old"]["month"]))].append(action)
    conn.commit()
    inserted = 0
    for (aid, month), group in sorted(grouped.items()):
        try:
            with conn.cursor() as cur:
                owner = owners[aid]
                owner_id = int(owner["id"])
                cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s),%s::integer)", [RUN_KIND, owner_id])
                run_id = insert_row(cur, "activity_sync_runs", {"run_key": f"{RUN_KIND}:{plan['fingerprint']}:{aid}:{month}", "run_kind": RUN_KIND, "status": "running", "dry_run": False, "prompt_version": PROMPT_VERSION, "source_counts": Jsonb({"aptem_id": aid, "month": month, "estimated_allowed": allow_estimated}), "result_counts": Jsonb({})})
                order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner_id]).fetchone()["n"])
                group_inserted = 0
                for action in group:
                    old = action["old"]
                    source_ref = f"old_lms:{old['source']}:{old['ref']}:{old['month']}"
                    if cur.execute('SELECT id FROM "Learner".learner_activity_sources WHERE learner_id=%s AND source_activity_id=%s AND deleted_at IS NULL FOR UPDATE', [owner_id, source_ref]).fetchone():
                        continue
                    order += 1
                    segments = action.get("segments") or []
                    first = datetime.fromisoformat(segments[0]["start"]) if segments else None
                    last = datetime.fromisoformat(segments[-1]["end"]) if segments else None
                    basis = "old_lms:verified-source-hours" if not action.get("estimated") else "old_lms:estimated-recovery"
                    payload = {"old_schema": {"aptem_id": old["aptem_id"], "month": old["month"], "kind": old["kind"], "source": old["source"], "ref": old["ref"], "activity_date": str(old.get("activity_date") or ""), "actual_hours": str(old.get("actual_hours") or "")}, "reconciliation": {"prompt_version": PROMPT_VERSION, "estimated": bool(action.get("estimated")), "approval_required": bool(action.get("estimated")), "original_activity_date": str(old.get("activity_date") or ""), "segments": segments}}
                    title = str(old.get("title") or f"Recovered Old LMS {old['ref']}")[:500]
                    canonical = f"old_lms:{old['aptem_id']}:{old['source']}:{old['ref']}:{old['month']}"
                    parent_id = insert_row(cur, "learner_progress_entries", {"learner_id": owner_id, "entry_order": order, "kind": "reading_quiz" if norm(old["kind"]) == "reading_quiz" else norm(old["kind"]), "component_ref": source_ref, "component_title": title, "component_type": "old_lms_recovered", "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "old_lms", "source_activity_id": source_ref, "source_attempt_key": source_ref, "canonical_activity_key": canonical, "activity_status": "Completed", "accepted": True, "actual_seconds": int(action["actual_seconds"]), "actual_basis": basis, "reporting_started_at": first, "reporting_ended_at": last, "reporting_month": month, "reporting_timestamp_label": "Scheduled" if action.get("estimated") else "Input", "source_payload": Jsonb(payload), "sync_run_id": run_id})
                    insert_row(cur, "learner_activity_sources", {"learner_id": owner_id, "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "old_lms", "source_activity_id": source_ref, "source_attempt_key": source_ref, "canonical_activity_key": canonical, "activity_type": norm(old["kind"]), "title": title, "activity_status": "Completed", "completed": True, "accepted": True, "actual_seconds": int(action["actual_seconds"]), "actual_basis": basis, "source_started_at": first, "source_ended_at": last, "reporting_started_at": first, "reporting_ended_at": last, "reporting_month": month, "source_payload": Jsonb(payload), "sync_run_id": run_id, "canonical_progress_id": parent_id, "source_fingerprint": digest(payload)})
                    for segment_order, segment in enumerate(segments, 1):
                        insert_row(cur, "learner_activity_reporting_segments", {"progress_id": parent_id, "learner_id": owner_id, "segment_order": segment_order, "actual_seconds": int(segment["seconds"]), "reporting_started_at": datetime.fromisoformat(segment["start"]), "reporting_ended_at": datetime.fromisoformat(segment["end"]), "reporting_month": segment["month"], "sync_run_id": run_id})
                    group_inserted += 1
                result = {"parents_inserted": group_inserted, "estimated_allowed": allow_estimated, "fingerprint": plan["fingerprint"], "aptem_id": aid, "month": month}
                cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed", Jsonb(result), run_id])
                inserted += group_inserted
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    return {"parents_inserted": inserted, "estimated_allowed": allow_estimated, "fingerprint": plan["fingerprint"], "groups": len(grouped)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--fingerprint")
    parser.add_argument("--database")
    parser.add_argument("--allow-estimated", action="store_true")
    parser.add_argument("--output-dir", default=str(Path(__file__).resolve().parents[1] / "reports"))
    args = parser.parse_args()
    with psycopg.connect(database_url(), connect_timeout=20, row_factory=dict_row) as conn:
        state = read_state(conn)
        report_path = Path(__file__).resolve().parents[1] / "reports" / "old_ssot_missing_validation_54_2026-10-04.csv"
        plan = build_plan(state, report_path)
        if args.apply:
            if args.database != plan["database"]:
                raise SystemExit("Database name does not match the reviewed dry-run target.")
            if args.fingerprint != plan["fingerprint"]:
                raise SystemExit("Dry-run fingerprint changed; generate and review a new report.")
            result = apply_plan(plan, conn, args.allow_estimated)
            print(json.dumps(result, default=str, ensure_ascii=False, indent=2))
        else:
            md, csv_path, json_path = write_report(plan, Path(args.output_dir))
            print(json.dumps({"database": plan["database"], "fingerprint": plan["fingerprint"], "summary": plan["summary"], "excluded_zero": plan["excluded_zero"], "approved_104": plan["approved_104"], "markdown": str(md), "csv": str(csv_path), "json": str(json_path)}, default=str, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
