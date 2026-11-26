"""Synthetic storage-contract tests; NOT an application restoration rehearsal.

Run: python backend/scripts/test_manual_restore_points_postgres.py
Starts a disposable local cluster. Never loads Django, .env, or remote settings.
DDL models the supplied final contract; it is not a deployment migration.
"""
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import unittest

import psycopg
from psycopg.types.json import Jsonb


TABLE = '"Learner".manual_month_restore_points'
DDL = '''
CREATE SCHEMA "Learner";
CREATE TABLE "Learner".learners(id bigint PRIMARY KEY, aptem_id bigint);
INSERT INTO "Learner".learners VALUES(1,101),(2,202);
CREATE TABLE "Learner".manual_month_restore_points(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 learner_id bigint NOT NULL,
 report_month text NOT NULL CHECK(report_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 point_kind text NOT NULL CHECK(point_kind IN ('manual','automatic','pre_restore')),
 snapshot_hash text NOT NULL, snapshot jsonb NOT NULL,
 row_count integer NOT NULL CHECK(row_count>=0),
 document_count integer NOT NULL CHECK(document_count>=0),
 actor text, reason text, related_point_id bigint, legacy_related_point_id bigint,
 created_at timestamptz NOT NULL, archived_at timestamptz,
 CONSTRAINT manual_restore_points_learner_fk FOREIGN KEY(learner_id)
   REFERENCES "Learner".learners(id) ON DELETE RESTRICT,
 CONSTRAINT manual_restore_points_scope_unique UNIQUE(id,learner_id,report_month),
 CONSTRAINT manual_restore_points_related_fk FOREIGN KEY(related_point_id,learner_id,report_month)
   REFERENCES "Learner".manual_month_restore_points(id,learner_id,report_month)
   ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX manual_restore_points_learner_scope_idx ON "Learner".manual_month_restore_points
 (learner_id,report_month,id DESC);
CREATE INDEX manual_restore_points_related_idx ON "Learner".manual_month_restore_points
 (related_point_id,learner_id,report_month) WHERE related_point_id IS NOT NULL;
'''


class StorageContractTests(unittest.TestCase):
    def setUp(self):
        self.db = psycopg.connect(**CONFIG, autocommit=True)
        self.addCleanup(self.db.close)
        # Roll back every test, including its DDL and synthetic fixture changes.
        self.db.execute('BEGIN')
        self.addCleanup(self.db.execute, 'ROLLBACK')

    def insert(self, **changes):
        values = dict(learner_id=1, report_month='2026-01', point_kind='manual',
                      snapshot_hash='opaque-original-hash',
                      snapshot=Jsonb({'aptem_id': 101, 'rows': [{'id': 7}],
                                      'documents': [{'id': 8, 'blob_name': 'synthetic'}]}),
                      row_count=1, document_count=1, actor='synthetic actor',
                      reason='historical reason', related_point_id=None,
                      legacy_related_point_id=None, created_at='2020-01-02T03:04:05Z',
                      archived_at=None)
        values.update(changes)
        return self.db.execute(f'INSERT INTO {TABLE} ({",".join(values)}) VALUES '
                               f'({",".join(["%s"] * len(values))}) RETURNING id',
                               list(values.values())).fetchone()[0]

    def row(self, ident):
        return self.db.execute(f'SELECT to_jsonb(p) FROM {TABLE} p WHERE id=%s', [ident]).fetchone()[0]

    def rejects(self, error, operation):
        with self.assertRaises(error), self.db.transaction():
            operation()

    def test_columns_identity_and_multiple_points(self):
        columns = self.db.execute("SELECT column_name FROM information_schema.columns WHERE "
                                  "table_schema='Learner' AND table_name='manual_month_restore_points'").fetchall()
        self.assertEqual(len(columns), 14)
        self.assertNotIn(('aptem_id',), columns)
        ids = [self.insert(point_kind=kind) for kind in ('manual', 'automatic', 'pre_restore')]
        self.assertEqual(len(set(ids)), 3)
        self.assertEqual(ids, sorted(ids))
        self.rejects(psycopg.errors.GeneratedAlways, lambda: self.insert(id=999))
        self.assertEqual(self.row(ids[0])['learner_id'], 1)

    def test_owner_required_and_restricted(self):
        self.rejects(psycopg.errors.ForeignKeyViolation, lambda: self.insert(learner_id=999))
        self.rejects(psycopg.errors.NotNullViolation, lambda: self.insert(learner_id=None))
        self.insert()
        self.rejects(psycopg.errors.RestrictViolation,
                     lambda: self.db.execute('DELETE FROM "Learner".learners WHERE id=1'))

    def test_checks(self):
        for values in [dict(point_kind='restore'), dict(report_month='2026-13'),
                       dict(report_month='2026-1'), dict(row_count=-1), dict(document_count=-1)]:
            with self.subTest(values=values):
                self.rejects(psycopg.errors.CheckViolation, lambda: self.insert(**values))

    def test_relationship_scope_and_missing_parent(self):
        parent = self.insert()
        child = self.insert(point_kind='pre_restore', related_point_id=parent)
        self.assertEqual(self.row(child)['related_point_id'], parent)
        for values in [dict(related_point_id=999999),
                       dict(related_point_id=parent, learner_id=2),
                       dict(related_point_id=parent, report_month='2026-02')]:
            with self.subTest(values=values):
                self.rejects(psycopg.errors.ForeignKeyViolation, lambda: self.insert(**values))
        constraints = self.db.execute(f"SELECT convalidated FROM pg_constraint WHERE "
                                     f"conrelid='{TABLE}'::regclass AND contype='f'").fetchall()
        self.assertEqual(constraints, [(True,), (True,)])

    def test_parent_delete_and_scope_update_restricted(self):
        parent = self.insert()
        self.insert(related_point_id=parent)
        for sql in [f'DELETE FROM {TABLE} WHERE id=%s',
                    f'UPDATE {TABLE} SET learner_id=2 WHERE id=%s',
                    f"UPDATE {TABLE} SET report_month='2026-02' WHERE id=%s"]:
            with self.subTest(sql=sql):
                self.rejects(psycopg.errors.RestrictViolation,
                             lambda: self.db.execute(sql, [parent]))

    def test_nine_unresolved_references_remain_metadata(self):
        legacy_ids = [80795,80796,80797,80798,80799,80806,80807,80808,80809]
        ids = [self.insert(point_kind='pre_restore', legacy_related_point_id=old,
                           snapshot=Jsonb({'recovery_point_id': old, 'aptem_id': 101}),
                           row_count=0, document_count=0) for old in legacy_ids]
        for ident, old in zip(ids, legacy_ids):
            record = self.row(ident)
            self.assertIsNone(record['related_point_id'])
            self.assertEqual(record['legacy_related_point_id'], old)
            self.assertEqual(record['snapshot']['recovery_point_id'], old)
        self.assertEqual(self.db.execute(f'SELECT count(*) FROM {TABLE}').fetchone()[0], 9)

    def test_archive_snapshot_hash_and_metadata_preservation(self):
        ident = self.insert(archived_at='2021-02-03T04:05:06Z')
        before = self.row(ident)
        self.db.execute('UPDATE "Learner".learners SET aptem_id=303 WHERE id=1')
        self.insert(related_point_id=ident)
        self.assertEqual(self.row(ident), before)
        self.assertEqual(before['snapshot']['aptem_id'], 101)
        self.assertEqual(before['snapshot_hash'], 'opaque-original-hash')
        self.assertEqual(len(before['snapshot']['rows']), before['row_count'])
        self.assertEqual(len(before['snapshot']['documents']), before['document_count'])

    def test_historical_id_collision_is_not_a_mapping(self):
        canonical = self.insert()
        # Historical data is an in-memory fixture, never a historical-schema table.
        historical = dict(id=canonical, learner_id=2, report_month='2026-02',
                          snapshot={'aptem_id': 202, 'rows': [], 'documents': []})
        before = self.row(canonical)
        self.assertIsNone(self.db.execute(f'SELECT id FROM {TABLE} WHERE id=%s AND learner_id=%s '
                                         'AND report_month=%s',
                                         [historical['id'], 2, '2026-02']).fetchone())
        imported = self.insert(learner_id=2, report_month='2026-02',
                               snapshot=Jsonb(historical['snapshot']), row_count=0, document_count=0)
        self.assertNotEqual(imported, canonical)
        self.assertEqual(self.row(canonical), before)

    def test_transaction_rollback(self):
        before = self.db.execute(f'SELECT count(*) FROM {TABLE}').fetchone()
        with self.assertRaises(RuntimeError), self.db.transaction():
            self.insert()
            raise RuntimeError('synthetic failure')
        self.assertEqual(self.db.execute(f'SELECT count(*) FROM {TABLE}').fetchone(), before)

    def test_no_restore_events_or_historical_schema_created(self):
        self.assertIsNone(self.db.execute("SELECT to_regclass('" +
                                         '"Learner".manual_month_restore_events' + "')").fetchone()[0])
        for schema in ('structured_manual_activities', 'refactor_backup'):
            self.assertIsNone(self.db.execute('SELECT to_regnamespace(%s)', [schema]).fetchone()[0])


def main():
    global CONFIG
    initdb, pgctl = shutil.which('initdb'), shutil.which('pg_ctl')
    if not initdb or not pgctl:
        raise RuntimeError('Local PostgreSQL required; no remote fallback.')
    with tempfile.TemporaryDirectory(prefix='lms-manual-restore-contract-') as temporary:
        directory = Path(temporary)
        data = directory / 'data'
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        subprocess.run([initdb, '-D', str(data), '-U', 'postgres', '-A', 'trust',
                        '--no-locale', '-E', 'UTF8'], check=True, capture_output=True, **flags)
        # On Windows the server can inherit captured pipes and keep communicate()
        # waiting after pg_ctl exits. Redirect startup output to a private file.
        with (directory / 'startup.log').open('wb') as output:
            subprocess.run([pgctl, '-D', str(data), '-l', str(directory / 'server.log'),
                            '-o', f'-h 127.0.0.1 -p {port}', '-w', 'start'],
                           check=True, stdout=output, stderr=output, timeout=60, **flags)
        CONFIG = dict(host='127.0.0.1', port=port, user='postgres', dbname='postgres')
        try:
            with psycopg.connect(**CONFIG, autocommit=True) as db:
                actual, branch = db.execute("SELECT current_setting('data_directory'), "
                                            "current_setting('neon.branch_id',true)").fetchone()
                if Path(actual).resolve() != data.resolve() or branch:
                    raise RuntimeError('Database is not the newly created disposable cluster.')
                print('Verified disposable PostgreSQL; synthetic final-contract fixture only.', flush=True)
                db.execute(DDL)
            result = unittest.TextTestRunner(verbosity=2).run(
                unittest.defaultTestLoader.loadTestsFromTestCase(StorageContractTests))
            return result.wasSuccessful()
        finally:
            subprocess.run([pgctl, '-D', str(data), '-m', 'fast', '-w', 'stop'],
                           check=True, capture_output=True, timeout=60, **flags)


if __name__ == '__main__':
    raise SystemExit(not main())
