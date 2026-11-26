"""Schema behaviour on a verified fresh local PostgreSQL cluster only.

No application startup, settings imports, production connections or services.
Every test rolls back its synthetic tables and records.
"""
import importlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest

import psycopg
from django.db.migrations.exceptions import IrreversibleError


migration = importlib.import_module('learner_api.migrations.0029_monthly_actual_summary_storage')
ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get('RUN_MONTHLY_ACTUAL_STORAGE_TESTS') == '1',
                     'requires a verified fresh local PostgreSQL cluster')
class MonthlyActualStoragePostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config_path = Path(os.environ['MONTHLY_ACTUAL_TEST_CONNECTION_FILE']).resolve()
        if not config_path.is_relative_to(ROOT / '.qa-tmp'):
            raise RuntimeError('Test connection file must be private to this workspace.')
        config = json.loads(config_path.read_text(encoding='utf-8'))
        directory = Path(config['data_directory']).resolve()
        if (config['host'] != '127.0.0.1'
                or not config['dbname'].startswith('monthly_actual_test_')
                or not directory.is_relative_to(ROOT / '.qa-tmp')):
            raise RuntimeError('Only a disposable local monthly-actual test cluster is allowed.')
        cls.db = psycopg.connect(**{key: config[key] for key in
                                  ('host', 'port', 'dbname', 'user', 'password')}, connect_timeout=5)
        actual = cls.db.execute('''SELECT host(inet_server_addr()),inet_server_port(),
            current_database(),current_setting('data_directory'),
            current_setting('neon.branch_id',true)''').fetchone()
        if (actual[:3] != (config['host'], config['port'], config['dbname'])
                or Path(actual[3]).resolve() != directory or actual[4] is not None):
            cls.db.close()
            raise RuntimeError('Actual database identity does not match the isolated cluster.')
        count = cls.db.execute('''SELECT count(*) FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog','information_schema')''').fetchone()[0]
        cls.db.rollback()
        if count:
            cls.db.close()
            raise RuntimeError('The isolated test database must start empty.')
        cls.editor = SimpleNamespace(connection=SimpleNamespace(
            vendor='postgresql', cursor=cls.db.cursor))

    @classmethod
    def tearDownClass(cls):
        cls.db.rollback()
        cls.db.close()

    def setUp(self):
        self.db.execute('CREATE SCHEMA "Learner"')
        self.db.execute('CREATE TABLE "Learner".learners(id bigint PRIMARY KEY)')
        self.db.execute('INSERT INTO "Learner".learners VALUES (1),(2),(3)')
        self.db.execute('''CREATE TABLE "Learner".learner_monthly_targets (
            id bigint PRIMARY KEY, learner_id bigint NOT NULL REFERENCES "Learner".learners(id),
            report_month varchar(7) NOT NULL,target_hours numeric(12,4),
            programme_id text,programme_profile_id text NOT NULL DEFAULT '',
            source_system text NOT NULL,source_ref text NOT NULL DEFAULT '',
            basis text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),
            UNIQUE NULLS NOT DISTINCT(learner_id,programme_id,programme_profile_id,report_month))''')
        self.db.execute('''CREATE TABLE "Learner".learner_progress_entries (
            id bigint PRIMARY KEY,learner_id bigint NOT NULL REFERENCES "Learner".learners(id),
            actual_seconds bigint CHECK (actual_seconds>=0),
            accepted boolean NOT NULL DEFAULT true,reporting_month varchar(7) NOT NULL,
            deleted_at timestamptz)''')
        self.db.execute('''INSERT INTO "Learner".learner_monthly_targets
            (id,learner_id,report_month,target_hours,programme_id,programme_profile_id,source_system)
            VALUES (10,1,'2026-11',30,'P','','synthetic'),
                   (11,1,'2026-11',40,'P','historical','synthetic'),
                   (20,2,'2026-11',36,'P','','synthetic')''')
        self.db.execute('''INSERT INTO "Learner".learner_progress_entries
            (id,learner_id,actual_seconds,reporting_month)
            VALUES (101,1,3600,'2026-11'),(102,1,7200,'2026-11'),(201,2,1800,'2026-11')''')

    def tearDown(self):
        self.db.rollback()

    def install(self):
        migration.install(None, self.editor)

    def expect_error(self, error_type, statement, params=None):
        with self.assertRaises(error_type):
            with self.db.transaction():
                self.db.execute(statement, params)

    def test_preserves_original_records_and_leaves_storage_uninitialised(self):
        before_targets = self.db.execute('SELECT * FROM "Learner".learner_monthly_targets ORDER BY id').fetchall()
        before_progress = self.db.execute('SELECT * FROM "Learner".learner_progress_entries ORDER BY id').fetchall()
        self.install()
        targets = self.db.execute('SELECT * FROM "Learner".learner_monthly_targets ORDER BY id').fetchall()
        progress = self.db.execute('SELECT * FROM "Learner".learner_progress_entries ORDER BY id').fetchall()
        self.assertEqual([row[:-2] for row in targets], before_targets)
        self.assertEqual([row[-2:] for row in targets], [(None, None)] * 3)
        self.assertEqual([row[:-1] for row in progress], before_progress)
        self.assertEqual([row[-1] for row in progress], [None] * 3)
        self.assertEqual(self.db.execute('''SELECT count(*) FROM pg_trigger
            WHERE tgrelid IN ('"Learner".learner_monthly_targets'::regclass,
                '"Learner".learner_progress_entries'::regclass) AND NOT tgisinternal''').fetchone()[0], 0)

    def test_many_activities_can_reference_one_month(self):
        self.install()
        self.db.execute('UPDATE "Learner".learner_progress_entries SET monthly_target_id=10 WHERE learner_id=1')
        self.assertEqual(self.db.execute('''SELECT count(*) FROM "Learner".learner_progress_entries
            WHERE monthly_target_id=10''').fetchone()[0], 2)

    def test_rejects_missing_target_and_cross_learner_links(self):
        self.install()
        for target_id in (999, 20):
            self.expect_error(psycopg.errors.ForeignKeyViolation,
                'UPDATE "Learner".learner_progress_entries SET monthly_target_id=%s WHERE id=101', [target_id])

    def test_prevents_owner_changes_on_linked_records(self):
        self.install()
        self.db.execute('UPDATE "Learner".learner_progress_entries SET monthly_target_id=10 WHERE id=101')
        self.expect_error(psycopg.errors.ForeignKeyViolation,
            'UPDATE "Learner".learner_progress_entries SET learner_id=2 WHERE id=101')
        self.expect_error(psycopg.errors.ForeignKeyViolation,
            'UPDATE "Learner".learner_monthly_targets SET learner_id=3 WHERE id=10')

    def test_target_deletion_preserves_linked_activity(self):
        self.install()
        self.db.execute('UPDATE "Learner".learner_progress_entries SET monthly_target_id=10 WHERE id=101')
        self.expect_error(psycopg.errors.RestrictViolation,
            'DELETE FROM "Learner".learner_monthly_targets WHERE id=10')
        self.assertEqual(self.db.execute('SELECT actual_seconds FROM "Learner".learner_progress_entries WHERE id=101').fetchone()[0], 3600)

    def test_zero_and_large_totals_and_month_without_planned_hours(self):
        self.install()
        original_time = self.db.execute('SELECT updated_at FROM "Learner".learner_monthly_targets WHERE id=10').fetchone()[0]
        for value in (0, 2**31 + 1):
            self.db.execute('''UPDATE "Learner".learner_monthly_targets
                SET actual_seconds_total=%s,actual_updated_at=now(),target_hours=NULL WHERE id=10''', [value])
            self.assertEqual(self.db.execute('''SELECT actual_seconds_total,target_hours,updated_at
                FROM "Learner".learner_monthly_targets WHERE id=10''').fetchone(), (value, None, original_time))

    def test_rejects_negative_or_partially_initialised_summary(self):
        self.install()
        for expression in ('actual_seconds_total=-1,actual_updated_at=now()',
                           'actual_seconds_total=0', 'actual_updated_at=now()'):
            self.expect_error(psycopg.errors.CheckViolation,
                f'UPDATE "Learner".learner_monthly_targets SET {expression} WHERE id=10')

    def test_reinstallation_preserves_populated_values_and_links(self):
        self.install()
        self.db.execute('UPDATE "Learner".learner_progress_entries SET monthly_target_id=10 WHERE id=101')
        self.db.execute('''UPDATE "Learner".learner_monthly_targets
            SET actual_seconds_total=3600,actual_updated_at=now() WHERE id=10''')
        before = self.db.execute('SELECT * FROM "Learner".learner_monthly_targets ORDER BY id').fetchall()
        self.install()
        self.assertEqual(self.db.execute('SELECT * FROM "Learner".learner_monthly_targets ORDER BY id').fetchall(), before)
        self.assertEqual(self.db.execute('SELECT monthly_target_id FROM "Learner".learner_progress_entries WHERE id=101').fetchone()[0], 10)

    def test_wrong_existing_column_is_rejected_without_partial_install(self):
        self.db.execute('ALTER TABLE "Learner".learner_monthly_targets ADD COLUMN actual_seconds_total integer')
        with self.assertRaises(RuntimeError), self.db.transaction():
            self.install()
        with self.db.cursor() as cursor:
            self.assertIsNone(migration._column(cursor, migration.PROGRESS, 'monthly_target_id'))

    def test_wrong_existing_constraint_is_not_silently_accepted(self):
        self.install()
        self.db.execute('''ALTER TABLE "Learner".learner_progress_entries
            DROP CONSTRAINT learner_progress_monthly_target_owner_fk''')
        self.db.execute('''ALTER TABLE "Learner".learner_progress_entries
            ADD CONSTRAINT learner_progress_monthly_target_owner_fk
            FOREIGN KEY (monthly_target_id) REFERENCES "Learner".learner_monthly_targets(id) ON DELETE CASCADE''')
        with self.assertRaises(RuntimeError), self.db.transaction():
            self.install()

    def test_unused_storage_can_be_rolled_back_and_reinstalled(self):
        before_targets = self.db.execute('SELECT * FROM "Learner".learner_monthly_targets ORDER BY id').fetchall()
        before_progress = self.db.execute('SELECT * FROM "Learner".learner_progress_entries ORDER BY id').fetchall()
        self.install()
        migration.uninstall(None, self.editor)
        self.assertEqual(self.db.execute('SELECT * FROM "Learner".learner_monthly_targets ORDER BY id').fetchall(), before_targets)
        self.assertEqual(self.db.execute('SELECT * FROM "Learner".learner_progress_entries ORDER BY id').fetchall(), before_progress)
        self.install()

    def test_rollback_refuses_to_discard_used_storage(self):
        self.install()
        self.db.execute('UPDATE "Learner".learner_progress_entries SET monthly_target_id=10 WHERE id=101')
        with self.assertRaises(IrreversibleError), self.db.transaction():
            migration.uninstall(None, self.editor)
        self.assertEqual(self.db.execute('SELECT monthly_target_id FROM "Learner".learner_progress_entries WHERE id=101').fetchone()[0], 10)

    def test_rollback_refuses_to_discard_an_initialised_zero(self):
        self.install()
        self.db.execute('''UPDATE "Learner".learner_monthly_targets
            SET actual_seconds_total=0,actual_updated_at=now() WHERE id=10''')
        with self.assertRaises(IrreversibleError), self.db.transaction():
            migration.uninstall(None, self.editor)
        self.assertEqual(self.db.execute('SELECT actual_seconds_total FROM "Learner".learner_monthly_targets WHERE id=10').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
