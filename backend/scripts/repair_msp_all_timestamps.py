"""Create a reviewed, estimated calendar allocation for the exact MSP roster.

The evidence reconciler intentionally keeps a canonical progress row.  This
script adds reporting segments only for accepted rows in the reviewed 26-ID
MSP roster which do not already have segments.  Source hours and source
timestamps are never overwritten.  Every inserted allocation is explicitly
marked ``estimated`` and ``approval_required`` so it is visible in Monthly
Logs but is not counted as authoritative actual time until reviewed.

Default mode is a read-only preview.  Applying a preview requires the
database name and fingerprint printed by that preview.
"""
from __future__ import annotations

import argparse
import calendar
from collections import defaultdict
from datetime import date, datetime, time, timedelta
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


UK = ZoneInfo("Europe/London")
DAILY_SECONDS = 8 * 60 * 60
WEEKLY_SECONDS = 12 * 60 * 60
MONTHLY_SECONDS = 45 * 60 * 60
ROSTER = [
    6254, 6310, 6329, 6425, 6436, 6473, 6498, 6524, 6536, 6563,
    6703, 6732, 6753, 7217, 7495, 7796, 8162, 8170, 8580, 8635,
    8903, 9314, 9862, 9866, 9918, 10071,
]
RUN_KIND = "msp-all-timestamp-repair"
PROMPT_VERSION = "msp-timestamp-repair-v2"


def env_values() -> dict[str, str]:
    values = dict(os.environ)
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def local_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            return value.astimezone(UK).date()
        return value.date()
    if isinstance(value, date):
        return value
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return local_date(parsed)
    except (TypeError, ValueError):
        return None


def parse_anchor(text: str) -> date | None:
    text = str(text or "")
    for match in re.finditer(r"(?<!\d)(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?!\d)", text):
        year = int(match.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, int(match.group(2)), int(match.group(1)))
        except ValueError:
            continue
    for match in re.finditer(r"(?<!\d)(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})(?!\d)", text):
        month_name = match.group(2).lower()
        month = next((index for index in range(1, 13)
                      if calendar.month_name[index].lower().startswith(month_name[:3])), None)
        if month:
            try:
                return date(int(match.group(3)), month, int(match.group(1)))
            except ValueError:
                pass
    return None


def week_key(day: date) -> tuple[int, int]:
    iso = day.isocalendar()
    return iso.year, iso.week


def periods_from_payload(payload: Any) -> set[date]:
    if not isinstance(payload, dict):
        return set()
    reconciliation = payload.get("reconciliation")
    if not isinstance(reconciliation, dict):
        return set()
    evidence = reconciliation.get("break_evidence")
    periods = evidence.get("periods") if isinstance(evidence, dict) else []
    closed: set[date] = set()
    for item in periods if isinstance(periods, list) else []:
        if not isinstance(item, dict):
            continue
        try:
            start = date.fromisoformat(str(item.get("start")))
            end = date.fromisoformat(str(item.get("end") or item.get("start")))
        except (TypeError, ValueError):
            continue
        while start <= end:
            closed.add(start)
            start += timedelta(days=1)
    return closed


def plan(cur) -> dict[str, Any]:
    cur.execute(
        '''SELECT l.id AS learner_id, a."ID" AS aptem_id,
                  COALESCE(a."Start-Date"::date, l.start_date) AS start_date,
                  COALESCE(a."End-Date"::date, l.end_date) AS end_date
             FROM "Learner".learners l
             JOIN "LMS"."Aptem_users" a ON a."ID" = l.aptem_id
            WHERE a."ID" = ANY(%s)''',
        [ROSTER],
    )
    owners = {row["learner_id"]: row for row in cur.fetchall()}
    missing = sorted(set(ROSTER) - {row["aptem_id"] for row in owners.values()})
    if missing:
        raise ValueError(f"Roster learners are missing from the consolidated identity: {missing}")

    cur.execute(
        '''SELECT holiday_date FROM curriculum.england_holidays
           WHERE holiday_date BETWEEN '2026-01-01' AND '2028-12-31'
           UNION
           SELECT holiday_date FROM curriculum.source_lms_bank_holidays
           WHERE holiday_date BETWEEN '2026-01-01' AND '2028-12-31' ''',
    )
    holidays = {row["holiday_date"] for row in cur.fetchall()}

    learner_ids = list(owners)
    cur.execute(
        '''SELECT s.*, p.source_payload, p.source_system
             FROM "Learner".learner_activity_reporting_segments s
             JOIN "Learner".learner_progress_entries p ON p.id = s.progress_id
            WHERE p.accepted IS TRUE AND p.deleted_at IS NULL
              AND s.learner_id = ANY(%s)''',
        [learner_ids],
    )
    existing_segments = cur.fetchall()
    cur.execute(
        '''SELECT p.*
             FROM "Learner".learner_progress_entries p
            WHERE p.accepted IS TRUE AND p.deleted_at IS NULL
              AND p.actual_seconds > 0
              AND p.learner_id = ANY(%s)
              AND NOT EXISTS (
                    SELECT 1 FROM "Learner".learner_activity_reporting_segments s
                    WHERE s.progress_id = p.id
              )
            ORDER BY p.learner_id, p.reporting_started_at NULLS LAST,
                     p.entry_order NULLS LAST, p.id''',
        [learner_ids],
    )
    candidates = cur.fetchall()

    daily: dict[tuple[int, date], int] = defaultdict(int)
    weekly: dict[tuple[int, tuple[int, int]], int] = defaultdict(int)
    monthly: dict[tuple[int, str], int] = defaultdict(int)
    intervals: dict[tuple[int, date], list[tuple[datetime, datetime]]] = defaultdict(list)
    for segment in existing_segments:
        day = local_date(segment["reporting_started_at"])
        if day is None:
            continue
        seconds = int(segment["actual_seconds"] or 0)
        learner_id = int(segment["learner_id"])
        daily[(learner_id, day)] += seconds
        weekly[(learner_id, week_key(day))] += seconds
        monthly[(learner_id, day.strftime("%Y-%m"))] += seconds
        start = segment["reporting_started_at"].astimezone(UK)
        end = segment["reporting_ended_at"].astimezone(UK)
        intervals[(learner_id, day)].append((start, end))

    plans: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    by_learner = defaultdict(list)
    for row in candidates:
        by_learner[int(row["learner_id"])].append(row)

    for learner_id, rows in by_learner.items():
        owner = owners[learner_id]
        start_date = owner["start_date"] or date(2026, 1, 1)
        end_date = owner["end_date"] or date(2028, 12, 31)
        closed_dates: set[date] = set()
        for row in rows:
            closed_dates.update(periods_from_payload(row.get("source_payload")))
        valid_days = []
        day = start_date
        while day <= end_date:
            if day.weekday() < 5 and day not in holidays and day not in closed_dates:
                valid_days.append(day)
            day += timedelta(days=1)

        def row_anchor(row: dict[str, Any]) -> tuple[date, str]:
            original = local_date(row.get("reporting_started_at"))
            if original:
                return original, "source_reporting_timestamp"
            title = " ".join(str(row.get(key) or "") for key in ("component_title", "feed_title", "feed_detail"))
            parsed = parse_anchor(title)
            if parsed:
                return parsed, "activity_title_date"
            try:
                return date.fromisoformat(f"{row['reporting_month']}-01"), "reporting_month_index"
            except (TypeError, ValueError):
                return start_date, "programme_start_fallback"

        rows.sort(key=lambda row: (*row_anchor(row), int(row["entry_order"] or 0), int(row["id"])))
        for row in rows:
            anchor, anchor_method = row_anchor(row)
            remaining = int(row["actual_seconds"] or 0)
            segments: list[dict[str, Any]] = []
            for target_day in sorted(valid_days, key=lambda value: (abs((value - anchor).days), value)):
                if remaining <= 0:
                    break
                learner_day = (learner_id, target_day)
                available = min(
                    DAILY_SECONDS - daily[learner_day],
                    WEEKLY_SECONDS - weekly[(learner_id, week_key(target_day))],
                    MONTHLY_SECONDS - monthly[(learner_id, target_day.strftime("%Y-%m"))],
                )
                if available <= 0:
                    continue
                seconds = min(remaining, available)
                start_local = datetime.combine(target_day, time(9, 0), tzinfo=UK)
                cursor = start_local
                for existing_start, existing_end in sorted(intervals[learner_day]):
                    if existing_end <= cursor:
                        continue
                    if existing_start - cursor >= timedelta(seconds=seconds):
                        break
                    cursor = max(cursor, existing_end)
                end_local = cursor + timedelta(seconds=seconds)
                segments.append({
                    "seconds": seconds,
                    "start": cursor.isoformat(),
                    "end": end_local.isoformat(),
                    "month": target_day.strftime("%Y-%m"),
                    "date": target_day.isoformat(),
                })
                intervals[learner_day].append((cursor, end_local))
                intervals[learner_day].sort(key=lambda item: item[0])
                daily[learner_day] += seconds
                weekly[(learner_id, week_key(target_day))] += seconds
                monthly[(learner_id, target_day.strftime("%Y-%m"))] += seconds
                remaining -= seconds

            if remaining:
                unresolved.append({"progress_id": row["id"], "remaining_seconds": remaining,
                                   "aptem_id": owner["aptem_id"]})
                continue
            payload = row.get("source_payload") or {}
            reconciliation = payload.get("reconciliation") if isinstance(payload, dict) else {}
            reconciliation = reconciliation if isinstance(reconciliation, dict) else {}
            plans.append({
                "progress_id": int(row["id"]),
                "learner_id": learner_id,
                "aptem_id": int(owner["aptem_id"]),
                "source_system": row.get("source_system"),
                "source_date": row.get("reporting_started_at"),
                "source_month": row.get("reporting_month"),
                "anchor_method": anchor_method,
                "segments": segments,
                "source_evidence_id": reconciliation.get("source_evidence_id"),
            })

    report = {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "roster": ROSTER,
        "candidate_progress_count": len(candidates),
        "candidate_seconds": sum(int(row["actual_seconds"] or 0) for row in candidates),
        "existing_segment_count": len(existing_segments),
        "planned_progress_count": len(plans),
        "planned_segment_count": sum(len(item["segments"]) for item in plans),
        "planned_seconds": sum(sum(int(part["seconds"]) for part in item["segments"]) for item in plans),
        "unresolved": unresolved,
        "holidays_loaded": len(holidays),
        "plans": plans,
    }
    report["fingerprint"] = digest({key: value for key, value in report.items() if key != "fingerprint"})
    return report


def apply(cur, report: dict[str, Any], expected_database: str, expected_fingerprint: str) -> int:
    if report["database"] != expected_database:
        raise ValueError("Database differs from the reviewed preview.")
    if report["fingerprint"] != expected_fingerprint:
        raise ValueError("Data or preview changed; run the read-only preview again.")
    if report["unresolved"]:
        raise ValueError("The preview has unresolved progress rows; no write was attempted.")
    plans = report["plans"]
    run = cur.execute(
        '''INSERT INTO "Learner".activity_sync_runs
           (run_key,run_kind,status,dry_run,prompt_version,source_counts,result_counts)
           VALUES (%s,%s,'running',false,%s,%s,%s) RETURNING id''',
        [
            f"msp-all-timestamp-repair:{expected_fingerprint}", RUN_KIND, PROMPT_VERSION,
            Jsonb({"roster": ROSTER, "candidate_progress": len(plans)}),
            Jsonb({"planned_progress": len(plans), "planned_segments": report["planned_segment_count"],
                   "estimated": True}),
        ],
    ).fetchone()["id"]
    for item in plans:
        progress = cur.execute(
            '''SELECT id,learner_id,actual_seconds,source_payload
                 FROM "Learner".learner_progress_entries
                WHERE id=%s AND deleted_at IS NULL FOR UPDATE''',
            [item["progress_id"]],
        ).fetchone()
        if not progress or int(progress["learner_id"]) != item["learner_id"]:
            raise ValueError("Progress row changed or ownership no longer matches.")
        if cur.execute(
            'SELECT 1 FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s LIMIT 1',
            [item["progress_id"]],
        ).fetchone():
            raise ValueError(f"Progress row {item['progress_id']} already has segments.")
        if sum(int(part["seconds"]) for part in item["segments"]) != int(progress["actual_seconds"] or 0):
            raise ValueError(f"Segment total does not equal source hours for {item['progress_id']}.")
        for order, segment in enumerate(item["segments"], 1):
            cur.execute(
                '''INSERT INTO "Learner".learner_activity_reporting_segments
                   (progress_id,learner_id,segment_order,actual_seconds,
                    reporting_started_at,reporting_ended_at,reporting_month,sync_run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                [item["progress_id"], item["learner_id"], order, segment["seconds"],
                 datetime.fromisoformat(segment["start"]), datetime.fromisoformat(segment["end"]),
                 segment["month"], run],
            )
        payload = dict(progress["source_payload"] or {})
        reconciliation = dict(payload.get("reconciliation") or {})
        reconciliation["reporting_allocation"] = {
            "method": "nearest_valid_weekday_index_capacity_v2",
            "estimated": True,
            "approval_required": True,
            "source_system": item["source_system"],
            "source_evidence_id": item["source_evidence_id"],
            "original_reporting_date": item["source_date"].isoformat() if item["source_date"] else None,
            "original_reporting_month": item["source_month"],
            "anchor_method": item["anchor_method"],
            "index_rule": "source timestamp, then activity-title date, then reporting-month/index",
            "calendar_rule": "Europe/London weekdays excluding bank holidays; 8h/day, 12h/week, 45h/month",
            "segments": item["segments"],
            "segment_total_seconds": sum(int(part["seconds"]) for part in item["segments"]),
            "source_duration_seconds": int(progress["actual_seconds"] or 0),
        }
        payload["reconciliation"] = reconciliation
        cur.execute(
            '''UPDATE "Learner".learner_progress_entries
                  SET source_payload=%s,ssot_updated_at=now() WHERE id=%s''',
            [Jsonb(payload), item["progress_id"]],
        )
    cur.execute(
        '''UPDATE "Learner".activity_sync_runs
              SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s
            WHERE id=%s''',
        [Jsonb({"planned_progress": len(plans), "created_segments": report["planned_segment_count"],
                "estimated": True}), run],
    )
    return int(run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    values = env_values()
    database_url = values.get("Database_url") or values.get("DATABASE_URL")
    if not database_url:
        raise ValueError("No configured database URL.")
    with psycopg.connect(database_url, connect_timeout=20, row_factory=dict_row) as connection:
        connection.read_only = not args.apply
        with connection.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=120000")
            report = plan(cur)
            if args.apply:
                run_id = apply(cur, report, args.expected_database, args.expected_fingerprint)
                print(json.dumps({"database": report["database"], "run_id": run_id,
                                  "applied_progress": report["planned_progress_count"],
                                  "created_segments": report["planned_segment_count"]}, default=str))
            elif args.summary:
                print(json.dumps({key: report[key] for key in (
                    "database", "candidate_progress_count", "candidate_seconds",
                    "existing_segment_count", "planned_progress_count", "planned_segment_count",
                    "planned_seconds", "unresolved", "holidays_loaded", "fingerprint")}, default=str))
            else:
                print(json.dumps(report, default=str))


if __name__ == "__main__":
    main()
