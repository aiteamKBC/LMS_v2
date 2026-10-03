"""Scoped Aptem-to-LMS hours reconciliation for the Sharon AI group.

The command is intentionally explicit and two-phase.  The default mode is a
read-only preview.  ``--apply`` requires the reviewed database name and the
preview fingerprint.  It only counts Accepted Aptem evidence with a London
work date, whole-minute duration, a non-overlapping 09:00-17:00 slot, and no
more than eight hours in one evidence item.  Referred evidence, bank holidays,
weekends, large/ambiguous durations, and overlaps stay in the report.

Existing Aptem-only lineage rows are filled in place; old LMS/journal rows are
never rewritten.  Missing evidence is attached to an existing Aptem-only
component when possible, otherwise it gets one new canonical progress row.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import hashlib
import json
import mimetypes
import os
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
GROUP_ID = "GROUP-202609210905110684506B246BDED88E"
MODULE_ID = "MOD-20260921085233798880517CB0D243D0"
ROSTER = {
    4342: "John McCarthy",
    4443: "Amy Wilkinson",
    4579: "Kiley Brown",
    4605: "Cheska Hardie",
    4660: "Joseph Shemeld",
    4925: "Elisei Sergevnin",
    5053: "Leigh Millington",
}
CONTAINER = "fetch-aptem-evidences"


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def db_url() -> str:
    values = dict(os.environ)
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return next(values[k] for k in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL") if values.get(k))


def bank_holidays() -> set[date]:
    # England and Wales holidays covering the Aptem dates in this group.
    return {
        date(2025, 12, 25), date(2025, 12, 26), date(2026, 1, 1),
        date(2026, 4, 3), date(2026, 4, 6), date(2026, 5, 4),
        date(2026, 5, 25), date(2026, 8, 31), date(2026, 12, 25),
        date(2026, 12, 28), date(2027, 1, 1),
    }


def london_date(value: datetime | None) -> date | None:
    return value.astimezone(UK).date() if value else None


def seconds_for(evidence: dict[str, Any]) -> int | None:
    minutes = Decimal(str(evidence["spent_time"]))
    seconds = minutes * 60
    if seconds < 0 or seconds != seconds.to_integral_value():
        return None
    return int(seconds)


def is_attendance(evidence: dict[str, Any]) -> bool:
    text = " ".join(str(evidence.get(k) or "") for k in ("component_name", "evidence_name", "hours_type")).lower()
    return "attendance" in text or "lecture" in text


def source_evidence_id(source: dict[str, Any]) -> int | None:
    raw = source.get("source_payload") or {}
    value = source.get("source_activity_id") or ""
    if value.startswith("evidence:"):
        value = value.split(":", 1)[1]
    else:
        value = raw.get("Id")
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def insert_row(cur, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def state(cur) -> dict[str, Any]:
    roster_rows = cur.execute(
        '''SELECT l.id,l.enrolment_id,l.programme_id,l.aptem_id,l.full_name,l.programme,
                  t.module_ref AS curriculum_module_id
           FROM "Learner".learners l
           LEFT JOIN "Learner".learner_training_plan_modules t
             ON t.learner_id=l.id AND t.module_ref=%s
           WHERE l.aptem_id=ANY(%s)
           ORDER BY l.aptem_id''',
        [MODULE_ID, list(ROSTER)],
    ).fetchall()
    if len(roster_rows) != len(ROSTER) or any(r["curriculum_module_id"] != MODULE_ID for r in roster_rows):
        raise ValueError("The seven-learner roster/module invariant failed.")

    aptem = cur.execute(
        '''SELECT "ID"::bigint aptem_id,"Start-Date" start_date,"End-Date" end_date
           FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)''',
        [list(ROSTER)],
    ).fetchall()
    if len(aptem) != len(ROSTER):
        raise ValueError("Aptem date rows are incomplete.")
    aptem_by_id = {r["aptem_id"]: r for r in aptem}

    evidence = cur.execute(
        '''WITH d AS (
             SELECT "ID"::bigint aptem_id,"Start-Date" start_date,"End-Date" end_date
             FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)
           )
           SELECT e.*,
             coalesce(e.completed_date_override,e.completed_date,e.submission_date) AS evidence_at
           FROM fetching_evidence.evidence_items e JOIN d ON d.aptem_id=e.learner_id
           WHERE e.evidence_status='Accepted' AND e.spent_time>0
             AND ((coalesce(e.completed_date_override,e.completed_date,e.submission_date)
                   AT TIME ZONE 'Europe/London')::date) BETWEEN d.start_date AND d.end_date
           ORDER BY e.learner_id,e.evidence_id''',
        [list(ROSTER)],
    ).fetchall()
    owners = {r["aptem_id"]: r for r in roster_rows}
    owner_ids = [r["id"] for r in roster_rows]
    progress = cur.execute(
        '''SELECT * FROM "Learner".learner_progress_entries
           WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''',
        [owner_ids],
    ).fetchall()
    sources = cur.execute(
        '''SELECT * FROM "Learner".learner_activity_sources
           WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''',
        [owner_ids],
    ).fetchall()
    segments = cur.execute(
        '''SELECT * FROM "Learner".learner_activity_reporting_segments
           WHERE learner_id=ANY(%s) ORDER BY learner_id,progress_id,segment_order,id''',
        [owner_ids],
    ).fetchall()
    documents = cur.execute(
        '''SELECT * FROM "Learner".learner_activity_documents
           WHERE learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY learner_id,id''',
        [owner_ids],
    ).fetchall()
    return {
        "owners": owners,
        "aptem": aptem_by_id,
        "evidence": evidence,
        "progress": progress,
        "sources": sources,
        "segments": segments,
        "documents": documents,
    }


def occupied_slots(current: dict[str, Any]) -> dict[int, dict[date, list[tuple[datetime, datetime]]]]:
    by_learner: dict[int, dict[date, list[tuple[datetime, datetime]]]] = defaultdict(lambda: defaultdict(list))
    progress_by_id = {p["id"]: p for p in current["progress"]}
    for p in current["progress"]:
        start = p.get("reporting_started_at")
        end = p.get("reporting_ended_at")
        if start and end:
            by_learner[p["learner_id"]][london_date(start)].append((start.astimezone(UK), end.astimezone(UK)))
    for s in current["segments"]:
        if s["progress_id"] in progress_by_id:
            start, end = s["reporting_started_at"], s["reporting_ended_at"]
            by_learner[s["learner_id"]][london_date(start)].append((start.astimezone(UK), end.astimezone(UK)))
    return by_learner


def slot_for(slots: dict[date, list[tuple[datetime, datetime]]], day: date, seconds: int) -> tuple[datetime, datetime] | None:
    if day.weekday() >= 5 or day in bank_holidays():
        return None
    duration = timedelta(seconds=seconds)
    cursor = datetime.combine(day, time(9, 0), tzinfo=UK)
    day_end = datetime.combine(day, time(17, 0), tzinfo=UK)
    occupied = sorted(slots.get(day, []))
    for start, end in occupied:
        if cursor + duration <= start and cursor + duration <= day_end:
            slots.setdefault(day, []).append((cursor, cursor + duration))
            return cursor, cursor + duration
        if end > cursor:
            cursor = end
    if cursor + duration <= day_end:
        slots.setdefault(day, []).append((cursor, cursor + duration))
        return cursor, cursor + duration
    return None


def plan(cur) -> tuple[dict[str, Any], dict[str, Any]]:
    current = state(cur)
    slots = occupied_slots(current)
    owners = current["owners"]
    progress_by_id = {p["id"]: p for p in current["progress"]}
    segments_by_progress: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for s in current["segments"]:
        segments_by_progress[s["progress_id"]].append(s)
    sources_by_evidence: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    sources_by_component: dict[tuple[int, str], list[dict[str, Any]]] = defaultdict(list)
    for s in current["sources"]:
        evid = source_evidence_id(s)
        owner_aptem = s.get("aptem_id")
        if evid is not None:
            sources_by_evidence[(owner_aptem, evid)].append(s)
        raw = s.get("source_payload") or {}
        component = raw.get("ComponentId")
        if owner_aptem is not None and component is not None and s.get("source_system") == "aptem":
            sources_by_component[(owner_aptem, str(component))].append(s)

    # A progress that contains anything other than Aptem lineage is not touched.
    systems_by_progress: dict[int, set[str]] = defaultdict(set)
    for s in current["sources"]:
        if s.get("canonical_progress_id"):
            systems_by_progress[s["canonical_progress_id"]].add(s.get("source_system"))

    actions: list[dict[str, Any]] = []
    counts = Counter()
    for evidence in current["evidence"]:
        aptem_id = evidence["learner_id"]
        evidence_at = evidence.get("evidence_at")
        day = london_date(evidence_at)
        seconds = seconds_for(evidence)
        if day is None or seconds is None:
            counts["invalid_duration_or_date"] += 1
            continue
        exact = sources_by_evidence.get((aptem_id, evidence["evidence_id"]), [])
        if len(exact) > 1:
            counts["duplicate_source_review"] += 1
            actions.append({"resolution": "duplicate_source_review", "evidence": evidence})
            continue
        progress_id = exact[0].get("canonical_progress_id") if exact else None
        if progress_id is None:
            for candidate in sources_by_component.get((aptem_id, str(evidence["component_id"])), []):
                if candidate.get("canonical_progress_id") in progress_by_id:
                    progress_id = candidate["canonical_progress_id"]
                    break
        if progress_id is not None:
            p = progress_by_id.get(progress_id)
            systems = systems_by_progress.get(progress_id, set())
            if p is None or p.get("deleted_at") is not None or systems - {"aptem"}:
                counts["mixed_or_deleted_review"] += 1
                actions.append({"resolution": "mixed_or_deleted_review", "evidence": evidence, "source": exact[0] if exact else None})
                continue
            if (p.get("actual_seconds") or 0) > 0 or segments_by_progress.get(progress_id):
                counts["already_counted"] += 1
                actions.append({"resolution": "already_counted", "evidence": evidence, "source": exact[0] if exact else None, "progress_id": progress_id})
                continue
            resolution = "count_on_existing_progress" if exact else "attach_missing_source"
        else:
            resolution = "new_progress"
        if seconds > 8 * 3600:
            counts["duration_over_daily_limit"] += 1
            actions.append({"resolution": "duration_over_daily_limit", "evidence": evidence, "progress_id": progress_id})
            continue
        slot = slot_for(slots[owners[aptem_id]["id"]], day, seconds)
        if slot is None:
            counts["overlap_or_workday_review"] += 1
            actions.append({"resolution": "overlap_or_workday_review", "evidence": evidence, "progress_id": progress_id})
            continue
        action = {
            "resolution": resolution,
            "evidence": evidence,
            "source": exact[0] if exact else None,
            "progress_id": progress_id,
            "start": slot[0],
            "end": slot[1],
            "seconds": seconds,
            "day": day,
        }
        actions.append(action)
        counts[resolution] += 1

    before = {}
    for aptem_id, owner in owners.items():
        before[aptem_id] = sum((p.get("actual_seconds") or 0) for p in current["progress"] if p["learner_id"] == owner["id"] and p.get("accepted"))
    added = defaultdict(int)
    for action in actions:
        if action["resolution"] in {"count_on_existing_progress", "attach_missing_source", "new_progress"}:
            added[action["evidence"]["learner_id"]] += action["seconds"]
    report = {
        "group_id": GROUP_ID,
        "module_id": MODULE_ID,
        "roster": [{"aptem_id": k, "name": ROSTER[k], "start_date": current["aptem"][k]["start_date"], "end_date": current["aptem"][k]["end_date"]} for k in sorted(ROSTER)],
        "counts": dict(counts),
        "learners": [],
        "actions": actions,
    }
    for aptem_id in sorted(ROSTER):
        report["learners"].append({
            "aptem_id": aptem_id,
            "name": ROSTER[aptem_id],
            "before_hours": str(Decimal(before[aptem_id]) / Decimal(3600)),
            "planned_add_hours": str(Decimal(added[aptem_id]) / Decimal(3600)),
            "planned_after_hours": str(Decimal(before[aptem_id] + added[aptem_id]) / Decimal(3600)),
        })
    fingerprint = digest({
        "group_id": GROUP_ID,
        "module_id": MODULE_ID,
        "learners": report["learners"],
        "actions": [
            {"resolution": a["resolution"], "evidence_id": a["evidence"]["evidence_id"], "progress_id": a.get("progress_id"), "seconds": a.get("seconds"), "start": a.get("start"), "end": a.get("end")}
            for a in actions
        ],
    })
    report["fingerprint"] = fingerprint
    return current, report


def raw_with_reconciliation(evidence: dict[str, Any], resolution: str, progress_id: int | None) -> dict[str, Any]:
    raw = dict(evidence.get("evidence_raw") or {})
    raw["reconciliation"] = {
        "resolution": resolution,
        "source_table": "fetching_evidence.evidence_items",
        "group_id": GROUP_ID,
        "module_id": MODULE_ID,
        "canonical_progress_id": progress_id,
    }
    raw["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    if evidence.get("note_content"):
        raw["note_content"] = evidence["note_content"]
    return raw


def apply(cur, current: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    actions = [a for a in report["actions"] if a["resolution"] in {"count_on_existing_progress", "attach_missing_source", "new_progress"}]
    run_id = insert_row(cur, "activity_sync_runs", {
        "run_key": "sharon-ai-group-aptem-reconciliation:" + report["fingerprint"],
        "run_kind": "scoped-aptem-evidence-reconciliation",
        "status": "running", "dry_run": False,
        "source_counts": Jsonb({"group_id": GROUP_ID, "module_id": MODULE_ID, "roster": len(ROSTER), "selected_evidence": len(actions)}),
        "result_counts": Jsonb({"planned_actions": len(actions)}),
    })
    owners = current["owners"]
    progress_by_id = {p["id"]: p for p in current["progress"]}
    segments_by_progress: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for s in current["segments"]:
        segments_by_progress[s["progress_id"]].append(s)
    next_order = defaultdict(int)
    for p in current["progress"]:
        next_order[p["learner_id"]] = max(next_order[p["learner_id"]], p.get("entry_order") or 0)
    # entry_order is unique for a learner across historical rows too.  The
    # scoped state query intentionally excludes deleted progress, so include
    # all historical orders before allocating new rows.
    historical_orders = cur.execute(
        '''SELECT learner_id,coalesce(max(entry_order),0) AS max_order
           FROM "Learner".learner_progress_entries
           WHERE learner_id=ANY(%s) GROUP BY learner_id''',
        [[owner["id"] for owner in owners.values()]],
    ).fetchall()
    for row in historical_orders:
        next_order[row["learner_id"]] = max(next_order[row["learner_id"]], row["max_order"] or 0)
    sources_by_evidence = {(s.get("aptem_id"), source_evidence_id(s)): s for s in current["sources"] if source_evidence_id(s) is not None}
    added_by_learner = defaultdict(int)
    new_progress = 0
    updated_progress = 0
    source_updates = 0
    documents_added = 0
    for action in actions:
        e = action["evidence"]
        aptem_id = e["learner_id"]
        owner = owners[aptem_id]
        source = action.get("source")
        progress_id = action.get("progress_id")
        raw = raw_with_reconciliation(e, action["resolution"], progress_id)
        source_ref = f"evidence:{e['evidence_id']}"
        key = f"aptem:{aptem_id}:{source_ref}"
        if action["resolution"] == "new_progress":
            next_order[owner["id"]] += 1
            progress_id = insert_row(cur, "learner_progress_entries", {
                "learner_id": owner["id"], "entry_order": next_order[owner["id"]],
                "kind": "attendance" if is_attendance(e) else "aptem_evidence",
                "module_title": e.get("component_name") or e.get("evidence_name") or "Aptem evidence",
                "week_title": "", "component_ref": str(e.get("component_id") or ""),
                "component_title": e.get("component_name") or e.get("evidence_name") or "Aptem evidence",
                "component_type": "attendance" if is_attendance(e) else "evidence",
                "programme_id": owner.get("programme_id"), "aptem_id": aptem_id,
                "enrolment_id": owner.get("enrolment_id"), "source_system": "aptem",
                "source_activity_id": source_ref, "source_attempt_key": source_ref,
                "canonical_activity_key": key, "activity_status": "Accepted", "accepted": True,
                "actual_seconds": action["seconds"], "actual_basis": "aptem:accepted-evidence-spent-minutes",
                "reporting_started_at": action["start"], "reporting_ended_at": action["end"],
                "reporting_month": action["day"].strftime("%Y-%m"), "source_payload": Jsonb(raw),
                "sync_run_id": run_id,
            })
            new_progress += 1
        else:
            p = progress_by_id[progress_id]
            existing_total = sum(s.get("actual_seconds") or 0 for s in segments_by_progress.get(progress_id, []))
            new_total = existing_total + action["seconds"]
            cur.execute('''UPDATE "Learner".learner_progress_entries
                           SET actual_seconds=%s,actual_basis=%s,accepted=TRUE,activity_status='Accepted',sync_run_id=%s
                           WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''',
                        [new_total, "aptem:accepted-evidence-spent-minutes", run_id, progress_id, owner["id"]])
            updated_progress += 1
            order = max((s.get("segment_order") or 0 for s in segments_by_progress.get(progress_id, [])), default=0) + 1
            insert_row(cur, "learner_activity_reporting_segments", {
                "progress_id": progress_id, "learner_id": owner["id"], "segment_order": order,
                "actual_seconds": action["seconds"], "reporting_started_at": action["start"],
                "reporting_ended_at": action["end"], "reporting_month": action["day"].strftime("%Y-%m"),
                "sync_run_id": run_id,
            })
            segments_by_progress[progress_id].append({"segment_order": order, "actual_seconds": action["seconds"]})
        # Update an existing source or create a missing source identity.
        source_values = {
            "actual_seconds": action["seconds"], "actual_basis": "aptem:accepted-evidence-spent-minutes",
            "source_started_at": action["start"], "source_ended_at": action["end"],
            "reporting_started_at": action["start"], "reporting_ended_at": action["end"],
            "reporting_month": action["day"].strftime("%Y-%m"), "canonical_progress_id": progress_id,
            "accepted": True, "activity_status": "Accepted", "completed": True, "sync_run_id": run_id,
        }
        if source is not None:
            cur.execute('''UPDATE "Learner".learner_activity_sources SET
                actual_seconds=%(actual_seconds)s,actual_basis=%(actual_basis)s,source_started_at=%(source_started_at)s,
                source_ended_at=%(source_ended_at)s,reporting_started_at=%(reporting_started_at)s,
                reporting_ended_at=%(reporting_ended_at)s,reporting_month=%(reporting_month)s,
                canonical_progress_id=%(canonical_progress_id)s,accepted=%(accepted)s,activity_status=%(activity_status)s,
                completed=%(completed)s,sync_run_id=%(sync_run_id)s,last_seen_at=now()
                WHERE id=%(id)s AND deleted_at IS NULL''', {**source_values, "id": source["id"]})
            source_updates += 1
        else:
            insert_row(cur, "learner_activity_sources", {
                "learner_id": owner["id"], "enrolment_id": owner.get("enrolment_id"),
                "programme_id": owner.get("programme_id"), "aptem_id": aptem_id,
                "source_system": "aptem", "source_activity_id": source_ref, "source_attempt_key": source_ref,
                "curriculum_component_id": e.get("component_id"), "canonical_activity_key": key,
                "activity_type": "attendance" if is_attendance(e) else "evidence",
                "title": e.get("component_name") or e.get("evidence_name") or "Aptem evidence",
                "activity_status": "Accepted", "completed": True, "accepted": True,
                "actual_seconds": action["seconds"], "actual_basis": "aptem:accepted-evidence-spent-minutes",
                "source_started_at": action["start"], "source_ended_at": action["end"],
                "reporting_started_at": action["start"], "reporting_ended_at": action["end"],
                "reporting_month": action["day"].strftime("%Y-%m"), "ksb_codes": Jsonb(e.get("ksb_codes") or []),
                "source_payload": Jsonb(raw), "sync_run_id": run_id, "canonical_progress_id": progress_id,
                "source_fingerprint": digest(e), "source_course_ref": "",
            })
            source_updates += 1
        if e.get("file_blob"):
            existing_doc = cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents
                WHERE source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''', [source_ref + ":file"]).fetchone()
            if not existing_doc:
                cur.execute('''INSERT INTO "Learner".learner_activity_documents
                    (learner_id,progress_id,source_system,source_document_id,container,blob_name,display_name,content_type,uploaded_at)
                    VALUES (%s,%s,'aptem',%s,%s,%s,%s,%s,%s)''', [
                        owner["id"], progress_id, source_ref + ":file", CONTAINER, e["file_blob"],
                        e.get("evidence_name") or "Aptem evidence",
                        mimetypes.guess_type(e.get("evidence_name") or "")[0] or "application/octet-stream",
                        e.get("submission_date"),
                    ])
                documents_added += 1
        added_by_learner[aptem_id] += action["seconds"]
    result = {
        "planned_actions": len(actions), "new_progress": new_progress,
        "updated_progress": updated_progress, "source_updates": source_updates,
        "documents_added": documents_added,
        "added_hours": {str(k): str(Decimal(v) / Decimal(3600)) for k, v in sorted(added_by_learner.items())},
    }
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run_id])
    return {"run_id": run_id, **result}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not args.expected_database:
        parser.error("--apply requires --expected-database")
    with psycopg.connect(db_url(), connect_timeout=10, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=5000")
            database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            current, report = plan(cur)
            if args.apply:
                if database != args.expected_database:
                    raise ValueError("Database differs from reviewed preview.")
                if report["fingerprint"] != args.expected_fingerprint:
                    raise ValueError("Data changed since preview; preview again before applying.")
                owner_ids = [r["id"] for r in current["owners"].values()]
                for owner_id in owner_ids:
                    cur.execute("SELECT pg_advisory_xact_lock(hashtext('sharon-ai-group-reconciliation'),%s::integer)", [owner_id])
                result = apply(cur, current, report)
                report["applied"] = result
            report["database"] = database
            # Evidence action details are intentionally compact in stdout; the
            # report still preserves enough IDs/reasons for audit follow-up.
            report["actions"] = [
                {"evidence_id": a["evidence"]["evidence_id"], "learner_id": a["evidence"]["learner_id"],
                 "component": a["evidence"].get("component_name"), "spent_minutes": str(a["evidence"].get("spent_time")),
                 "resolution": a["resolution"], "progress_id": a.get("progress_id"),
                 "start": a.get("start"), "end": a.get("end")}
                for a in report["actions"]
            ]
        print(json.dumps(report, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
