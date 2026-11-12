"""Copy the data of curriculum features the new database was missing, from production.

Run AFTER backend/sql/new_db_curriculum_missing_objects.sql has been applied to
the new database: that file creates the columns and tables; this script fills
them with what production (the old database) holds. Nothing else is touched.

    python scripts/copy_curriculum_feature_data_to_new_db.py            # report only
    python scripts/copy_curriculum_feature_data_to_new_db.py --apply    # write

Source: ``Database_url`` from backend/.env (production), opened read-only.
Target: ``NEW_ENDPOINT_URL`` from backend/.env (the new database).
``--target-host`` swaps only the target host, to rehearse on a Neon branch.

What is copied:
  * live_session_learner_attendance: the rows production marks as parallel
    attendance. A row the new database already has (same id, same occurrence and
    learner) gets its status, basis and parallel_* columns from production. A row
    it lacks is inserted only when everything it points at exists there.
  * teams_organization_calendar_connections, module_hours_targets/_access/_audit,
    curriculum_video_import, curriculum_video_change: every production row the
    new database does not have yet (ON CONFLICT DO NOTHING).

All writes run in one transaction; any error rolls everything back. Running it
again copies nothing new. No connection string or credential is printed.
"""
import argparse
import os
import sys
from urllib.parse import urlparse, urlunparse

import psycopg

ATTENDANCE = 'curriculum.live_session_learner_attendance'
PARALLEL_FILTER = ('parallel_source_occurrence_id IS NOT NULL OR parallel_created '
                   "OR attendance_basis = 'parallel' OR parallel_previous_status IS NOT NULL")
PARALLEL_COLUMNS = ('attendance_status', 'attendance_basis', 'parallel_source_occurrence_id',
                    'parallel_source_module_id', 'parallel_previous_status', 'parallel_previous_basis',
                    'parallel_created', 'updated_at')
# (table, conflict target for the report, identity column to resync or None)
WHOLE_TABLES = (
    ('curriculum.teams_organization_calendar_connections', None),
    ('curriculum.module_hours_targets', None),
    ('curriculum.module_hours_access', None),
    ('curriculum.module_hours_audit', 'id'),
    ('public.curriculum_video_import', None),
    ('public.curriculum_video_change', 'id'),
)


def env_value(name):
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    with open(path, encoding='utf-8-sig') as handle:
        for line in handle:
            line = line.strip()
            if line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            if key.strip() == name:
                return value.strip().strip('"').strip("'")
    raise SystemExit(f'{name} is not set in backend/.env')


def columns(cursor, qualified):
    schema, table = qualified.split('.', 1)
    cursor.execute('SELECT column_name FROM information_schema.columns '
                   'WHERE table_schema = %s AND table_name = %s ORDER BY ordinal_position', [schema, table])
    return [row[0] for row in cursor.fetchall()]


def quote(names):
    return ', '.join(f'"{name}"' for name in names)


def insert_rows(target, table, shared, rows):
    """Insert jsonb rows by column name; returns how many were new."""
    sql = (f'INSERT INTO {table} ({quote(shared)}) '
           f'SELECT {quote(shared)} FROM jsonb_populate_record(NULL::{table}, %s::jsonb) '
           f'ON CONFLICT DO NOTHING')
    added = 0
    for row in rows:
        target.execute(sql, [row])
        added += target.rowcount
    return added


def exists(target, sql, value):
    if value is None:
        return True
    target.execute(sql, [value])
    return target.fetchone() is not None


def copy_attendance(source, target, report):
    source_columns = columns(source, ATTENDANCE)
    target_columns = columns(target, ATTENDANCE)
    missing = [name for name in PARALLEL_COLUMNS if name not in target_columns]
    if missing:
        raise SystemExit(f'The new database lacks {missing}: apply new_db_curriculum_missing_objects.sql first.')
    # The new database numbers its own rows (identity BY DEFAULT): an inserted row
    # takes a fresh id there rather than production's, which may collide later.
    shared = [name for name in source_columns if name in target_columns and name != 'id']
    source.execute(f'SELECT to_jsonb(r)::text, r.id, r.occurrence_id, r.learner_profile_id FROM {ATTENDANCE} r '
                   f'WHERE {PARALLEL_FILTER} ORDER BY r.id')
    rows = source.fetchall()
    import json
    updated = inserted = 0
    skipped = []
    for payload, row_id, occurrence_id, profile_id in rows:
        data = json.loads(payload)
        if not exists(target, 'SELECT 1 FROM curriculum.live_session_occurrences WHERE id = %s',
                      data.get('parallel_source_occurrence_id')):
            skipped.append((row_id, 'its parallel source session is not in the new database'))
            continue
        # The register's own key is (session, learner): ids differ between the
        # two databases for the same row.
        target.execute(f'SELECT id FROM {ATTENDANCE} WHERE occurrence_id = %s AND learner_profile_id = %s',
                       [occurrence_id, profile_id])
        current = target.fetchone()
        if current is not None:
            assignments = ', '.join(f'"{name}" = %s' for name in PARALLEL_COLUMNS)
            target.execute(f'UPDATE {ATTENDANCE} SET {assignments} WHERE id = %s',
                           [data.get(name) for name in PARALLEL_COLUMNS] + [current[0]])
            updated += target.rowcount
            continue
        checks = (
            ('SELECT 1 FROM curriculum.live_session_occurrences WHERE id = %s', data.get('occurrence_id'), 'session'),
            ('SELECT 1 FROM curriculum.live_sessions WHERE id = %s', data.get('live_session_id'), 'live session'),
            ('SELECT 1 FROM curriculum.modules WHERE module_catalogue_id = %s', data.get('module_catalogue_id'), 'module'),
            ('SELECT 1 FROM "Learner".learners WHERE id = %s', data.get('learner_profile_id'), 'learner'),
            ('SELECT 1 FROM curriculum.qr_attendance WHERE id = %s', data.get('qr_attendance_id'), 'QR record'),
        )
        absent = [label for sql, value, label in checks if not exists(target, sql, value)]
        if absent:
            skipped.append((row_id, 'missing in the new database: ' + ', '.join(absent)))
            continue
        inserted += insert_rows(target, ATTENDANCE, shared, [payload])
    report.append(f'{ATTENDANCE}: {len(rows)} parallel rows in production; '
                  f'{updated} updated, {inserted} inserted, {len(skipped)} skipped')
    for row_id, reason in skipped:
        report.append(f'    skipped row {row_id}: {reason}')


def copy_table(source, target, table, identity, report, apply):
    target_columns = columns(target, table)
    if not target_columns:
        raise SystemExit(f'The new database lacks {table}: apply new_db_curriculum_missing_objects.sql first.')
    shared = [name for name in columns(source, table) if name in target_columns]
    source.execute(f'SELECT to_jsonb(r)::text FROM {table} r')
    rows = [row[0] for row in source.fetchall()]
    added = insert_rows(target, table, shared, rows)
    # setval is not undone by a rollback, so a report-only run leaves it alone.
    if identity and rows and apply:
        target.execute(f"SELECT setval(pg_get_serial_sequence(%s, %s), "
                       f"GREATEST((SELECT COALESCE(max({identity}), 0) FROM {table}), 1))", [table, identity])
    report.append(f'{table}: {len(rows)} rows in production; {added} copied, {len(rows) - added} already there')


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    parser.add_argument('--apply', action='store_true', help='write (default: report and roll back)')
    parser.add_argument('--target-host', help='rehearse on another host (a Neon branch endpoint)')
    args = parser.parse_args()

    source_url = env_value('Database_url')
    target_url = env_value('NEW_ENDPOINT_URL')
    if args.target_host:
        parsed = urlparse(target_url)
        user = parsed.netloc.rsplit('@', 1)[0]
        target_url = urlunparse(parsed._replace(netloc=f'{user}@{args.target_host}'))
    if urlparse(source_url).hostname == urlparse(target_url).hostname:
        raise SystemExit('Source and target are the same database; refusing.')

    report = []
    with psycopg.connect(source_url, options='-c default_transaction_read_only=on') as source_conn, \
            psycopg.connect(target_url) as target_conn:
        with source_conn.cursor() as source, target_conn.cursor() as target:
            source.execute('SHOW default_transaction_read_only')
            assert source.fetchone()[0] == 'on', 'production must be opened read-only'
            for label, cursor in (('source (production)', source), ('target (new)', target)):
                try:
                    cursor.execute("SELECT current_setting('neon.branch_id', true)")
                    report.append(f'{label} branch: {cursor.fetchone()[0]}')
                except psycopg.Error:
                    cursor.connection.rollback()
            copy_attendance(source, target, report)
            for table, identity in WHOLE_TABLES:
                copy_table(source, target, table, identity, report, args.apply)
        if args.apply:
            target_conn.commit()
        else:
            target_conn.rollback()
    print('\n'.join(report))
    print('APPLIED' if args.apply else 'Report only: nothing written. Run again with --apply to write.')


if __name__ == '__main__':
    sys.exit(main())
