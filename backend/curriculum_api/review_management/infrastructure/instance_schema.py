"""Existing independent provisioning/readiness gates, with one state owner."""
from __future__ import annotations

from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.review_management.infrastructure.instance_relations import LEARNER_REVIEW_ADDITIONS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_ANSWERS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_REOPENS_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_SIGNATURES_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import authoring_json_type
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api import schema_gate


_TABLES_READY = False


def ensure_review_instance_tables():
    global _TABLES_READY
    if _TABLES_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(
            REVIEW_INSTANCES_TABLE, REVIEW_INSTANCE_ANSWERS_TABLE, REVIEW_INSTANCE_SIGNATURES_TABLE,
        )
        _TABLES_READY = True
        return
    provision_review_instance_tables()


_MANUAL_OVERRIDES_TABLE_READY = False


def ensure_review_instance_manual_overrides_table():
    """Verify/provision review_instance_manual_overrides on its own, narrower
    gate than ensure_review_instance_tables().

    Deliberately not folded into the three core tables' gate: those three are
    required before ANY review-instance operation (schedule, save an answer,
    complete, sign), so adding this one there would mean a plain Teams-
    attendance transition -- which never touches this table -- starts failing
    in production the moment this code deploys, if the new table's SQL
    (sql/<date>_curriculum_review_instance_manual_overrides.sql) has not been
    run against Neon yet. Keeping it separate means only the manual-override
    action itself is affected by that ordering, not the rest of the review
    engine.
    """
    global _MANUAL_OVERRIDES_TABLE_READY
    if _MANUAL_OVERRIDES_TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)
        _MANUAL_OVERRIDES_TABLE_READY = True
        return
    _provision_review_instance_manual_overrides_table()
    _MANUAL_OVERRIDES_TABLE_READY = True


def _provision_review_instance_manual_overrides_table():
    """Mirrors sql/<date>_curriculum_review_instance_manual_overrides.sql for
    sqlite/local dev. NOT for production request paths -- see
    ensure_review_instance_manual_overrides_table/schema_gate."""
    from django.db import connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)} (
                id varchar(128) primary key,
                review_instance_id varchar(128) not null,
                calendar_event_id integer,
                previous_status varchar(32) not null,
                new_status varchar(32) not null,
                reason_code varchar(64) not null,
                note text not null default '',
                changed_by varchar(255) not null,
                changed_at timestamp not null default current_timestamp,
                manual_started_at timestamp
            )
        ''')
        cursor.execute(f'''
            create index if not exists review_instance_manual_overrides_instance_idx
            on {authoring_table_name(REVIEW_INSTANCE_MANUAL_OVERRIDES_TABLE)} (review_instance_id, changed_at desc)
        ''')


_REOPENS_TABLE_READY = False


def ensure_review_instance_reopens_table():
    """Verify/provision review_instance_reopens on its own, narrow gate.

    Same reasoning as ensure_review_instance_manual_overrides_table: folding
    this into the three core tables' gate would mean every ordinary review
    operation (schedule, answer, complete, sign) starts failing the moment
    this code deploys, if sql/2026-09-21_curriculum_review_instance_reopens.sql
    has not been run against Neon yet. Keeping it separate confines that
    ordering risk to the reopen action itself.
    """
    global _REOPENS_TABLE_READY
    if _REOPENS_TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(REVIEW_INSTANCE_REOPENS_TABLE)
        _REOPENS_TABLE_READY = True
        return
    _provision_review_instance_reopens_table()
    _REOPENS_TABLE_READY = True


def _provision_review_instance_reopens_table():
    """Mirrors sql/2026-09-21_curriculum_review_instance_reopens.sql for
    sqlite/local dev. NOT for production request paths -- see
    ensure_review_instance_reopens_table/schema_gate."""
    from django.db import connection
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_INSTANCE_REOPENS_TABLE)} (
                id varchar(128) primary key,
                review_instance_id varchar(128) not null,
                calendar_event_id integer,
                previous_status varchar(32) not null,
                new_status varchar(32) not null,
                reason_code varchar(64) not null,
                note text not null default '',
                changed_by varchar(255) not null,
                changed_at timestamp not null default current_timestamp,
                previous_state_snapshot {json_type}
            )
        ''')
        cursor.execute(f'''
            create index if not exists review_instance_reopens_instance_idx
            on {authoring_table_name(REVIEW_INSTANCE_REOPENS_TABLE)} (review_instance_id, changed_at desc)
        ''')


_LEARNER_REVIEW_ADDITIONS_TABLE_READY = False


def ensure_learner_review_additions_table():
    global _LEARNER_REVIEW_ADDITIONS_TABLE_READY
    if _LEARNER_REVIEW_ADDITIONS_TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(LEARNER_REVIEW_ADDITIONS_TABLE)
        _LEARNER_REVIEW_ADDITIONS_TABLE_READY = True
        return
    _provision_learner_review_additions_table()
    _LEARNER_REVIEW_ADDITIONS_TABLE_READY = True


def _provision_learner_review_additions_table():
    """Mirrors sql/2026-09-15_curriculum_learner_review_additions.sql for
    sqlite/local dev. NOT for production request paths -- see
    ensure_learner_review_additions_table/schema_gate."""
    from django.db import connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} (
                id varchar(128) primary key,
                review_template_id varchar(128) not null,
                programme_id varchar(255) not null,
                learner_id integer not null,
                target_date date not null,
                reason_code varchar(64) not null default '',
                reason varchar(1000) not null default '',
                created_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_by varchar(255) not null default '',
                updated_at timestamp not null default current_timestamp,
                deleted_at timestamp,
                deleted_by varchar(255)
            )
        ''')
        cursor.execute(f'''
            create index if not exists learner_review_additions_learner_idx
            on {authoring_table_name(LEARNER_REVIEW_ADDITIONS_TABLE)} (learner_id)
        ''')


def provision_review_instance_tables():
    """Mirrors sql/2026-09-13_curriculum_review_instances.sql for sqlite/local
    dev. NOT for production request paths -- see reviews.py/schema_gate."""
    global _TABLES_READY
    if _TABLES_READY:
        return
    from django.db import connection
    json_type = authoring_json_type()
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_INSTANCES_TABLE)} (
                id varchar(128) primary key,
                review_template_id varchar(128) not null,
                learner_id integer not null,
                learner_kind varchar(32) not null default '',
                programme_id varchar(255) not null,
                occurrence_number integer,
                occurrence_source varchar(16) not null default 'generated',
                occurrence_ref varchar(160),
                target_date date not null,
                coach_email varchar(255) not null default '',
                calendar_event_id integer,
                definition_snapshot {json_type} not null,
                progress_snapshot {json_type},
                status varchar(32) not null default 'not-scheduled',
                started_at timestamp,
                completed_at timestamp,
                created_by varchar(255) not null default '',
                updated_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_INSTANCE_ANSWERS_TABLE)} (
                id varchar(128) primary key,
                review_instance_id varchar(128) not null,
                field_id varchar(128) not null,
                answer {json_type},
                answered_by varchar(255) not null default '',
                answered_at timestamp not null default current_timestamp,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_INSTANCE_SIGNATURES_TABLE)} (
                id varchar(128) primary key,
                review_instance_id varchar(128) not null,
                role varchar(32) not null,
                signed_by varchar(255) not null default '',
                signed_name varchar(255) not null default '',
                signature text,
                signed_at timestamp,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
    _TABLES_READY = True


def reset_review_instance_readiness():
    """Reset exactly the three gates historically reset by the app entry point.

    The independently managed reopen gate retains its previous lifetime.
    """
    global _TABLES_READY, _MANUAL_OVERRIDES_TABLE_READY, _LEARNER_REVIEW_ADDITIONS_TABLE_READY
    _TABLES_READY = False
    _MANUAL_OVERRIDES_TABLE_READY = False
    _LEARNER_REVIEW_ADDITIONS_TABLE_READY = False
