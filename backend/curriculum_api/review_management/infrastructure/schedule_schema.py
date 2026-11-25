"""Schedule schema readiness and existing local provisioning; one readiness flag owner."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.relations import CLASH_RESOLUTIONS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.review_management.infrastructure.relations import OCCURRENCE_OVERRIDES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from django.db import connection
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api import schema_gate


_REVIEW_SCHEDULE_TABLES_READY = False


def ensure_review_schedule_tables():
    global _REVIEW_SCHEDULE_TABLES_READY
    if _REVIEW_SCHEDULE_TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(OCCURRENCE_OVERRIDES_TABLE, CLASH_RESOLUTIONS_TABLE)
        _REVIEW_SCHEDULE_TABLES_READY = True
        return
    provision_review_schedule_tables()


def provision_review_schedule_tables():
    """Mirrors sql/2026-09-10_curriculum_review_schedule_clash_resolution.sql
    for sqlite/local dev. NOT for production request paths -- see reviews.py
    and schema_gate for why."""
    global _REVIEW_SCHEDULE_TABLES_READY
    if _REVIEW_SCHEDULE_TABLES_READY:
        return
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(OCCURRENCE_OVERRIDES_TABLE)} (
                id varchar(128) primary key,
                review_id varchar(128) not null,
                programme_id varchar(255) not null,
                occurrence_date date not null,
                -- NULL keeps the programme-wide skip; a set value scopes the
                -- override to one learner (see review_instances.py). Mirrors
                -- sql/2026-09-13_curriculum_review_instances.sql.
                learner_id integer,
                action varchar(16) not null default 'skip',
                reason varchar(1000) not null default '',
                deleted_at timestamp,
                deleted_by varchar(255),
                deleted_via_parent varchar(255),
                created_by varchar(255) not null default '',
                updated_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(CLASH_RESOLUTIONS_TABLE)} (
                id varchar(128) primary key,
                programme_id varchar(255) not null,
                clash_month varchar(7) not null,
                clash_signature varchar(2000) not null default '',
                resolution varchar(16) not null default 'keep_all',
                note varchar(1000) not null default '',
                deleted_at timestamp,
                deleted_by varchar(255),
                created_by varchar(255) not null default '',
                updated_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
    _REVIEW_SCHEDULE_TABLES_READY = True


def reset_review_schedule_ready():
    """Reset the process-local readiness flag for isolated tests."""
    global _REVIEW_SCHEDULE_TABLES_READY
    _REVIEW_SCHEDULE_TABLES_READY = False
