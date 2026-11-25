"""Run the real consumer against a fresh loopback-only PostgreSQL test cluster.

No application .env is read. Parent and child reject external PostgreSQL targets.
The child blocks application networking; Windows event-loop self-pipes are the
only allowed local socket connects. Generated credentials never leave this run.
"""
import argparse
import builtins
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import threading
import unittest
import uuid

import psycopg


ROOT = Path(__file__).resolve().parents[2]
DATABASE = 'review_feedback_consumer_test'
MARKER = '.feedback-consumer-test-sandbox'


def isolated_environment():
    return {key: value for key, value in os.environ.items()
            if not key.upper().startswith('PG') and 'DATABASE' not in key.upper()
            and key.upper() not in {'MY_DB_URL', 'RUN_APP_ON_TEST_BRANCH', 'DJANGO_SETTINGS_MODULE'}}


def child(directory):
    counters = {'envReads': 0, 'externalConnections': 0, 'postgresConnections': 0}
    original_open, original_io, original_exists = builtins.open, io.open, Path.exists

    def environment_file(path):
        if not isinstance(path, (str, bytes, os.PathLike)):
            return False
        name = Path(os.fsdecode(path)).name.casefold()
        return name == '.env' or name.startswith('.env.')

    def opened(original, path, *args, **kwargs):
        if environment_file(path):
            counters['envReads'] += 1
            raise RuntimeError('Reading application environment files is forbidden.')
        return original(path, *args, **kwargs)

    builtins.open = lambda path, *a, **kw: opened(original_open, path, *a, **kw)
    io.open = lambda path, *a, **kw: opened(original_io, path, *a, **kw)
    Path.exists = lambda path: False if environment_file(path) else original_exists(path)
    original_connect = psycopg.connect

    def local_connect(conninfo='', **kwargs):
        if (conninfo or kwargs.get('host') != '127.0.0.1' or kwargs.get('dbname') != DATABASE
                or kwargs.get('hostaddr') or not kwargs.get('port')):
            counters['externalConnections'] += 1
            raise RuntimeError('Only the isolated consumer database is permitted.')
        counters['postgresConnections'] += 1
        return original_connect(**kwargs)

    psycopg.connect = local_connect
    state = threading.local()
    original_pair, original_socket_connect = socket.socketpair, socket.socket.connect

    def denied(*args, **kwargs):
        counters['externalConnections'] += 1
        raise RuntimeError('Application network access is forbidden.')

    def connect(sock, address):
        if getattr(state, 'internal', False) and isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_socket_connect(sock, address)
        return denied()

    def pair(*args, **kwargs):
        state.internal = True
        try:
            return original_pair(*args, **kwargs)
        finally:
            state.internal = False

    socket.socketpair = pair
    socket.socket.connect = connect
    socket.socket.connect_ex = denied
    socket.create_connection = denied
    from twisted.internet import _signals
    original_waker = _signals._SocketWaker.__init__

    def waker(instance):
        state.internal = True
        try:
            return original_waker(instance)
        finally:
            state.internal = False

    _signals._SocketWaker.__init__ = waker
    sys.path.insert(0, str(ROOT / 'backend'))
    sys.argv = ['manage.py', 'test']
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    from django.conf import settings
    params = json.loads(os.environ.pop('FEEDBACK_CONSUMER_TEST_CONNECTION'))
    assert params['host'] == '127.0.0.1' and params['dbname'] == DATABASE
    config = {'ENGINE': 'django.db.backends.postgresql', 'NAME': DATABASE,
              'HOST': params['host'], 'PORT': params['port'], 'USER': params['user'],
              'PASSWORD': params['password'], 'CONN_MAX_AGE': 0,
              'OPTIONS': {'connect_timeout': 3, 'options': '-c statement_timeout=1000 -c lock_timeout=500'}}
    settings.DATABASES = {'default': dict(config), 'enrolment': {**config, 'OPTIONS': {
        **config['OPTIONS'], 'options': config['OPTIONS']['options'] + ' -c default_transaction_read_only=on'}}}
    settings.FEEDBACK_CONSUMER_TEST_DIRECTORY = str(directory)
    import django
    from django.db.backends.base.base import BaseDatabaseWrapper
    from unittest.mock import patch
    with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=RuntimeError('No startup database access')):
        django.setup()
    from django.db import connections
    try:
        suite = unittest.defaultTestLoader.loadTestsFromName('engagement_api.tests_review_feedback_consumer')
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        report = {'passed': result.wasSuccessful(), 'tests': result.testsRun,
                  'failures': len(result.failures), 'errors': len(result.errors), 'safety': counters}
        from engagement_api.tests_review_feedback_consumer import MEASUREMENTS
        report['measurements'] = MEASUREMENTS
        (directory.parent / 'consumer-results.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
        print(json.dumps(report), flush=True)
        return 0 if result.wasSuccessful() and not counters['envReads'] and not counters['externalConnections'] else 1
    finally:
        connections.close_all()


def main():
    # libpq also reads PG* defaults in this parent process. Do not let a
    # PGHOSTADDR/PGSERVICE inherited from the workstation redirect a connection.
    for key in list(os.environ):
        if key.upper().startswith('PG'):
            os.environ.pop(key, None)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path)
    parser.add_argument('--isolated-child', type=Path)
    args = parser.parse_args()
    if args.isolated_child:
        directory = args.isolated_child.resolve()
        if (not directory.is_relative_to(ROOT / '.local-runtime/review-feedback-consumer-tests')
                or not (directory.parent / MARKER).is_file()):
            raise RuntimeError('Not a consumer test sandbox.')
        return child(directory)
    if args.pg_bin is None:
        parser.error('--pg-bin is required')
    run = ROOT / '.local-runtime/review-feedback-consumer-tests' / uuid.uuid4().hex[:12]
    run.mkdir(parents=True)
    data = run / 'data'
    (run / MARKER).write_text('isolated consumer tests only', encoding='utf-8')
    password = secrets.token_urlsafe(32)
    pwfile = run / 'init-password.txt'
    pwfile.write_text(password, encoding='utf-8')
    env = isolated_environment()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]

    def command(name, *parts):
        binary = args.pg_bin / (name + ('.exe' if os.name == 'nt' else ''))
        with (run / f'{name}.log').open('a') as log:
            subprocess.run([str(binary), *map(str, parts)], env=env, stdout=log, stderr=log,
                           check=True, timeout=60,
                           creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)

    stopped = False
    try:
        command('initdb', '-D', data, '-U', 'consumer_test_admin', '--pwfile', pwfile,
                '--auth=scram-sha-256', '--encoding=UTF8', '--no-locale')
        pwfile.unlink()
        with (data / 'postgresql.conf').open('a') as config_file:
            config_file.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\n")
        command('pg_ctl', '-D', data, '-l', run / 'postgres.log', '-w', 'start')
        params = {'host': '127.0.0.1', 'port': port, 'user': 'consumer_test_admin',
                  'password': password, 'connect_timeout': 3}
        with psycopg.connect(dbname='postgres', autocommit=True, **params) as admin:
            host, actual = admin.execute("SELECT host(inet_server_addr()),current_setting('data_directory')").fetchone()
            if host != '127.0.0.1' or Path(actual).resolve() != data.resolve():
                raise RuntimeError('Unexpected database; no writes allowed.')
            admin.execute('CREATE DATABASE review_feedback_consumer_test')
        env['FEEDBACK_CONSUMER_TEST_CONNECTION'] = json.dumps({**params, 'dbname': DATABASE})
        result = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--isolated-child', str(data)],
                                env=env, timeout=180, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
        (run / 'test-output.log').write_text(result.stdout, encoding='utf-8')
        print(result.stdout, flush=True)
        return result.returncode
    finally:
        if pwfile.exists():
            pwfile.unlink()
        if (data / 'postmaster.pid').exists():
            command('pg_ctl', '-D', data, '-m', 'fast', '-w', 'stop')
            stopped = True
        (run / 'shutdown.json').write_text(json.dumps({'databaseStopped': stopped}), encoding='utf-8')
        print('Results:', run, flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
