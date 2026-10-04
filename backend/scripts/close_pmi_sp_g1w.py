"""Close the reviewed PMI-SP G1-W reconciliation without inflating hours.

The four accepted Aptem attachments selected here are aggregate or malformed
LMS evidence.  They are retained as source lineage with no counted seconds:
the granular canonical activities/attendance remain the only hour-bearing
records.  Preview is read-only; apply requires the reviewed database name and
preview fingerprint.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


MODULE_TITLE = "PMI-SP Scheduling Professional"
PROGRAMME_NAME = "Project Controls Professional Level 6"
COHORT_NAME = "Feb 2026"
GROUP_NAME = "G1-W"
APTEM_SOURCE_GROUP_ID = "145544"
EXPECTED_MODULE_ID = "MOD-20261001105703419367E214F45713C3"
EXPECTED_ROSTER_COUNT = 18
EVIDENCE_IDS = (57336, 57417, 57418, 57425)

# These decisions were made from the inspected Azure documents and the
# existing canonical activity rows.  They deliberately do not guess dates or
# split a single aggregate spent-time value across activities.
CLASSIFICATIONS = {
    57417: {
        "activity_type": "lms_activity",
        "actual_basis": "aggregate LMS evidence overlaps granular canonical LMS activities",
        "resolution": "aggregate_overlap_no_double_count",
        "reasons": [
            "accepted aggregate LMS attachment",
            "dated sections overlap granular canonical LMS activities",
            "no additional seconds may be counted",
        ],
    },
    57425: {
        "activity_type": "lms_activity",
        "actual_basis": "aggregate LMS evidence overlaps granular canonical LMS activities",
        "resolution": "aggregate_overlap_no_double_count",
        "reasons": [
            "accepted aggregate LMS attachment",
            "template contains duplicate/mixed sections without a safe allocation",
            "spent-time type is not PaidWorkingHours",
            "no additional seconds may be counted",
        ],
    },
    57336: {
        "activity_type": "evidence",
        "actual_basis": "aptem:accepted-evidence-spent-minutes:held-no-safe-date-time-allocation",
        "resolution": "reviewed_no_safe_allocation",
        "reasons": [
            "accepted LMS attachment has no per-activity time allocation",
            "document dates do not provide a complete, non-overlapping plan",
            "no additional seconds may be counted",
        ],
    },
    57418: {
        "activity_type": "evidence",
        "actual_basis": "aptem:accepted-evidence-spent-minutes:held-no-safe-date-time-allocation",
        "resolution": "reviewed_no_safe_allocation",
        "reasons": [
            "accepted additional-job attachment has no complete per-activity time allocation",
            "document contains a malformed date",
            "no additional seconds may be counted",
        ],
    },
}


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def database_url() -> str:
    values = dict(os.environ)
    env_file = Path(__file__).resolve().parents[1] / ".env"
    for line in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    value = values.get("ENROLMENT_DATABASE_URL") or values.get("Database_url") or values.get("DATABASE_URL")
    if not value:
        raise ValueError("No configured enrolment database.")
    return value


def insert(cur: psycopg.Cursor, table: str, values: dict[str, Any]) -> int:
    from psycopg import sql

    statement = sql.SQL(
        'INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id'
    ).format(
        sql.Identifier(table),
        sql.SQL(",").join(map(sql.Identifier, values)),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return int(cur.execute(statement, list(values.values())).fetchone()["id"])


def module_and_roster(cur: psycopg.Cursor) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    modules = cur.execute(
        '''SELECT module_catalogue_id,title,programme_name,cohort_name,group_id,
                  group_name,start_date,end_date,total_otjh,tutor_name,
                  session_week_day,session_start_time,session_end_time
             FROM curriculum.modules
            WHERE module_catalogue_id=%s AND title=%s AND deleted_at IS NULL''',
        [EXPECTED_MODULE_ID, MODULE_TITLE],
    ).fetchall()
    if len(modules) != 1:
        raise ValueError("Expected exactly one active PMI-SP G1-W module.")
    module = modules[0]
    if (module["programme_name"], module["cohort_name"], module["group_name"]) != (
        PROGRAMME_NAME,
        COHORT_NAME,
        GROUP_NAME,
    ):
        raise ValueError("The reviewed module identity changed.")

    roster = cur.execute(
        '''SELECT DISTINCT l.id,l.enrolment_id,l.programme_id,l.aptem_id
             FROM "Learner".learner_source_course_memberships m
             JOIN "Learner".learners l ON l.id=m.learner_id
            WHERE m.deleted_at IS NULL
              AND m.source_payload->>'group_id'=%s
              AND l.aptem_id IS NOT NULL
            ORDER BY l.id''',
        [APTEM_SOURCE_GROUP_ID],
    ).fetchall()
    if len(roster) != EXPECTED_ROSTER_COUNT or len({r["aptem_id"] for r in roster}) != EXPECTED_ROSTER_COUNT:
        raise ValueError("PMI-SP source roster is not the reviewed 18-learner roster.")
    return module, roster


def current_metrics(cur: psycopg.Cursor, learner_ids: list[int]) -> dict[str, Any]:
    row = cur.execute(
        '''SELECT count(*) FILTER (WHERE deleted_at IS NULL AND accepted) AS active_accepted,
                  coalesce(sum(actual_seconds) FILTER (WHERE deleted_at IS NULL AND accepted),0) AS accepted_seconds
             FROM "Learner".learner_progress_entries
            WHERE learner_id=ANY(%s)''',
        [learner_ids],
    ).fetchone()
    source_row = cur.execute(
        '''SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS active_sources,
                  coalesce(sum(actual_seconds) FILTER (WHERE deleted_at IS NULL),0) AS source_seconds
             FROM "Learner".learner_activity_sources
            WHERE learner_id=ANY(%s)''',
        [learner_ids],
    ).fetchone()
    return {
        "active_accepted_progress": int(row["active_accepted"]),
        "accepted_progress_seconds": int(row["accepted_seconds"]),
        "active_sources": int(source_row["active_sources"]),
        "source_seconds": int(source_row["source_seconds"]),
    }


def build_report(cur: psycopg.Cursor) -> dict[str, Any]:
    module, roster = module_and_roster(cur)
    learner_ids = [r["id"] for r in roster]
    metrics_before = current_metrics(cur, learner_ids)
    evidence = cur.execute(
        '''SELECT evidence_id,learner_id,component_id,component_name,evidence_name,
                  evidence_status,spent_time,hours_type,spent_time_type,
                  completed_date_override,completed_date,submission_date,
                  source_fetched_at,source_synced_at,ksb_codes
             FROM fetching_evidence.evidence_items
            WHERE evidence_id=ANY(%s)
            ORDER BY evidence_id''',
        [list(EVIDENCE_IDS)],
    ).fetchall()
    if [int(e["evidence_id"]) for e in evidence] != list(EVIDENCE_IDS):
        raise ValueError("The four reviewed evidence items are not all present.")
    roster_by_aptem = {int(r["aptem_id"]): r for r in roster}
    plans: list[dict[str, Any]] = []
    for item in evidence:
        evidence_id = int(item["evidence_id"])
        owner = roster_by_aptem.get(int(item["learner_id"]))
        if owner is None:
            raise ValueError("Reviewed evidence is outside the PMI-SP G1-W roster.")
        if item["evidence_status"] != "Accepted":
            raise ValueError("Only Accepted evidence may be retained in the closeout lineage.")
        existing = cur.execute(
            '''SELECT id,deleted_at,canonical_progress_id,actual_seconds,actual_basis
                 FROM "Learner".learner_activity_sources
                WHERE source_system='aptem' AND source_activity_id=%s
                ORDER BY id''',
            [f"evidence:{evidence_id}"],
        ).fetchall()
        if len(existing) > 1 or any(e["deleted_at"] is not None for e in existing):
            raise ValueError("Existing duplicate or deleted evidence source requires review.")
        classification = CLASSIFICATIONS[evidence_id]
        plans.append(
            {
                "evidence_id": evidence_id,
                "aptem_id": int(item["learner_id"]),
                "learner_id": int(owner["id"]),
                "component_id": int(item["component_id"]) if item["component_id"] is not None else None,
                "component_name": item["component_name"],
                "evidence_name": item["evidence_name"],
                "evidence_status": item["evidence_status"],
                "spent_time_minutes": str(item["spent_time"]),
                "spent_time_type": item["spent_time_type"],
                "classification": classification,
                "existing_source_id": int(existing[0]["id"]) if existing else None,
                "existing_source_actual_seconds": existing[0]["actual_seconds"] if existing else None,
                "existing_source_actual_basis": existing[0]["actual_basis"] if existing else None,
                "completed_date": item["completed_date_override"] or item["completed_date"] or item["submission_date"],
                "ksb_codes": item["ksb_codes"] or [],
                "source_updated_at": item["source_synced_at"] or item["source_fetched_at"] or item["submission_date"],
            }
        )
    report = {
        "database": cur.execute("SELECT current_database() AS name").fetchone()["name"],
        "module": {
            "module_catalogue_id": module["module_catalogue_id"],
            "title": module["title"],
            "programme": module["programme_name"],
            "cohort": module["cohort_name"],
            "group": module["group_name"],
            "start_date": module["start_date"],
            "end_date": module["end_date"],
            "total_otjh": str(module["total_otjh"]),
        },
        "roster_count": len(roster),
        "metrics_before": metrics_before,
        "evidence": plans,
        "planned_new_sources": sum(p["existing_source_id"] is None for p in plans),
        "planned_added_seconds": 0,
        "group_reconciliation": "complete_without_double_count",
    }
    report["fingerprint"] = digest(report)
    return report


def apply_report(cur: psycopg.Cursor, report: dict[str, Any], expected_database: str, expected_fingerprint: str) -> int:
    database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
    if database != expected_database:
        raise ValueError("Database differs from reviewed preview.")
    reviewed = dict(report)
    reviewed.pop("fingerprint", None)
    if digest(reviewed) != expected_fingerprint:
        raise ValueError("Data changed since preview; run the read-only preview again.")

    # Re-resolve the reviewed roster inside the write transaction.  The four
    # attachment owners are only two learners, while the invariant must cover
    # all 18 learners in the group.
    _, roster = module_and_roster(cur)
    learner_ids = [int(row["id"]) for row in roster]
    metrics_before = report["metrics_before"]
    run_id = insert(
        cur,
        "activity_sync_runs",
        {
            "run_key": "pmi-sp-g1w-closeout:" + expected_fingerprint,
            "run_kind": "pmi-sp-g1w-reconciliation-closeout",
            "status": "running",
            "dry_run": False,
            "prompt_model": "",
            "prompt_version": "pmi-sp-g1w-closeout-v1",
            "source_counts": Jsonb(
                {
                    "module": MODULE_TITLE,
                    "programme": PROGRAMME_NAME,
                    "cohort": COHORT_NAME,
                    "group": GROUP_NAME,
                    "learner_count": EXPECTED_ROSTER_COUNT,
                    "reviewed_evidence_count": len(report["evidence"]),
                }
            ),
            "result_counts": Jsonb(
                {
                    "planned_new_sources": report["planned_new_sources"],
                    "added_seconds": 0,
                    "aggregate_overlap_no_double_count": sum(
                        p["classification"]["resolution"] == "aggregate_overlap_no_double_count"
                        for p in report["evidence"]
                    ),
                    "reviewed_no_safe_allocation": sum(
                        p["classification"]["resolution"] == "reviewed_no_safe_allocation"
                        for p in report["evidence"]
                    ),
                    "progress_rows_changed": 0,
                    "hard_deletes": 0,
                    "soft_deletes": 0,
                }
            ),
            "error_summary": "",
        },
    )

    for item in report["evidence"]:
        if item["existing_source_id"] is not None:
            continue
        classification = item["classification"]
        raw = {
            "evidence_id": item["evidence_id"],
            "learner_id": item["aptem_id"],
            "component_id": item["component_id"],
            "component_name": item["component_name"],
            "evidence_name": item["evidence_name"],
            "evidence_status": item["evidence_status"],
            "spent_time_minutes": item["spent_time_minutes"],
            "hours_type": "OffTheJobTraining",
            "spent_time_type": item["spent_time_type"],
            "ksb_codes": item["ksb_codes"],
            "reconciliation": {
                "resolution": classification["resolution"],
                "counted_seconds": 0,
                "reasons": classification["reasons"],
                "canonical_progress_id": None,
                "source_table": "fetching_evidence.evidence_items",
            },
        }
        source_ref = f"evidence:{item['evidence_id']}"
        insert(
            cur,
            "learner_activity_sources",
            {
                "learner_id": item["learner_id"],
                "enrolment_id": None,
                "programme_id": None,
                "aptem_id": item["aptem_id"],
                "source_system": "aptem",
                "source_activity_id": source_ref,
                "source_attempt_key": source_ref + ":closeout",
                "curriculum_component_id": item["component_id"],
                "canonical_activity_key": f"aptem:pmi-sp-g1w:{source_ref}:no-count",
                "activity_type": classification["activity_type"],
                "title": item["component_name"] or item["evidence_name"],
                "activity_status": "Accepted",
                "completed": True,
                "accepted": True,
                "actual_seconds": None,
                "actual_basis": classification["actual_basis"],
                "source_started_at": None,
                "source_ended_at": None,
                "reporting_started_at": None,
                "reporting_ended_at": None,
                "reporting_month": "2026-09",
                "ksb_codes": Jsonb(item["ksb_codes"] or []),
                "source_payload": Jsonb(raw),
                "source_updated_at": item["source_updated_at"],
                "sync_run_id": run_id,
                "canonical_progress_id": None,
                "source_fingerprint": digest(raw),
                "curriculum_component_ref": str(item["component_id"]) if item["component_id"] is not None else None,
                "source_course_ref": "PMI-SP G1-W Feb 2026",
            },
        )

    metrics_after = current_metrics(cur, learner_ids)
    if metrics_after["accepted_progress_seconds"] != metrics_before["accepted_progress_seconds"]:
        raise ValueError("Progress hours changed during a no-count closeout.")
    cur.execute(
        '''UPDATE "Learner".activity_sync_runs
              SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s
            WHERE id=%s''',
        [Jsonb({
            "planned_new_sources": report["planned_new_sources"],
            "actual_new_sources": sum(p["existing_source_id"] is None for p in report["evidence"]),
            "added_seconds": 0,
            "progress_rows_changed": 0,
            "metrics_before": metrics_before,
            "metrics_after": metrics_after,
            "group_reconciled": True,
        }), run_id],
    )
    return run_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    with psycopg.connect(database_url(), connect_timeout=20, row_factory=dict_row) as connection:
        connection.read_only = not args.apply
        with connection.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=5000")
            if args.apply:
                if cur.execute("SELECT current_database() AS name").fetchone()["name"] != args.expected_database:
                    raise ValueError("Database differs from reviewed preview.")
                # Serialize this narrow reconciliation and re-check ownership before writes.
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('pmi-sp-g1w-closeout'))")
            report = build_report(cur)
            database = report["database"]
            if args.apply:
                run_id = apply_report(cur, report, args.expected_database, args.expected_fingerprint)
                print(json.dumps({"database": database, "run_id": run_id, "fingerprint": report["fingerprint"]}, default=str, sort_keys=True))
            else:
                print(json.dumps(report, default=str, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
