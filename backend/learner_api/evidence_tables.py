"""Read-only compatibility check for the normalized evidence schema.

Schema provisioning belongs to migrations/deployment, never learner GET paths.
This guard deliberately performs catalog reads only and fails visibly when the
deployed schema is incompatible.
"""
from django.db import ProgrammingError, connections

_READY = False
_WRITE_READY = False

REQUIRED_COLUMNS = frozenset({
    "id", "learner_kind", "section_ref", "blob_name", "original_filename",
    "content_type", "size_bytes", "status", "scan_result", "uploaded_by",
    "uploaded_at", "reviewed_at", "Training_plan_details", "progress_entry_id",
    "learner_profile_id", "plan_component_id", "component_ref",
})


def ensure_evidence_tables():
    """Verify the deployed normalized table without creating or altering it."""
    global _READY
    if _READY:
        return
    with connections["enrolment"].cursor() as cur:
        cur.execute(
            "select column_name from information_schema.columns "
            "where table_schema='Learner' and table_name='evidence_files'"
        )
        columns = {row[0] for row in cur.fetchall()}
    missing = sorted(REQUIRED_COLUMNS - columns)
    if missing:
        raise ProgrammingError(
            'The normalized Learner.evidence_files schema is unavailable; '
            f'missing columns: {", ".join(missing)}'
        )
    _READY = True


def ensure_evidence_write_tables():
    """Preserve the legacy approved-file index for mutating workflows only.

    Evidence GET paths must never call this function. The lifecycle table is
    validated, not repaired; only the separate approved-file index retained by
    upload/delete is provisioned as it was before normalized-schema support.
    """
    global _WRITE_READY
    ensure_evidence_tables()
    if _WRITE_READY:
        return
    with connections["enrolment"].cursor() as cur:
        cur.execute('create schema if not exists "Learner"')
        cur.execute(
            '''
            create table if not exists "Learner"."Evidence" (
                "id" integer primary key generated always as identity,
                "Azure_id" text,
                "Evidence_name" text,
                "Evidence_path" text
            )
            '''
        )
    _WRITE_READY = True
