"""Apply the reviewed remaining Sharon evidence as estimated allocations.

This is deliberately scoped to the two learners and evidence IDs listed in
PLAN. Existing journal rows are never changed. Evidence already linked to a
Journal row is intentionally excluded from the plan. New timestamps are
stored as estimated and labelled as requiring approval.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime
import hashlib
import json
import mimetypes
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import repair_sharon_evidence_allocations as base

CONTAINER = "fetch-aptem-evidences"
LABEL = "Estimated — approval required"
BASIS = "aptem:accepted-evidence-spent-minutes;estimated-reporting-allocation"
RUN_KIND = "sharon-estimated-remaining-evidence-v1"

# (Aptem learner id, existing parent id or None, evidence ids).
PLAN = [
    (4336, 704787, [12674]),
    (4336, 704796, [39143]),
    (4336, 704790, [24308]),
    (4336, 704798, [39159]),
    (4336, 704800, [39296]),
    (4336, 704802, [43002]),
    (4445, None, [12504]),
    (4445, None, [14478]),
    (4445, None, [31630, 33287]),
    (4445, 705107, [33284]),
    (4445, None, [34267]),
    (4445, 705108, [36235]),
    (4445, None, [42991, 42993]),
    (4445, 705117, [48603]),
    (4445, 705118, [48661]),
]

SCHEDULES = {
    12674: [("2025-10-15", 77 * 60)],
    39143: [("2025-12-19", 8 * 3600)],
    24308: [("2026-01-30", 14 * 3600)],
    39159: [("2026-01-30", 8 * 3600)],
    39296: [("2026-02-27", 8 * 3600)],
    43002: [("2026-05-19", 2 * 3600)],
    12504: [("2025-10-15", 30 * 60)],
    14478: [("2025-11-10", 90 * 60)],
    31630: [("2026-03-16", 90 * 60)],
    33287: [("2026-03-26", 150 * 60)],
    33284: [("2026-03-26", 60 * 60)],
    34267: [("2026-04-01", 150 * 60)],
    36235: [("2026-04-16", 7 * 3600)],
    42991: [("2026-05-29", 3 * 3600)],
    42993: [("2026-05-29", 2 * 3600)],
    48603: [("2026-07-17", 2 * 3600)],
    48661: [("2026-07-17", 2 * 3600)],
}


def digest(value):
    return hashlib.sha256(
        json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def db_url(values):
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise ValueError("No configured enrolment database.")


def selected_ids():
    return sorted({eid for _, _, eids in PLAN for eid in eids})


def read_evidence(cur):
    ids = selected_ids()
    rows = cur.execute(
        """SELECT evidence_id,learner_id,component_id,component_name,evidence_name,
                  evidence_status,spent_time,hours_type,spent_time_type,
                  completed_date_override,completed_date,submission_date,
                  file_blob,note_blob,report_blob,note_content,evidence_raw,ksb_codes
             FROM fetching_evidence.evidence_items
            WHERE evidence_id=ANY(%s) ORDER BY evidence_id""",
        [ids],
    ).fetchall()
    if {int(r["evidence_id"]) for r in rows} != set(ids):
        raise ValueError("A selected evidence item is missing.")
    for row in rows:
        if (
            row["evidence_status"] != "Accepted"
            or row["hours_type"] != "OffTheJobTraining"
            or row["spent_time_type"] != "PaidWorkingHours"
            or int(row["spent_time"]) <= 0
        ):
            raise ValueError(f"Evidence {row['evidence_id']} is not accepted paid OTJ.")
        scheduled = sum(seconds for _, seconds in SCHEDULES[int(row["evidence_id"])])
        if scheduled != int(row["spent_time"]) * 60:
            raise ValueError(f"Evidence {row['evidence_id']} schedule mismatch.")
    return {int(r["evidence_id"]): r for r in rows}


def owner_rows(cur):
    owners = {}
    for aptem_id in sorted({item[0] for item in PLAN}):
        rows = cur.execute(
            """SELECT id,enrolment_id,programme_id,aptem_id,full_name
                 FROM "Learner".learners WHERE aptem_id=%s""",
            [aptem_id],
        ).fetchall()
        if len(rows) != 1:
            raise ValueError(f"Expected one canonical learner for Aptem {aptem_id}.")
        owners[aptem_id] = rows[0]
    return owners


def build_report(cur):
    evidence = read_evidence(cur)
    owners = owner_rows(cur)
    by_owner = {aptem_id: owner["id"] for aptem_id, owner in owners.items()}
    parents = {}
    sources = {}
    for aptem_id, parent_id, evidence_ids in PLAN:
        owner_id = by_owner[aptem_id]
        if parent_id is not None:
            parent = cur.execute(
                """SELECT * FROM "Learner".learner_progress_entries
                    WHERE id=%s AND learner_id=%s AND deleted_at IS NULL""",
                [parent_id, owner_id],
            ).fetchone()
            if not parent:
                raise ValueError(f"Parent {parent_id} is missing or belongs to another learner.")
            existing_segments = cur.execute(
                """SELECT id FROM "Learner".learner_activity_reporting_segments
                    WHERE progress_id=%s LIMIT 1""",
                [parent_id],
            ).fetchone()
            if existing_segments:
                raise ValueError(f"Parent {parent_id} already has reporting segments.")
            if parent["actual_seconds"] not in (None, 0):
                raise ValueError(f"Parent {parent_id} already has counted hours.")
            parents[parent_id] = parent
        source_rows = cur.execute(
            """SELECT * FROM "Learner".learner_activity_sources
                WHERE learner_id=%s AND source_system='aptem' AND deleted_at IS NULL
                  AND source_activity_id=ANY(%s) ORDER BY id""",
            [owner_id, [f"evidence:{eid}" for eid in evidence_ids]],
        ).fetchall()
        expected_refs = {f"evidence:{eid}" for eid in evidence_ids}
        found_refs = {r["source_activity_id"] for r in source_rows}
        if parent_id is None and source_rows:
            raise ValueError(f"Evidence already has an active source: {sorted(found_refs)}")
        if parent_id is not None and found_refs != expected_refs:
            raise ValueError(f"Parent {parent_id} has incomplete evidence sources.")
        for source in source_rows:
            if source["canonical_progress_id"] not in (None, parent_id):
                raise ValueError(f"Evidence source {source['source_activity_id']} points elsewhere.")
            sources[source["source_activity_id"]] = source

    journal_usage = {}
    selected_usage_by_owner = defaultdict(lambda: defaultdict(int))
    for aptem_id, owner in owners.items():
        rows = cur.execute(
            """SELECT activity_date,COALESCE(SUM(actual_hours),0) AS hours
                 FROM "Learner".learner_journal_rows
                WHERE canonical_learner_id=%s AND deleted_at IS NULL
                  AND accepted IS TRUE AND activity_date <= '2026-08-31'
                GROUP BY activity_date""",
            [owner["id"]],
        ).fetchall()
        journal_usage[aptem_id] = {
            row["activity_date"]: int(round(float(row["hours"] or 0) * 3600))
            for row in rows if row["activity_date"] is not None
        }

    base.SCHEDULES = SCHEDULES
    plans = []
    for aptem_id, parent_id, evidence_ids in PLAN:
        group_segments = base.make_segments(
            evidence_ids,
            evidence,
            journal_usage[aptem_id],
            selected_usage_by_owner[aptem_id],
        )
        group_segments.sort(key=lambda item: (item["start"], item["evidence_id"]))
        expected = sum(int(evidence[eid]["spent_time"]) * 60 for eid in evidence_ids)
        if sum(int(seg["seconds"]) for seg in group_segments) != expected:
            raise ValueError(f"Total mismatch for Aptem {aptem_id} evidence {evidence_ids}.")
        plans.append(
            {
                "aptem_id": aptem_id,
                "owner_id": owners[aptem_id]["id"],
                "owner_name": owners[aptem_id]["full_name"],
                "parent_id": parent_id,
                "evidence_ids": evidence_ids,
                "expected_seconds": expected,
                "segments": group_segments,
                "source_ids": [
                    sources[f"evidence:{eid}"]["id"]
                    for eid in evidence_ids
                    if f"evidence:{eid}" in sources
                ],
                "existing_parent_seconds": parents[parent_id]["actual_seconds"] if parent_id else None,
            }
        )

    database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
    totals = {}
    for aptem_id, owner in owners.items():
        journal = cur.execute(
            """SELECT COALESCE(SUM(actual_hours),0) AS hours
                 FROM "Learner".learner_journal_rows
                WHERE canonical_learner_id=%s AND deleted_at IS NULL AND accepted IS TRUE
                  AND activity_date <= '2026-08-31' """,
            [owner["id"]],
        ).fetchone()["hours"]
        added = sum(item["expected_seconds"] for item in plans if item["aptem_id"] == aptem_id)
        totals[aptem_id] = {
            "journal_hours": float(journal or 0),
            "new_estimated_hours": added / 3600,
            "estimated_added_seconds": added,
        }
    report = {
        "database": database,
        "plans": plans,
        "totals": totals,
        "selected_evidence_count": len(evidence),
        "selected_source_count": len(sources),
    }
    report["fingerprint"] = digest(report)
    return report


def insert_row(cur, table, values):
    from psycopg import sql
    statement = sql.SQL('INSERT INTO "Learner".{} ({}) VALUES ({}) RETURNING id').format(
        sql.Identifier(table),
        sql.SQL(",").join(sql.Identifier(k) for k in values),
        sql.SQL(",").join(sql.Placeholder() for _ in values),
    )
    return cur.execute(statement, list(values.values())).fetchone()["id"]


def apply_report(cur, report, expected_database, expected_fingerprint):
    if report["database"] != expected_database or report["fingerprint"] != expected_fingerprint:
        raise ValueError("Database or reviewed fingerprint changed; preview again.")
    run = insert_row(
        cur,
        "activity_sync_runs",
        {
            "run_key": "sharon-estimated-remaining-evidence:" + expected_fingerprint,
            "run_kind": RUN_KIND,
            "status": "running",
            "dry_run": False,
            "prompt_version": "v1-read-evidence-hours",
            "source_counts": Jsonb(
                {
                    "aptem_ids": sorted({p["aptem_id"] for p in report["plans"]}),
                    "evidence_ids": selected_ids(),
                    "estimated": True,
                }
            ),
            "result_counts": Jsonb({}),
        },
    )
    evidence = read_evidence(cur)
    owners = owner_rows(cur)
    created_parents = 0
    source_updates = 0
    segment_count = 0
    documents_added = 0
    for item in report["plans"]:
        owner = owners[item["aptem_id"]]
        parent_id = item["parent_id"]
        segments = item["segments"]
        parent_segments = [{k: v for k, v in seg.items() if k != "evidence_id"} for seg in segments]
        first = evidence[item["evidence_ids"][0]]
        payload = base.allocation_payload(first, parent_segments, item["evidence_ids"])
        if parent_id is None:
            max_order = cur.execute(
                'SELECT COALESCE(MAX(entry_order),0) AS n FROM "Learner".learner_progress_entries WHERE learner_id=%s',
                [owner["id"]],
            ).fetchone()["n"]
            parent_id = insert_row(
                cur,
                "learner_progress_entries",
                {
                    "learner_id": owner["id"],
                    "entry_order": int(max_order) + 1,
                    "kind": "assignment",
                    "component_ref": f"evidence:{first['evidence_id']}",
                    "component_title": first["component_name"] or first["evidence_name"],
                    "component_type": "assignment",
                    "enrolment_id": owner["enrolment_id"],
                    "programme_id": owner["programme_id"],
                    "aptem_id": owner["aptem_id"],
                    "source_system": "aptem",
                    "source_activity_id": f"evidence:{first['evidence_id']}",
                    "canonical_activity_key": f"aptem:{owner['aptem_id']}:evidence:{first['evidence_id']}",
                    "activity_status": "Accepted",
                    "accepted": True,
                    "actual_seconds": item["expected_seconds"],
                    "actual_basis": BASIS,
                    "reporting_started_at": datetime.fromisoformat(parent_segments[0]["start"]),
                    "reporting_ended_at": datetime.fromisoformat(parent_segments[-1]["end"]),
                    "reporting_month": min(seg["month"] for seg in parent_segments),
                    "reporting_timestamp_label": LABEL,
                    "source_payload": Jsonb(payload),
                    "sync_run_id": run,
                },
            )
            created_parents += 1
        else:
            current = cur.execute(
                'SELECT actual_seconds,deleted_at FROM "Learner".learner_progress_entries WHERE id=%s AND learner_id=%s FOR UPDATE',
                [parent_id, owner["id"]],
            ).fetchone()
            if not current or current["deleted_at"] is not None or current["actual_seconds"] not in (None, 0):
                raise ValueError(f"Parent {parent_id} changed; refusing to overwrite it.")
            cur.execute(
                """UPDATE "Learner".learner_progress_entries
                      SET actual_seconds=%s,actual_basis=%s,reporting_started_at=%s,
                          reporting_ended_at=%s,reporting_month=%s,reporting_timestamp_label=%s,
                          source_payload=%s,sync_run_id=%s,ssot_updated_at=now()
                    WHERE id=%s""",
                [
                    item["expected_seconds"],
                    BASIS,
                    datetime.fromisoformat(parent_segments[0]["start"]),
                    datetime.fromisoformat(parent_segments[-1]["end"]),
                    min(seg["month"] for seg in parent_segments),
                    LABEL,
                    Jsonb(payload),
                    run,
                    parent_id,
                ],
            )
        for index, seg in enumerate(parent_segments, 1):
            insert_row(
                cur,
                "learner_activity_reporting_segments",
                {
                    "progress_id": parent_id,
                    "learner_id": owner["id"],
                    "segment_order": index,
                    "actual_seconds": seg["seconds"],
                    "reporting_started_at": datetime.fromisoformat(seg["start"]),
                    "reporting_ended_at": datetime.fromisoformat(seg["end"]),
                    "reporting_month": seg["month"],
                    "sync_run_id": run,
                },
            )
            segment_count += 1
        for evidence_id in item["evidence_ids"]:
            row = evidence[evidence_id]
            evidence_segments = [
                {k: v for k, v in seg.items() if k != "evidence_id"}
                for seg in segments if seg["evidence_id"] == evidence_id
            ]
            started = datetime.fromisoformat(evidence_segments[0]["start"])
            ended = datetime.fromisoformat(evidence_segments[-1]["end"])
            evidence_payload = base.allocation_payload(row, evidence_segments, item["evidence_ids"], evidence_id)
            source = cur.execute(
                """SELECT * FROM "Learner".learner_activity_sources
                    WHERE learner_id=%s AND source_system='aptem'
                      AND source_activity_id=%s AND deleted_at IS NULL""",
                [owner["id"], f"evidence:{evidence_id}"],
            ).fetchone()
            if source:
                cur.execute(
                    """UPDATE "Learner".learner_activity_sources
                          SET canonical_progress_id=%s,actual_seconds=%s,actual_basis=%s,
                              source_started_at=%s,source_ended_at=%s,reporting_started_at=%s,
                              reporting_ended_at=%s,reporting_month=%s,source_payload=%s,
                              ksb_codes=%s,sync_run_id=%s,last_seen_at=now()
                        WHERE id=%s""",
                    [
                        parent_id,
                        int(row["spent_time"]) * 60,
                        BASIS,
                        started,
                        ended,
                        started,
                        ended,
                        min(seg["month"] for seg in evidence_segments),
                        Jsonb(evidence_payload),
                        Jsonb(row["ksb_codes"] or []),
                        run,
                        source["id"],
                    ],
                )
            else:
                insert_row(
                    cur,
                    "learner_activity_sources",
                    {
                        "learner_id": owner["id"],
                        "enrolment_id": owner["enrolment_id"],
                        "programme_id": owner["programme_id"],
                        "aptem_id": owner["aptem_id"],
                        "source_system": "aptem",
                        "source_activity_id": f"evidence:{evidence_id}",
                        "canonical_activity_key": f"aptem:{owner['aptem_id']}:evidence:{evidence_id}",
                        "activity_type": "assignment",
                        "title": row["component_name"] or row["evidence_name"],
                        "activity_status": "Accepted",
                        "completed": True,
                        "accepted": True,
                        "actual_seconds": int(row["spent_time"]) * 60,
                        "actual_basis": BASIS,
                        "source_started_at": started,
                        "source_ended_at": ended,
                        "reporting_started_at": started,
                        "reporting_ended_at": ended,
                        "reporting_month": min(seg["month"] for seg in evidence_segments),
                        "source_payload": Jsonb(evidence_payload),
                        "ksb_codes": Jsonb(row["ksb_codes"] or []),
                        "sync_run_id": run,
                        "canonical_progress_id": parent_id,
                        "source_fingerprint": digest(row),
                    },
                )
            source_updates += 1
            if row["file_blob"]:
                exists = cur.execute(
                    """SELECT 1 FROM "Learner".learner_activity_documents
                        WHERE source_system='aptem' AND source_document_id=%s AND deleted_at IS NULL""",
                    [f"evidence:{evidence_id}:file"],
                ).fetchone()
                if not exists:
                    insert_row(
                        cur,
                        "learner_activity_documents",
                        {
                            "learner_id": owner["id"],
                            "progress_id": parent_id,
                            "source_system": "aptem",
                            "source_document_id": f"evidence:{evidence_id}:file",
                            "container": CONTAINER,
                            "blob_name": row["file_blob"],
                            "display_name": row["evidence_name"],
                            "content_type": mimetypes.guess_type(row["evidence_name"])[0] or "application/octet-stream",
                            "uploaded_at": row["submission_date"],
                        },
                    )
                    documents_added += 1
    result = {
        "estimated": True,
        "approval_required": True,
        "label": LABEL,
        "created_parents": created_parents,
        "source_rows_written": source_updates,
        "segments_written": segment_count,
        "documents_added": documents_added,
        "evidence_ids": selected_ids(),
        "seconds_written": sum(item["expected_seconds"] for item in report["plans"]),
    }
    cur.execute(
        """UPDATE "Learner".activity_sync_runs
              SET status='completed_with_issues',finished_at=now(),updated_at=now(),result_counts=%s
            WHERE id=%s""",
        [Jsonb(result), run],
    )
    return run, result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and (not args.expected_database or not args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    values = base.env_values()
    with psycopg.connect(db_url(values), connect_timeout=15, row_factory=dict_row) as conn:
        conn.read_only = not args.apply
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=10000")
            if args.apply:
                cur.execute("SELECT pg_advisory_xact_lock(hashtext('sharon-estimated-evidence-repair'))")
            report = build_report(cur)
            if args.apply:
                run_id, result = apply_report(cur, report, args.expected_database, args.expected_fingerprint)
                report.update(applied=True, run_id=run_id, result=result)
            compact = {
                "database": report["database"],
                "fingerprint": report["fingerprint"],
                "applied": bool(args.apply),
                "totals": report["totals"],
                "selected_evidence_count": report["selected_evidence_count"],
                "selected_source_count": report["selected_source_count"],
            }
            if args.apply:
                compact["run_id"] = report["run_id"]
                compact["result"] = report["result"]
            print(json.dumps(compact, default=str, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, psycopg.Error) as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, ValueError) else type(exc).__name__}, ensure_ascii=False))
        raise SystemExit(1)

