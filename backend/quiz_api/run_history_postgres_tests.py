"""Run quiz history regressions on a verified empty, disposable local PostgreSQL.

Usage: python backend/quiz_api/run_history_postgres_tests.py --connection-file PATH
JSON keys: host, port, dbname, user, password, data_directory. Database name must
start with quiz_safety_test_. No production settings, migrations or app startup
hooks run. Only synthetic tables/rows and the proposed FK are created here.
"""
import argparse
import json
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--connection-file', type=Path, required=True)
    args = parser.parse_args()
    cfg = json.loads(args.connection_file.read_text(encoding='utf-8-sig'))
    if cfg['host'] != '127.0.0.1' or not cfg['dbname'].startswith('quiz_safety_test_'):
        raise RuntimeError('Only a disposable local quiz test database is permitted.')
    import psycopg
    with psycopg.connect(**{k: cfg[k] for k in ('host', 'port', 'dbname', 'user', 'password')},
                          options='-c default_transaction_read_only=on') as conn, conn.cursor() as cursor:
        cursor.execute("SELECT current_database(),host(inet_server_addr()),inet_server_port(),current_setting('data_directory')")
        name, host, port, directory = cursor.fetchone()
        if (name, host, port) != (cfg['dbname'], cfg['host'], cfg['port']) or Path(directory).resolve() != Path(cfg['data_directory']).resolve():
            raise RuntimeError('Actual PostgreSQL identity does not match the isolated cluster.')
        cursor.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
        if cursor.fetchone()[0]:
            raise RuntimeError('Refusing to overwrite a nonempty database. Use a fresh disposable database.')

    from django.apps import AppConfig
    from django.conf import settings
    # Explicit base AppConfigs avoid application ready() hooks and repair jobs.
    apps = []
    for name in ('learner_api', 'login', 'enrolment_api', 'quiz_api', 'curriculum_api',
                 'coach_api', 'engagement_api', 'system_audit', 'progress_reviews_api',
                 'read_models', 'chat', 'knowledge_base', 'old_otjh'):
        cls = type(name + 'TestsConfig', (AppConfig,), {'name': name, '__module__': __name__})
        globals()[cls.__name__] = cls
        apps.append(__name__ + '.' + cls.__name__)
    database = {'ENGINE': 'django.db.backends.postgresql', 'NAME': cfg['dbname'],
                'HOST': cfg['host'], 'PORT': cfg['port'], 'USER': cfg['user'], 'PASSWORD': cfg['password'],
                'OPTIONS': {'options': '-c statement_timeout=15000 -c lock_timeout=10000'}}
    settings.configure(
        SECRET_KEY='synthetic-quiz-tests-only', USE_TZ=True, TIME_ZONE='Europe/London',
        DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
        INSTALLED_APPS=['django.contrib.auth', 'django.contrib.contenttypes', *apps],
        DATABASES={alias: dict(database) for alias in ('default', 'enrolment')},
        DATABASE_ROUTERS=['learner_api.routers.EnrolmentRouter'],
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
        QUIZ_HISTORY_POSTGRES_TESTS=True,
    )
    import django
    django.setup()
    from django.db import connections
    from quiz_api.tests_history_postgres import prepare_database, QuizHistoryPostgresTests
    from quiz_api.tests_question_fk_migration_postgres import QuestionForeignKeyMigrationTests
    from quiz_api.tests_question_bank_postgres import QuestionBankPostgresTests
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('External services forbidden')):
        try:
            prepare_database()
            print('Verified isolated PostgreSQL; synthetic fixtures; external services blocked.', flush=True)
            suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(cls)
                for cls in (QuestionForeignKeyMigrationTests, QuizHistoryPostgresTests, QuestionBankPostgresTests))
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        finally:
            connections.close_all()
    return not result.wasSuccessful()


if __name__ == '__main__':
    raise SystemExit(main())
