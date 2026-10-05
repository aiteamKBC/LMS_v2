"""Dry-run/apply timestamp redistribution for the approved 54-learner scope.

This is a one-off, auditable maintenance script.  It changes only SSOT
reporting timestamps/segments and adds reviewed Old-LMS rows which are not
already represented.  Old Schema, Aptem mirrors, Attendance rows, Journal
rows, and application/schema code are read-only inputs.

The default command is read-only.  Apply is gated by the generated plan
fingerprint and database name.  Attendance is never moved; date-only
attendance is reported as TIME_MISSING rather than being silently timed.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

import reconcile_old_lms_missing_ssot as base

UK = ZoneInfo("Europe/London")
DAILY = 8 * 3600
WEEKLY = 12 * 3600
MONTHLY = 45 * 3600
ACTOR = "codex:activity-hours-timestamp-recovery"
RUN_KIND = "activity-hours-timestamp-recovery-v2"
PROMPT_VERSION = "activity-hours-timestamp-recovery-v2"
REPORT = Path(__file__).resolve().parents[1] / "reports" / "old_lms_ssot_reconciliation_54_2026-10-04.json"
REDISTRIBUTION_REPORT = Path(__file__).resolve().parents[1] / "reports" / "activity_timestamp_redistribution_54_2026-10-04.json"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


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


def local_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=UK)
        return value.astimezone(UK).date()
    if isinstance(value, date):
        return value
    try:
        text = str(value).replace("Z", "+00:00")
        parsed = datetime.fromisoformat(text)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UK)
        return parsed.astimezone(UK).date()
    except (TypeError, ValueError):
        return None


def local_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UK)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=UK)
    except (TypeError, ValueError):
        return None


def seconds_old(value: Any) -> int:
    return int((Decimal(str(value or 0)) * Decimal(3600)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def fmt(seconds: int) -> str:
    seconds = int(seconds)
    sign = "-" if seconds < 0 else ""
    seconds = abs(seconds)
    return f"{sign}{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def holidays() -> set[date]:
    return base.bank_holidays()


def period_ok(day: date, period: dict[str, Any], br: dict[str, Any] | None) -> bool:
    if not period.get("start_date") or not period.get("end_date"):
        return False
    if day < period["start_date"] or day > period["end_date"]:
        return False
    has_break, last, returned = base.break_bounds(br)
    if has_break and last and day > last and (not returned or day < returned):
        return False
    return day.weekday() < 5 and day not in holidays()


def anchor_from_parent(row: dict[str, Any]) -> date | None:
    payload = parse_json(row.get("source_payload"))
    rec = payload.get("reconciliation") if isinstance(payload.get("reconciliation"), dict) else {}
    old = payload.get("old_schema") if isinstance(payload.get("old_schema"), dict) else {}
    for value in (
        old.get("activity_date"), rec.get("original_activity_date"),
        row.get("declared_completed_at"), row.get("submitted_at"),
        row.get("feed_occurred_at"), row.get("reporting_started_at"),
    ):
        day = local_date(value)
        if day:
            return day
    month = str(row.get("reporting_month") or "")
    try:
        return date.fromisoformat(month + "-01")
    except ValueError:
        return None


def kind_rank(kind: str) -> int:
    k = str(kind or "").lower()
    return {"reading": 1, "powerpoint": 2, "reading_quiz": 3, "quiz": 4, "audio": 5, "video": 6, "assignment": 7}.get(k, 8)


def load_state(conn) -> dict[str, Any]:
    with conn.cursor() as cur:
        owners = cur.execute('SELECT id,enrolment_id,programme_id,aptem_id,full_name FROM "Learner".learners WHERE aptem_id=ANY(%s)', [base.ROSTER]).fetchall()
        periods = cur.execute('SELECT "ID"::bigint AS aptem_id,"Start-Date" AS start_date,"End-Date" AS end_date FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)', [base.ROSTER]).fetchall()
        entries = cur.execute('''SELECT p.*,l.aptem_id AS owner_aptem_id FROM "Learner".learner_progress_entries p
            JOIN "Learner".learners l ON l.id=p.learner_id
            WHERE l.aptem_id=ANY(%s) AND p.accepted IS TRUE AND p.deleted_at IS NULL AND COALESCE(p.actual_seconds,0)>0''', [base.ROSTER]).fetchall()
        sources = cur.execute('''SELECT s.*,l.aptem_id AS owner_aptem_id FROM "Learner".learner_activity_sources s
            JOIN "Learner".learners l ON l.id=s.learner_id WHERE l.aptem_id=ANY(%s) AND s.deleted_at IS NULL''', [base.ROSTER]).fetchall()
        segments = cur.execute('''SELECT s.* FROM "Learner".learner_activity_reporting_segments s
            JOIN "Learner".learners l ON l.id=s.learner_id WHERE l.aptem_id=ANY(%s) ORDER BY s.progress_id,s.segment_order,s.id''', [base.ROSTER]).fetchall()
        attendance = cur.execute('SELECT * FROM "Learner".source_lms_attendance WHERE aptem_id=ANY(%s)', [base.ROSTER]).fetchall()
        breaks = cur.execute('''SELECT DISTINCT ON (learner_id) learner_id,program_status,"Break in learning" AS break_json,source,fetched_at,id
            FROM fetching_evidence.aptem_cv_contracts_probe WHERE learner_id=ANY(%s) AND source <> 'audit_upload'
            ORDER BY learner_id,fetched_at DESC NULLS LAST,id DESC''', [base.ROSTER]).fetchall()
        aptem = cur.execute('''SELECT learner_id,COALESCE(sum(spent_time),0) * 60 AS seconds
            FROM fetching_evidence.evidence_items WHERE learner_id=ANY(%s)
              AND lower(trim(COALESCE(evidence_status,'')))='accepted' AND COALESCE(spent_time,0)>0
            GROUP BY learner_id''', [base.ROSTER]).fetchall()
        database = cur.execute('SELECT current_database() AS name').fetchone()["name"]
    old_actions = json.loads(REPORT.read_text(encoding="utf-8"))["rows"] if REPORT.exists() else []
    preserve_ids: set[int] = set()
    if REDISTRIBUTION_REPORT.exists():
        try:
            prior = json.loads(REDISTRIBUTION_REPORT.read_text(encoding="utf-8"))
            preserve_ids = {int(item["progress_id"]) for item in prior.get("blockers", []) if item.get("status") in {"NO_CAPACITY_BEFORE_CUTOFF", "PRESERVED_BLOCKED"} and item.get("progress_id")}
        except (OSError, ValueError, TypeError):
            preserve_ids = set()
    return {"database": database, "owners": owners, "periods": periods, "entries": entries, "sources": sources, "segments": segments, "attendance": attendance, "breaks": breaks, "aptem": aptem, "old_actions": old_actions, "preserve_ids": preserve_ids}


def new_candidates(state: dict[str, Any]) -> list[dict[str, Any]]:
    """Select only reviewed positive Old rows not already represented.

    Timestamp-cap rows are included because a global redistribution can fit
    them; boundary/break/duration-conflict rows remain review-only.
    """
    chosen = {"NEW_ESTIMATED", "NEW_LEGITIMATE", "BLOCKED_TIMESTAMP_CAP"}
    items = []
    for item in state["old_actions"]:
        if item.get("status") not in chosen or not item.get("ref"):
            continue
        seconds = int(item.get("actual_seconds") or 0)
        if seconds <= 0:
            continue
        items.append({"new": True, "aptem_id": int(item["aptem_id"]), "month": str(item["month"]), "kind": item.get("kind") or "reading_quiz", "source": item.get("source") or "old_lms", "ref": str(item["ref"]), "title": item.get("title") or f"Recovered Old LMS {item['ref']}", "seconds": seconds, "anchor": local_date(item.get("old_activity_date")), "status": item.get("status")})
    return items


def build_activities(state: dict[str, Any]) -> tuple[dict[int, list[dict[str, Any]]], list[dict[str, Any]]]:
    owners = {int(r["id"]): r for r in state["owners"]}
    out: dict[int, list[dict[str, Any]]] = defaultdict(list)
    blockers: list[dict[str, Any]] = []
    seg_by_progress: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for seg in state["segments"]:
        seg_by_progress[int(seg["progress_id"])].append(seg)
    for row in state["entries"]:
        aid = int(row["owner_aptem_id"])
        seconds = int(row.get("actual_seconds") or 0)
        is_att = str(row.get("kind") or "").lower() == "attendance"
        anchor = anchor_from_parent(row)
        source_ref = str(row.get("source_activity_id") or "")
        preserved = int(row["id"]) in state.get("preserve_ids", set())
        item = {"new": False, "progress_id": int(row["id"]), "learner_id": int(row["learner_id"]), "aptem_id": aid, "month": str(row["reporting_month"]), "kind": row.get("kind"), "source": row.get("source_system"), "ref": source_ref, "source_ref": source_ref if str(row.get("source_system") or "") == "old_lms" else None, "title": row.get("component_title") or "", "seconds": seconds, "anchor": anchor, "segments": seg_by_progress.get(int(row["id"]), []), "row": row, "fixed": is_att or preserved, "preserved_blocker": preserved}
        if is_att:
            # Existing attendance segments are immutable. Date-only attendance
            # remains fixed on its documented date but needs human time review.
            if not item["segments"]:
                blockers.append({"status": "TIME_MISSING", "aptem_id": aid, "progress_id": row["id"], "month": row["reporting_month"], "seconds": seconds, "title": item["title"], "reason": "Attendance has a date/status but no original start/end."})
            out[aid].append(item)
            continue
        if not anchor:
            blockers.append({"status": "DATE_MISSING", "aptem_id": aid, "progress_id": row["id"], "month": row["reporting_month"], "seconds": seconds, "title": item["title"], "reason": "No source/evidence date or existing reporting date."})
            continue
        out[aid].append(item)
    # Add reviewed Old-LMS candidates; identity is rechecked against active SSOT.
    existing_refs = {(int(r["owner_aptem_id"]), str(r.get("source_activity_id") or "")) for r in state["entries"]}
    for item in new_candidates(state):
        source_ref = f"old_lms:{item['source']}:{item['ref']}:{item['month']}"
        if (item["aptem_id"], source_ref) in existing_refs:
            continue
        period = next((p for p in state["periods"] if int(p["aptem_id"]) == item["aptem_id"]), None)
        owner = next((o for o in state["owners"] if int(o["aptem_id"]) == item["aptem_id"]), None)
        # A weekend/holiday is not a boundary failure: the scheduler is
        # required to move it to the nearest legal weekday.  Only a missing
        # date, learner boundary, or Break-in-Learning date blocks it here.
        br = next((b for b in state["breaks"] if int(b["learner_id"]) == int(owner["id"])), None) if owner else None
        has_break, last, returned = base.break_bounds(br)
        in_break = bool(has_break and last and item["anchor"] and item["anchor"] > last and (not returned or item["anchor"] < returned))
        in_bounds = bool(item["anchor"] and period and period.get("start_date") and period.get("end_date") and period["start_date"] <= item["anchor"] <= period["end_date"])
        if not item["anchor"] or not period or not in_bounds or in_break:
            blockers.append({"status": "CANDIDATE_DATE_BLOCKED", **item, "reason": "Reviewed Old date is missing/outside working learner period."})
            continue
        item.update({"source_ref": source_ref, "fixed": False, "segments": [], "learner_id": int(owner["id"]) if owner else None, "candidate": True})
        if owner:
            out[item["aptem_id"]].append(item)
    return out, blockers


def seed_occupancy(items: list[dict[str, Any]]) -> tuple[dict[date, int], dict[date, int], dict[tuple[int, int], int], dict[str, int], set[date], dict[date, datetime]]:
    occupancy: dict[date, int] = defaultdict(int)
    counts: dict[date, int] = defaultdict(int)
    weekly: dict[tuple[int, int], int] = defaultdict(int)
    monthly: dict[str, int] = defaultdict(int)
    lecture: set[date] = set()
    cursor: dict[date, datetime] = {}
    for item in items:
        if not item.get("fixed"):
            continue
        for seg in item.get("segments") or []:
            started = local_dt(seg.get("reporting_started_at"))
            ended = local_dt(seg.get("reporting_ended_at"))
            if not started or not ended:
                continue
            day = started.astimezone(UK).date()
            sec = int(seg.get("actual_seconds") or 0)
            occupancy[day] += sec; counts[day] += 1
            iso = day.isocalendar(); weekly[(iso.year, iso.week)] += sec; monthly[day.strftime("%Y-%m")] += sec
            if item.get("kind") == "attendance":
                lecture.add(day)
            cursor[day] = max(cursor.get(day, started), ended)
    return occupancy, counts, weekly, monthly, lecture, cursor


def split_to_count(segments: list[dict[str, Any]], required: int) -> list[dict[str, Any]]:
    if len(segments) >= required:
        return segments
    while len(segments) < required:
        idx = max(range(len(segments)), key=lambda i: segments[i]["seconds"])
        current = segments[idx]
        if current["seconds"] < 2:
            break
        left = current["seconds"] // 2
        right = current["seconds"] - left
        start = datetime.fromisoformat(current["start"])
        middle = start + timedelta(seconds=left)
        segments[idx:idx + 1] = [{**current, "end": middle.isoformat(), "seconds": left}, {**current, "start": middle.isoformat(), "seconds": right}]
    return segments


def allocate(item: dict[str, Any], period: dict[str, Any], br: dict[str, Any] | None, occupancy: dict[date, int], counts: dict[date, int], weekly: dict[tuple[int, int], int], monthly: dict[str, int], lecture: set[date], cursor: dict[date, datetime], fingerprint: str) -> list[dict[str, Any]] | None:
    anchor = item.get("anchor")
    if not anchor:
        return None
    remaining = int(item["seconds"])
    result: list[dict[str, Any]] = []
    # First pass honours 12h weeks; second pass relaxes only that rule.
    for relaxed in (False, True):
        if result:
            break
        cursor_before: dict[date, datetime | None] = {}
        day = anchor
        while remaining > 0 and day <= period["end_date"]:
            if period_ok(day, period, br) and day not in lecture:
                month = day.strftime("%Y-%m")
                iso = day.isocalendar(); wk = (iso.year, iso.week)
                day_used = occupancy.get(day, 0)
                month_used = monthly.get(month, 0)
                week_used = weekly.get(wk, 0)
                if counts.get(day, 0) < 8 and day_used < DAILY and month_used < MONTHLY and (relaxed or week_used < WEEKLY):
                    seed = int(hashlib.sha1(f"{fingerprint}:{day.isoformat()}".encode()).hexdigest()[:8], 16)
                    gap = 180 + (seed % 901)
                    offset = 300 + (seed % 541)
                    base_time = time(9, 0)
                    start = datetime.combine(day, base_time, tzinfo=UK) + timedelta(seconds=offset)
                    # Use a per-learner day cursor, so separate activities
                    # cannot overlap even when the fixed attendance interval
                    # has a gap or starts later than 09:00.
                    if day in cursor:
                        start = max(start, cursor[day] + timedelta(seconds=gap))
                    available = min(DAILY - day_used, MONTHLY - month_used)
                    if not relaxed:
                        available = min(available, WEEKLY - week_used)
                    available = min(available, int((datetime.combine(day, time(17, 0), tzinfo=UK) - start).total_seconds()))
                    if available > 0:
                        take = min(remaining, available)
                        end = start + timedelta(seconds=take)
                        cursor_before.setdefault(day, cursor.get(day))
                        result.append({"start": start.isoformat(), "end": end.isoformat(), "month": month, "seconds": take})
                        remaining -= take; occupancy[day] = day_used + take; counts[day] = counts.get(day, 0) + 1
                        weekly[wk] = week_used + take; monthly[month] = month_used + take
                        cursor[day] = end
            day += timedelta(days=1)
        if remaining == 0:
            break
        # Roll back allocations from a failed first pass before relaxed retry.
        for seg in result:
            d = local_date(seg["start"]); iso = d.isocalendar(); month = seg["month"]
            occupancy[d] -= seg["seconds"]; counts[d] -= 1; weekly[(iso.year, iso.week)] -= seg["seconds"]; monthly[month] -= seg["seconds"]
            cursor[d] = cursor_before.get(d) if cursor_before.get(d) is not None else cursor.pop(d, None)
        result = []; remaining = int(item["seconds"])
    if remaining:
        return None
    return result


def _build_plan_once(state: dict[str, Any]) -> dict[str, Any]:
    activities, blockers = build_activities(state)
    periods = {int(r["aptem_id"]): r for r in state["periods"]}
    breaks = {int(r["learner_id"]): r for r in state["breaks"]}
    all_rows: list[dict[str, Any]] = []
    for aid, items in activities.items():
        occupancy, counts, weekly, monthly, lecture, cursor = seed_occupancy(items)
        period = periods.get(aid)
        owner = next((o for o in state["owners"] if int(o["aptem_id"]) == aid), None)
        br = breaks.get(int(owner["id"])) if owner else None
        for preserved in (x for x in items if x.get("preserved_blocker")):
            blockers.append({"status": "PRESERVED_BLOCKED", "aptem_id": aid, "progress_id": preserved.get("progress_id"), "ref": preserved.get("ref"), "seconds": preserved["seconds"], "anchor": str(preserved.get("anchor")), "reason": "Prior run had no legal capacity before cutoff; current timestamps preserved to avoid inventing hours/date."})
        ordered = sorted((x for x in items if not x.get("fixed")), key=lambda x: (x.get("anchor") or date.max, kind_rank(x.get("kind")), int(x.get("progress_id") or 0), str(x.get("ref") or "")))
        for item in ordered:
            if not period:
                blockers.append({"status": "BOUNDARY_UNKNOWN", "aptem_id": aid, "progress_id": item.get("progress_id"), "ref": item.get("ref"), "seconds": item["seconds"], "reason": "Learner Start/End missing."})
                continue
            # Do not schedule before the evidence/source date.
            if item.get("anchor") < period["start_date"]:
                item["anchor"] = period["start_date"]
            fp = f"{aid}:{item.get('progress_id') or item.get('source_ref')}:{item['seconds']}"
            segments = allocate(item, period, br, occupancy, counts, weekly, monthly, lecture, cursor, fp)
            if not segments:
                blockers.append({"status": "NO_CAPACITY_BEFORE_CUTOFF", "aptem_id": aid, "progress_id": item.get("progress_id"), "ref": item.get("ref"), "seconds": item["seconds"], "anchor": str(item.get("anchor")), "reason": "No legal weekday capacity before learner End-Date under daily/monthly caps."})
                continue
            required = len(item.get("segments") or []) if item.get("progress_id") else 0
            segments = split_to_count(segments, required) if required else segments
            if len(segments) < required:
                blockers.append({"status": "SEGMENT_COUNT_UNRESOLVED", "aptem_id": aid, "progress_id": item.get("progress_id"), "seconds": item["seconds"], "reason": "Existing segment rows cannot be preserved without deleting or zero-duration segments."})
                continue
            item["new_segments"] = segments
            all_rows.append(item)
    summary = defaultdict(lambda: {"rows": 0, "seconds": 0})
    for b in blockers:
        summary[b["status"]]["rows"] += 1; summary[b["status"]]["seconds"] += int(b.get("seconds") or 0)
    for item in all_rows:
        summary["READY"]["rows"] += 1; summary["READY"]["seconds"] += int(item["seconds"])
    current_seconds = sum(int(row.get("actual_seconds") or 0) for row in state["entries"])
    added_seconds = sum(int(item["seconds"]) for item in all_rows if item.get("new"))
    aptem_seconds = sum(int(row.get("seconds") or 0) for row in state.get("aptem", []))
    preserved_attendance = [item for items in activities.values() for item in items if item.get("fixed") and item.get("segments")]
    summary["PRESERVED_ATTENDANCE_WITH_TIME"]["rows"] = len(preserved_attendance)
    summary["PRESERVED_ATTENDANCE_WITH_TIME"]["seconds"] = sum(int(item["seconds"]) for item in preserved_attendance)
    plan = {"database": state["database"], "scope": base.ROSTER, "prompt_version": PROMPT_VERSION, "summary": dict(summary), "blockers": blockers, "activities": all_rows, "candidate_count": len(new_candidates(state)), "totals": {"ssot_before_seconds": current_seconds, "old_lms_added_seconds": added_seconds, "ssot_after_seconds": current_seconds + added_seconds, "aptem_seconds": aptem_seconds, "after_minus_aptem_seconds": current_seconds + added_seconds - aptem_seconds}}
    plan["fingerprint"] = digest({"database": plan["database"], "scope": plan["scope"], "summary": plan["summary"], "activities": [{"aptem_id": a["aptem_id"], "identity": a.get("source_ref") or a.get("progress_id"), "seconds": a["seconds"], "segments": a.get("new_segments", [])} for a in all_rows]})
    return plan


def build_plan(state: dict[str, Any]) -> dict[str, Any]:
    """Reach a fixed point when a late-cutoff row cannot fit.

    Such a row is preserved as a documented blocker and becomes occupancy for
    the next pass.  This prevents a sequence of one-new-blocker-per-run
    reports and, more importantly, prevents ready rows from overlapping it.
    """
    for _ in range(512):
        plan = _build_plan_once(state)
        new_blocked = {
            int(item["progress_id"])
            for item in plan["blockers"]
            if item.get("status") == "NO_CAPACITY_BEFORE_CUTOFF" and item.get("progress_id")
        } - set(state.get("preserve_ids", set()))
        if not new_blocked:
            return plan
        state.setdefault("preserve_ids", set()).update(new_blocked)
    return plan


def serialise(plan: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for a in plan["activities"]:
        rows.append({"aptem_id": a["aptem_id"], "progress_id": a.get("progress_id"), "new": bool(a.get("new")), "source_ref": a.get("source_ref") or a.get("ref"), "month_before": a.get("month"), "kind": a.get("kind"), "title": a.get("title"), "seconds": a["seconds"], "hours": fmt(a["seconds"]), "anchor": str(a.get("anchor")), "segments": a.get("new_segments", [])})
    return {"fingerprint": plan["fingerprint"], "database": plan["database"], "summary": plan["summary"], "candidate_count": plan["candidate_count"], "totals": plan["totals"], "blockers": plan["blockers"], "rows": rows}


def write_report(plan: dict[str, Any], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(serialise(plan), default=str, ensure_ascii=False, indent=2), encoding="utf-8")
    md = output.with_suffix(".md")
    lines = ["# Activity timestamp redistribution — 54 learners", "", f"Database: `{plan['database']}`", "Mode: read-only dry run", f"Fingerprint: `{plan['fingerprint']}`", "", "## Summary", "", "| Status | Rows | Hours |", "|---|---:|---:|"]
    for key, value in sorted(plan["summary"].items()):
        lines.append(f"| `{key}` | {value['rows']} | {fmt(value['seconds'])} |")
    totals = plan["totals"]
    lines += ["", "## Totals", "", f"- SSOT Accepted before: **{fmt(totals['ssot_before_seconds'])}**", f"- Old LMS proposed addition: **{fmt(totals['old_lms_added_seconds'])}**", f"- SSOT Accepted after: **{fmt(totals['ssot_after_seconds'])}**", f"- Aptem accepted benchmark: **{fmt(totals['aptem_seconds'])}**", f"- After minus Aptem: **{fmt(totals['after_minus_aptem_seconds'])}**", "", f"Reviewed Old-LMS candidates considered: **{plan['candidate_count']}**", f"Blockers: **{len(plan['blockers'])}**", "", "## Rules", "", "- Attendance rows and Attendance source tables were not changed.", "- Old Schema and Aptem mirror are read-only.", "- No hard delete: existing segment rows are updated or retained; new rows are inserted only when needed.", "- Every scheduled interval equals actual_seconds exactly.", "- Daily 8h/8 activities, monthly 45h, weekday/holiday/lecture/break/cutoff checks applied.", "- Date-only Attendance is `TIME_MISSING`, not fabricated.", "", "## First blockers", ""]
    for blocker in plan["blockers"][:100]:
        lines.append(f"- `{blocker.get('status')}` learner `{blocker.get('aptem_id')}` progress `{blocker.get('progress_id','')}` ref `{blocker.get('ref','')}` — {blocker.get('reason','')}")
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql
    stmt = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return int(cur.execute(stmt, list(values.values())).fetchone()["id"])


def apply_plan(plan: dict[str, Any], conn, allow_partial: bool = False) -> dict[str, Any]:
    if plan["blockers"] and not allow_partial:
        raise RuntimeError(f"Refusing write: {len(plan['blockers'])} unresolved blockers remain.")
    state = load_state(conn)
    check = build_plan(state)
    if check["fingerprint"] != plan["fingerprint"]:
        raise RuntimeError("Live state changed since dry run; fingerprint mismatch.")
    owners = {int(x["aptem_id"]): x for x in state["owners"]}
    by_progress = {int(x["progress_id"]): x for x in plan["activities"] if x.get("progress_id")}
    by_owner = defaultdict(list)
    for item in plan["activities"]:
        by_owner[int(item["aptem_id"])].append(item)
    touched = 0
    with conn.cursor() as cur:
        cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", [RUN_KIND])
        for aid in sorted(by_owner):
            owner = owners[aid]; owner_id = int(owner["id"])
            months = sorted({seg["month"] for item in by_owner[aid] for seg in item["new_segments"]})
            for month in months:
                rows = cur.execute('''SELECT p.id,p.learner_id,p.reporting_month,p.source_system,p.source_activity_id,p.actual_seconds,p.source_payload,
                    p.reporting_started_at,p.reporting_ended_at FROM "Learner".learner_progress_entries p
                    WHERE p.learner_id=%s AND p.reporting_month=%s AND p.accepted IS TRUE AND p.deleted_at IS NULL''', [owner_id, month]).fetchall()
                # Restore-point JSON must retain values exactly while still
                # being serialisable (psycopg returns datetime/Decimal).
                snapshot = json.loads(json.dumps({"progress": [dict(r) for r in rows]}, default=str))
                source_ref = f"{RUN_KIND}:{aid}:{month}:{plan['fingerprint']}"
                if not cur.execute('SELECT 1 FROM "Learner".learner_month_restore_points WHERE source_system=%s AND source_ref=%s', [RUN_KIND, source_ref]).fetchone():
                    now = datetime.now(UK)
                    insert_row(cur, "learner_month_restore_points", {"learner_id": owner_id, "report_month": month, "point_kind": "before_timestamp_redistribution", "snapshot_hash": digest(snapshot), "snapshot": Jsonb(snapshot), "row_count": len(rows), "document_count": 0, "actor": ACTOR, "reason": "Approved 54-learner Activity Hours & Timestamp Recovery Prompt", "source_system": RUN_KIND, "source_ref": source_ref, "created_at": now, "imported_at": now})
            run_id = insert_row(cur, "activity_sync_runs", {"run_key": f"{RUN_KIND}:{aid}:{plan['fingerprint']}", "run_kind": RUN_KIND, "status": "running", "dry_run": False, "prompt_version": PROMPT_VERSION, "source_counts": Jsonb({"aptem_id": aid, "activities": len(by_owner[aid])}), "result_counts": Jsonb({}), "prompt_model": "codex", "error_summary": ""})
            order = int(cur.execute('SELECT COALESCE(MAX(entry_order),0) n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner_id]).fetchone()["n"])
            for item in by_owner[aid]:
                segs = item["new_segments"]
                first = datetime.fromisoformat(segs[0]["start"]); last = datetime.fromisoformat(segs[-1]["end"])
                progress_id = item.get("progress_id")
                before = None
                if progress_id:
                    before = cur.execute('SELECT to_jsonb(p) AS payload FROM "Learner".learner_progress_entries p WHERE p.id=%s FOR UPDATE', [progress_id]).fetchone()["payload"]
                    cur.execute('UPDATE "Learner".learner_progress_entries SET reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,reporting_timestamp_label=%s,source_payload=%s,sync_run_id=%s,ssot_updated_at=now() WHERE id=%s', [first, last, segs[0]["month"], "Scheduled", Jsonb({**parse_json(before.get("source_payload") if isinstance(before, dict) else {}), "reconciliation": {"prompt_version": PROMPT_VERSION, "redistributed": True, "original_reporting_month": item.get("month"), "original_activity_date": str(item.get("anchor")), "reporting_allocation": {"method": "deterministic-capacity-scheduler", "segments": segs}}}), run_id, progress_id])
                else:
                    order += 1
                    old = item
                    source_ref = item["source_ref"]
                    canonical = f"old_lms:{aid}:{old['source']}:{old['ref']}:{old['month']}"
                    payload = {"old_schema": {"aptem_id": aid, "month": old["month"], "kind": old["kind"], "source": old["source"], "ref": old["ref"], "activity_date": str(old.get("anchor")), "actual_seconds": old["seconds"]}, "reconciliation": {"prompt_version": PROMPT_VERSION, "redistributed": True, "original_activity_date": str(old.get("anchor")), "reporting_allocation": {"method": "deterministic-capacity-scheduler", "segments": segs}}}
                    progress_id = insert_row(cur, "learner_progress_entries", {"learner_id": owner_id, "entry_order": order, "kind": str(old["kind"] or "reading_quiz")[:30], "module_title": "", "week_title": "", "component_title": str(old["title"] or f"Recovered Old LMS {old['ref']}")[:500], "component_type": "old_lms_recovered", "feedback": "", "reported_time": "", "time_taken": "", "feed_kind": "", "feed_action": "", "feed_title": "", "feed_detail": "", "programme_title": "", "cohort_title": "", "group_title": "", "time_tracking_source": "", "time_tracking_calculation": "", "time_tracking_session_ref": "", "outside_working_hours": False, "outside_working_hours_confirmed": False, "reflection_skipped": False, "inside_working_hours_confirmed": True, "submission_validation_reason": "old_lms_recovery_timestamp", "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "old_lms", "source_activity_id": source_ref, "source_attempt_key": source_ref, "canonical_activity_key": canonical, "activity_status": "Completed", "accepted": True, "actual_seconds": old["seconds"], "actual_basis": "old_lms:verified-source-hours", "reporting_started_at": first, "reporting_ended_at": last, "reporting_month": segs[0]["month"], "reporting_timestamp_label": "Scheduled", "source_payload": Jsonb(payload), "sync_run_id": run_id})
                    insert_row(cur, "learner_activity_sources", {"learner_id": owner_id, "enrolment_id": owner.get("enrolment_id"), "programme_id": owner.get("programme_id"), "aptem_id": aid, "source_system": "old_lms", "source_activity_id": source_ref, "source_attempt_key": source_ref, "canonical_activity_key": canonical, "activity_type": str(old["kind"] or "reading_quiz"), "title": str(old["title"] or f"Recovered Old LMS {old['ref']}")[:500], "activity_status": "Completed", "completed": True, "accepted": True, "actual_seconds": old["seconds"], "actual_basis": "old_lms:verified-source-hours", "source_started_at": first, "source_ended_at": last, "reporting_started_at": first, "reporting_ended_at": last, "reporting_month": segs[0]["month"], "source_payload": Jsonb(payload), "sync_run_id": run_id, "canonical_progress_id": progress_id, "source_fingerprint": digest(payload), "source_course_ref": ""})
                existing = cur.execute('SELECT id FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s ORDER BY segment_order,id FOR UPDATE', [progress_id]).fetchall()
                for idx, seg in enumerate(segs, 1):
                    vals = [progress_id, owner_id, idx, seg["seconds"], datetime.fromisoformat(seg["start"]), datetime.fromisoformat(seg["end"]), seg["month"], run_id]
                    if idx <= len(existing):
                        cur.execute('UPDATE "Learner".learner_activity_reporting_segments SET segment_order=%s,actual_seconds=%s,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,sync_run_id=%s,updated_at=now() WHERE id=%s', [idx, seg["seconds"], vals[4], vals[5], seg["month"], run_id, existing[idx - 1]["id"]])
                    else:
                        insert_row(cur, "learner_activity_reporting_segments", {"progress_id": progress_id, "learner_id": owner_id, "segment_order": idx, "actual_seconds": seg["seconds"], "reporting_started_at": vals[4], "reporting_ended_at": vals[5], "reporting_month": seg["month"], "sync_run_id": run_id})
                after = cur.execute('SELECT to_jsonb(p) AS payload FROM "Learner".learner_progress_entries p WHERE p.id=%s', [progress_id]).fetchone()["payload"]
                rev_ref = f"{RUN_KIND}:{progress_id}:{plan['fingerprint']}"
                if not cur.execute('SELECT 1 FROM "Learner".learner_activity_revisions WHERE source_system=%s AND source_ref=%s AND change_kind=%s', [RUN_KIND, rev_ref, "timestamp_redistribution"]).fetchone():
                    now = datetime.now(UK)
                    insert_row(cur, "learner_activity_revisions", {"learner_id": owner_id, "progress_id": progress_id, "report_month": segs[0]["month"], "source_system": RUN_KIND, "source_ref": rev_ref, "change_kind": "timestamp_redistribution", "before_snapshot": Jsonb(before or {}), "after_snapshot": Jsonb(after or {}), "actor": ACTOR, "changed_at": now, "imported_at": now})
                touched += 1
            cur.execute('UPDATE "Learner".activity_sync_runs SET status=%s,finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s', ["completed", Jsonb({"touched": touched, "fingerprint": plan["fingerprint"]}), run_id])
            # Keep the recovery restartable at learner granularity.  A later
            # learner failure must not roll back completed learners.
            conn.commit()
            print(json.dumps({"progress": "learner_committed", "aptem_id": aid, "touched": len(by_owner[aid])}, ensure_ascii=False), flush=True)
        conn.commit()
    return {"touched": touched, "fingerprint": plan["fingerprint"], "database": plan["database"], "blocked_preserved": len(plan["blockers"]), "partial": bool(plan["blockers"])}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--apply-ready", action="store_true", help="Apply only READY rows and preserve unresolved blockers")
    parser.add_argument("--fingerprint")
    parser.add_argument("--database")
    parser.add_argument("--output", default=str(Path(__file__).resolve().parents[1] / "reports" / "activity_timestamp_redistribution_54_2026-10-04.json"))
    args = parser.parse_args()
    with psycopg.connect(base.database_url(), connect_timeout=20, row_factory=dict_row) as conn:
        state = load_state(conn)
        plan = build_plan(state)
        if args.apply or args.apply_ready:
            if args.database != plan["database"] or args.fingerprint != plan["fingerprint"]:
                raise SystemExit("Database/fingerprint gate failed; regenerate and review the dry run.")
            print(json.dumps(apply_plan(plan, conn, allow_partial=args.apply_ready), ensure_ascii=False, indent=2, default=str))
        else:
            output = Path(args.output); write_report(plan, output)
            print(json.dumps({"database": plan["database"], "fingerprint": plan["fingerprint"], "summary": plan["summary"], "totals": plan["totals"], "blockers": len(plan["blockers"]), "candidate_count": plan["candidate_count"], "json": str(output), "markdown": str(output.with_suffix('.md'))}, ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
