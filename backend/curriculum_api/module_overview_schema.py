"""Additive storage for the learner-facing Module Overview.

One nullable JSONB column, ``curriculum.modules.module_overview``, keyed by the
module's existing ``module_catalogue_id`` primary key. NULL means "no overview
authored". Existing rows are untouched: the column is added empty and nothing
backfills it.

Keep this stable: migration 0086 calls :func:`provision`, and the SQL script
``backend/sql/2026-11-12_module_overview.sql`` is the hand-run equivalent.
Runtime request paths never call it -- the views answer 503 while the column is
missing instead of creating it.
"""

COLUMN = 'module_overview'
CONSTRAINT = 'modules_module_overview_is_object'


def provision(connection):
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute("SELECT to_regclass('curriculum.modules') IS NOT NULL")
            if not cursor.fetchone()[0]:
                # A database without the curriculum tables has nothing to extend.
                return
            cursor.execute(f'ALTER TABLE curriculum.modules ADD COLUMN IF NOT EXISTS {COLUMN} jsonb NULL')
            # Only objects (or NULL) may be stored. Every existing row is NULL
            # after the ADD COLUMN, so validating the constraint scans nothing
            # that could fail.
            cursor.execute(f'''
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = '{CONSTRAINT}'
                          AND conrelid = 'curriculum.modules'::regclass
                    ) THEN
                        ALTER TABLE curriculum.modules
                            ADD CONSTRAINT {CONSTRAINT}
                            CHECK ({COLUMN} IS NULL OR jsonb_typeof({COLUMN}) = 'object');
                    END IF;
                END
                $$;
            ''')
            return
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='modules'")
        if not cursor.fetchone():
            return
        cursor.execute('PRAGMA table_info("modules")')
        if COLUMN not in {row[1] for row in cursor.fetchall()}:
            cursor.execute(f'ALTER TABLE "modules" ADD COLUMN {COLUMN} text NULL')


def remove(connection):
    """Reverse of :func:`provision`. Drops authored overviews -- run deliberately."""
    with connection.cursor() as cursor:
        if connection.vendor != 'postgresql':
            return
        cursor.execute("SELECT to_regclass('curriculum.modules') IS NOT NULL")
        if not cursor.fetchone()[0]:
            return
        cursor.execute(f'ALTER TABLE curriculum.modules DROP CONSTRAINT IF EXISTS {CONSTRAINT}')
        cursor.execute(f'ALTER TABLE curriculum.modules DROP COLUMN IF EXISTS {COLUMN}')
