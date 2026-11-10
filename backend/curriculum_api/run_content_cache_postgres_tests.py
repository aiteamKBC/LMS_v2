"""Check the shared caches against a verified empty local PostgreSQL.

    python curriculum_api/run_content_cache_postgres_tests.py \\
        --connection-file <private JSON> --data-directory <cluster data directory>

The JSON holds host, port, dbname, user, password. The database must be on
127.0.0.1, named kbc_content_cache_test_*, and empty; every other network
connection is refused. No application DSN, Valkey or Neon branch is used:
the cache is an in-process LocMemCache.
"""
import argparse
import json
import os
import socket
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--connection-file', type=Path, required=True)
    parser.add_argument('--data-directory', required=True)
    parser.add_argument('--cases', default='curriculum_api.postgres_content_cache_cases',
                        help='Case module to run (default: the Phase 1 content cache cases).')
    args = parser.parse_args()
    cfg = json.loads(args.connection_file.read_text(encoding='utf-8-sig'))
    if cfg.get('host') != '127.0.0.1' or not str(cfg.get('dbname', '')).startswith('kbc_content_cache_test_'):
        raise RuntimeError('Only an isolated local content-cache test database is permitted.')
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    os.environ['CURRICULUM_WARM'] = '0'
    os.environ['CURRICULUM_CONTENT_CACHE'] = 'true'
    os.environ.pop('USE_SECURITY_TEST_BRANCH', None)
    sys.argv = ['manage.py', 'test']
    from django.conf import settings
    database = {'ENGINE': 'django.db.backends.postgresql', 'NAME': cfg['dbname'],
                'USER': cfg['user'], 'PASSWORD': cfg['password'], 'HOST': cfg['host'], 'PORT': cfg['port'],
                'OPTIONS': {'connect_timeout': 5, 'options': '-c statement_timeout=15000 -c lock_timeout=5000'}}
    settings.DATABASES = {name: dict(database) for name in ('default', 'enrolment')}
    settings.CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                                   'LOCATION': 'content-cache-postgres'}}
    # One process and one LocMem cache: let the shared-version caches run.
    settings.SHARED_VERSION_CACHE_ALLOW_LOCAL = True
    original_connect = socket.socket.connect

    def local_connections_only(sock, address):
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_connect(sock, address)
        if isinstance(address, str):  # unix sockets (asyncio self-pipe)
            return original_connect(sock, address)
        raise AssertionError('External network disabled in regression tests')

    with patch('socket.socket.connect', new=local_connections_only):
        import django
        django.setup()
        from django.db import connections
        for db in connections.all():
            with db.cursor() as cursor:
                cursor.execute("SELECT current_database(),host(inet_server_addr()),inet_server_port(),"
                               "current_setting('data_directory')")
                name, host, port, directory = cursor.fetchone()
                # A local Docker container reports its bridge address (172.x).
                local_server = host == '127.0.0.1' or str(host).startswith('172.')
                if name != cfg['dbname'] or not local_server or str(directory) != args.data_directory:
                    raise RuntimeError('Actual database and cluster do not match the isolated test target.')
                cursor.execute("SELECT count(*) FROM information_schema.tables "
                               "WHERE table_schema NOT IN ('pg_catalog','information_schema')")
                if cursor.fetchone()[0]:
                    raise RuntimeError('Test database is not empty; refusing to overwrite existing tables.')
        print('Verified empty local PostgreSQL; running content cache cases.', flush=True)
        suite = unittest.defaultTestLoader.loadTestsFromName(args.cases)
        from django.test.utils import setup_test_environment, teardown_test_environment
        setup_test_environment()
        try:
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        finally:
            teardown_test_environment()
            connections.close_all()
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
