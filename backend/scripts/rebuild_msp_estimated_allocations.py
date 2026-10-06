"""Rebuild only estimated MSP reporting segments within calendar limits.

This is a scoped repair for the reviewed 26-person MSP roster.  It never
changes an accepted parent row or its source duration.  Only segments already
marked ``reporting_allocation.estimated=true`` are rebuilt; documented (non-
estimated) segments are treated as fixed occupancy.  The resulting estimates
are explicitly labelled as requiring approval.

Preview is the default.  ``--apply`` requires the database name and preview
fingerprint printed by ``--summary``.
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

from repair_msp_all_timestamps import ROSTER, env_values, local_date, parse_anchor, periods_from_payload, week_key

UK = ZoneInfo("Europe/London")
DAILY = 8 * 60 * 60
WEEKLY = 12 * 60 * 60
MONTHLY = 45 * 60 * 60
RUN_KIND = "msp-estimated-rebalance-v3"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def estimated_payload(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    reconciliation = payload.get("reconciliation")
    allocation = reconciliation.get("reporting_allocation") if isinstance(reconciliation, dict) else None
    return bool(isinstance(allocation, dict) and allocation.get("estimated") is True)


def anchor(row: dict[str, Any]) -> tuple[date, str]:
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
        return date(2026, 1, 1), "programme_start_fallback"


def free_start(day: date, seconds: int, intervals: list[tuple[datetime, datetime]]) -> datetime | None:
    """Find a non-overlapping interval beginning at 09:00 local time."""
    cursor = datetime.combine(day, time(9, 0), tzinfo=UK)
    for existing_start, existing_end in sorted(intervals):
        if existing_end <= cursor:
            continue
        if cursor + timedelta(seconds=seconds) <= existing_start:
            return cursor
        cursor = max(cursor, existing_end)
    # Estimates are learning time, not a claim of a fixed classroom shift;
    # keep each block within the 8-hour daily window beginning at 09:00.
    if cursor + timedelta(seconds=seconds) <= datetime.combine(day, time(17, 0), tzinfo=UK):
        return cursor
    return None


def valid_days(start: date, end: date, holidays: set[date], closed: set[date]) -> list[date]:
    result: list[date] = []
    day = start
    while day <= end:
        if day.weekday() < 5 and day not in holidays and day not in closed:
            result.append(day)
        day += timedelta(days=1)
    return result


def plan(cur) -> dict[str, Any]:
    cur.execute(
        '''SELECT l.id AS learner_id,a."ID" AS aptem_id,
                  COALESCE(a."Start-Date"::date,l.start_date) AS start_date,
                  COALESCE(a."End-Date"::date,l.end_date) AS end_date
             FROM "Learner".learners l
             JOIN "LMS"."Aptem_users" a ON a."ID"=l.aptem_id
            WHERE a."ID"=ANY(%s)''', [ROSTER])
    owners = {int(row["learner_id"]): row for row in cur.fetchall()}
    if set(int(row["aptem_id"]) for row in owners.values()) != set(ROSTER):
        raise ValueError("The exact reviewed roster is not present in the consolidated identity.")
    cur.execute('''SELECT holiday_date FROM curriculum.england_holidays
                   WHERE holiday_date BETWEEN '2026-01-01' AND '2028-12-31'
                   UNION SELECT holiday_date FROM curriculum.source_lms_bank_holidays
                   WHERE holiday_date BETWEEN '2026-01-01' AND '2028-12-31' ''')
    holidays = {row["holiday_date"] for row in cur.fetchall()}
    ids = list(owners)
    cur.execute('''SELECT p.* FROM "Learner".learner_progress_entries p
                   WHERE p.accepted IS TRUE AND p.deleted_at IS NULL
                     AND p.learner_id=ANY(%s) ORDER BY p.learner_id,p.reporting_started_at NULLS LAST,p.entry_order NULLS LAST,p.id''', [ids])
    parents = cur.fetchall()
    by_learner: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in parents:
        if estimated_payload(row.get("source_payload")):
            by_learner[int(row["learner_id"])].append(row)
    cur.execute('''SELECT s.*,p.source_payload,p.actual_seconds,p.reporting_started_at AS source_started,
                          p.reporting_month,p.entry_order,p.component_title,p.feed_title,p.feed_detail,
                          p.learner_id AS parent_learner_id
                     FROM "Learner".learner_activity_reporting_segments s
                     JOIN "Learner".learner_progress_entries p ON p.id=s.progress_id
                    WHERE p.accepted IS TRUE AND p.deleted_at IS NULL
                      AND p.learner_id=ANY(%s) ORDER BY s.progress_id,s.segment_order,s.id''', [ids])
    segments = cur.fetchall()
    seg_by_parent: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in segments:
        seg_by_parent[int(row["progress_id"])].append(row)
    # Documented timestamps are immutable occupancy.  Estimated timestamps
    # are excluded and rebuilt, so old invalid allocations cannot constrain the
    # corrected plan.
    fixed_daily: dict[tuple[int, date], int] = defaultdict(int)
    fixed_weekly: dict[tuple[int, tuple[int, int]], int] = defaultdict(int)
    fixed_monthly: dict[tuple[int, str], int] = defaultdict(int)
    intervals: dict[tuple[int, date], list[tuple[datetime, datetime]]] = defaultdict(list)
    for seg in segments:
        parent_payload = seg.get("source_payload")
        if estimated_payload(parent_payload):
            continue
        start = seg.get("reporting_started_at")
        end = seg.get("reporting_ended_at")
        if not start or not end:
            continue
        local_start = start.astimezone(UK)
        local_end = end.astimezone(UK)
        day = local_start.date()
        seconds = int(seg.get("actual_seconds") or 0)
        learner_id = int(seg["parent_learner_id"])
        fixed_daily[(learner_id, day)] += seconds
        fixed_weekly[(learner_id, week_key(day))] += seconds
        fixed_monthly[(learner_id, day.strftime("%Y-%m"))] += seconds
        intervals[(learner_id, day)].append((local_start, local_end))
    plans: list[dict[str, Any]] = []
    unresolved: list[dict[str, Any]] = []
    for learner_id, rows in by_learner.items():
        owner = owners[learner_id]
        start_date = owner["start_date"] or date(2026, 1, 1)
        end_date = owner["end_date"] or date(2028, 12, 31)
        closed: set[date] = set()
        for row in rows:
            closed.update(periods_from_payload(row.get("source_payload")))
        days = valid_days(start_date, end_date, holidays, closed)
        rows.sort(key=lambda row: (*anchor(row), int(row.get("entry_order") or 0), int(row["id"])))
        daily = defaultdict(int, {key: value for key, value in fixed_daily.items() if key[0] == learner_id})
        weekly = defaultdict(int, {key: value for key, value in fixed_weekly.items() if key[0] == learner_id})
        monthly = defaultdict(int, {key: value for key, value in fixed_monthly.items() if key[0] == learner_id})
        for row in rows:
            row_anchor, anchor_method = anchor(row)
            remaining = int(row.get("actual_seconds") or 0)
            row_segments: list[dict[str, Any]] = []
            for day in sorted(days, key=lambda value: (abs((value-row_anchor).days), value)):
                if remaining <= 0:
                    break
                key = (learner_id, day)
                available = min(DAILY-daily[key], WEEKLY-weekly[(learner_id, week_key(day))], MONTHLY-monthly[(learner_id, day.strftime("%Y-%m"))])
                if available <= 0:
                    continue
                seconds = min(remaining, available)
                start_local = free_start(day, seconds, intervals[key])
                if start_local is None:
                    continue
                end_local = start_local + timedelta(seconds=seconds)
                intervals[key].append((start_local, end_local))
                intervals[key].sort()
                daily[key] += seconds
                weekly[(learner_id, week_key(day))] += seconds
                monthly[(learner_id, day.strftime("%Y-%m"))] += seconds
                row_segments.append({"seconds": seconds, "start": start_local.isoformat(), "end": end_local.isoformat(), "month": day.strftime("%Y-%m"), "date": day.isoformat()})
                remaining -= seconds
            if remaining:
                unresolved.append({"progress_id": int(row["id"]), "aptem_id": int(owner["aptem_id"]), "remaining_seconds": remaining})
            plans.append({"progress_id": int(row["id"]),"learner_id": learner_id,"aptem_id": int(owner["aptem_id"]),"actual_seconds": int(row.get("actual_seconds") or 0),"source_payload": row.get("source_payload") or {},"source_system": row.get("source_system"),"source_evidence_id": ((row.get("source_payload") or {}).get("reconciliation") or {}).get("source_evidence_id"),"source_date": row.get("reporting_started_at"),"source_month": row.get("reporting_month"),"anchor_method": anchor_method,"segments": row_segments,"old_segments": seg_by_parent.get(int(row["id"]),[])})
    summary = {"database": cur.execute("SELECT current_database() AS name").fetchone()["name"],"roster": ROSTER,"estimated_parent_count": len(plans),"estimated_existing_segment_count": sum(len(item["old_segments"]) for item in plans),"planned_segment_count": sum(len(item["segments"]) for item in plans),"planned_seconds": sum(sum(int(seg["seconds"]) for seg in item["segments"]) for item in plans),"unresolved": unresolved,"holidays_loaded": len(holidays)}
    summary["fingerprint"] = digest({key:value for key,value in summary.items() if key != "fingerprint"})
    return {"summary": summary, "plans": plans}


def apply(cur, report: dict[str, Any], database: str, fingerprint: str) -> int:
    summary = report["summary"]
    if summary["database"] != database or summary["fingerprint"] != fingerprint:
        raise ValueError("Database or reviewed allocation fingerprint changed.")
    if summary["unresolved"]:
        raise ValueError("The reviewed plan has unresolved estimated hours.")
    run = cur.execute('''INSERT INTO "Learner".activity_sync_runs
        (run_key,run_kind,status,dry_run,prompt_version,source_counts,result_counts)
        VALUES (%s,%s,'running',false,%s,%s,%s) RETURNING id''',
        [f"msp-estimated-rebalance:{fingerprint}", RUN_KIND, "msp-timestamp-repair-v3", Jsonb({"roster": ROSTER,"estimated_parents": summary["estimated_parent_count"]}), Jsonb({"estimated": True,"planned_segments": summary["planned_segment_count"]})]).fetchone()["id"]
    for item in report["plans"]:
        progress = cur.execute('''SELECT id,learner_id,actual_seconds,source_payload FROM "Learner".learner_progress_entries
                                  WHERE id=%s AND deleted_at IS NULL FOR UPDATE''',[item["progress_id"]]).fetchone()
        if not progress or int(progress["learner_id"]) != item["learner_id"]:
            raise ValueError("Estimated parent changed during repair.")
        if not estimated_payload(progress["source_payload"]):
            raise ValueError("A non-estimated parent entered the plan.")
        if sum(int(seg["seconds"]) for seg in item["segments"]) != int(progress["actual_seconds"] or 0):
            raise ValueError("Rebuilt segments do not equal source seconds.")
        old_ids = [int(seg["id"]) for seg in item["old_segments"]]
        keep = min(len(old_ids), len(item["segments"]))
        for index, seg in enumerate(item["segments"][:keep]):
            cur.execute('''UPDATE "Learner".learner_activity_reporting_segments
                              SET segment_order=%s,actual_seconds=%s,reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,sync_run_id=%s,updated_at=now()
                            WHERE id=%s''',[index+1,seg["seconds"],datetime.fromisoformat(seg["start"]),datetime.fromisoformat(seg["end"]),seg["month"],run,old_ids[index]])
        if len(old_ids) > keep:
            cur.execute('DELETE FROM "Learner".learner_activity_reporting_segments WHERE id=ANY(%s)',[old_ids[keep:]])
        for index, seg in enumerate(item["segments"][keep:], start=keep+1):
            cur.execute('''INSERT INTO "Learner".learner_activity_reporting_segments
                (progress_id,learner_id,segment_order,actual_seconds,reporting_started_at,reporting_ended_at,reporting_month,sync_run_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',[item["progress_id"],item["learner_id"],index,seg["seconds"],datetime.fromisoformat(seg["start"]),datetime.fromisoformat(seg["end"]),seg["month"],run])
        payload = dict(progress["source_payload"] or {})
        reconciliation = dict(payload.get("reconciliation") or {})
        reconciliation["reporting_allocation"] = {"method":"nearest_valid_weekday_index_capacity_v3","estimated":True,"approval_required":True,"source_system":item["source_system"],"source_evidence_id":item["source_evidence_id"],"original_reporting_date":item["source_date"].isoformat() if item["source_date"] else None,"original_reporting_month":item["source_month"],"anchor_method":item["anchor_method"],"index_rule":"source timestamp, then activity-title date, then reporting-month/index","calendar_rule":"Europe/London weekdays excluding bank holidays and recorded breaks; 8h/day, 12h/week, 45h/month","segments":item["segments"],"segment_total_seconds":sum(int(seg["seconds"]) for seg in item["segments"]),"source_duration_seconds":int(progress["actual_seconds"] or 0)}
        payload["reconciliation"] = reconciliation
        cur.execute('UPDATE "Learner".learner_progress_entries SET source_payload=%s,ssot_updated_at=now() WHERE id=%s',[Jsonb(payload),item["progress_id"]])
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''',[Jsonb({"estimated":True,"rebalanced_parents":summary["estimated_parent_count"],"created_or_updated_segments":summary["planned_segment_count"]}),run])
    return int(run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    values = env_values()
    url = values.get("Database_url") or values.get("DATABASE_URL")
    if not url:
        raise ValueError("No configured database URL")
    with psycopg.connect(url, connect_timeout=20, row_factory=dict_row) as connection:
        connection.read_only = not args.apply
        with connection.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=180000")
            report = plan(cur)
            if args.apply:
                print(json.dumps({"database": report["summary"]["database"],"run_id":apply(cur,report,args.expected_database,args.expected_fingerprint),"rebalanced_parents":report["summary"]["estimated_parent_count"],"segments":report["summary"]["planned_segment_count"]},default=str))
            elif args.summary:
                print(json.dumps(report["summary"],default=str))
            else:
                print(json.dumps(report["summary"],default=str))


if __name__ == "__main__":
    main()
