"""Read-only integrity checks for restored Progress Review run data."""

from django.db import connections

from .runs import CONN, PPTX_CONTENT_TYPE


def _rows(cursor, sql, params=None):
    cursor.execute(sql, params or [])
    return cursor.fetchall()


def build_integrity_report(*, using=CONN):
    """Return a JSON-serialisable report without changing schema or data.

    This deliberately does not call ``ensure_progress_review_tables``: a
    post-restore check must expose a missing/broken schema instead of repairing
    it as a side effect.
    """
    with connections[using].cursor() as cursor:
        completed_without_pptx = _rows(
            cursor,
            '''select r.id
                 from "Learner"."progress_review_runs" r
                where r.generation_status = 'completed'
                  and not exists (
                      select 1 from "Learner"."progress_review_pptx_files" f
                       where f.run_id = r.id
                  )
                order by r.id''',
        )
        draft_without_pptx = _rows(
            cursor,
            '''select r.id
                 from "Learner"."progress_review_runs" r
                where r.generation_status = 'draft'
                  and not exists (
                      select 1 from "Learner"."progress_review_pptx_files" f
                       where f.run_id = r.id
                  )
                order by r.id''',
        )
        orphan_pptx = _rows(
            cursor,
            '''select f.id, f.run_id
                 from "Learner"."progress_review_pptx_files" f
                 left join "Learner"."progress_review_runs" r on r.id = f.run_id
                where r.id is null
                order by f.id''',
        )
        invalid_learners = _rows(
            cursor,
            '''select r.id, r.learner_id
                 from "Learner"."progress_review_runs" r
                 left join "Learner"."learners" l on l.id = r.learner_id
                where l.id is null
                order by r.id''',
        )
        duplicate_pptx = _rows(
            cursor,
            '''select run_id, count(*)
                 from "Learner"."progress_review_pptx_files"
                group by run_id
               having count(*) > 1
                order by run_id''',
        )
        invalid_metadata = _rows(
            cursor,
            '''select id, run_id, container, blob_name, original_filename,
                      content_type, size_bytes
                 from "Learner"."progress_review_pptx_files"
                where nullif(btrim(container), '') is null
                   or nullif(btrim(blob_name), '') is null
                   or nullif(btrim(original_filename), '') is null
                   or lower(right(original_filename, 5)) <> '.pptx'
                   or content_type <> %s
                   or size_bytes is null
                   or size_bytes <= 0
                order by id''',
            [PPTX_CONTENT_TYPE],
        )

    invalid_metadata_rows = []
    for row in invalid_metadata:
        file_id, run_id, container, blob_name, filename, content_type, size_bytes = row
        issues = []
        if not str(container or "").strip():
            issues.append("missing_container")
        if not str(blob_name or "").strip():
            issues.append("missing_blob_name")
        if not str(filename or "").strip():
            issues.append("missing_original_filename")
        elif not str(filename).lower().endswith(".pptx"):
            issues.append("invalid_original_filename")
        if content_type != PPTX_CONTENT_TYPE:
            issues.append("invalid_content_type")
        if size_bytes is None or size_bytes <= 0:
            issues.append("invalid_size_bytes")
        invalid_metadata_rows.append({"file_id": file_id, "run_id": run_id, "issues": issues})

    checks = {
        "completed_runs_without_pptx": {
            "count": len(completed_without_pptx),
            "run_ids": [row[0] for row in completed_without_pptx],
        },
        "draft_runs_without_pptx": {
            "count": len(draft_without_pptx),
            "run_ids": [row[0] for row in draft_without_pptx],
        },
        "orphan_pptx_records": {
            "count": len(orphan_pptx),
            "records": [{"file_id": row[0], "run_id": row[1]} for row in orphan_pptx],
        },
        "invalid_canonical_learner_references": {
            "count": len(invalid_learners),
            "runs": [{"run_id": row[0], "learner_id": row[1]} for row in invalid_learners],
        },
        "duplicate_pptx_records_per_run": {
            "count": len(duplicate_pptx),
            "runs": [{"run_id": row[0], "file_count": row[1]} for row in duplicate_pptx],
        },
        "missing_or_invalid_file_metadata": {
            "count": len(invalid_metadata_rows),
            "records": invalid_metadata_rows,
        },
    }
    return {
        "ok": all(check["count"] == 0 for check in checks.values()),
        "checks": checks,
    }

