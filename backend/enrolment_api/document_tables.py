"""Idempotent creation of enrolment."Enrolment_Documents".

One row per generated compliance document held in
AZURE_ENROLMENT_DOCS_CONTAINER, recording its Azure path and its type (see
DOC_TYPES in documents.py — Extended ILR today, seven more to come).

Created with CREATE TABLE IF NOT EXISTS so it is safe to call on any request
path, mirroring learner_api.evidence_tables.ensure_evidence_tables. The Neon
schemas are owned outside Django, so this is raw SQL rather than a migration.

Learners are addressed by (Learner_kind, Learner_id) — a pairing that dates from
when the directory spanned two learner tables. Both kinds now share
enrolment."Created_users", so Learner_id alone is unique; Learner_kind is kept so
existing rows keep resolving.

Rows are append-only per generation: regenerating a document inserts a new row
with a new timestamped blob, so a previously signed-and-filed copy is never
overwritten. "The current ILR" is therefore the newest row of that Doc_type.
"""
from django.db import connections

_READY = False


def ensure_enrolment_documents_table():
    global _READY
    if _READY:
        return
    with connections["enrolment"].cursor() as cur:
        cur.execute('create schema if not exists enrolment')
        cur.execute(
            '''
            create table if not exists enrolment."Enrolment_Documents" (
                id             uuid primary key,
                "Learner_kind" varchar(32)  not null,
                "Learner_id"   bigint       not null,
                "Learner_name" text,
                "Doc_type"     varchar(64)  not null,
                "Doc_name"     varchar(512) not null,
                "Container"    varchar(128) not null,
                "Blob_name"    varchar(1024) not null unique,
                "Doc_path"     text         not null,
                "Content_type" varchar(255),
                "Size_bytes"   bigint,
                "Signed"       boolean      not null default false,
                "Generated_at" timestamptz  not null default now()
            )
            '''
        )
        cur.execute(
            'create index if not exists idx_enrolment_docs_learner '
            'on enrolment."Enrolment_Documents" ("Learner_kind", "Learner_id")'
        )
        cur.execute(
            'create index if not exists idx_enrolment_docs_type '
            'on enrolment."Enrolment_Documents" ("Doc_type")'
        )
    _READY = True
