"""One-off ECS payload: only apply the reviewed additive calendar migrations.

Executed with the candidate image's normal settings, never a Django test runner.
No provider requests, meeting synchronization, seeds, or other migrations.
"""
import copy
import datetime as dt
import json
import os
import sys

LATEST_TARGET = ('curriculum_api', '0091_module_week_boundary_mode')
TARGET = LATEST_TARGET
ALLOWED = {('curriculum_api', '0089_module_week_starts_on'), ('curriculum_api', '0090_delivery_calendars'), TARGET}
PRODUCTION_BRANCH = 'br-lucky-resonance-abhjt0li'


class GateError(RuntimeError):
    pass


def candidate_target(disk_migrations):
    # Rollback images containing the original calendar feature do not contain
    # 0091. Verify their own minimum schema; never reverse the newer ledger.
    for target in (LATEST_TARGET, ('curriculum_api', '0090_delivery_calendars')):
        if target in disk_migrations:
            return target
    raise GateError('candidate_calendar_migration_missing')


def checked_database(config, endpoint, database):
    config = copy.deepcopy(config)
    host = str(config.get('HOST', '')).lower()
    if (config.get('ENGINE') != 'django.db.backends.postgresql'
            or config.get('NAME') != database
            or host not in {endpoint + '.eu-west-2.aws.neon.tech', endpoint + '-pooler.eu-west-2.aws.neon.tech'}
            or config.get('OPTIONS', {}).get('sslmode') not in {'require', 'verify-full'}):
        raise GateError('database_target_or_tls_mismatch')
    # DDL uses a direct session; a transaction pool must not split this operation.
    config['HOST'] = host.replace(endpoint + '-pooler.', endpoint + '.', 1)
    config.setdefault('OPTIONS', {}).pop('pool', None)
    config['CONN_MAX_AGE'] = 0
    return config


def checked_restore_point(raw, now=None):
    try:
        point = json.loads(raw)
        created = dt.datetime.fromisoformat(point['created_at'].replace('Z', '+00:00'))
        now = now or dt.datetime.now(dt.timezone.utc)
        age = (now - created).total_seconds()
        valid = (str(point['id']).startswith('snap-')
                 and point['branch_id'] == PRODUCTION_BRANCH and 0 <= age <= 86400)
    except (ValueError, TypeError, KeyError):
        valid = False
    if not valid:
        raise GateError('fresh_production_restore_point_required')


def checked_plan(executor, mode):
    if TARGET in executor.loader.applied_migrations:
        return []  # Minimum schema only: never reverse later main migrations.
    if mode != 'apply':
        raise GateError('calendar_schema_missing')
    plan = executor.migration_plan([TARGET])
    names = [(migration.app_label, migration.name) for migration, _ in plan]
    if (not names or names[-1] != TARGET or len(names) != len(set(names))
            or any(backwards or (m.app_label, m.name) not in ALLOWED for m, backwards in plan)):
        raise GateError('unexpected_migration_plan')
    return names


def fingerprint(cursor, previous=None):
    result = {}
    for table in ('modules', 'cohorts', 'learning_courses', 'free_authoring_modules'):
        cursor.execute('SELECT to_regclass(%s)', ['curriculum.' + table])
        if cursor.fetchone()[0] is None:
            continue
        if previous is None:
            cursor.execute('''SELECT column_name FROM information_schema.columns
                WHERE table_schema='curriculum' AND table_name=%s''', [table])
            added = sorted({'calendar_policy', 'week_starts_on', 'week_boundary_mode'} - {row[0] for row in cursor.fetchall()})
        else:
            added = previous[table]['added']
        # Preserve all existing fields, including existing overrides. Only newly
        # added NULL fields may be omitted. No row contents/hashes leave the task.
        cursor.execute(f"""SELECT count(*), md5(COALESCE(string_agg(value, '' ORDER BY value), ''))
            FROM (SELECT md5((to_jsonb(t) - %s::text[])::text) AS value
                  FROM curriculum.{table} t) rows""", [added])
        result[table] = {'rows': cursor.fetchone(), 'added': added}
        if previous is not None and table in {'modules', 'cohorts'}:
            for column in added:
                if column in {'week_starts_on', 'week_boundary_mode'} and table != 'modules':
                    continue
                cursor.execute(f'SELECT count(*) FROM curriculum.{table} WHERE {column} IS NOT NULL')
                if cursor.fetchone()[0] != 0:
                    raise GateError('legacy_calendar_defaults_changed')
    return result


def verify_schema(cursor):
    columns = [
            ('modules', 'week_starts_on', 'character varying'),
            ('modules', 'calendar_policy', 'jsonb'), ('cohorts', 'calendar_policy', 'jsonb')]
    if TARGET == LATEST_TARGET:
        columns.insert(1, ('modules', 'week_boundary_mode', 'character varying'))
    for table, column, data_type in columns:
        cursor.execute('''SELECT data_type, is_nullable FROM information_schema.columns
            WHERE table_schema='curriculum' AND table_name=%s AND column_name=%s''', [table, column])
        if cursor.fetchone() != (data_type, 'YES'):
            raise GateError('calendar_column_missing_or_incompatible')
        cursor.execute('SELECT has_column_privilege(current_user, %s, %s, %s), '
                       'has_column_privilege(current_user, %s, %s, %s)',
                       ['curriculum.' + table, column, 'SELECT', 'curriculum.' + table, column, 'UPDATE'])
        if cursor.fetchone() != (True, True):
            raise GateError('calendar_column_permissions_missing')
    cursor.execute("SELECT to_regclass('curriculum.country_holiday_calendars')")
    if cursor.fetchone()[0] is None:
        raise GateError('calendar_cache_missing')
    for privilege in ('SELECT', 'INSERT', 'UPDATE'):
        cursor.execute("SELECT has_table_privilege(current_user, 'curriculum.country_holiday_calendars', %s)",
                       [privilege])
        if cursor.fetchone()[0] is not True:
            raise GateError('calendar_cache_permissions_missing')


def run_gate(db, executor_factory, atomic, mode, restore_point, database):
    # Hold both DDL and its ledger entries in one bounded transaction. A failed
    # post-check rolls back both migrations; old application tasks stay running.
    with atomic(using=db.alias):
        with db.cursor() as cursor:
            cursor.execute("SET LOCAL lock_timeout = '5s'")
            cursor.execute("SET LOCAL statement_timeout = '60s'")
            cursor.execute('SELECT current_database(), pg_is_in_recovery()')
            if cursor.fetchone() != (database, False):
                raise GateError('database_identity_or_primary_mismatch')
            cursor.execute("SELECT pg_try_advisory_xact_lock(hashtext('lms-calendar-schema-release'))")
            if cursor.fetchone()[0] is not True:
                raise GateError('calendar_migration_already_running')
        executor = executor_factory(db)
        names = checked_plan(executor, mode)
        if names:
            checked_restore_point(restore_point)
            with db.cursor() as cursor:
                before = fingerprint(cursor)
            executor.migrate([TARGET])
            with db.cursor() as cursor:
                if fingerprint(cursor, before) != before:
                    raise GateError('existing_delivery_data_changed')
            if TARGET not in executor.loader.applied_migrations:
                # MigrationExecutor's loader is a pre-run snapshot.
                from django.db.migrations.recorder import MigrationRecorder
                if TARGET not in MigrationRecorder(db).applied_migrations():
                    raise GateError('calendar_migration_ledger_missing')
        with db.cursor() as cursor:
            verify_schema(cursor)
        return {'calendar_schema': 'verified', 'applied': [name for _, name in names]}


def main():
    if os.environ.get('CALENDAR_GATE_MODE') not in {'apply', 'verify'}:
        raise GateError('invalid_gate_mode')
    if not os.environ.get('CALENDARIFIC_API_KEY', '').strip():
        raise GateError('calendarific_key_missing_or_empty')
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
    if os.environ['DJANGO_SETTINGS_MODULE'] != 'config.settings':
        raise GateError('normal_production_settings_required')
    import django
    from django.db import connections, transaction
    from django.db.migrations.executor import MigrationExecutor
    django.setup()
    config = checked_database(connections.databases['default'], os.environ['CALENDAR_EXPECTED_ENDPOINT'],
                              os.environ['CALENDAR_EXPECTED_DATABASE'])
    alias = 'calendar_release'
    connections.databases[alias] = config
    db = connections[alias]
    def candidate_executor(database):
        global TARGET
        executor = MigrationExecutor(database)
        TARGET = candidate_target(executor.loader.disk_migrations)
        return executor
    try:
        result = run_gate(db, candidate_executor, transaction.atomic, os.environ['CALENDAR_GATE_MODE'],
                          os.environ.get('CALENDAR_RESTORE_POINT', ''), config['NAME'])
        print('CALENDAR_SCHEMA_GATE ' + json.dumps(result, sort_keys=True))
    finally:
        db.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Third-party errors may contain DSNs, SQL parameters or secret values.
        reason = str(exc) if isinstance(exc, GateError) else type(exc).__name__
        print('CALENDAR_SCHEMA_GATE ' + json.dumps({'error': reason}), file=sys.stderr)
        sys.exit(1)
