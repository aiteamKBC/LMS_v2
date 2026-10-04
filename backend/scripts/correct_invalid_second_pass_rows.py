"""Soft-delete the two invalid month-only rows from run 1684.

Run 1684 imported Evidence 39817 and 39888 without a valid timestamp
allocation.  The Aptem mirror and Azure blobs remain untouched; only the
derived SSOT projections and document links are excluded with an audit row.
"""
from __future__ import annotations

import json
from pathlib import Path
import os

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[1]
LABEL = "\u062a\u0642\u062f\u064a\u0631\u064a \u2014 \u064a\u062d\u062a\u0627\u062c \u0627\u0639\u062a\u0645\u0627\u062f"
EVIDENCE = {39817: 1303, 39888: 1132}
RUN_KIND = "correct-invalid-second-pass-additions-v1"


def database_url() -> str:
    values = dict(os.environ)
    for raw in (ROOT / ".env").read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise ValueError("No configured enrolment database.")


def insert_run(cur) -> int:
    row = cur.execute('''INSERT INTO "Learner".activity_sync_runs
        (run_key,run_kind,status,dry_run,prompt_version,source_counts,result_counts)
        VALUES (%s,%s,'running',FALSE,%s,%s,%s) RETURNING id''', [
        f"{RUN_KIND}:1684",
        RUN_KIND,
        "v2-invalid-timestamp-correction",
        Jsonb({"previous_run": 1684, "evidence_ids": sorted(EVIDENCE), "azure_untouched": True}),
        Jsonb({}),
    ]).fetchone()
    return int(row["id"])


def main() -> None:
    with psycopg.connect(database_url(), connect_timeout=20, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=60000")
            cur.execute("SET LOCAL lock_timeout=10000")
            rows = cur.execute('''SELECT p.id,p.learner_id,p.aptem_id,p.source_activity_id,p.actual_seconds
                FROM "Learner".learner_progress_entries p
                WHERE p.sync_run_id=1684 AND p.deleted_at IS NULL FOR UPDATE''').fetchall()
            if {(int(r["aptem_id"]), str(r["source_activity_id"])) for r in rows} != {
                (1303, "evidence:39817"), (1132, "evidence:39888")
            }:
                raise ValueError("Run 1684 active rows do not match the two approved correction targets.")
            parent_ids = [int(r["id"]) for r in rows]
            source_rows = cur.execute('''SELECT id,aptem_id,source_activity_id,actual_seconds
                FROM "Learner".learner_activity_sources
                WHERE sync_run_id=1684 AND deleted_at IS NULL FOR UPDATE''').fetchall()
            if {(int(r["aptem_id"]), str(r["source_activity_id"])) for r in source_rows} != {
                (1303, "evidence:39817"), (1132, "evidence:39888")
            }:
                raise ValueError("Run 1684 active source rows do not match correction targets.")
            run_id = insert_run(cur)
            reason = "reconciliation:soft-delete-invalid-month-only-additional-hours;timestamp-capacity-review"
            audit = Jsonb({
                "reconciliation": {
                    "correction_run_id": run_id,
                    "replaced_run_id": 1684,
                    "reason": reason,
                    "evidence_ids": sorted(EVIDENCE),
                    "label": LABEL,
                    "azure_blobs_preserved": True,
                }
            })
            cur.execute('''UPDATE "Learner".learner_progress_entries
                SET deleted_at=now(),accepted=FALSE,activity_status='Referred',actual_basis=%s,
                    sync_run_id=%s,source_payload=source_payload || %s,ssot_updated_at=now()
                WHERE id=ANY(%s) AND deleted_at IS NULL''', [reason, run_id, audit, parent_ids])
            source_ids = [int(r["id"]) for r in source_rows]
            cur.execute('''UPDATE "Learner".learner_activity_sources
                SET deleted_at=now(),accepted=FALSE,activity_status='Referred',actual_basis=%s,
                    sync_run_id=%s,source_payload=source_payload || %s,last_seen_at=now()
                WHERE id=ANY(%s) AND deleted_at IS NULL''', [reason, run_id, audit, source_ids])
            doc_rows = cur.execute('''SELECT id FROM "Learner".learner_activity_documents
                WHERE progress_id=ANY(%s) AND deleted_at IS NULL FOR UPDATE''', [parent_ids]).fetchall()
            doc_ids = [int(r["id"]) for r in doc_rows]
            if doc_ids:
                cur.execute('''UPDATE "Learner".learner_activity_documents
                    SET deleted_at=now(),updated_at=now() WHERE id=ANY(%s) AND deleted_at IS NULL''', [doc_ids])
            result = {
                "previous_run": 1684,
                "evidence_ids": sorted(EVIDENCE),
                "parents_soft_deleted": len(parent_ids),
                "sources_soft_deleted": len(source_ids),
                "documents_soft_deleted": len(doc_ids),
                "seconds_removed_from_ssot": sum(int(r["actual_seconds"] or 0) for r in rows),
                "azure_blobs_deleted": 0,
                "lms_rows_excluded": 0,
                "reason": reason,
            }
            cur.execute('''UPDATE "Learner".activity_sync_runs
                SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s WHERE id=%s''',
                        [Jsonb(result), run_id])
        print(json.dumps({"run_id": run_id, **result}, ensure_ascii=False))


if __name__ == "__main__":
    main()
