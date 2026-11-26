"""Real FK behaviour using only a verified disposable local PostgreSQL cluster."""
import importlib
import json
import os
from pathlib import Path
from types import SimpleNamespace
import unittest

import psycopg
from django.db.migrations.exceptions import IrreversibleError


migration = importlib.import_module('learner_api.migrations.0033_source_lms_actual_hours_links')
ROOT = Path(__file__).resolve().parents[2]


@unittest.skipUnless(os.environ.get('RUN_LEGACY_ACTUAL_LINK_TESTS') == '1',
                     'requires a verified disposable local PostgreSQL cluster')
class LegacyActualLinksPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        config_path = Path(os.environ['LEGACY_ACTUAL_LINK_TEST_CONNECTION_FILE']).resolve()
        if not config_path.is_relative_to(ROOT / '.qa-tmp'):
            raise RuntimeError('Test connection must belong to this workspace.')
        config = json.loads(config_path.read_text(encoding='utf-8'))
        directory = Path(config['data_directory']).resolve()
        if (config['host'] != '127.0.0.1'
                or not config['dbname'].startswith('legacy_actual_test_')
                or not directory.is_relative_to(ROOT / '.qa-tmp')):
            raise RuntimeError('A disposable local legacy-actual test cluster is required.')
        cls.db = psycopg.connect(**{key: config[key] for key in
                                  ('host', 'port', 'dbname', 'user', 'password')}, connect_timeout=5)
        actual = cls.db.execute('''SELECT host(inet_server_addr()),inet_server_port(),
            current_database(),current_setting('data_directory'),
            current_setting('neon.branch_id',true)''').fetchone()
        if (actual[:3] != (config['host'], config['port'], config['dbname'])
                or Path(actual[3]).resolve() != directory or actual[4] is not None):
            cls.db.close()
            raise RuntimeError('Actual database does not match the isolated local test cluster.')
        tables = cls.db.execute('''SELECT count(*) FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog','information_schema')''').fetchone()[0]
        cls.db.rollback()
        if tables:
            cls.db.close()
            raise RuntimeError('The disposable database must start empty.')
        cls.editor = SimpleNamespace(connection=SimpleNamespace(vendor='postgresql', cursor=cls.db.cursor))

    @classmethod
    def tearDownClass(cls):
        cls.db.rollback()
        cls.db.close()

    def setUp(self):
        self.db.execute('CREATE SCHEMA "Learner"')
        self.db.execute('''CREATE TABLE "Learner".learners (
            id bigint PRIMARY KEY,aptem_id bigint UNIQUE,UNIQUE(id,aptem_id))''')
        self.db.execute('''INSERT INTO "Learner".learners VALUES (1,70001),(2,70002),(3,NULL)''')
        self.db.execute('''CREATE TABLE "Learner".source_lms_actual_hours (
            learner_id bigint NOT NULL,kind text NOT NULL,ref text NOT NULL,aptem_id bigint,
            month text,source text,actual_hours numeric,PRIMARY KEY(learner_id,kind,ref))''')
        self.db.execute('''INSERT INTO "Learner".source_lms_actual_hours VALUES
            (901,'reading','ref-a',70001,'2026-01','legacy',2),
            (902,'video','ref-b',70002,'2026-02','legacy',1),
            (903,'reading','ref-c',79999,'2026-01','legacy',3),
            (904,'reading','ref-d',NULL,'2026-01','legacy',4)''')
        self.db.execute('''CREATE TABLE "Learner".learner_activity_sources (
            id bigint PRIMARY KEY,learner_id bigint NOT NULL REFERENCES "Learner".learners(id),
            source_system text,actual_seconds bigint,source_payload jsonb NOT NULL DEFAULT '{}')''')
        self.db.execute('''INSERT INTO "Learner".learner_activity_sources
            (id,learner_id,source_system,actual_seconds) VALUES
            (11,1,'old_lms',7200),(22,2,'old_lms',3600),(33,3,'aptem',1800)''')

    def tearDown(self):
        self.db.rollback()

    def install(self):
        migration.install(None, self.editor)

    def link(self, source_id=11, old_id=901, kind='reading', ref='ref-a', aptem=70001):
        self.db.execute('''UPDATE "Learner".learner_activity_sources
            SET legacy_actual_learner_id=%s,legacy_actual_kind=%s,
                legacy_actual_ref=%s,legacy_actual_aptem_id=%s WHERE id=%s''',
                        [old_id, kind, ref, aptem, source_id])

    def expect_error(self, error_type, operation, constraint=None):
        with self.assertRaises(error_type) as raised:
            with self.db.transaction():
                operation()
        if constraint:
            self.assertEqual(raised.exception.diag.constraint_name, constraint)

    def test_install_preserves_hours_payloads_and_unmatched_history(self):
        old = self.db.execute('SELECT * FROM "Learner".source_lms_actual_hours ORDER BY learner_id').fetchall()
        sources = self.db.execute('SELECT * FROM "Learner".learner_activity_sources ORDER BY id').fetchall()
        self.install()
        self.assertEqual(old, self.db.execute('SELECT * FROM "Learner".source_lms_actual_hours ORDER BY learner_id').fetchall())
        after = self.db.execute('SELECT * FROM "Learner".learner_activity_sources ORDER BY id').fetchall()
        self.assertEqual([row[:-4] for row in after], sources)
        self.assertEqual([row[-4:] for row in after], [(None,) * 4] * 3)
        self.assertEqual(self.db.execute('''SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal
            AND tgrelid IN ('"Learner".source_lms_actual_hours'::regclass,
                           '"Learner".learner_activity_sources'::regclass)''').fetchone()[0], 0)

    def test_exact_legacy_record_links_to_different_current_profile_id(self):
        self.install()
        self.link()
        self.assertEqual(self.db.execute('''SELECT learner_id,legacy_actual_learner_id,
            legacy_actual_aptem_id FROM "Learner".learner_activity_sources WHERE id=11''').fetchone(),
                         (1, 901, 70001))

    def test_another_learner_and_unrelated_activity_remain_unlinked(self):
        self.install()
        self.link()
        self.assertEqual(self.db.execute('''SELECT legacy_actual_learner_id FROM
            "Learner".learner_activity_sources WHERE id IN (22,33) ORDER BY id''').fetchall(), [(None,), (None,)])

    def test_wrong_legacy_key_or_aptem_is_rejected(self):
        self.install()
        for patch in ({'old_id': 999}, {'kind': 'quiz'}, {'ref': 'absent'}, {'aptem': 70002}):
            with self.subTest(patch=patch):
                self.expect_error(psycopg.errors.ForeignKeyViolation, lambda: self.link(**patch))

    def test_cross_learner_link_is_rejected(self):
        self.install()
        self.expect_error(psycopg.errors.ForeignKeyViolation,
                          lambda: self.link(old_id=902, kind='video', ref='ref-b', aptem=70002))
        self.expect_error(psycopg.errors.ForeignKeyViolation, lambda: self.link(source_id=22))

    def test_partial_null_legacy_keys_are_rejected(self):
        self.install()
        for field in ('old_id', 'kind', 'ref', 'aptem'):
            with self.subTest(field=field):
                self.expect_error(psycopg.errors.ForeignKeyViolation, lambda: self.link(**{field: None}))

    def test_cannot_change_current_owner_of_linked_source(self):
        self.install()
        self.link()
        self.expect_error(psycopg.errors.ForeignKeyViolation, lambda: self.db.execute('''
            UPDATE "Learner".learner_activity_sources SET learner_id=2 WHERE id=11'''))

    def test_linked_old_identity_and_current_aptem_cannot_change(self):
        self.install()
        self.link()
        for statement, constraint in (
            ('UPDATE "Learner".source_lms_actual_hours SET aptem_id=70002 WHERE learner_id=901', migration.ROW_FK),
            ('UPDATE "Learner".source_lms_actual_hours SET ref=\'changed\' WHERE learner_id=901', migration.ROW_FK),
            ('UPDATE "Learner".learners SET aptem_id=70003 WHERE id=1', migration.OWNER_FK),
        ):
            with self.subTest(statement=statement):
                # PostgreSQL versions distinguish RESTRICT (23001) from an
                # ordinary FK violation (23503). Both must identify this FK.
                self.expect_error((psycopg.errors.ForeignKeyViolation, psycopg.errors.RestrictViolation),
                                  lambda: self.db.execute(statement), constraint)

    def test_referenced_history_cannot_be_deleted(self):
        self.install()
        self.link()
        self.expect_error((psycopg.errors.ForeignKeyViolation, psycopg.errors.RestrictViolation),
                          lambda: self.db.execute('''DELETE FROM "Learner".source_lms_actual_hours
                            WHERE learner_id=901'''), migration.ROW_FK)

    def test_removing_current_source_does_not_delete_history(self):
        self.install()
        self.link()
        self.db.execute('DELETE FROM "Learner".learner_activity_sources WHERE id=11')
        self.assertEqual(self.db.execute('SELECT actual_hours FROM "Learner".source_lms_actual_hours WHERE learner_id=901').fetchone()[0], 2)

    def test_reinstall_is_idempotent_with_valid_links(self):
        self.install()
        self.link()
        self.install()
        self.assertTrue(all(row[0] for row in self.db.execute('''SELECT convalidated FROM pg_constraint
            WHERE conrelid='"Learner".learner_activity_sources'::regclass AND conname IN (%s,%s)''',
                             [migration.ROW_FK, migration.OWNER_FK]).fetchall()))

    def test_existing_wrong_column_is_not_overwritten(self):
        self.db.execute('ALTER TABLE "Learner".learner_activity_sources ADD COLUMN legacy_actual_ref integer')
        self.expect_error(RuntimeError, self.install)

    def test_existing_partial_link_blocks_validation_without_repairing_data(self):
        for name, kind in migration.COLUMNS.items():
            self.db.execute(f'ALTER TABLE "Learner".learner_activity_sources ADD COLUMN {name} {kind}')
        self.db.execute('UPDATE "Learner".learner_activity_sources SET legacy_actual_ref=\'ref-a\' WHERE id=11')
        self.expect_error(psycopg.errors.ForeignKeyViolation, self.install)
        self.assertEqual(self.db.execute('''SELECT legacy_actual_ref FROM "Learner".learner_activity_sources
            WHERE id=11''').fetchone()[0], 'ref-a')

    def test_unexpected_existing_constraint_is_not_replaced(self):
        self.install()
        self.db.execute(f'ALTER TABLE {migration.SOURCES} DROP CONSTRAINT {migration.ROW_FK}')
        self.db.execute(f'ALTER TABLE {migration.SOURCES} ADD CONSTRAINT {migration.ROW_FK} CHECK (true)')
        self.expect_error(RuntimeError, self.install)

    def test_missing_current_owner_unique_key_blocks_install(self):
        self.db.execute('ALTER TABLE "Learner".learners DROP CONSTRAINT learners_id_aptem_id_key')
        self.expect_error(RuntimeError, self.install)

    def test_rollback_without_links_restores_original_schema(self):
        before = self.db.execute('SELECT * FROM "Learner".learner_activity_sources ORDER BY id').fetchall()
        self.install()
        migration.uninstall(None, self.editor)
        self.assertEqual(before, self.db.execute('SELECT * FROM "Learner".learner_activity_sources ORDER BY id').fetchall())

    def test_rollback_cannot_discard_existing_links(self):
        self.install()
        self.link()
        self.expect_error(IrreversibleError, lambda: migration.uninstall(None, self.editor))


if __name__ == '__main__':
    unittest.main()
