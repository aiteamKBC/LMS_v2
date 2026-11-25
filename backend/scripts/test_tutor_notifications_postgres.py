"""Notification regressions in a new, verified, network-isolated PostgreSQL cluster."""
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

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(BACKEND))


def tests(port, directory):
    os.environ['DJANGO_SETTINGS_MODULE']='config.settings_sqlite_test'
    os.environ['CURRICULUM_WARM']='0'
    os.environ['AZURE_MAIL_ENABLED']='false'
    from django.conf import settings
    from django.db.backends.base.base import BaseDatabaseWrapper
    assert all(v['ENGINE']=='django.db.backends.sqlite3' for v in settings.DATABASES.values())
    config=dict(ENGINE='django.db.backends.postgresql', NAME='postgres', USER='postgres',
        PASSWORD='', HOST='127.0.0.1', PORT=str(port), CONN_MAX_AGE=0,
        OPTIONS={'options':'-c lms.notification_test=isolated'})
    settings.DATABASES={'default':dict(config),'enrolment':dict(config)}
    settings.CACHES={'default':{'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}}
    settings.CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP=False
    original=BaseDatabaseWrapper.ensure_connection
    def ensure(db):
        cfg=db.settings_dict
        assert (cfg['ENGINE'],cfg['HOST'],str(cfg['PORT']),cfg['NAME']) == ('django.db.backends.postgresql','127.0.0.1',str(port),'postgres')
        return original(db)
    original_connect=socket.socket.connect
    def connect(sock,address):
        if not isinstance(address,tuple) or address[:2] != ('127.0.0.1',port):
            raise AssertionError('External network forbidden.')
        return original_connect(sock,address)
    with patch.object(logging.config,'dictConfig'), patch.object(BaseDatabaseWrapper,'ensure_connection',ensure):
        import django
        django.setup()
        from django.db import connection,connections
        from curriculum_api import tutor_notifications
        from curriculum_api.tests_tutor_notifications import fixture_schema
        with connection.cursor() as cursor:
            cursor.execute(fixture_schema())
        # Fail closed even if a regression forgets the per-test email mock.
        with patch.object(socket.socket,'connect',connect), patch.object(tutor_notifications.email_azure,'send_mail',side_effect=AssertionError('Unmocked email forbidden')):
            try:
                suite=unittest.defaultTestLoader.loadTestsFromName('curriculum_api.tests_tutor_notifications')
                result=unittest.TextTestRunner(verbosity=2).run(suite)
                print(f'COUNTS run={result.testsRun} failures={len(result.failures)} errors={len(result.errors)} skipped={len(result.skipped)}')
                return int(not result.wasSuccessful())
            finally:
                connections.close_all()


def main():
    binaries=Path('C:/Program Files/PostgreSQL/18/bin')
    root=Path(tempfile.mkdtemp(prefix='lms_tutor_notifications_')).resolve()
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
    raise SystemExit(main())
