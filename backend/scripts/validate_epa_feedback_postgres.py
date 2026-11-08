"""Check EPA DDL on a newly initialized, disposable local PostgreSQL cluster.

No Django startup, .env loading, application DBs, mail or storage access. Uses
installed PostgreSQL 18 binaries and a fresh temporary directory/loopback port.
"""
import argparse
import ast
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[2]
ROLE = 'epa_feedback_test'
OLD_TYPES = ('general', 'post_lecture', 'post_event', 'event_rsvp', 'post_mcm_review',
             'post_progress_review', 'post_progress_review_employer', 'mid_module', 'end_module')


def migration_sql():
    path = ROOT / 'backend/engagement_api/migrations/0012_epa_review_feedback.py'
    module = ast.parse(path.read_text(encoding='utf-8'))
    return next(ast.literal_eval(node.value) for node in module.body
                if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'SQL'
                                                       for target in node.targets))


def verify_target(conn, directory, port):
    database, location, role, host, actual_port = conn.execute(
        "SELECT current_database(), current_setting('data_directory'), current_user, "
        "host(inet_server_addr()), current_setting('port')"
    ).fetchone()
    if (database != 'postgres' or Path(location).resolve() != directory.resolve()
            or role != ROLE or host != '127.0.0.1' or actual_port != str(port)):
        raise RuntimeError('Refusing writes outside this run\'s newly created local cluster.')


def check(conn):
    conn.execute('CREATE SCHEMA "Feedback"')
    allowed = sql.SQL(',').join(sql.Literal(kind) for kind in OLD_TYPES)
    conn.execute(sql.SQL('''CREATE TABLE "Feedback".feedback_forms (
        id bigint PRIMARY KEY, form_type varchar(40) NOT NULL,
        CONSTRAINT feedback_form_type_check CHECK (form_type IN ({})));
        CREATE TABLE "Feedback".feedback_review_deliveries (
        id bigint PRIMARY KEY, form_id bigint REFERENCES "Feedback".feedback_forms(id),
        source_review_id bigint UNIQUE);
        CREATE TABLE "Feedback".feedback_responses (
        id bigint PRIMARY KEY, review_delivery_id bigint REFERENCES "Feedback".feedback_review_deliveries(id),
        answer text);
    ''').format(allowed))
    for identifier, kind in enumerate(OLD_TYPES, 1):
        conn.execute('INSERT INTO "Feedback".feedback_forms VALUES (%s,%s)', (identifier, kind))
    conn.execute('INSERT INTO "Feedback".feedback_review_deliveries VALUES (1,1,9001)')
    conn.execute("INSERT INTO \"Feedback\".feedback_responses VALUES (1,1,'Synthetic preserved answer')")

    def snapshot():
        return {table: conn.execute(sql.SQL('SELECT * FROM {} ORDER BY id').format(
            sql.Identifier('Feedback', table))).fetchall() for table in (
            'feedback_forms', 'feedback_review_deliveries', 'feedback_responses')}

    before = snapshot()
    body = migration_sql()
    with conn.transaction():
        conn.execute(body)
    assert snapshot() == before, 'Migration changed existing form/delivery/response history.'
    conn.execute('INSERT INTO "Feedback".feedback_forms VALUES (%s,%s)', (100, 'post_epa_review'))
    with_epa = snapshot()
    with conn.transaction():
        conn.execute(body)
    assert snapshot() == with_epa, 'Repeated migration changed history.'
    try:
        with conn.transaction():
            conn.execute('INSERT INTO "Feedback".feedback_forms VALUES (%s,%s)', (200, 'unsupported_type'))
    except psycopg.errors.CheckViolation:
        pass
    else:
        raise AssertionError('Form-type validation was weakened.')
    script = (ROOT / 'backend/sql/2026-11-07_epa_review_feedback.sql').read_text(encoding='utf-8')
    conn.execute(script)
    assert snapshot() == with_epa, 'Manual SQL changed existing history.'
    assert conn.execute("SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE "
                        "conname='feedback_form_type_check' AND "
                        "conrelid='\"Feedback\".feedback_forms'::regclass").fetchone()[0].find('post_epa_review') >= 0
    return ['migration applies', 'old types/history preserved', 'EPA accepted',
            'unsupported types rejected', 'repeat/manual SQL preserve history']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path, default=Path('C:/Program Files/PostgreSQL/18/bin'))
    args = parser.parse_args()
    initdb, pg_ctl = args.pg_bin / 'initdb.exe', args.pg_bin / 'pg_ctl.exe'
    if not initdb.is_file() or not pg_ctl.is_file():
        raise RuntimeError('Installed PostgreSQL initdb/pg_ctl binaries are required; nothing was started.')
    temporary_parent = Path(tempfile.gettempdir()).resolve()
    run = Path(tempfile.mkdtemp(prefix='lms-epa-pg-', dir=temporary_parent)).resolve()
    directory = run / 'cluster'
    assert run.parent == temporary_parent and run.name.startswith('lms-epa-pg-')
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    attempted_start = False

    def control(arguments):
        # PostgreSQL is a daemon. On Windows it can retain inherited pipe
        # handles after pg_ctl exits, so direct its output to a task-owned file
        # instead of waiting for capture_output pipes to reach EOF.
        with (run / 'pg_ctl.log').open('a', encoding='utf-8') as log:
            return subprocess.run([str(pg_ctl), '-D', str(directory), *arguments],
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, timeout=30)

    try:
        initialized = subprocess.run([str(initdb), '-D', str(directory), '-U', ROLE, '--auth=trust',
            '--encoding=UTF8', '--no-locale'], capture_output=True, text=True, timeout=45)
        if initialized.returncode:
            raise RuntimeError('Temporary initdb failed: ' + initialized.stderr[-1000:])
        attempted_start = True
        started = control(['-l', str(run / 'postgres.log'), '-o', f'-h 127.0.0.1 -p {port}', '-w', '-t', '20', 'start'])
        if started.returncode:
            raise RuntimeError('Temporary PostgreSQL startup failed; see ' + str(run / 'postgres.log'))
        with psycopg.connect(host='127.0.0.1', port=port, user=ROLE, dbname='postgres',
                             connect_timeout=5, autocommit=True) as conn:
            verify_target(conn, directory, port)
            checks = check(conn)
            print(json.dumps({'target': 'new disposable local PostgreSQL cluster', 'checks': checks,
                              'result': 'PASS', 'application_database_accessed': False}))
    finally:
        stopped = not attempted_start
        if attempted_start:
            stopped = control(['-m', 'fast', '-w', '-t', '20', 'stop']).returncode == 0
        if stopped:
            assert run.parent == temporary_parent and run.name.startswith('lms-epa-pg-')
            shutil.rmtree(run)
        else:
            print('Temporary cluster retained for inspection at ' + str(run))


if __name__ == '__main__':
    main()
