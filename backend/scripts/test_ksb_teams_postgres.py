"""Run the 31 Teams request/verdict cases in a fresh local PostgreSQL cluster.

Model-owned tables and existing curriculum test bootstrap helpers provide the
synthetic fixture schema; this is not a production migration test. Authentication
and application writes remain real. Only external transports are test doubles.
"""
import logging.config
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import psycopg
from psycopg import sql

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
SUITES = ['curriculum_api.tests.CurriculumTeamsMeetingTests',
          'curriculum_api.tests.TeamsCalendarSyncVerdictTests',
          'curriculum_api.test_template_ksbs_postgres.TemplateKsbApiTests']
EXPECTED_CASES = 37


def tests(port, directory):
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    os.environ['CURRICULUM_WARM'] = '0'
    os.environ['AZURE_MAIL_ENABLED'] = 'false'
    from django.conf import settings
    from django.db.backends.base.base import BaseDatabaseWrapper
    assert all(v['ENGINE']=='django.db.backends.sqlite3' for v in settings.DATABASES.values())
    config = dict(ENGINE='django.db.backends.postgresql',NAME='postgres',USER='postgres',
                  PASSWORD='',HOST='127.0.0.1',PORT=str(port),CONN_MAX_AGE=0)
    settings.DATABASES = {'default': dict(config), 'enrolment': dict(config)}
    settings.CACHES = {'default': {'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}}
    settings.CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP = True
    original = BaseDatabaseWrapper.ensure_connection
    def ensure(connection):
        cfg = connection.settings_dict
        if (cfg['ENGINE'],cfg['HOST'],str(cfg['PORT']),cfg['NAME']) != (
                'django.db.backends.postgresql','127.0.0.1',str(port),'postgres'):
            raise AssertionError('Database outside the verified disposable cluster forbidden.')
        return original(connection)
    original_connect = socket.socket.connect
    def connect(sock, address):
        if not isinstance(address,tuple) or address[:2] != ('127.0.0.1',port):
            raise AssertionError('External network forbidden.')
        return original_connect(sock,address)
    with patch.object(logging.config,'dictConfig'), patch.object(BaseDatabaseWrapper,'ensure_connection',ensure):
        import django
        django.setup()
        with patch.object(socket.socket,'connect',connect):
            from django.apps import apps
            from django.db import connection, connections
            from django.test.utils import setup_test_environment, teardown_test_environment
            from django.db.migrations.loader import MigrationLoader
            # Prove the SQLite-test graph is internally consistent, without
            # applying PostgreSQL historical migrations to an empty fixture DB.
            MigrationLoader(None).graph.validate_consistency()
            selected = {m for m in apps.get_models() if m._meta.managed and not m._meta.proxy}
            selected.update(apps.get_app_config('login').get_models())
            from learner_api.models import StaffUser
            selected.add(StaffUser)
            pending = list(selected)
            while pending:
                model = pending.pop()
                for field in model._meta.local_fields:
                    related = getattr(getattr(field,'remote_field',None),'model',None)
                    if related and related not in selected and getattr(field,'db_constraint',True):
                        selected.add(related)
                        pending.append(related)
            with connection.cursor() as cursor:
                for namespace in {'curriculum','Learner','enrolment','login','chat','Coach'} | {
                        m._meta.db_table.split('"."')[0].strip('"') for m in selected if '"."' in m._meta.db_table}:
                    cursor.execute(sql.SQL('CREATE SCHEMA IF NOT EXISTS {}').format(sql.Identifier(namespace)))
            from curriculum_api import views
            # Placement ORM models intentionally expose only a subset of the
            # authoring columns. Provision their full fixture tables first.
            views.ensure_module_authoring_tables()
            views.ensure_live_sessions_table()
            views.ensure_live_session_tracking_tables()
            seen = set()
            with connection.schema_editor() as editor:
                for model in sorted(selected,key=lambda m:m._meta.label):
                    with connection.cursor() as cursor:
                        cursor.execute('SELECT to_regclass(%s)', [editor.quote_name(model._meta.db_table)])
                        exists = cursor.fetchone()[0]
                    if model._meta.db_table not in seen and not exists:
                        editor.create_model(model)
                        seen.add(model._meta.db_table)
            # Existing deployment DDL is used only inside this verified empty
            # disposable cluster, never through an application connection.
            with connection.cursor() as cursor:
                cursor.execute("ALTER TABLE curriculum.programmes ADD COLUMN status text NOT NULL DEFAULT 'active', ADD COLUMN standard_ref text, ADD COLUMN standard_version text, ADD COLUMN updated_at timestamp")
                # Match installed defaults omitted by unmanaged ORM fixture DDL.
                cursor.execute('ALTER TABLE enrolment."Staff_users" ALTER COLUMN uuid SET DEFAULT gen_random_uuid(), ALTER COLUMN "Created_at" SET DEFAULT CURRENT_TIMESTAMP, ALTER COLUMN "Updated_at" SET DEFAULT CURRENT_TIMESTAMP')
                for fixture in ('session_results_archive.sql', 'teams_calendar_create_claims.sql'):
                    cursor.execute((BACKEND / 'sql' / fixture).read_text(encoding='utf-8'))
            setup_test_environment()
            try:
                suite = unittest.defaultTestLoader.loadTestsFromNames(SUITES)
                assert suite.countTestCases()==EXPECTED_CASES
                result = unittest.TextTestRunner(verbosity=2).run(suite)
                print(f'COUNTS run={result.testsRun} failures={len(result.failures)} errors={len(result.errors)} skipped={len(result.skipped)}')
                return int(not result.wasSuccessful())
            finally:
                teardown_test_environment()
                connections.close_all()


def main():
    binaries=Path('C:/Program Files/PostgreSQL/18/bin')
    root=Path(tempfile.mkdtemp(prefix='lms_ksb_teams_')).resolve()
    directory=root/'data'
    with socket.socket() as listener:
        listener.bind(('127.0.0.1',0))
        port=listener.getsockname()[1]
    def control(*args):
        with (root/'control.log').open('a') as log:
            return subprocess.run([str(binaries/'pg_ctl.exe'),'-D',str(directory),*args],
                stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,timeout=30).returncode
    started=False
    try:
        subprocess.run([str(binaries/'initdb.exe'),'-D',str(directory),'-U','postgres','--auth=trust',
                        '--encoding=UTF8','--no-locale'],check=True,capture_output=True,timeout=45)
        started=True
        if control('-l',str(root/'postgres.log'),'-o',f'-h 127.0.0.1 -p {port}','-w','-t','20','start'):
            raise RuntimeError('Isolated PostgreSQL startup failed.')
        with psycopg.connect(host='127.0.0.1',port=port,user='postgres',dbname='postgres') as db:
            host,actual_port,data,branch=db.execute("SELECT host(inet_server_addr()),inet_server_port(),current_setting('data_directory'),current_setting('neon.branch_id',true)").fetchone()
            assert host=='127.0.0.1' and actual_port==port and not branch and Path(data).resolve()==directory
            assert db.execute("SELECT count(*) FROM pg_namespace WHERE nspname='curriculum'").fetchone()[0]==0
        return tests(port,directory)
    finally:
        if started and control('-m','fast','-w','-t','20','stop'):
            raise RuntimeError(f'Could not stop disposable cluster: {root}')
        print('Stopped isolated test artifacts:',root)


if __name__=='__main__':
    if sys.argv[1:]:
        raise SystemExit('Use test_notification_teams_postgres.py for the complete Coach integration setup.')
    raise SystemExit(main())
