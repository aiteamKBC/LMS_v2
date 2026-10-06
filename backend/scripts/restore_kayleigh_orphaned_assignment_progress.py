"""Restore evidence-backed assignment progress orphaned by a topic split.

The topic-split closeout soft-deleted the original assignment progress rows and
the later date guard soft-deleted every derived topic row.  The Journal rows,
the accepted Aptem evidence, and the evidence-source lineage remain intact.
This narrow repair restores only the original progress rows whose Journal
hours exactly equal the sum of the selected Accepted Aptem evidence.  It never
creates a second activity and it refuses to run if an active replacement is
found.

Preview is read-only.  ``--apply`` requires the reviewed database name and
fingerprint printed by the preview.
"""

from __future__ import annotations

import argparse
from datetime import date
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


LEARNER_ID = 596
APTEM_ID = 1900
TARGET_PROGRESS = {
    506050: {"journal_ref": "asg:13006", "evidence_ids": [4026]},
    506301: {"journal_ref": "asg:20174", "evidence_ids": [43178, 43179, 43249, 43250, 43274]},
    506302: {"journal_ref": "asg:19649", "evidence_ids": [15035]},
    506516: {"journal_ref": "asg:19719:evidence:14815", "evidence_ids": [14815]},
    506517: {"journal_ref": "asg:19719:evidence:14816", "evidence_ids": [14816]},
    506518: {"journal_ref": "asg:19719:evidence:14817", "evidence_ids": [14817]},
    506593: {"journal_ref": "asg:20314", "evidence_ids": [43574]},
    506594: {"journal_ref": "asg:19754", "evidence_ids": [20259, 48670]},
    506209: {"journal_ref": "asg:19614:evidence:16715", "evidence_ids": [16715]},
    506392: {"journal_ref": "asg:19684:evidence:19331", "evidence_ids": [19331]},
    506515: {"journal_ref": "asg:20279:evidence:20137", "evidence_ids": [20137]},
    506868: {"journal_ref": "asg:67199:evidence:42988", "evidence_ids": [42988]},
}


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def database_url() -> str:
    values = dict(os.environ)
    for line in (Path(__file__).resolve().parents[1] / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    url = values.get("ENROLMENT_DATABASE_URL") or values.get("Database_url") or values.get("DATABASE_URL")
    if not url:
        raise ValueError("No configured enrolment database.")
    return url


def read_state(cur) -> dict[str, Any]:
    owner = cur.execute(
        'SELECT id,aptem_id,full_name,enrolment_id,programme_id FROM "Learner".learners WHERE id=%s',
        [LEARNER_ID],
    ).fetchone()
    if not owner or int(owner["aptem_id"]) != APTEM_ID:
        raise ValueError("Kayleigh Hill identity changed; refusing repair.")

    progress = cur.execute(
        '''SELECT id,component_ref,component_title,activity_status,accepted,actual_seconds,
                  actual_basis,reporting_month,deleted_at,sync_run_id,canonical_activity_key
             FROM "Learner".learner_progress_entries
            WHERE learner_id=%s AND id=ANY(%s) ORDER BY id''',
        [LEARNER_ID, list(TARGET_PROGRESS)],
    ).fetchall()
    if len(progress) != len(TARGET_PROGRESS):
        raise ValueError("A targeted progress row is missing.")

    refs = [spec["journal_ref"] for spec in TARGET_PROGRESS.values()]
    journals = cur.execute(
        '''SELECT id,source_ref,title,activity_date,actual_hours,accepted,deleted_at,progress_id
             FROM "Learner".learner_journal_rows
            WHERE canonical_learner_id=%s AND source_ref=ANY(%s) ORDER BY id''',
        [LEARNER_ID, refs],
    ).fetchall()
    if len(journals) != len(refs):
        raise ValueError("A targeted active Journal row is missing.")

    evidence_ids = sorted({eid for spec in TARGET_PROGRESS.values() for eid in spec["evidence_ids"]})
    evidence = cur.execute(
        '''SELECT evidence_id,component_id,evidence_name,evidence_status,spent_time,
                  hours_type,spent_time_type,completed_date_override,completed_date,submission_date
             FROM fetching_evidence.evidence_items
            WHERE learner_id=%s AND evidence_id=ANY(%s) ORDER BY evidence_id''',
        [APTEM_ID, evidence_ids],
    ).fetchall()
    if len(evidence) != len(evidence_ids):
        raise ValueError("A selected Aptem Evidence row is missing.")

    active_replacements = cur.execute(
        '''SELECT id,component_ref,source_activity_id,actual_seconds,canonical_activity_key
             FROM "Learner".learner_progress_entries
            WHERE learner_id=%s AND deleted_at IS NULL
              AND (source_payload->>'original_source_ref'=ANY(%s)
                   OR component_ref=ANY(%s))
            ORDER BY id''',
        [LEARNER_ID, refs, refs],
    ).fetchall()

    source_rows = cur.execute(
        '''SELECT id,source_activity_id,canonical_progress_id,actual_seconds,accepted,deleted_at
             FROM "Learner".learner_activity_sources
            WHERE learner_id=%s AND canonical_progress_id=ANY(%s)
            ORDER BY id''',
        [LEARNER_ID, list(TARGET_PROGRESS)],
    ).fetchall()
    return {
        "owner": owner,
        "progress": progress,
        "journals": journals,
        "evidence": evidence,
        "active_replacements": active_replacements,
        "sources": source_rows,
    }


def build_plan(state: dict[str, Any]) -> dict[str, Any]:
    if state["active_replacements"]:
        raise ValueError("An active replacement exists; refusing to restore a duplicate.")
    progress = {int(row["id"]): row for row in state["progress"]}
    journals = {row["source_ref"]: row for row in state["journals"]}
    evidence = {int(row["evidence_id"]): row for row in state["evidence"]}
    selected = []
    for progress_id, spec in TARGET_PROGRESS.items():
        p = progress[progress_id]
        j = journals[spec["journal_ref"]]
        if j["deleted_at"] is not None or not j["accepted"] or int(j["progress_id"]) != progress_id:
            raise ValueError(f"Journal linkage changed for progress {progress_id}.")
        if p["deleted_at"] is None or p["accepted"]:
            raise ValueError(f"Progress {progress_id} is not the expected orphaned row.")
        if p["actual_seconds"] is None or Decimal(str(j["actual_hours"])) <= 0:
            raise ValueError(f"Progress {progress_id} has no positive Journal hours.")
        rows = [evidence[eid] for eid in spec["evidence_ids"]]
        for e in rows:
            if e["evidence_status"] != "Accepted":
                raise ValueError(f"Evidence {e['evidence_id']} is not Accepted.")
            if Decimal(str(e["spent_time"])) <= 0:
                continue
            if e["hours_type"] != "OffTheJobTraining" or e["spent_time_type"] != "PaidWorkingHours":
                raise ValueError(f"Evidence {e['evidence_id']} is not paid OTJ evidence.")
        evidence_seconds = sum(int(Decimal(str(e["spent_time"])) * 60) for e in rows)
        if evidence_seconds != int(p["actual_seconds"]):
            raise ValueError(
                f"Progress {progress_id} differs from selected evidence: "
                f"progress={p['actual_seconds']} evidence={evidence_seconds}."
            )
        selected.append(
            {
                "progress_id": progress_id,
                "journal_id": j["id"],
                "journal_ref": spec["journal_ref"],
                "component_title": p["component_title"],
                "reporting_month": p["reporting_month"],
                "seconds": int(p["actual_seconds"]),
                "evidence_ids": spec["evidence_ids"],
            }
        )
    total = sum(row["seconds"] for row in selected)
    return {
        "learner_id": LEARNER_ID,
        "aptem_id": APTEM_ID,
        "target_count": len(selected),
        "selected": selected,
        "restored_seconds": total,
        "restored_minutes": total // 60,
        "reason": "journal rows remain active and equal Accepted Aptem evidence, while both parent and derived progress were soft-deleted",
    }


def current_metrics(cur) -> dict[str, int]:
    row = cur.execute(
        '''SELECT count(*) FILTER (WHERE deleted_at IS NULL AND accepted) AS count,
                  coalesce(sum(actual_seconds) FILTER (WHERE deleted_at IS NULL AND accepted),0) AS seconds
             FROM "Learner".learner_progress_entries WHERE learner_id=%s''',
        [LEARNER_ID],
    ).fetchone()
    aptem = cur.execute(
        '''SELECT coalesce(sum(spent_time)*60,0) AS seconds
             FROM fetching_evidence.evidence_items
            WHERE learner_id=%s AND evidence_status='Accepted' AND spent_time>0''',
        [APTEM_ID],
    ).fetchone()
    return {"active_accepted_count": int(row["count"]), "ssot_seconds": int(row["seconds"]), "aptem_seconds": int(aptem["seconds"])}


def apply(cur, state: dict[str, Any], plan: dict[str, Any], fingerprint: str) -> int:
    before = current_metrics(cur)
    run = cur.execute(
        '''INSERT INTO "Learner".activity_sync_runs
           (run_key,run_kind,status,dry_run,source_counts,result_counts,started_at,created_at,updated_at)
           VALUES (%s,%s,'running',false,%s,%s,now(),now(),now()) RETURNING id''',
        [
            "kayleigh-orphaned-assignment-restore:" + fingerprint,
            "kayleigh-orphaned-assignment-progress-restore",
            Jsonb({"learner_id": LEARNER_ID, "aptem_id": APTEM_ID, "evidence_ids": sorted({eid for x in plan["selected"] for eid in x["evidence_ids"]})}),
            Jsonb({"planned_rows": plan["target_count"], "restored_seconds": plan["restored_seconds"], "hard_deletes": 0, "soft_deletes": 0}),
        ],
    ).fetchone()["id"]
    for item in plan["selected"]:
        updated = cur.execute(
            '''UPDATE "Learner".learner_progress_entries
                  SET activity_status='completed',accepted=true,deleted_at=NULL,
                      sync_run_id=%s,ssot_updated_at=now()
                WHERE id=%s AND learner_id=%s AND deleted_at IS NOT NULL AND accepted=false
                RETURNING id''',
            [run, item["progress_id"], LEARNER_ID],
        ).fetchone()
        if not updated:
            raise ValueError(f"Progress {item['progress_id']} changed during apply.")
        cur.execute(
            '''UPDATE "Learner".learner_activity_sources
                  SET canonical_progress_id=%s,sync_run_id=%s,last_seen_at=now()
                WHERE learner_id=%s AND canonical_progress_id=%s AND deleted_at IS NULL''',
            [item["progress_id"], run, LEARNER_ID, item["progress_id"]],
        )
    after = current_metrics(cur)
    expected = before["ssot_seconds"] + plan["restored_seconds"]
    if after["ssot_seconds"] != expected:
        raise ValueError(f"SSOT verification failed: expected {expected}, got {after['ssot_seconds']}.")
    cur.execute(
        '''UPDATE "Learner".activity_sync_runs
              SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s
            WHERE id=%s''',
        [Jsonb({"planned_rows": plan["target_count"], "restored_seconds": plan["restored_seconds"], "before": before, "after": after, "hard_deletes": 0, "soft_deletes": 0}), run],
    )
    return int(run)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(database_url(), connect_timeout=20, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=5000")
            database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            state = read_state(cur)
            plan = build_plan(state)
            metrics = current_metrics(cur)
            report = {"database": database, "metrics_before": metrics, "plan": plan}
            fingerprint = digest(report)
            if args.apply:
                if database != args.expected_database or fingerprint != args.expected_fingerprint:
                    raise ValueError("Database or reviewed fingerprint changed; preview again.")
                cur.execute("SELECT id FROM \"Learner\".learners WHERE id=%s FOR UPDATE", [LEARNER_ID])
                run_id = apply(cur, state, plan, fingerprint)
                print(json.dumps({"database": database, "run_id": run_id, "fingerprint": fingerprint, "metrics_before": metrics, "plan": plan}, default=str, sort_keys=True))
            else:
                report["fingerprint"] = fingerprint
                print(json.dumps(report, default=str, sort_keys=True, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}))
        raise SystemExit(1)
