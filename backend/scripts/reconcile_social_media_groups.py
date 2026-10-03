"""Reconcile the two Social Media groups in one audited, two-phase run.

The command is read-only by default.  It works on the union of both rosters,
keeps the group membership in the report, and processes a shared learner only
once.  Only Accepted, paid OTJ Aptem evidence inside the learner's Aptem
period is eligible.  Existing active Aptem parents with a null actual value
are recovered only when every active source on the parent is Aptem lineage and
the selected evidence is independently accepted.  Missing evidence gets its
own canonical parent; exact journal matches get lineage only and no extra
counted hours.  Reporting dates for recovered/new rows are deliberately
estimated and labelled for approval; source evidence dates remain in payload.

No hard deletes or existing Journal/Old LMS rewrites are performed.
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
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
CONTAINER = "fetch-aptem-evidences"
LABEL = "\u062a\u0642\u062f\u064a\u0631\u064a \u2014 \u064a\u062d\u062a\u0627\u062c \u0627\u0639\u062a\u0645\u0627\u062f"
BASIS = "aptem:accepted-evidence-spent-minutes;estimated-reporting-allocation"
RUN_KIND = "social-media-groups-reconciliation-v1"
DAILY_SECONDS = 8 * 60 * 60

GROUPS = {
    "G2-Juliane Social Media": {
        "group_id": "GROUP-202609211159360971368DB0592873D3",
        "module_id": "MOD-202609211208476573216D584A576BEF",
        "tutor": "Juliane Thieme",
        "learner_ids": [15825, 15955, 15997, 16146, 17045, 17216, 17370,
                        17403, 17432, 17922, 18123, 18222, 18962, 19320],
    },
    "G1-Julian Social Media": {
        "group_id": "GROUP-20260921115837423561E79D154A1979",
        "module_id": "MOD-20260921081039161503EB58ACC4DD01",
        "tutor": "Julian Thomas",
        "learner_ids": [4609, 6231, 10250, 10625, 14548, 14874, 15021,
                        15069, 15430, 15822, 15825, 16001, 16057, 16456,
                        16930, 17323, 18000],
    },
}
ALL_APTEM_IDS = sorted({aid for group in GROUPS.values() for aid in group["learner_ids"]})


def db_url() -> str:
    values = dict(os.environ)
    for raw in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise ValueError("No configured enrolment database.")


def digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def london_date(value: datetime | None) -> date | None:
    return value.astimezone(UK).date() if value and value.tzinfo else None


def evidence_date(row: dict[str, Any]) -> date | None:
    return london_date(row.get("evidence_at"))


def is_attendance(row: dict[str, Any]) -> bool:
    text = " ".join(str(row.get(k) or "") for k in ("component_name", "evidence_name", "note_content")).lower()
    return "attendance" in text or "lecture" in text


def fmt(seconds: int) -> str:
    sign = "-" if seconds < 0 else ""
    seconds = abs(int(seconds))
    return f"{sign}{seconds // 3600}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"


def bank_holidays() -> set[date]:
    return {
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


def state(cur) -> dict[str, Any]:
    owners = cur.execute(
        '''SELECT id,enrolment_id,programme_id,aptem_id,full_name,group_id,programme
             FROM "Learner".learners WHERE aptem_id=ANY(%s) ORDER BY aptem_id''',
        [ALL_APTEM_IDS],
    ).fetchall()
    if {int(row["aptem_id"]) for row in owners} != set(ALL_APTEM_IDS):
        raise ValueError("Social Media roster canonical learner invariant failed.")
    owner_by_aptem = {int(row["aptem_id"]): row for row in owners}
    aptem = cur.execute(
        '''SELECT "ID"::bigint aptem_id,"Start-Date" start_date,"End-Date" end_date
             FROM "Learner"."Aptem_users" WHERE "ID"=ANY(%s)''',
        [ALL_APTEM_IDS],
    ).fetchall()
    aptem_by_id = {int(row["aptem_id"]): row for row in aptem}
    if set(aptem_by_id) != set(ALL_APTEM_IDS):
        raise ValueError("Aptem date rows are incomplete.")
    owner_ids = [row["id"] for row in owners]
    evidence = cur.execute(
        '''SELECT e.*, coalesce(e.completed_date_override,e.completed_date,e.submission_date) AS evidence_at
             FROM fetching_evidence.evidence_items e
            WHERE e.learner_id=ANY(%s) AND e.evidence_status='Accepted'
              AND e.spent_time>0 AND e.hours_type='OffTheJobTraining'
              AND e.spent_time_type='PaidWorkingHours'
            ORDER BY e.learner_id,coalesce(e.completed_date_override,e.completed_date,e.submission_date),e.evidence_id''',
        [ALL_APTEM_IDS],
    ).fetchall()
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
    journals = cur.execute(
        '''SELECT * FROM "Learner".learner_journal_rows
            WHERE canonical_learner_id=ANY(%s) AND deleted_at IS NULL ORDER BY canonical_learner_id,id''',
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
        "owners": owner_by_aptem, "aptem": aptem_by_id, "evidence": evidence,
        "progress": progress, "sources": sources, "journals": journals,
        "segments": segments, "documents": documents,
    }


def accepted_valid(evidence: dict[str, Any], aptem_row: dict[str, Any]) -> bool:
    day = evidence_date(evidence)
    return bool(day and aptem_row["start_date"] <= day <= aptem_row["end_date"])


def evidence_id_for_source(source: dict[str, Any]) -> int | None:
    raw = source.get("source_payload") or {}
    value = source.get("source_activity_id") or ""
    if value.startswith("evidence:"):
        value = value.split(":", 1)[1]
    elif raw.get("Id") is not None:
        value = raw["Id"]
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def source_maps(current: dict[str, Any], owner_id: int):
    sources = [s for s in current["sources"] if s["learner_id"] == owner_id and s["source_system"] == "aptem"]
    exact: dict[int, list[dict[str, Any]]] = defaultdict(list)
    by_component: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for source in sources:
        eid = evidence_id_for_source(source)
        if eid is not None:
            exact[eid].append(source)
        component = (source.get("source_payload") or {}).get("ComponentId")
        if component is not None:
            by_component[str(component)].append(source)
    return exact, by_component


def exact_journal(current: dict[str, Any], owner_id: int, evidence: dict[str, Any]):
    ref = f"asg:{evidence['component_id']}:evidence:{evidence['evidence_id']}"
    rows = [j for j in current["journals"] if j["canonical_learner_id"] == owner_id and j.get("source_ref") == ref and j["accepted"]]
    return [j for j in rows if j.get("actual_hours") and not j.get("deleted_at")]


def attendance_journal_day(current: dict[str, Any], owner_id: int, day: date):
    return [j for j in current["journals"] if j["canonical_learner_id"] == owner_id
            and j["category"] == "attendance" and j["activity_date"] == day
            and j["accepted"] and j.get("actual_hours") and not j.get("deleted_at")]


def aptem_total(current: dict[str, Any], aptem_id: int) -> int:
    seen_attendance = set()
    total = 0
    for row in current["evidence"]:
        if int(row["learner_id"]) != aptem_id or not accepted_valid(row, current["aptem"][aptem_id]):
            continue
        seconds = int(Decimal(str(row["spent_time"])) * 60)
        if is_attendance(row):
            key = (evidence_date(row), str(row["component_id"]), str(row.get("spent_time")), " ".join(str(row.get("note_content") or "").split()).lower())
            if key in seen_attendance:
                continue
            seen_attendance.add(key)
        total += seconds
    return total


def current_ssot(current: dict[str, Any], owner_id: int) -> int:
    return sum(int(row.get("actual_seconds") or 0) for row in current["progress"]
               if row["learner_id"] == owner_id and row["accepted"] and not row.get("deleted_at"))


def qualifying_null_parents(current: dict[str, Any], aptem_id: int, owner_id: int, valid_evidence: dict[int, dict[str, Any]]):
    progress_by_id = {p["id"]: p for p in current["progress"] if p["learner_id"] == owner_id and not p.get("deleted_at")}
    exact, _ = source_maps(current, owner_id)
    source_by_parent: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for source in current["sources"]:
        if source["learner_id"] == owner_id and not source.get("deleted_at") and source.get("canonical_progress_id"):
            source_by_parent[source["canonical_progress_id"]].append(source)
    plans = []
    for parent_id, sources in source_by_parent.items():
        parent = progress_by_id.get(parent_id)
        if not parent or parent.get("actual_seconds") is not None or not parent.get("accepted"):
            continue
        if parent.get("source_system") != "aptem" or any(s.get("source_system") != "aptem" for s in sources):
            continue
        eids = [eid for eid, rows in exact.items() if any(s["id"] in {r["id"] for r in rows} for s in sources) and eid in valid_evidence]
        if not eids:
            continue
        if any(s.get("actual_seconds") is not None for s in sources):
            continue
        plans.append({"kind": "recover_parent", "parent_id": parent_id, "evidence_ids": sorted(eids), "sources": sources})
    return plans


def occupied_usage(current: dict[str, Any], owner_id: int) -> dict[date, int]:
    usage: dict[date, int] = defaultdict(int)
    for row in current["journals"]:
        if row["canonical_learner_id"] != owner_id or row.get("deleted_at") or not row.get("accepted"):
            continue
        if row.get("activity_date") and row.get("actual_hours"):
            usage[row["activity_date"]] = max(usage[row["activity_date"]], int(Decimal(str(row["actual_hours"])) * 3600))
    progress = {p["id"]: p for p in current["progress"] if p["learner_id"] == owner_id and not p.get("deleted_at")}
    seg_total: dict[date, int] = defaultdict(int)
    for row in current["segments"]:
        if row["learner_id"] != owner_id or row["progress_id"] not in progress:
            continue
        day = london_date(row.get("reporting_started_at"))
        if day:
            seg_total[day] += int(row.get("actual_seconds") or 0)
    for p in progress.values():
        if p.get("actual_seconds") and p.get("reporting_started_at") and not p.get("reporting_ended_at"):
            day = london_date(p["reporting_started_at"])
            if day:
                seg_total[day] += int(p["actual_seconds"] or 0)
    for day, seconds in seg_total.items():
        usage[day] = max(usage.get(day, 0), seconds)
    return usage


def allocate(owner_usage: dict[date, int], planned_usage: dict[date, int], anchor: date, seconds: int):
    segments = []
    remaining = int(seconds)
    for distance in range(0, 370):
        if remaining <= 0:
            break
        offsets = [0] if distance == 0 else [distance, -distance]
        for offset in offsets:
            if remaining <= 0:
                break
            day = anchor + timedelta(days=offset)
            if day.weekday() >= 5 or day in bank_holidays():
                continue
            used = int(owner_usage.get(day, 0)) + int(planned_usage.get(day, 0))
            capacity = DAILY_SECONDS - used
            if capacity <= 0:
                continue
            allocated = min(remaining, capacity)
            start = datetime.combine(day, time(9, 0), tzinfo=UK) + timedelta(seconds=used)
            end = start + timedelta(seconds=allocated)
            if end.astimezone(UK).date() != day or end > datetime.combine(day, time(17, 0), tzinfo=UK):
                continue
            segments.append({"date": day.isoformat(), "seconds": allocated,
                             "start": start.isoformat(), "end": end.isoformat(),
                             "anchor_date": anchor.isoformat(), "estimated": day != anchor or True})
            planned_usage[day] = int(planned_usage.get(day, 0)) + allocated
            remaining -= allocated
    if remaining:
        raise ValueError(f"No weekday capacity for {seconds}s anchored at {anchor}.")
    segments.sort(key=lambda segment: segment["start"])
    return segments


def raw_payload(evidence: dict[str, Any], group_names: list[str], resolution: str, segments: list[dict[str, Any]], parent_id: int | None = None):
    raw = dict(evidence.get("evidence_raw") or {})
    raw["reconciliation"] = {
        "resolution": resolution, "estimated": True, "approval_required": True,
        "label": LABEL, "group_names": group_names,
        "source_evidence_id": evidence["evidence_id"],
        "original_evidence_date": str(evidence.get("evidence_at")),
        "canonical_progress_id": parent_id,
        "segments": segments,
    }
    raw["component_name"] = evidence.get("component_name") or evidence.get("evidence_name")
    if evidence.get("note_content"):
        raw["note_content"] = evidence["note_content"]
    return raw


def build_plan(current: dict[str, Any]) -> dict[str, Any]:
    progress_by_id = {p["id"]: p for p in current["progress"]}
    by_evidence = {int(e["evidence_id"]): e for e in current["evidence"]}
    group_for = defaultdict(list)
    for name, group in GROUPS.items():
        for aid in group["learner_ids"]:
            group_for[aid].append(name)
    report: dict[str, Any] = {"groups": {}, "learners": [], "actions": [], "skipped": []}
    planned_by_owner = defaultdict(lambda: defaultdict(int))
    for aid in ALL_APTEM_IDS:
        owner = current["owners"][aid]
        owner_id = owner["id"]
        aptem_row = current["aptem"][aid]
        aptem_seconds = aptem_total(current, aid)
        before = current_ssot(current, owner_id)
        valid = {int(e["evidence_id"]): e for e in current["evidence"]
                 if int(e["learner_id"]) == aid and accepted_valid(e, aptem_row)}
        below = before < aptem_seconds
        plans = []
        if below:
            null_parents = qualifying_null_parents(current, aid, owner_id, valid)
            for parent in null_parents:
                segs = []
                for eid in parent["evidence_ids"]:
                    e = by_evidence[eid]
                    anchor = evidence_date(e)
                    segs.extend(allocate(occupied_usage(current, owner_id), planned_by_owner[owner_id], anchor, int(Decimal(str(e["spent_time"])) * 60)))
                segs.sort(key=lambda segment: segment["start"])
                plans.append({**parent, "segments": segs, "seconds": sum(int(by_evidence[eid]["spent_time"]) * 60 for eid in parent["evidence_ids"]), "group_names": group_for[aid]})
            exact, by_component = source_maps(current, owner_id)
            recovered_eids = {eid for p in plans for eid in p["evidence_ids"]}
            for eid, e in sorted(valid.items(), key=lambda item: (evidence_date(item[1]), item[0])):
                if eid in recovered_eids:
                    continue
                source_rows = exact.get(eid, [])
                if source_rows:
                    report["skipped"].append({"aptem_id": aid, "evidence_id": eid, "reason": "exact_source_present"})
                    continue
                jmatch = exact_journal(current, owner_id, e)
                if jmatch:
                    plans.append({"kind": "lineage_only", "evidence": e, "parent_id": jmatch[0]["progress_id"], "seconds": 0, "segments": [], "group_names": group_for[aid]})
                    continue
                comp = str(e["component_id"])
                positive_component = False
                for source in by_component.get(comp, []):
                    parent = progress_by_id.get(source.get("canonical_progress_id"))
                    if parent and parent.get("accepted") and int(parent.get("actual_seconds") or 0) > 0:
                        positive_component = True
                        break
                if positive_component:
                    report["skipped"].append({"aptem_id": aid, "evidence_id": eid, "reason": "component_already_counted"})
                    continue
                if is_attendance(e) and attendance_journal_day(current, owner_id, evidence_date(e)):
                    plans.append({"kind": "lineage_only", "evidence": e, "parent_id": None, "seconds": 0, "segments": [], "group_names": group_for[aid]})
                    continue
                anchor = evidence_date(e)
                segs = allocate(occupied_usage(current, owner_id), planned_by_owner[owner_id], anchor, int(Decimal(str(e["spent_time"])) * 60))
                plans.append({"kind": "new_parent", "evidence": e, "parent_id": None, "seconds": int(Decimal(str(e["spent_time"])) * 60), "segments": segs, "group_names": group_for[aid]})
        report["learners"].append({
            "aptem_id": aid, "name": owner["full_name"], "groups": group_for[aid],
            "aptem_valid_seconds": aptem_seconds, "ssot_before_seconds": before,
            "difference_before_seconds": before - aptem_seconds, "below_target": below,
            "planned_seconds": sum(int(p["seconds"]) for p in plans),
            "planned_action_count": len(plans),
            "planned_after_seconds": before + sum(int(p["seconds"]) for p in plans),
            "difference_after_seconds": before + sum(int(p["seconds"]) for p in plans) - aptem_seconds,
        })
        report["actions"].extend([{"aptem_id": aid, **p} for p in plans])
    for name, group in GROUPS.items():
        members = [r for r in report["learners"] if name in r["groups"]]
        report["groups"][name] = {
            "group_id": group["group_id"], "module_id": group["module_id"],
            "tutor": group["tutor"], "assigned_aptem_learners": len(group["learner_ids"]),
            "no_aptem_ids_in_screenshot": ["Aya Aya Test", "Aya Khater"],
            "aptem_valid_seconds": sum(r["aptem_valid_seconds"] for r in members),
            "ssot_before_seconds": sum(r["ssot_before_seconds"] for r in members),
            "planned_seconds": sum(r["planned_seconds"] for r in members),
            "ssot_after_seconds": sum(r["planned_after_seconds"] for r in members),
            "difference_after_seconds": sum(r["difference_after_seconds"] for r in members),
            "below_target_count": sum(1 for r in members if r["below_target"]),
        }
    report["database"] = current.get("database")
    report["fingerprint"] = digest({
        "groups": report["groups"], "learners": report["learners"],
        "actions": [{"aptem_id": a["aptem_id"], "kind": a["kind"], "evidence_id": (a.get("evidence") or {}).get("evidence_id"),
                     "parent_id": a.get("parent_id"), "seconds": a["seconds"], "segments": a["segments"]} for a in report["actions"]],
    })
    return report


def apply_plan(cur, current: dict[str, Any], report: dict[str, Any]) -> dict[str, Any]:
    owner_ids = [current["owners"][aid]["id"] for aid in ALL_APTEM_IDS]
    for owner_id in owner_ids:
        cur.execute("SELECT pg_advisory_xact_lock(hashtext('social-media-groups-reconciliation'),%s::integer)", [owner_id])
    run_id = insert_row(cur, "activity_sync_runs", {
        "run_key": RUN_KIND + ":" + report["fingerprint"], "run_kind": RUN_KIND,
        "status": "running", "dry_run": False, "prompt_version": "v1-two-groups-estimated",
        "source_counts": Jsonb({"groups": {name: group["group_id"] for name, group in GROUPS.items()},
                                 "aptem_ids": ALL_APTEM_IDS, "estimated": True}),
        "result_counts": Jsonb({}),
    })
    by_evidence = {int(e["evidence_id"]): e for e in current["evidence"]}
    progress_by_id = {p["id"]: p for p in current["progress"]}
    source_by_id = {s["id"]: s for s in current["sources"]}
    next_order = {owner_id: int(cur.execute('SELECT COALESCE(MAX(entry_order),0) n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [owner_id]).fetchone()["n"]) for owner_id in owner_ids}
    created_parents = updated_parents = source_rows = segments = documents = 0
    for action in report["actions"]:
        aid = int(action["aptem_id"]); owner = current["owners"][aid]; owner_id = owner["id"]
        group_names = action["group_names"]
        evidence_ids = (action.get("evidence_ids") or [int(action["evidence"]["evidence_id"])]) if action.get("evidence") else []
        parent_id = action.get("parent_id")
        if action["kind"] == "recover_parent":
            total = int(action["seconds"]); segs = action["segments"]
            first = datetime.fromisoformat(segs[0]["start"]); last = datetime.fromisoformat(segs[-1]["end"])
            cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=%s,actual_basis=%s,
                reporting_started_at=%s,reporting_ended_at=%s,reporting_month=%s,reporting_timestamp_label=%s,
                source_payload=%s,sync_run_id=%s,ssot_updated_at=now()
                WHERE id=%s AND learner_id=%s AND deleted_at IS NULL AND actual_seconds IS NULL''', [
                total, BASIS, first, last, min(seg["date"][:7] for seg in segs), LABEL,
                Jsonb({"reconciliation": {"resolution": "recover_null_accepted_aptem_parent", "estimated": True,
                                          "approval_required": True, "label": LABEL, "group_names": group_names,
                                          "evidence_ids": evidence_ids, "segments": segs}}), run_id, parent_id, owner_id])
            if cur.rowcount != 1:
                raise ValueError(f"Parent {parent_id} changed before apply.")
            updated_parents += 1
            for index, seg in enumerate(segs, 1):
                insert_row(cur, "learner_activity_reporting_segments", {
                    "progress_id": parent_id, "learner_id": owner_id, "segment_order": index,
                    "actual_seconds": int(seg["seconds"]), "reporting_started_at": datetime.fromisoformat(seg["start"]),
                    "reporting_ended_at": datetime.fromisoformat(seg["end"]), "reporting_month": seg["date"][:7], "sync_run_id": run_id,
                }); segments += 1
            for eid in evidence_ids:
                e = by_evidence[eid]
                source_rows_for_e = [s for s in current["sources"] if s["learner_id"] == owner_id and evidence_id_for_source(s) == eid]
                if len(source_rows_for_e) != 1:
                    raise ValueError(f"Evidence source cardinality changed for {eid}.")
                e_segs = [s for s in segs if s["anchor_date"] == str(evidence_date(e))]
                if not e_segs:
                    e_segs = segs
                start = datetime.fromisoformat(e_segs[0]["start"]); end = datetime.fromisoformat(e_segs[-1]["end"])
                cur.execute('''UPDATE "Learner".learner_activity_sources SET actual_seconds=%s,actual_basis=%s,
                    source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,reporting_ended_at=%s,
                    reporting_month=%s,canonical_progress_id=%s,sync_run_id=%s,last_seen_at=now(),source_payload=%s
                    WHERE id=%s AND deleted_at IS NULL AND actual_seconds IS NULL''', [
                    int(Decimal(str(e["spent_time"])) * 60), BASIS, start, end, start, end, e_segs[0]["date"][:7],
                    parent_id, run_id, Jsonb(raw_payload(e, group_names, "recover_null_accepted_aptem_parent", e_segs, parent_id)), source_rows_for_e[0]["id"]])
                if cur.rowcount != 1:
                    raise ValueError(f"Source {source_rows_for_e[0]['id']} changed before apply.")
                source_rows += 1
            continue
        e = action.get("evidence")
        if not e:
            continue
        eid = int(e["evidence_id"]); source_ref = f"evidence:{eid}"
        if action["kind"] == "lineage_only":
            segs = []
            start = end = None
            actual = 0
        else:
            segs = action["segments"]
            start = datetime.fromisoformat(segs[0]["start"]); end = datetime.fromisoformat(segs[-1]["end"]); actual = int(action["seconds"])
            next_order[owner_id] += 1
            parent_id = insert_row(cur, "learner_progress_entries", {
                "learner_id": owner_id, "entry_order": next_order[owner_id], "kind": "attendance" if is_attendance(e) else "aptem_evidence",
                "component_ref": source_ref, "component_title": e.get("component_name") or e.get("evidence_name"),
                "component_type": "attendance" if is_attendance(e) else "evidence", "enrolment_id": owner["enrolment_id"],
                "programme_id": owner["programme_id"], "aptem_id": aid, "source_system": "aptem", "source_activity_id": source_ref,
                "source_attempt_key": source_ref, "canonical_activity_key": f"aptem:{aid}:{source_ref}",
                "activity_status": "Accepted", "accepted": True, "actual_seconds": actual, "actual_basis": BASIS,
                "reporting_started_at": start, "reporting_ended_at": end, "reporting_month": segs[0]["date"][:7],
                "reporting_timestamp_label": LABEL, "source_payload": Jsonb(raw_payload(e, group_names, "estimated_missing_accepted_evidence", segs)), "sync_run_id": run_id,
            })
            created_parents += 1
            for index, seg in enumerate(segs, 1):
                insert_row(cur, "learner_activity_reporting_segments", {
                    "progress_id": parent_id, "learner_id": owner_id, "segment_order": index,
                    "actual_seconds": int(seg["seconds"]), "reporting_started_at": datetime.fromisoformat(seg["start"]),
                    "reporting_ended_at": datetime.fromisoformat(seg["end"]), "reporting_month": seg["date"][:7], "sync_run_id": run_id,
                }); segments += 1
        cur.execute('''INSERT INTO "Learner".learner_activity_sources
            (learner_id,enrolment_id,programme_id,aptem_id,source_system,source_activity_id,source_attempt_key,
             curriculum_component_id,canonical_activity_key,activity_type,title,activity_status,completed,accepted,
             actual_seconds,actual_basis,source_started_at,source_ended_at,reporting_started_at,reporting_ended_at,
             reporting_month,ksb_codes,source_payload,sync_run_id,canonical_progress_id,source_fingerprint)
            VALUES (%s,%s,%s,%s,'aptem',%s,%s,%s,%s,%s,%s,'Accepted',TRUE,TRUE,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT DO NOTHING''', [owner_id, owner["enrolment_id"], owner["programme_id"], aid, source_ref, source_ref,
                e["component_id"], f"aptem:{aid}:{source_ref}", "attendance" if is_attendance(e) else "evidence",
                e.get("component_name") or e.get("evidence_name"), actual, BASIS if actual else "aptem:accepted-evidence-lineage-only",
                start, end, start, end, (segs[0]["date"][:7] if segs else evidence_date(e).strftime("%Y-%m")), Jsonb(e.get("ksb_codes") or []),
                Jsonb(raw_payload(e, group_names, action["kind"], segs, parent_id)), run_id, parent_id, digest(e)])
        source_rows += 1
        if e.get("file_blob") and parent_id is not None and not cur.execute('''SELECT 1 FROM "Learner".learner_activity_documents WHERE source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL''', [source_ref + ":file"]).fetchone():
            insert_row(cur, "learner_activity_documents", {
                "learner_id": owner_id, "progress_id": parent_id, "source_system": "aptem", "source_document_id": source_ref + ":file",
                "container": CONTAINER, "blob_name": e["file_blob"], "display_name": e.get("evidence_name") or "Aptem evidence",
                "content_type": mimetypes.guess_type(e.get("evidence_name") or "")[0] or "application/octet-stream", "uploaded_at": e.get("submission_date"),
            }); documents += 1
    result = {"run_id": run_id, "estimated": True, "approval_required": True, "label": LABEL,
              "created_parents": created_parents, "updated_parents": updated_parents,
              "source_rows": source_rows, "segments": segments, "documents": documents,
              "planned_seconds": sum(int(a["seconds"]) for a in report["actions"])}
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed_with_issues',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''', [Jsonb(result), run_id])
    return result


def main():
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
            current = state(cur); current["database"] = database
            report = build_plan(current); report["database"] = database
            if args.apply:
                if database != args.expected_database or report["fingerprint"] != args.expected_fingerprint:
                    raise ValueError("Database or reviewed fingerprint changed; preview again.")
                report["applied"] = apply_plan(cur, current, report)
            print(json.dumps(report, default=str, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)
