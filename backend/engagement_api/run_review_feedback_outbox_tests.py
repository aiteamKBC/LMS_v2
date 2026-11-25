"""Explicit runner: test the migration on a new, local-only PostgreSQL cluster.

Run directly with --pg-bin pointing to existing PostgreSQL binaries. Never reads
.env or imports Django settings. The cluster is stopped even when a test fails.
"""
import argparse
import ast
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import unittest
import uuid

import psycopg


MIGRATION = Path(__file__).parent / 'migrations/0015_review_feedback_outbox.py'


def migration_sql():
    tree = ast.parse(MIGRATION.read_text(encoding='utf-8'))
    return {node.targets[0].id: ast.literal_eval(node.value)
            for node in tree.body if isinstance(node, ast.Assign)
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in ('SQL', 'DISABLE_SQL')}


class ReviewFeedbackOutboxTests(unittest.TestCase):
    params = None
    data_directory = None

    def setUp(self):
        self.conn = psycopg.connect(**self.params)
        self.addCleanup(self.conn.close)
        identity = self.conn.execute("SELECT current_database(),host(inet_server_addr()),current_setting('data_directory')").fetchone()
        self.assertEqual(identity[0], 'review_outbox_isolated_test')
        self.assertEqual(identity[1], '127.0.0.1')
        self.assertEqual(Path(identity[2]).resolve(), self.data_directory.resolve())
        # Only this verified, newly created empty cluster is reset between cases.
        self.conn.execute('DROP SCHEMA IF EXISTS "Feedback" CASCADE; DROP SCHEMA IF EXISTS "Learner" CASCADE')
        self.conn.execute('CREATE SCHEMA "Learner"; CREATE SCHEMA "Feedback"')
        self.conn.execute('''CREATE TABLE "Learner".reviews (
            id bigint PRIMARY KEY, status text, completed_date timestamptz, note text DEFAULT '')''')
        self.conn.execute('''INSERT INTO "Learner".reviews(id,status)
            SELECT n,'In Progress' FROM generate_series(1,10) n''')
        self.conn.execute('GRANT USAGE ON SCHEMA "Learner" TO migration_actor, import_actor')
        self.conn.execute('GRANT USAGE,CREATE ON SCHEMA "Feedback" TO migration_actor')
        self.conn.execute('GRANT TRIGGER,SELECT ON "Learner".reviews TO migration_actor')
        self.conn.execute('GRANT SELECT,INSERT,UPDATE ON "Learner".reviews TO import_actor')
        self.install()

    def install(self, reverse=False):
        with self.conn.transaction():
            self.conn.execute('SET LOCAL ROLE migration_actor')
            self.conn.execute(migration_sql()['DISABLE_SQL' if reverse else 'SQL'])

    def write(self, query, params=None):
        with self.conn.transaction():
            self.conn.execute('SET LOCAL ROLE import_actor')
            return self.conn.execute(query, params)

    def rows(self):
        return self.conn.execute('''SELECT source_review_id,requested_version,processed_version
            FROM "Feedback".review_feedback_outbox ORDER BY source_review_id''').fetchall()

    def test_ten_rows_two_updates_and_repeat(self):
        self.assertEqual(self.rows(), [])
        self.write('''UPDATE "Learner".reviews SET status='Completed',
            completed_date='2026-11-24T10:00:00Z' WHERE id IN (1,2)''')
        self.assertEqual(self.rows(), [(1,1,0),(2,1,0)])
        self.write('UPDATE "Learner".reviews SET status=status,completed_date=completed_date')
        self.assertEqual(self.rows(), [(1,1,0),(2,1,0)])
        self.assertEqual(self.conn.execute('''SELECT count(*) FROM "Learner".reviews
            WHERE id>2 AND status='In Progress' AND completed_date IS NULL''').fetchone()[0], 8)

    def test_unrelated_fields_do_not_enqueue(self):
        self.write('''UPDATE "Learner".reviews SET note='synthetic note' ''')
        self.assertEqual(self.rows(), [])

    def test_insert_with_date_enqueues_without_backfill(self):
        self.write('''INSERT INTO "Learner".reviews(id,status,completed_date)
            VALUES(11,'Completed','2026-11-24T10:00:00Z')''')
        self.assertEqual(self.rows(), [(11,1,0)])
        self.install()
        self.assertEqual(self.rows(), [(11,1,0)])

    def test_insert_without_date_waits_for_late_date(self):
        self.write('''INSERT INTO "Learner".reviews(id,status) VALUES(11,'Completed')''')
        self.assertEqual(self.rows(), [])
        self.write('''UPDATE "Learner".reviews SET completed_date='2026-11-24T10:00:00Z' WHERE id=11''')
        self.assertEqual(self.rows(), [(11,1,0)])

    def test_signature_then_completed_with_same_date(self):
        self.write('''UPDATE "Learner".reviews SET status='AwaitingSignature',
            completed_date='2026-11-24T10:00:00Z' WHERE id=1''')
        self.assertEqual(self.rows(), [(1,1,0)])
        self.write('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
        self.assertEqual(self.rows(), [(1,2,0)])

    def test_null_transitions_are_detected(self):
        self.write('UPDATE "Learner".reviews SET status=NULL WHERE id=1')
        self.write('UPDATE "Learner".reviews SET status=NULL WHERE id=1')
        self.assertEqual(self.rows(), [(1,1,0)])
        self.write('''UPDATE "Learner".reviews SET completed_date='2026-11-24T10:00:00Z' WHERE id=1''')
        self.write('UPDATE "Learner".reviews SET completed_date=NULL WHERE id=1')
        self.assertEqual(self.rows(), [(1,3,0)])

    def test_uncommitted_event_is_not_visible(self):
        with psycopg.connect(**self.params) as observer:
            with self.conn.transaction():
                self.conn.execute('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
                self.assertEqual(observer.execute('SELECT count(*) FROM "Feedback".review_feedback_outbox').fetchone()[0], 0)
            self.assertEqual(observer.execute('SELECT count(*) FROM "Feedback".review_feedback_outbox').fetchone()[0], 1)

    def test_rollback_discards_review_change_and_request(self):
        with self.assertRaisesRegex(ValueError, 'rollback test'):
            with self.conn.transaction():
                self.conn.execute('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
                self.assertEqual(self.rows(), [(1,1,0)])
                raise ValueError('rollback test')
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.conn.execute('SELECT status FROM "Learner".reviews WHERE id=1').fetchone()[0], 'In Progress')

    def test_queue_failure_rolls_back_source(self):
        with self.assertRaises(psycopg.errors.CheckViolation):
            with self.conn.transaction():
                self.conn.execute('ALTER TABLE "Feedback".review_feedback_outbox ADD CHECK(source_review_id<>1)')
                self.conn.execute('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
        self.assertEqual(self.rows(), [])
        self.assertEqual(self.conn.execute('SELECT status FROM "Learner".reviews WHERE id=1').fetchone()[0], 'In Progress')

    def test_concurrent_writers_preserve_both_changes(self):
        def change(status):
            with psycopg.connect(**self.params) as writer:
                with writer.transaction():
                    writer.execute('SET LOCAL ROLE import_actor')
                    writer.execute('UPDATE "Learner".reviews SET status=%s WHERE id=1', (status,))
        with ThreadPoolExecutor(max_workers=2) as workers:
            futures = [workers.submit(change, status) for status in ('AwaitingSignature','Completed')]
            for future in futures:
                future.result(timeout=15)
        self.assertEqual(self.rows(), [(1,2,0)])

    def test_old_ack_does_not_hide_new_change(self):
        self.write('''UPDATE "Learner".reviews SET status='AwaitingSignature' WHERE id=1''')
        captured_version = self.rows()[0][1]
        self.write('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
        self.conn.execute('''UPDATE "Feedback".review_feedback_outbox SET processed_version=%s,
            processed_at=clock_timestamp() WHERE source_review_id=1''', (captured_version,))
        self.assertEqual(self.rows(), [(1,2,1)])

    def test_processed_review_becomes_pending_again(self):
        self.write('''UPDATE "Learner".reviews SET status='AwaitingSignature' WHERE id=1''')
        self.conn.execute('UPDATE "Feedback".review_feedback_outbox SET processed_version=1')
        self.write('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
        self.assertEqual(self.rows(), [(1,2,1)])

    def test_importer_needs_no_queue_access(self):
        self.assertFalse(self.conn.execute('''SELECT has_table_privilege('import_actor',
            '"Feedback".review_feedback_outbox','INSERT')''').fetchone()[0])
        self.write('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
        self.assertEqual(self.rows(), [(1,1,0)])

    def test_function_has_fixed_search_path_and_private_execute(self):
        row = self.conn.execute('''SELECT prosecdef,proconfig,has_function_privilege(
            'import_actor',oid,'EXECUTE') FROM pg_proc
            WHERE oid='"Feedback".capture_review_feedback_change()'::regprocedure''').fetchone()
        self.assertEqual(row, (True, ['search_path=pg_catalog, pg_temp'], False))

    def test_disable_and_reenable_preserves_queue(self):
        self.write('''UPDATE "Learner".reviews SET status='AwaitingSignature' WHERE id=1''')
        self.install(reverse=True)
        self.write('''UPDATE "Learner".reviews SET status='Completed' WHERE id=2''')
        self.assertEqual(self.rows(), [(1,1,0)])
        self.install()
        self.write('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
        self.assertEqual(self.rows(), [(1,2,0)])

    def test_version_constraint_rejects_invalid_ack(self):
        self.write('''UPDATE "Learner".reviews SET status='Completed' WHERE id=1''')
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.conn.execute('UPDATE "Feedback".review_feedback_outbox SET processed_version=2')
        self.assertEqual(self.rows(), [(1,1,0)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pg-bin', type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    run = repo / '.local-runtime/review-feedback-outbox-tests' / uuid.uuid4().hex[:12]
    run.mkdir(parents=True)
    data = run / 'data'
    password = secrets.token_urlsafe(32)
    pwfile = run / 'init-password.txt'
    pwfile.write_text(password, encoding='utf-8')
    env = {key: val for key,val in os.environ.items() if not key.upper().startswith('PG')}
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port = sock.getsockname()[1]
    windows = os.name == 'nt'
    def command(name, *parts):
        binary = args.pg_bin / (name + ('.exe' if windows else ''))
        with (run / (name+'.log')).open('a') as log:
            subprocess.run([str(binary), *map(str,parts)], env=env, stdout=log, stderr=log,
                           timeout=60, check=True, creationflags=subprocess.CREATE_NO_WINDOW if windows else 0)
    report = {'passed':False,'tests':0,'database_stopped':False}
    try:
        command('initdb','-D',data,'-U','demo_admin','--pwfile',pwfile,'--auth=scram-sha-256','--encoding=UTF8','--no-locale')
        pwfile.unlink()
        with (data/'postgresql.conf').open('a') as cfg:
            cfg.write(f"\nlisten_addresses='127.0.0.1'\nport={port}\n")
        command('pg_ctl','-D',data,'-l',run/'postgres.log','-w','start')
        params = dict(host='127.0.0.1',port=port,user='demo_admin',password=password,
                      connect_timeout=5,autocommit=True,options='-c statement_timeout=10000 -c lock_timeout=3000')
        with psycopg.connect(dbname='postgres',**params) as admin:
            actual = admin.execute("SELECT host(inet_server_addr()),current_setting('data_directory')").fetchone()
            if actual[0]!='127.0.0.1' or Path(actual[1]).resolve()!=data.resolve():
                raise RuntimeError('Unexpected cluster; no writes permitted')
            admin.execute('CREATE DATABASE review_outbox_isolated_test')
            admin.execute('CREATE ROLE migration_actor NOLOGIN; CREATE ROLE import_actor NOLOGIN')
        ReviewFeedbackOutboxTests.params = dict(params,dbname='review_outbox_isolated_test')
        ReviewFeedbackOutboxTests.data_directory = data
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(ReviewFeedbackOutboxTests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        report.update(passed=result.wasSuccessful(),tests=result.testsRun,
                      failures=len(result.failures),errors=len(result.errors),
                      migration_sha256=hashlib.sha256(MIGRATION.read_bytes()).hexdigest())
    finally:
        if pwfile.exists():
            pwfile.unlink()
        if (data/'postmaster.pid').exists():
            command('pg_ctl','-D',data,'-m','fast','-w','stop')
            report['database_stopped']=True
        (run/'results.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
        print('Results:', run/'results.json')
    raise SystemExit(0 if report['passed'] else 1)


if __name__ == '__main__':
    main()
