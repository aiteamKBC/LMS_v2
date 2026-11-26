"""Run learner session ownership regressions in fresh local PostgreSQL."""
import os
import socket
import subprocess
import tempfile
from pathlib import Path

import psycopg
import test_ksb_teams_postgres as harness

SUITE = 'curriculum_api.test_learner_session_results_postgres.LearnerSessionOwnershipPostgresTests'
EXPECTED_CASES = 11


def main():
    configured = os.environ.get('LMS_TEST_PG_BIN', '').strip()
    binaries = Path(configured) if configured else Path(
        tempfile.gettempdir()
    ) / (
        'lms-ksb-pg16/portable-tar/pgsql/bin'
    )
    for name in ('initdb.exe', 'pg_ctl.exe'):
        if not (binaries / name).is_file():
            raise RuntimeError(f'Local PostgreSQL binary is unavailable: {binaries / name}')

    root = Path(tempfile.mkdtemp(prefix='lms_learner_session_')).resolve()
    directory = root / 'data'
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]

    def control(*arguments):
        with (root / 'control.log').open('a') as log:
            return subprocess.run(
                [str(binaries / 'pg_ctl.exe'), '-D', str(directory), *arguments],
                check=False,
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                timeout=30,
            ).returncode

    started = False
    try:
        subprocess.run([
            str(binaries / 'initdb.exe'), '-D', str(directory), '-U', 'postgres',
            '--auth=trust', '--encoding=UTF8', '--no-locale',
        ], check=True, capture_output=True, timeout=45)
        started = True
        if control('-l', str(root / 'postgres.log'), '-o', f'-h 127.0.0.1 -p {port}',
                   '-w', '-t', '20', 'start'):
            raise RuntimeError('Isolated PostgreSQL startup failed.')

        with psycopg.connect(host='127.0.0.1', port=port, user='postgres', dbname='postgres') as db:
            host, actual_port, data, branch = db.execute(
                "SELECT host(inet_server_addr()),inet_server_port(),"
                "current_setting('data_directory'),current_setting('neon.branch_id',true)"
            ).fetchone()
            if (host != '127.0.0.1' or actual_port != port or branch
                    or Path(data).resolve() != directory):
                raise RuntimeError('PostgreSQL isolation proof failed.')
            if db.execute("SELECT count(*) FROM pg_namespace WHERE nspname='curriculum'").fetchone()[0]:
                raise RuntimeError('Disposable cluster was not empty.')

        harness.SUITES = list(SUITE) if isinstance(SUITE, (list, tuple)) else [SUITE]
        harness.EXPECTED_CASES = EXPECTED_CASES
        return harness.tests(port, directory)
    finally:
        if started and control('-m', 'fast', '-w', '-t', '20', 'stop'):
            raise RuntimeError(f'Could not stop disposable cluster: {root}')
        print('Stopped isolated test artifacts:', root)


if __name__ == '__main__':
    raise SystemExit(main())
