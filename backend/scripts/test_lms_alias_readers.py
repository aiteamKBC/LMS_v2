"""Run alias reader regressions with database/external network access blocked.

Use --baseline to load the affected modules from Git HEAD in memory. No files,
database fixtures, migrations, or application servers are created by this runner.
"""
import argparse
import importlib
import logging
import os
from pathlib import Path
import socket
import subprocess
import sys
import unittest
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', action='store_true')
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(backend))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
    from django.db.backends.base.base import BaseDatabaseWrapper

    original_connect = socket.socket.connect

    def isolated_connect(sock, address):
        # Windows asyncio creates its internal socket pair over loopback.
        if isinstance(address, tuple) and address[0] in ('127.0.0.1', '::1'):
            return original_connect(sock, address)
        raise AssertionError('External network access forbidden in alias reader tests')

    with patch.object(BaseDatabaseWrapper, 'ensure_connection',
                      side_effect=AssertionError('Database access forbidden in alias reader tests')), \
            patch.object(socket.socket, 'connect', isolated_connect):
        import django
        django.setup()
        from django.conf import settings
        assert all(db['ENGINE'] == 'django.db.backends.sqlite3' for db in settings.DATABASES.values())
        logging.disable(logging.CRITICAL)
        if args.baseline:
            for name in ('subject_source', 'student_activity_data', 'recovered_activity_content',
                         'tests_subject_source'):
                module = importlib.import_module('learner_api.' + name)
                source = subprocess.check_output(
                    ['git', 'show', f'HEAD:backend/learner_api/{name}.py'], cwd=backend,
                ).decode('utf-8-sig')
                exec(compile(source, f'HEAD:backend/learner_api/{name}.py', 'exec'), module.__dict__)
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'learner_api.tests_subject_source',
            'learner_api.test_recovered_activity_content_no_db',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    raise SystemExit(main())
