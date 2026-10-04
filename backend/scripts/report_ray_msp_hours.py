"""Read-only final report for the Ray MSP Jan / PCP Level 6 group."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from decimal import Decimal
import hashlib
import json
import os
import argparse
from pathlib import Path
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

UK = ZoneInfo("Europe/London")
GROUP_ID = "APTEM-GROUP-4d0bf743cf6d8e9a5cb60a44d25c34b0"
PROGRAMME_ID = "PROG-PCP-L6"
# Evidence whose date is still ambiguous is not used in the comparison total.
DATE_REVIEW_IDS = {27573}


def db_url():
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            values.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    return values.get("ENROLMENT_DATABASE_URL") or values.get("Database_url") or values.get("DATABASE_URL")


def fmt(seconds):
    seconds = int(seconds or 0)
    sign = "-" if seconds < 0 else ""
    seconds = abs(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{sign}{h}:{m:02d}:{s:02d}"


def day(row):
    at = row.get("completed_date_override") or row.get("completed_date") or row.get("submission_date")
    return at.astimezone(UK).date() if isinstance(at, datetime) and at.tzinfo else None


def evidence_key(row):
    # Attendance Notes with the same learner/date/component/duration are one
    # event even when Aptem submitted the note twice.  Component identity is
    # retained so different sessions are never merged by title alone.
    component = str(row.get("component_name") or "").lower()
    if "attendance" not in component and "attendance" not in str(row.get("evidence_name") or "").lower():
        return None
    note = " ".join(str(row.get("note_content") or "").split()).lower()
    return (row["learner_id"], day(row), row["component_id"], str(row["spent_time"]), note)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--markdown", action="store_true")
    markdown = parser.parse_args().markdown
    with psycopg.connect(db_url(), row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            learners = cur.execute("""SELECT id, aptem_id, full_name,
                coach_name FROM \"Learner\".learners
                WHERE group_id=%s AND programme_id=%s ORDER BY aptem_id""", [GROUP_ID, PROGRAMME_ID]).fetchall()
            if len(learners) != 27:
                raise ValueError(f"Expected 27 canonical Ray members, found {len(learners)}")
            learner_ids = [r["id"] for r in learners]
            aptem_ids = [r["aptem_id"] for r in learners]
            progress = cur.execute("""SELECT learner_id,
                COALESCE(SUM(actual_seconds) FILTER (WHERE deleted_at IS NULL AND accepted),0) AS seconds
                FROM \"Learner\".learner_progress_entries
                WHERE learner_id=ANY(%s) GROUP BY learner_id""", [learner_ids]).fetchall()
            ssot = {r["learner_id"]: int(r["seconds"] or 0) for r in progress}
            evidence = cur.execute("""SELECT evidence_id, learner_id, component_id,
                component_name, evidence_name, evidence_status, spent_time,
                hours_type, spent_time_type, completed_date_override, completed_date,
                submission_date, note_content
                FROM fetching_evidence.evidence_items
                WHERE learner_id=ANY(%s) AND evidence_status='Accepted'
                  AND hours_type='OffTheJobTraining'
                  AND spent_time_type='PaidWorkingHours' AND spent_time>0
                ORDER BY evidence_id""", [aptem_ids]).fetchall()
            evidence = [r for r in evidence if day(r) is not None]
            zero_days = set()
            for r in cur.execute("""SELECT aptem_id, attendance_date, attendance_value
                FROM \"Learner\".source_lms_attendance WHERE aptem_id=ANY(%s)""", [aptem_ids]).fetchall():
                if r["attendance_value"] == 0:
                    zero_days.add((r["aptem_id"], r["attendance_date"]))
            raw = defaultdict(int)
            valid = defaultdict(int)
            duplicate_ids = defaultdict(list)
            seen = {}
            excluded = defaultdict(list)
            for e in evidence:
                seconds = int(Decimal(str(e["spent_time"])) * 60)
                aid = int(e["learner_id"])
                d = day(e)
                raw[aid] += seconds
                if (aid, d) in zero_days:
                    excluded[aid].append({"id": e["evidence_id"], "reason": "Not Attended / attendance_value=0", "seconds": seconds})
                    continue
                if e["evidence_id"] in DATE_REVIEW_IDS:
                    excluded[aid].append({"id": e["evidence_id"], "reason": "date-review / duplicate decision pending", "seconds": seconds})
                    continue
                key = evidence_key(e)
                if key is not None:
                    if key in seen:
                        duplicate_ids[aid].append({"kept": seen[key], "excluded": e["evidence_id"], "seconds": seconds, "date": str(d)})
                        continue
                    seen[key] = e["evidence_id"]
                valid[aid] += seconds
            rows = []
            for l in learners:
                aid = int(l["aptem_id"])
                ssot_s = ssot.get(l["id"], 0)
                raw_s = raw.get(aid, 0)
                valid_s = valid.get(aid, 0)
                rows.append({
                    "aptem_id": aid,
                    "learner": l.get("full_name") or str(aid),
                    "aptem_raw_seconds": raw_s,
                    "aptem_valid_seconds": valid_s,
                    "ssot_seconds": ssot_s,
                    "difference_seconds": ssot_s - valid_s,
                    "excluded_not_attended_seconds": sum(x["seconds"] for x in excluded[aid] if "Not Attended" in x["reason"]),
                    "duplicate_count": len(duplicate_ids[aid]),
                    "date_review_count": sum(1 for x in excluded[aid] if "date-review" in x["reason"]),
                })
            total = {k: sum(r[k] for r in rows) for k in ("aptem_raw_seconds", "aptem_valid_seconds", "ssot_seconds", "difference_seconds")}
            run = cur.execute("""SELECT id,run_key,result_counts,finished_at
                FROM \"Learner\".activity_sync_runs
                WHERE run_kind='ray-msp-negative-hours-repair' ORDER BY id DESC LIMIT 1""").fetchone()
            report = {
                "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
                "group": "Ray‑MSP Jan — Project Controls Professional Level 6 — Feb 2026",
                "group_id": GROUP_ID, "programme_id": PROGRAMME_ID,
                "learner_count": len(rows), "totals": total,
                "rows": rows,
                "duplicates": duplicate_ids,
                "excluded": excluded,
                "latest_write_run": run,
            }
            if markdown:
                print(f"Group: {report['group']}\nLearners: {len(rows)}\n")
                print("| Aptem ID | الطالب | Aptem الخام | Aptem للمقارنة | SSOT | الفرق النهائي |")
                print("|---:|---|---:|---:|---:|---:|")
                for item in rows:
                    print(f"| {item['aptem_id']} | {item['learner']} | {fmt(item['aptem_raw_seconds'])} | {fmt(item['aptem_valid_seconds'])} | {fmt(item['ssot_seconds'])} | {'+' if item['difference_seconds'] >= 0 else ''}{fmt(item['difference_seconds'])} |")
                print(f"| **الإجمالي** | **{len(rows)}** | **{fmt(total['aptem_raw_seconds'])}** | **{fmt(total['aptem_valid_seconds'])}** | **{fmt(total['ssot_seconds'])}** | **+{fmt(total['difference_seconds'])}** |")
            else:
                print(json.dumps(report, default=str, ensure_ascii=True))


if __name__ == "__main__":
    main()
