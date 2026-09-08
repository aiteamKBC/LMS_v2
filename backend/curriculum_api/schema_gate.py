"""Schema ownership boundary for the Curriculum app.

Background
----------
Curriculum request handlers used to call ``ensure_*_tables()`` helpers that
issued ``CREATE SCHEMA`` / ``CREATE TABLE`` / ``ALTER TABLE`` / ``CREATE INDEX``
— and, worse, historical data backfills — on the way to serving an ordinary
read. That had three consequences:

1. A plain ``GET`` could not run against a read-only connection.
2. Schema drifted implicitly at runtime instead of through migrations, so a
   dropped column silently reappeared on the next process restart.
3. Once foreign keys exist (migration 0038), a runtime backfill that rewrites a
   ``programme_id`` can raise a foreign-key violation and turn a read endpoint
   into a 500.

Design
------
Schema is owned by Django migrations in production. This module keeps the two
responsibilities apart:

``require_tables(...)``
    Read-only. Verifies the expected tables exist and raises
    ``SchemaNotProvisioned`` naming the missing relations and the migration to
    run. Never mutates anything. This is what request paths use.

``provision_schema(...)``
    Mutating. Only runs where the process is explicitly allowed to own schema —
    the SQLite test runner and local development. Production request paths never
    reach it.

``CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP`` (settings, default ``False``)
    Escape hatch for local Postgres development where running migrations by hand
    is inconvenient. It is *not* enabled in production.
"""
from __future__ import annotations

import logging

from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

CURRICULUM_SCHEMA = 'curriculum'

# The migration that first provisions each table, surfaced in the error so an
# operator knows where to look. Several Curriculum tables predate this app's
# migration history and were renamed into place by 0003/0004, so these point at
# the migration that established the CURRENT name rather than claiming a single
# authoritative CREATE. Tables absent from the map fall back to a generic hint.
TABLE_OWNER_MIGRATION = {
    'programmes': 'curriculum_api.0003_rename_clear_curriculum_tables',
    'cohorts': 'curriculum_api.0004_rename_selected_curriculum_tables',
    'weeks': 'curriculum_api.0004_rename_selected_curriculum_tables',
    'ksb_mappings': 'curriculum_api.0004_rename_selected_curriculum_tables',
    'modules': 'curriculum_api.0001_ksb_mapping_source_metadata',
    'components': 'curriculum_api.0001_ksb_mapping_source_metadata',
    'groups': 'curriculum_api.0005_create_groups_table',
    'tutor_module_notifications': 'curriculum_api.0049_tutor_module_notifications',
    'free_courses': 'curriculum_api.0029_rename_free_programme_modules_to_free_courses',
    'free_programme_components': 'curriculum_api.0030_free_courses_week_link_and_ids',
    'free_course_weeks': 'curriculum_api.0034_split_free_courses_and_weeks',
    'live_sessions': 'curriculum_api.0012_livesession_livesessionartifact_and_more',
    'live_session_occurrences': 'curriculum_api.0012_livesession_livesessionartifact_and_more',
    'live_session_attendance': 'curriculum_api.0012_livesession_livesessionartifact_and_more',
    'live_session_artifacts': 'curriculum_api.0012_livesession_livesessionartifact_and_more',
    'live_session_recording_events': 'curriculum_api.0012_livesession_livesessionartifact_and_more',
    'live_session_join_launches': 'curriculum_api.0060_live_session_join_launches_updated_at',
    'quizzes': 'quiz_api.0003_initial',
    'quiz_course_links': 'quiz_api.0002_rename_quiz_course_links_module_catalogue_id',
    'quiz_component_links': 'quiz_api.0002_rename_quiz_course_links_module_catalogue_id',
    # week_templates / week_template_components are provisioned outside the
    # Django migration graph by sql/001_week_templates.sql on Neon.
}


class SchemaNotProvisioned(RuntimeError):
    """Required Curriculum tables are absent.

    Raised instead of silently creating them inside a request. Carries the
    missing table names so the handler can return a controlled configuration
    error rather than a raw database failure.
    """

    def __init__(self, missing):
        self.missing = list(missing)
        known = sorted({
            TABLE_OWNER_MIGRATION[table]
            for table in self.missing if table in TABLE_OWNER_MIGRATION
        })
        hint = (
            'Apply ' + ', '.join(known) if known
            else 'Run: python manage.py migrate curriculum_api'
        )
        if any(table not in TABLE_OWNER_MIGRATION for table in self.missing):
            hint += (
                ' (note: week_templates/week_template_components are provisioned'
                ' by sql/001_week_templates.sql, not the migration graph)'
            )
        super().__init__(
            'Curriculum schema is not provisioned. Missing: '
            + ', '.join(f'{CURRICULUM_SCHEMA}.{table}' for table in self.missing)
            + '. ' + hint + '.'
        )


def runtime_bootstrap_allowed():
    """May this process create/alter schema outside a migration?

    True only for the SQLite test runner, or when a developer has explicitly
    opted in locally. Production leaves both off, so schema stays migration-owned.
    """
    if connection.vendor != 'postgresql':
        # SQLite is used exclusively by the test runner, which builds its schema
        # in-process because the historical migrations cannot run there.
        return True
    return bool(getattr(settings, 'CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP', False))


# Populated by table_exists() probes; cleared when schema is provisioned.
_VERIFIED_TABLES = set()


def _table_exists(table):
    if connection.vendor == 'postgresql':
        sql = (
            'select 1 from information_schema.tables '
            'where table_schema = %s and table_name = %s limit 1'
        )
        params = [CURRICULUM_SCHEMA, table]
    else:
        sql = "select 1 from sqlite_master where type='table' and name = %s limit 1"
        params = [table]
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        return cursor.fetchone() is not None


def require_tables(*tables):
    """Verify tables exist. Read-only; raises SchemaNotProvisioned if not.

    Results are memoised because schema does not change under a running process
    without a deploy. A negative result is never cached, so a transient error
    cannot pin a table to "missing" for the process lifetime.
    """
    unverified = [table for table in tables if table not in _VERIFIED_TABLES]
    if not unverified:
        return

    missing = []
    for table in unverified:
        try:
            if _table_exists(table):
                _VERIFIED_TABLES.add(table)
            else:
                missing.append(table)
        except Exception:
            # Do not mask a connectivity problem as a schema problem; let the
            # caller's own query surface the real database error.
            logger.debug('Could not verify %s.%s', CURRICULUM_SCHEMA, table, exc_info=True)
            return

    if missing:
        raise SchemaNotProvisioned(missing)


def reset_verification_cache():
    """Forget verified tables (test isolation / after provisioning)."""
    _VERIFIED_TABLES.clear()
