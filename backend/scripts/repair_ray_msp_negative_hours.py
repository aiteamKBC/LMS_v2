"""Scoped repair for negative SSOT-minus-Aptem hours in Ray MSP Jan.

The script is intentionally fingerprinted and two-phase.  A preview classifies
the exact evidence IDs selected from the audit; ``--apply`` requires that
fingerprint and the reviewed database name.  It never hard-deletes or revives
deleted journal/source rows.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

UK = ZoneInfo("Europe/London")
GROUP_ID = "APTEM-GROUP-4d0bf743cf6d8e9a5cb60a44d25c34b0"
PROGRAMME_ID = "PROG-PCP-L6"
RUN_KEY_PREFIX = "ray-msp-negative-hours-repair:"

# Explicitly reviewed evidence.  These are the only records this repair may
# write.  Duplicate/Not Attended IDs are retained in the audit report only.
TARGETS = {
    6310: {"add": [41969, 41970, 43944], "normalise": [], "zero": [27666, 27668, 47413], "duplicates": []},
    6425: {"add": [41965, 56288, 56289, 57231, 57232], "normalise": [25321, 26230, 27580], "zero": [40515], "duplicates": [41986]},
    6732: {"add": [41575, 48524, 54614, 56275], "normalise": [25322, 26224, 27586], "zero": [], "duplicates": []},
    8170: {"add": [42451, 49179, 55604, 56267], "normalise": [25341, 26233, 27575, 42450], "zero": [42452, 49754, 49755, 49181], "duplicates": []},
    8903: {"add": [48518, 54593, 56264], "normalise": [25323, 26223, 27572], "zero": [44884], "duplicates": [27573]},
    9314: {"add": [27681, 54588, 56278], "normalise": [27682, 27683], "zero": [40947], "duplicates": []},
    9866: {"add": [41569, 48530, 56268], "normalise": [25328], "zero": [27578, 27579, 39607, 46810, 48531], "duplicates": []},
    10071: {"add": [41572, 48575, 54596, 56270], "normalise": [25327, 26227, 27577], "zero": [54130], "duplicates": []},
}


def database_url() -> str:
    values = dict(os.environ)
    env_path = Path(__file__).resolve().parents[1] / ".env"
    for line in env_path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = values.get("ENROLMENT_DATABASE_URL") or values.get("Database_url") or values.get("DATABASE_URL")
    if not url:
        raise ValueError("No configured enrolment database")
    return url


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, default=str, sort_keys=True).encode()).hexdigest()


def local_day(evidence):
    at = evidence.get("completed_date_override") or evidence.get("completed_date") or evidence.get("submission_date")
    if not isinstance(at, datetime) or at.tzinfo is None:
        raise ValueError(f"Evidence {evidence['evidence_id']} has no timezone-aware timestamp")
    return at.astimezone(UK).date()


def raw_for(e):
    raw = dict(e.get("evidence_raw") or {})
    raw.setdefault("Id", e["evidence_id"])
    raw["reconciliation"] = {
        "run_kind": "ray-msp-negative-hours-repair",
        "source_table": "fetching_evidence.evidence_items",
        "selected_evidence_id": e["evidence_id"],
        "rule": "Accepted paid OTJ evidence; explicit Not Attended=0 excluded; duplicate event collapsed",
    }
    if e.get("note_content"):
        raw["note_content"] = e["note_content"]
    return raw


def evidence(cur, evidence_id):
    row = cur.execute("""SELECT evidence_id, learner_id, component_id, component_name,
        evidence_name, evidence_status, spent_time, hours_type, spent_time_type,
        completed_date_override, completed_date, submission_date, source_synced_at,
        source_fetched_at, ksb_codes, evidence_raw, note_content, file_blob
        FROM fetching_evidence.evidence_items WHERE evidence_id=%s""", [evidence_id]).fetchone()
    if not row:
        raise ValueError(f"Evidence {evidence_id} not found")
    return row


def learner(cur, aptem_id):
    row = cur.execute("""SELECT id, aptem_id, enrolment_id, programme_id, group_id,
        start_date, end_date FROM \"Learner\".learners WHERE aptem_id=%s""", [aptem_id]).fetchone()
    if not row:
        raise ValueError(f"Learner {aptem_id} not found")
    if row["group_id"] != GROUP_ID or row["programme_id"] != PROGRAMME_ID:
        raise ValueError(f"Learner {aptem_id} is outside the reviewed Ray MSP scope")
    return row


def attendance_value(cur, aptem_id, day):
    rows = cur.execute("""SELECT attendance_value, activity_hours, attendance_status
        FROM \"Learner\".source_lms_attendance
        WHERE aptem_id=%s AND attendance_date=%s""", [aptem_id, day]).fetchall()
    values = [r["attendance_value"] for r in rows if r["attendance_value"] is not None]
    if any(v == 0 for v in values):
        return 0
    if any(v == 1 for v in values):
        return 1
    return None


def journal_matches(cur, learner_id, day):
    return cur.execute("""SELECT id, actual_hours, accepted, progress_id, source_ref,
        title, deleted_at FROM \"Learner\".learner_journal_rows
        WHERE canonical_learner_id=%s AND category='attendance' AND activity_date=%s
        ORDER BY id""", [learner_id, day]).fetchall()


def active_sources(cur, learner_id, evidence_id):
    return cur.execute("""SELECT id, canonical_progress_id, actual_seconds, deleted_at
        FROM \"Learner\".learner_activity_sources
        WHERE learner_id=%s AND source_system='aptem'
          AND (source_activity_id=%s OR source_payload->>'Id'=%s)
        ORDER BY id""", [learner_id, f"evidence:{evidence_id}", str(evidence_id)]).fetchall()


def classify(cur, learners):
    plan = []
    for aptem_id, config in TARGETS.items():
        owner = learners[aptem_id]
        for action in ("add", "normalise", "zero", "duplicates"):
            for evidence_id in config[action]:
                e = evidence(cur, evidence_id)
                if int(e["learner_id"]) != aptem_id:
                    raise ValueError(f"Evidence {evidence_id} belongs to another Aptem learner")
                day = local_day(e)
                seconds = int(Decimal(str(e["spent_time"])) * 60)
                att = attendance_value(cur, aptem_id, day)
                journals = journal_matches(cur, owner["id"], day)
                active_j = [j for j in journals if j["deleted_at"] is None]
                deleted_j = [j for j in journals if j["deleted_at"] is not None]
                sources = active_sources(cur, owner["id"], evidence_id)
                active_s = [s for s in sources if s["deleted_at"] is None]
                if action == "zero" or att == 0:
                    resolution = "not_attended_zero"
                elif action == "duplicates":
                    resolution = "duplicate_event"
                elif active_s:
                    resolution = "already_present"
                elif action == "normalise" and len(active_j) == 1:
                    resolution = "normalise_journal"
                elif action == "normalise" and deleted_j:
                    resolution = "deleted_journal_review"
                elif action == "normalise":
                    resolution = "missing_journal_review"
                elif sources and not active_j:
                    # Keep the historical soft-deleted rows untouched, and
                    # create a fresh active representation for this accepted
                    # evidence.  The new payload records which rows it
                    # supersedes; nothing is revived or hard-deleted.
                    resolution = "restore_as_new_attendance"
                elif active_j:
                    resolution = "journal_present_review"
                else:
                    resolution = "new_attendance"
                plan.append({
                    "aptem_id": aptem_id, "learner_id": owner["id"], "evidence_id": evidence_id,
                    "action": action, "resolution": resolution, "day": str(day),
                    "seconds": seconds, "attendance_value": att,
                    "component_id": e["component_id"], "component_name": e["component_name"],
                    "evidence_status": e["evidence_status"],
                    "journal_ids": [j["id"] for j in journals],
                    "active_journal_ids": [j["id"] for j in active_j],
                    "deleted_journal_ids": [j["id"] for j in deleted_j],
                    "journal_hours": [str(j["actual_hours"]) for j in journals],
                    "journal_progress_ids": [j["progress_id"] for j in journals],
                    "source_ids": [s["id"] for s in sources],
                    "active_source_ids": [s["id"] for s in active_s],
                })
    return plan


def get_state(cur):
    learners = {}
    rows = cur.execute("""SELECT id, aptem_id, enrolment_id, programme_id, group_id,
        start_date, end_date FROM \"Learner\".learners
        WHERE group_id=%s AND programme_id=%s ORDER BY aptem_id""", [GROUP_ID, PROGRAMME_ID]).fetchall()
    for row in rows:
        learners[int(row["aptem_id"])] = row
    missing = set(TARGETS) - set(learners)
    if missing:
        raise ValueError(f"Target learners outside canonical group: {sorted(missing)}")
    if len(learners) != 27:
        raise ValueError(f"Expected 27 canonical Ray members, found {len(learners)}")
    plan = classify(cur, learners)
    fingerprint = digest({"group_id": GROUP_ID, "programme_id": PROGRAMME_ID, "learners": learners, "plan": plan})
    return learners, plan, fingerprint


def insert(cur, table, values):
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, values)),
        sql.SQL(',').join(sql.Placeholder() for _ in values))
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def apply(cur, learners, plan, fingerprint):
    writable = [p for p in plan if p["resolution"] in {"new_attendance", "restore_as_new_attendance", "normalise_journal"}]
    if not writable:
        return None, {"writable": 0}
    if cur.execute('SELECT id FROM "Learner".activity_sync_runs WHERE run_key=%s', [RUN_KEY_PREFIX + fingerprint]).fetchone():
        raise ValueError("A repair run with this fingerprint already exists")
    run_id = insert(cur, "activity_sync_runs", {
        "run_key": RUN_KEY_PREFIX + fingerprint,
        "run_kind": "ray-msp-negative-hours-repair",
        "status": "running", "dry_run": False,
        "source_counts": Jsonb({"group_id": GROUP_ID, "programme_id": PROGRAMME_ID,
                                 "target_learners": sorted(TARGETS), "planned_actions": len(plan)}),
        "result_counts": Jsonb({}),
    })
    counts = {"new_progress": 0, "new_sources": 0, "journal_normalised": 0,
              "seconds_added": 0, "seconds_normalised": 0,
              "not_attended_zero": sum(p["resolution"] == "not_attended_zero" for p in plan),
              "duplicates_collapsed": sum(p["resolution"] == "duplicate_event" for p in plan)}
    next_orders = {aid: (cur.execute('SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s', [row["id"]]).fetchone()["n"] or 0)
                   for aid, row in learners.items()}
    for p in writable:
        owner = learners[p["aptem_id"]]
        e = evidence(cur, p["evidence_id"])
        seconds = p["seconds"]
        at = e.get("completed_date_override") or e.get("completed_date") or e.get("submission_date")
        day = datetime.fromisoformat(p["day"]).date()
        end_at = at + timedelta(seconds=seconds) if seconds else at
        raw = raw_for(e)
        raw["reconciliation"].update({"resolution": p["resolution"], "sync_run_id": run_id,
                                      "reporting_date": p["day"], "canonical_learner_id": owner["id"],
                                      "superseded_deleted_source_ids": p["source_ids"]
                                      if p["resolution"] == "restore_as_new_attendance" else []})
        if p["resolution"] in {"new_attendance", "restore_as_new_attendance"}:
            next_orders[p["aptem_id"]] += 1
            source_ref = f"evidence:{p['evidence_id']}"
            key = f"aptem:{p['aptem_id']}:{source_ref}"
            progress_id = insert(cur, "learner_progress_entries", {
                "learner_id": owner["id"], "entry_order": next_orders[p["aptem_id"]],
                "kind": "attendance", "component_ref": source_ref,
                "component_title": e["component_name"] or e["evidence_name"],
                "component_type": "attendance", "enrolment_id": owner["enrolment_id"],
                "programme_id": owner["programme_id"], "aptem_id": owner["aptem_id"],
                "source_system": "aptem", "source_activity_id": source_ref,
                "canonical_activity_key": key, "activity_status": "Accepted", "accepted": True,
                "actual_seconds": seconds, "actual_basis": "aptem:accepted-evidence-spent-minutes",
                "reporting_started_at": at, "reporting_ended_at": end_at,
                "reporting_month": day.strftime("%Y-%m"), "source_payload": Jsonb(raw),
                "sync_run_id": run_id,
            })
            insert(cur, "learner_activity_sources", {
                "learner_id": owner["id"], "enrolment_id": owner["enrolment_id"],
                "programme_id": owner["programme_id"], "aptem_id": owner["aptem_id"],
                "source_system": "aptem", "source_activity_id": source_ref,
                "canonical_activity_key": key, "activity_type": "attendance",
                "title": e["component_name"] or e["evidence_name"], "activity_status": "Accepted",
                "completed": True, "accepted": True, "actual_seconds": seconds,
                "actual_basis": "aptem:accepted-evidence-spent-minutes",
                "source_started_at": at, "source_ended_at": end_at,
                "reporting_started_at": at, "reporting_ended_at": end_at,
                "reporting_month": day.strftime("%Y-%m"), "ksb_codes": Jsonb(e["ksb_codes"] or []),
                "source_payload": Jsonb(raw),
                "source_updated_at": e["source_synced_at"] or e["source_fetched_at"],
                "sync_run_id": run_id, "canonical_progress_id": progress_id,
                "source_fingerprint": digest({k: str(v) for k, v in e.items() if k not in {"evidence_raw", "note_content"}}),
            })
            counts["new_progress"] += 1; counts["new_sources"] += 1; counts["seconds_added"] += seconds
        else:
            j = cur.execute('SELECT id,progress_id,actual_hours FROM "Learner".learner_journal_rows WHERE id=%s FOR UPDATE', [p["active_journal_ids"][0]]).fetchone()
            target_hours = Decimal(seconds) / Decimal(3600)
            progress_id = j["progress_id"]
            cur.execute('''UPDATE "Learner".learner_journal_rows
                SET actual_hours=%s, updated_by=%s, updated_at=now()
                WHERE id=%s''', [target_hours, "ray-msp-negative-hours-repair", j["id"]])
            if progress_id:
                payload = cur.execute('SELECT source_payload FROM "Learner".learner_progress_entries WHERE id=%s FOR UPDATE', [progress_id]).fetchone()
                if not payload:
                    raise ValueError(f"Journal {j['id']} points to missing progress {progress_id}")
                pp = dict(payload["source_payload"] or {})
                pp.setdefault("reconciliation", {})
                pp["reconciliation"].update({"run_kind": "ray-msp-negative-hours-repair", "resolution": "normalise_journal", "evidence_id": p["evidence_id"], "sync_run_id": run_id})
                cur.execute('''UPDATE "Learner".learner_progress_entries SET actual_seconds=%s,
                    actual_basis=%s, source_payload=%s, sync_run_id=%s WHERE id=%s''',
                            [seconds, "journal:accepted-aptem-attendance-normalized", Jsonb(pp), run_id, progress_id])
                sources = cur.execute('''SELECT id,source_payload FROM "Learner".learner_activity_sources
                    WHERE learner_id=%s AND canonical_progress_id=%s AND deleted_at IS NULL FOR UPDATE''', [owner["id"], progress_id]).fetchall()
                if len(sources) > 1:
                    raise ValueError(f"Journal {j['id']} expected at most one active source, found {len(sources)}")
                if sources:
                    sp = dict(sources[0]["source_payload"] or {})
                    sp.setdefault("reconciliation", {})
                    sp["reconciliation"].update({"run_kind": "ray-msp-negative-hours-repair", "resolution": "normalise_journal", "evidence_id": p["evidence_id"], "sync_run_id": run_id})
                    cur.execute('''UPDATE "Learner".learner_activity_sources SET actual_seconds=%s,
                        actual_basis=%s, source_payload=%s, sync_run_id=%s, last_seen_at=now()
                        WHERE id=%s''', [seconds, "journal:accepted-aptem-attendance-normalized", Jsonb(sp), run_id, sources[0]["id"]])
            counts["journal_normalised"] += 1
            counts["seconds_normalised"] += seconds - int(Decimal(str(j["actual_hours"])) * 3600)
    cur.execute('''UPDATE "Learner".activity_sync_runs SET status='completed', finished_at=now(),
        updated_at=now(), result_counts=%s WHERE id=%s''', [Jsonb(counts), run_id])
    return run_id, counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(database_url(), row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=30000")
            cur.execute("SET LOCAL lock_timeout=5000")
            db = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            if args.apply:
                if db != args.expected_database:
                    raise ValueError("Database differs from reviewed preview")
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('ray-msp-negative-hours-repair'))")
                for row in cur.execute('SELECT id FROM "Learner".learners WHERE group_id=%s AND programme_id=%s FOR UPDATE', [GROUP_ID, PROGRAMME_ID]).fetchall():
                    pass
            learners, plan, fingerprint = get_state(cur)
            output = {"database": db, "group_id": GROUP_ID, "programme_id": PROGRAMME_ID,
                      "learner_count": len(learners), "fingerprint": fingerprint,
                      "plan": plan}
            if args.apply:
                if fingerprint != args.expected_fingerprint:
                    raise ValueError("Data changed since preview; preview again")
                run_id, counts = apply(cur, learners, plan, fingerprint)
                output.update({"applied": True, "run_id": run_id, "counts": counts})
        # psycopg commits here only after all checks and writes have succeeded.
    print(json.dumps(output, default=str))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc)}))
        raise SystemExit(1)
