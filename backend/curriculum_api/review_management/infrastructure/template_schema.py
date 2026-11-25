"""Template schema readiness and existing local provisioning; one readiness flag owner."""
from __future__ import annotations

from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.review_management.infrastructure.relations import REVIEW_FIELDS_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_SECTIONS_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_TEMPLATES_TABLE
from curriculum_api.review_management.infrastructure.relations import REVIEW_TYPES_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import authoring_json_type
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from django.db import connection
from curriculum_api.review_management.infrastructure.type_schema import provision_review_types_table
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api import schema_gate


_REVIEW_TABLES_READY = False


def ensure_review_tables():
    """Verify Review tables exist; provision only outside production."""
    global _REVIEW_TABLES_READY
    if _REVIEW_TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(
            REVIEW_TEMPLATES_TABLE, REVIEW_SECTIONS_TABLE, REVIEW_FIELDS_TABLE,
            REVIEW_TYPES_TABLE,
        )
        _REVIEW_TABLES_READY = True
        return
    provision_review_template_tables()


def provision_review_template_tables():
    """Mirrors the two Review SQL files for sqlite/local dev.

    NOT for production request paths -- schema there is owned by the SQL
    files applied to Neon directly. See schema_gate module docstring.
    """
    global _REVIEW_TABLES_READY
    if _REVIEW_TABLES_READY:
        return
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_TEMPLATES_TABLE)} (
                id varchar(128) primary key,
                programme_id varchar(255) not null,
                name varchar(500) not null default '',
                enabled boolean not null default true,
                recurrence_interval integer not null default 1,
                recurrence_unit varchar(16) not null default 'weeks',
                schedule_anchor_date date not null default current_date,
                occurrence_count integer,
                review_type_id varchar(128),
                applicable_statuses {json_type},
                applicability {json_type},
                signature_advisor boolean not null default false,
                signature_employer boolean not null default false,
                signature_participant boolean not null default false,
                signature_referrer boolean not null default false,
                visible_advisor boolean not null default true,
                visible_employer boolean not null default true,
                visible_participant boolean not null default true,
                visible_referrer boolean not null default true,
                record_time_spent boolean not null default false,
                expected_otjh numeric(8, 2) not null default 0,
                counts_towards_otjh boolean not null default false,
                allow_editing_prior_days integer not null default 0,
                notify_employer boolean not null default false,
                notify_participant boolean not null default false,
                incomplete_marker varchar(255) not null default '',
                field_count integer not null default 0,
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
            create table if not exists {authoring_table_name(REVIEW_SECTIONS_TABLE)} (
                id varchar(128) primary key,
                review_id varchar(128) not null,
                title varchar(500) not null default '',
                estimated_minutes integer not null default 0,
                display_order integer not null default 0,
                enabled boolean not null default true,
                deleted_at timestamp,
                deleted_by varchar(255),
                deleted_via_parent varchar(255),
                created_by varchar(255) not null default '',
                updated_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'alter table {authoring_table_name(REVIEW_TEMPLATES_TABLE)} add column if not exists applicability {json_type}')
        else:
            cursor.execute(f'pragma table_info({quote_ident(REVIEW_TEMPLATES_TABLE)})')
            if 'applicability' not in {row[1] for row in cursor.fetchall()}:
                cursor.execute(f'alter table {authoring_table_name(REVIEW_TEMPLATES_TABLE)} add column applicability {json_type}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_FIELDS_TABLE)} (
                id varchar(128) primary key,
                review_id varchar(128) not null,
                section_id varchar(128) not null,
                parent_field_id varchar(128),
                condition_value varchar(16),
                title varchar(500) not null default '',
                field_type varchar(32) not null default 'text',
                required boolean not null default false,
                display_order integer not null default 0,
                configuration {json_type},
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
    # A Review cannot be saved without a Review Type, so the type catalogue is
    # part of the same provisioning step rather than a separate opt-in.
    provision_review_types_table()
    _REVIEW_TABLES_READY = True


def reset_review_tables_ready():
    """Reset the process-local readiness flag for isolated tests."""
    global _REVIEW_TABLES_READY
    _REVIEW_TABLES_READY = False
