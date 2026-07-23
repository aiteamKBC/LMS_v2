"""Idempotent creation of the evidence tables on the Neon (`enrolment`) DB.

Two tables, both created with `CREATE TABLE IF NOT EXISTS` so they are safe to
call on every request path (mirrors curriculum_api.ensure_module_authoring_tables).
The Neon schemas are authored/owned outside Django, so we manage these with raw
SQL rather than Django migrations — consistent with the rest of learner_api.

  curriculum.evidence_files
      Full upload lifecycle record (quarantine -> approved/rejected). Adapted to
      this project: learners are addressed by (learner_kind, learner_id), NOT the
      Django auth_user the generic spec assumes.

  "Learner"."Evidence"
      The learner-facing index requested for approved evidence: a row is inserted
      the moment a blob lands in AZURE_APPROVED_CONTAINER.
          id            identity PK
          Azure_id      the blob name / identifier in Azure
          Evidence_name the original filename
          Evidence_path the approved-container blob URL
"""
from django.db import connections

_READY = False


def ensure_evidence_tables():
    global _READY
    if _READY:
        return
    with connections["enrolment"].cursor() as cur:
        # Lifecycle table (own metadata + status). Kept in the curriculum schema
        # alongside the other app-owned Neon tables.
        cur.execute("create schema if not exists \"Learner\"")
        cur.execute(
            """
            create table if not exists "Learner"."evidence_files" (
                id                uuid primary key,
                learner_kind      varchar(32)  not null,
                learner_id        varchar(128) not null,
                azure_oid         varchar(128),
                section_ref       varchar(255) not null,
                container         varchar(128) not null,
                blob_name         varchar(1024) not null unique,
                original_filename varchar(512) not null,
                content_type      varchar(255) not null,
                size_bytes        bigint not null,
                status            varchar(16) not null default 'pending',
                scan_result       varchar(32),
                uploaded_by       varchar(255),
                uploaded_at       timestamptz not null default now(),
                reviewed_at       timestamptz
            )
            """
        )
        cur.execute("create index if not exists idx_evidence_files_learner on \"Learner\".evidence_files (learner_kind, learner_id)")
        cur.execute("create index if not exists idx_evidence_files_section on \"Learner\".evidence_files (section_ref)")
        cur.execute("create index if not exists idx_evidence_files_status  on \"Learner\".evidence_files (status)")

        # The requested approved-evidence index in the "Learner" schema.
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
    _READY = True
