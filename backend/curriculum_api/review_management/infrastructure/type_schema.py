"""Review-type schema readiness and idempotent system-type seeding."""
from __future__ import annotations

from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.review_management.infrastructure.relations import REVIEW_TYPES_TABLE
from curriculum_api.review_management.domain.classification import SYSTEM_REVIEW_TYPES
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.domain.values import clean_str
from django.db import connection
from datetime import datetime
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api import schema_gate
from curriculum_api.catalogue.infrastructure.database_reads import table_name


_TABLE_READY = False


def reset_ready_flag():
    """Test hook -- mirrors views.reset_schema_ready_flags()."""
    global _TABLE_READY
    _TABLE_READY = False


def ensure_review_types_table():
    """Verify the table exists; provision + seed only outside production."""
    global _TABLE_READY
    if _TABLE_READY:
        return
    if not schema_gate.runtime_bootstrap_allowed():
        schema_gate.require_tables(REVIEW_TYPES_TABLE)
        _TABLE_READY = True
        return
    provision_review_types_table()


def provision_review_types_table():
    """Mirrors sql/2026-09-13_curriculum_review_types.sql for sqlite/local dev.

    NOT for production request paths -- schema there is owned by the SQL file
    applied to Neon directly. See schema_gate's module docstring.
    """
    global _TABLE_READY
    if _TABLE_READY:
        return
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(CURRICULUM_SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {authoring_table_name(REVIEW_TYPES_TABLE)} (
                id varchar(128) primary key,
                name varchar(255) not null default '',
                code varchar(64) not null,
                is_system boolean not null default false,
                is_active boolean not null default true,
                created_by varchar(255) not null default '',
                updated_by varchar(255) not null default '',
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
    _TABLE_READY = True
    seed_system_review_types()


def seed_system_review_types():
    """Insert any missing system type. Idempotent: matched on ``code``, so a
    row someone renamed in the UI is left exactly as it is."""
    existing = {
        clean_str(row.get('code')).lower()
        for row in fetch_all(
            f'select code from {table_name(REVIEW_TYPES_TABLE)}'
        )
    }
    seeded = []
    for entry in SYSTEM_REVIEW_TYPES:
        if entry['code'] in existing:
            continue
        insert_row(REVIEW_TYPES_TABLE, {
            'id': entry['id'],
            'name': entry['name'],
            'code': entry['code'],
            'is_system': True,
            'is_active': True,
            'created_by': 'system',
            'updated_by': 'system',
            'created_at': datetime.utcnow(),
            'updated_at': datetime.utcnow(),
        })
        seeded.append(entry['code'])
    return seeded
