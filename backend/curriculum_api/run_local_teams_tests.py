"""Run Teams regressions on a verified, empty, disposable local PostgreSQL DB.

From backend: python -m curriculum_api.run_local_teams_tests
  --connection-file <private JSON> --data-directory <local cluster directory>
The JSON needs host, port, user and dbname (lms_gate_*), and optionally password.
The existing EnrolmentTestRunner creates/destroys a separate test_ database.
Application .env files and remote databases are never used as connection targets.
As with settings_sqlite_test, current managed models are created with syncdb;
this validates PostgreSQL requests/transactions, not deployment migration history.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import socket
import sys
from unittest.mock import patch


SUITES = (
    'curriculum_api.tests.TeamsMultiDayRecurrenceTests',
    'curriculum_api.tests.TeamsAttendanceRosterTests',
    'curriculum_api.tests.CurriculumTeamsMeetingTests',
    'curriculum_api.tests.TeamsCalendarSyncVerdictTests',
    'coach_api.tests.CoachTimetableWindowTests',
    'coach_api.tests.CoachTimetableBookingConflictTests',
    'coach_api.tests.CoachMeetingArtifactTests',
    'coach_api.tests_calendar_race',
    'coach_api.tests_errors',
    'coach_api.tests_security',
    'learner_api.tests.TeamsAttendanceEligibilityTests',
    'learner_api.tests.TeamsAttendanceSyncTests',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--connection-file', type=Path, required=True)
    parser.add_argument('--data-directory', type=Path, required=True)
    parser.add_argument('--failfast', action='store_true')
    args = parser.parse_args()
    cfg = json.loads(args.connection_file.read_text(encoding='utf-8-sig'))
    name = str(cfg.get('dbname', ''))
    if cfg.get('host') != '127.0.0.1' or not name.startswith('lms_gate_') or not name.isidentifier():
        raise RuntimeError('Only an explicitly named disposable local lms_gate_ database is permitted.')
    directory = args.data_directory.resolve(strict=True)
    import psycopg
    connect = dict(host='127.0.0.1', port=int(cfg['port']), dbname=name,
                   user=cfg['user'], password=cfg.get('password', ''), connect_timeout=5)
    with psycopg.connect(**connect) as conn, conn.cursor() as cursor:
        cursor.execute("SELECT current_database(), host(inet_server_addr()), inet_server_port(), current_setting('data_directory')")
        actual_name, host, port, actual_directory = cursor.fetchone()
        if (actual_name != name or host != '127.0.0.1' or port != connect['port']
                or Path(actual_directory).resolve() != directory):
            raise RuntimeError('The actual database/cluster does not match the isolated test target.')
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema')")
        if cursor.fetchone()[0]:
            raise RuntimeError('The disposable base database must be empty.')
        cursor.execute('SELECT 1 FROM pg_database WHERE datname = %s', ['test_' + name])
        if cursor.fetchone():
            raise RuntimeError('A test database already exists; refusing to overwrite it.')

    # Load the existing isolated configuration first, then replace EVERY alias.
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_coaching_recordings_test'
    os.environ['CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP'] = 'true'
    os.environ['CURRICULUM_WARM'] = '0'
    sys.argv = ['manage.py', 'test', *SUITES, '--noinput', '--verbosity=1']
    if args.failfast:
        sys.argv.append('--failfast')
    from django.conf import settings
    database = dict(ENGINE='django.db.backends.postgresql', NAME=name,
                    HOST=connect['host'], PORT=connect['port'], USER=connect['user'],
                    PASSWORD=connect['password'], CONN_MAX_AGE=0,
                    OPTIONS={'connect_timeout': 5}, TEST={'NAME': 'test_' + name})
    settings.DATABASES = {'default': database, 'enrolment': copy.deepcopy(database)}
    settings.DATABASES['enrolment']['TEST'] = {'MIRROR': 'default'}
    # Engagement's migrations extend an externally provisioned reward wallet;
    # these Teams suites do not exercise rewards or validate their migrations.
    settings.MIGRATION_MODULES = {**settings.MIGRATION_MODULES, 'engagement_api': None}
    settings.TEST_RUNNER = 'login.test_runner.EnrolmentTestRunner'

    original_connect = psycopg.Connection.connect
    def local_database_only(conninfo='', **kwargs):
        params = psycopg.conninfo.conninfo_to_dict(conninfo, **kwargs)
        if (params.get('host') != '127.0.0.1' or int(params.get('port', 0)) != connect['port']
                or params.get('dbname') not in {name, 'test_' + name, 'postgres'}
                or params.get('user') != connect['user']):
            raise AssertionError('Database connection outside the verified local cluster forbidden.')
        return original_connect(conninfo, **kwargs)

    original_socket_connect = socket.socket.connect
    def local_socket_only(sock, address):
        # Windows asyncio creates its socketpair over loopback.
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_socket_connect(sock, address)
        raise AssertionError('External network forbidden in Teams regressions.')

    print('Verified empty local PostgreSQL and cluster directory; remote DB/network disabled.', flush=True)
    from django.core.management import execute_from_command_line
    with patch.object(psycopg.Connection, 'connect', new=staticmethod(local_database_only)), \
            patch('psycopg.connect', new=local_database_only), \
            patch.object(socket.socket, 'connect', new=local_socket_only), \
            patch.object(socket.socket, 'connect_ex', side_effect=AssertionError('External network forbidden')):
        import django
        django.setup()
        from django.db.backends.signals import connection_created
        from learner_api.models import EnrolmentUser, LearnerProfile, LearnerProgressEntry, LearnerQuizAnswer
        # Coach attendance's real cross-schema FKs need these unmanaged parents
        # before syncdb. Use current ORM definitions, including generated columns.
        provisioned = set()
        def provision_parents(sender, connection, **kwargs):
            target = connection.settings_dict['NAME']
            if target != 'test_' + name or target in provisioned:
                return
            # Django installs mirrors after migrations; cross-alias migration
            # preflights must already see the same verified test database.
            from django.db import connections
            connections['enrolment'].close()
            connections['enrolment'].settings_dict['NAME'] = target
            with connection.cursor() as cursor:
                cursor.execute('CREATE SCHEMA IF NOT EXISTS "Learner"')
                cursor.execute('CREATE SCHEMA IF NOT EXISTS enrolment')
            with connection.schema_editor() as editor:
                editor.create_model(EnrolmentUser)
                editor.create_model(LearnerProfile)
                editor.create_model(LearnerProgressEntry)
                editor.create_model(LearnerQuizAnswer)
            provisioned.add(target)
            from curriculum_api import views
            from curriculum_api.tests import CurriculumPersistenceFixtures
            fixtures = CurriculumPersistenceFixtures()
            fixtures.ensure_programmes_table()
            fixtures.ensure_ksb_profiles_table()
            views.ensure_module_authoring_tables()
            views.ensure_live_session_tracking_tables()
            sql_dir = Path(__file__).resolve().parents[1] / 'sql'
            for artifact in ('session_results_archive.sql', 'teams_calendar_create_claims.sql',
                             'teams_calendar_create_drafts.sql', 'teams_schedule_emails.sql',
                             '2026-10-08_teams_calendar_integrity_events.sql', 'module_session_overrides.sql'):
                with connection.cursor() as cursor:
                    cursor.execute((sql_dir / artifact).read_text(encoding='utf-8-sig'))
            from quiz_api.models import QuizPackage, QuizQuestion, QuizAnswer
            with connection.schema_editor() as editor:
                for model in (QuizPackage, QuizQuestion, QuizAnswer):
                    editor.create_model(model)
        connection_created.connect(provision_parents, weak=False)
        execute_from_command_line(sys.argv)


if __name__ == '__main__':
    main()
