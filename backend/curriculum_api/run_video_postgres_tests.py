"""Test actual video triggers on a verified empty local PostgreSQL database.

Run from backend with --connection-file <private JSON> --data-directory <cluster>.
JSON contains host, port, dbname, user, password. No application DSN is used.
The database must be empty, on 127.0.0.1, and named kbc_bunny_test_*.
"""
import argparse
import importlib
import json
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--connection-file', type=Path, required=True)
    parser.add_argument('--data-directory', type=Path, required=True)
    args = parser.parse_args()
    cfg = json.loads(args.connection_file.read_text(encoding='utf-8-sig'))
    if cfg.get('host') != '127.0.0.1' or not str(cfg.get('dbname', '')).startswith('kbc_bunny_test_'):
        raise RuntimeError('Only an isolated local Bunny test database is permitted.')
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    os.environ['CURRICULUM_WARM'] = '0'
    os.environ['BUNNY_STREAM_ENABLED'] = 'false'
    sys.argv = ['manage.py', 'test']
    from django.conf import settings
    database = {'ENGINE': 'django.db.backends.postgresql', 'NAME': cfg['dbname'],
                'USER': cfg['user'], 'PASSWORD': cfg['password'], 'HOST': cfg['host'], 'PORT': cfg['port'],
                'OPTIONS': {'connect_timeout': 5, 'options': '-c statement_timeout=15000 -c lock_timeout=5000'}}
    settings.DATABASES = {name: dict(database) for name in ('default', 'enrolment')}
    from django.db import connection, connections
    for db in connections.all():
        with db.cursor() as cursor:
            cursor.execute("SELECT current_database(),host(inet_server_addr()),inet_server_port(),current_setting('data_directory')")
            name, host, port, directory = cursor.fetchone()
            if (name != cfg['dbname'] or host != '127.0.0.1' or int(port) != int(cfg['port'])
                    or Path(directory).resolve() != args.data_directory.resolve()):
                raise RuntimeError('Actual database and cluster do not match the isolated test target.')
            cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
            if cursor.fetchone()[0]:
                raise RuntimeError('Test database is not empty; refusing to overwrite existing tables.')
    original_connect = socket.socket.connect
    def local_connections_only(sock, address):
        # Windows implements asyncio's socketpair using a loopback connection.
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_connect(sock, address)
        raise AssertionError('External network disabled in regression tests')
    with patch('socket.socket.connect', new=local_connections_only):
        import django
        django.setup()
        from django.db.migrations.state import ProjectState
        with connection.cursor() as cursor:
            cursor.execute('''CREATE SCHEMA curriculum;
                CREATE TABLE curriculum.modules (
                    module_catalogue_id text PRIMARY KEY, title text, programme_id text, programme_name text,
                    cohort_id text, cohort_name text, group_id text, group_name text,
                    deleted_at timestamptz, is_programme_deleted boolean DEFAULT false);
                CREATE TABLE curriculum.week_templates (
                    id text PRIMARY KEY, title text, module_catalogue_id text, programme_id text,
                    programme_name text, cohort_id text, cohort_name text, group_id text, group_name text,
                    deleted_at timestamptz, is_programme_deleted boolean DEFAULT false);
                CREATE TABLE curriculum.groups (group_id text PRIMARY KEY, cohort_id text, cohort_name text);
                CREATE TABLE curriculum.components (
                    id text PRIMARY KEY, module_catalogue_id text, type text, title text,
                    settings_json jsonb, deleted_at timestamptz, is_programme_deleted boolean DEFAULT false);
                CREATE TABLE curriculum.week_template_components (
                    id text PRIMARY KEY, week_template_id text, type text, title text, settings_json jsonb);
                INSERT INTO curriculum.components (id,module_catalogue_id,type,title,settings_json)
                    VALUES ('PRE-EXISTING','MOD1','video','Historical','{"videoUrl":"https://example.com/old.mp4"}');
            ''')
        state = ProjectState()
        with connection.schema_editor() as editor:
            for name in ('0077_curriculum_video_import', '0078_curriculum_video_changes'):
                migration = importlib.import_module('curriculum_api.migrations.' + name).Migration(name, 'curriculum_api')
                state = migration.apply(state, editor)
        from curriculum_api.models import CurriculumVideoChange
        assert not CurriculumVideoChange.objects.exists(), 'Migration unexpectedly backfilled historical video sources.'
        print('Verified empty local PostgreSQL; applied migrations 0077/0078 to synthetic authoring tables.', flush=True)
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'curriculum_api.test_bunny_stream', 'curriculum_api.test_video_imports',
            'curriculum_api.test_youtube_download', 'curriculum_api.test_video_changes',
            'curriculum_api.test_video_change_postgres',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    connections.close_all()
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
