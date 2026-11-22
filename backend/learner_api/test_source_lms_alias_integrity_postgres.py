"""Opt-in PostgreSQL regression checks for the authoritative alias table.

Run only against an explicitly disposable Neon child branch after the alias
cleanup. The test rolls back every data change; do not run for read-only tasks.
"""
import os
import unittest

import psycopg
from psycopg.rows import dict_row


DEV_BRANCH = 'br-raspy-sky-abvs8lq9'
PRODUCTION_BRANCHES = {'br-holy-band-abhispwg', 'br-lucky-resonance-abhjt0li'}


@unittest.skipUnless(
    os.environ.get('RUN_SOURCE_LMS_ALIAS_POSTGRES_TESTS') == '1',
    'requires an explicitly disposable PostgreSQL branch',
)
class SourceLmsAliasIntegrityPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        url = os.environ['SOURCE_LMS_ALIAS_TEST_DATABASE_URL']
        expected = os.environ['SOURCE_LMS_ALIAS_TEST_BRANCH_ID']
        if expected == DEV_BRANCH or expected in PRODUCTION_BRANCHES:
            raise RuntimeError('Alias integrity writes require a disposable child branch.')
        cls.connection = psycopg.connect(url, row_factory=dict_row, autocommit=False)
        cls.cursor = cls.connection.cursor()
        actual = cls.cursor.execute(
            "SELECT current_setting('neon.branch_id', true) AS branch"
        ).fetchone()['branch']
        if actual != expected:
            raise RuntimeError('Connected branch does not match the disposable branch id.')
        cls.before = cls._snapshot()

    @classmethod
    def tearDownClass(cls):
        cls.connection.rollback()
        after = cls._snapshot()
        cls.cursor.close()
        cls.connection.close()
        if after != cls.before:
            raise AssertionError('Alias records changed despite transaction rollback.')
        super().tearDownClass()

    @classmethod
    def _snapshot(cls):
        return cls.cursor.execute('''SELECT count(*) AS rows,
            md5(string_agg(concat_ws('|',aptem_id,canonical_lms_id,lms_learner_id,
                coalesce(aptem_email,''),coalesce(lms_email,''),is_primary,match_basis,
                first_seen,last_seen,coalesce(learner_profile_id::text,'')), E'\\n'
                ORDER BY aptem_id,lms_learner_id)) AS checksum
            FROM "Last_audit".learner_lms_aliases''').fetchone()

    def _expect_integrity_error(self, sql, params, constraint=None, sqlstate=None):
        self.cursor.execute('SAVEPOINT alias_integrity_case')
        try:
            with self.assertRaises(psycopg.IntegrityError) as raised:
                self.cursor.execute(sql, params)
                self.cursor.execute('SET CONSTRAINTS ALL IMMEDIATE')
            if constraint:
                self.assertEqual(raised.exception.diag.constraint_name, constraint)
            if sqlstate:
                self.assertEqual(raised.exception.sqlstate, sqlstate)
        finally:
            self.cursor.execute('ROLLBACK TO SAVEPOINT alias_integrity_case')
            self.cursor.execute('RELEASE SAVEPOINT alias_integrity_case')

    def test_constraints_and_all_edge_cases(self):
        constraints = {
            row['conname']: row
            for row in self.cursor.execute('''SELECT conname,convalidated,confdeltype,confupdtype,
                pg_get_constraintdef(oid) AS definition FROM pg_constraint
                WHERE conrelid IN ('"Learner".learners'::regclass,
                    '"Last_audit".learner_lms_aliases'::regclass)''')
        }
        self.assertTrue(any('UNIQUE (id, aptem_id)' in row['definition'] for row in constraints.values()))
        children = [row for row in constraints.values()
                    if row['definition'].startswith('FOREIGN KEY (learner_profile_id, aptem_id)')
                    and 'REFERENCES "Learner".learners(id, aptem_id)' in row['definition']]
        self.assertEqual(len(children), 1)
        child = children[0]
        self.assertTrue(child['convalidated'])
        self.assertEqual((child['confdeltype'], child['confupdtype']), ('r', 'r'))

        rows = self.cursor.execute('''SELECT a.aptem_id,a.canonical_lms_id,a.learner_profile_id,
            a.aptem_email,a.lms_email
            FROM "Last_audit".learner_lms_aliases a
            WHERE a.learner_profile_id IS NOT NULL
            ORDER BY a.aptem_id LIMIT 2''').fetchall()
        self.assertEqual(len(rows), 2)
        owner, other = rows
        if owner['aptem_id'] == other['aptem_id']:
            other = self.cursor.execute('''SELECT learner_profile_id,aptem_id
                FROM "Last_audit".learner_lms_aliases
                WHERE learner_profile_id IS NOT NULL AND aptem_id<>%s LIMIT 1''',
                [owner['aptem_id']]).fetchone()

        insert = '''INSERT INTO "Last_audit".learner_lms_aliases
            (aptem_id,aptem_email,canonical_lms_id,lms_learner_id,lms_email,
             is_primary,match_basis,first_seen,last_seen,learner_profile_id)
            VALUES (%s,%s,%s,%s,%s,%s,'isolated-regression',now(),now(),%s)'''
        self.cursor.execute(insert, [owner['aptem_id'], owner['aptem_email'],
            owner['canonical_lms_id'], -900000000000001, owner['lms_email'], False,
            owner['learner_profile_id']])
        self.cursor.execute(insert, [owner['aptem_id'], owner['aptem_email'],
            owner['canonical_lms_id'], -900000000000002, owner['lms_email'], False, None])

        self._expect_integrity_error(insert, [owner['aptem_id'], owner['aptem_email'],
            owner['canonical_lms_id'], -900000000000003, owner['lms_email'], False,
            other['learner_profile_id']], child['conname'], '23503')
        self._expect_integrity_error(insert, [None, owner['aptem_email'],
            owner['canonical_lms_id'], -900000000000004, owner['lms_email'], False,
            owner['learner_profile_id']], sqlstate='23502')
        self._expect_integrity_error('''UPDATE "Learner".learners SET aptem_id=%s WHERE id=%s''',
            [-900000000000005, owner['learner_profile_id']],
            child['conname'], '23503')
        self._expect_integrity_error('''DELETE FROM "Learner".learners WHERE id=%s''',
            [owner['learner_profile_id']], sqlstate='23503')
        self._expect_integrity_error(insert, [owner['aptem_id'], owner['aptem_email'],
            -900000000000006, -900000000000006, owner['lms_email'], True,
            owner['learner_profile_id']], sqlstate='23505')


if __name__ == '__main__':
    unittest.main()
