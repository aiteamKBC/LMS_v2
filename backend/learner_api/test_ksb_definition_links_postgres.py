"""PostgreSQL integration coverage for profile-scoped KSB definition links.

Run only against an explicitly configured disposable local database::

    KSB_DEFINITION_TEST_DATABASE_URL=postgresql://.../ksb_definition_test \
        python -m unittest learner_api.test_ksb_definition_links_postgres -v

The guard deliberately rejects remote hosts and any other database name so a
normal test command cannot mutate Development or Production.
"""
import os
import unittest
from urllib.parse import urlparse

import psycopg

from .ksb_definition_links import assigned_definition_ids


DATABASE_URL = os.environ.get("KSB_DEFINITION_TEST_DATABASE_URL", "")


@unittest.skipUnless(DATABASE_URL, "Requires a disposable local PostgreSQL database")
class KsbDefinitionLinksPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        parsed = urlparse(DATABASE_URL)
        if parsed.hostname not in {"localhost", "127.0.0.1", "::1"}:
            raise RuntimeError("KSB definition integration tests require local PostgreSQL")
        if parsed.path.lstrip("/") != "ksb_definition_test":
            raise RuntimeError("KSB definition integration tests require ksb_definition_test")
        cls.connection = psycopg.connect(DATABASE_URL, autocommit=True)
        with cls.connection.cursor() as cursor:
            cursor.execute('CREATE SCHEMA IF NOT EXISTS curriculum')
            cursor.execute('CREATE SCHEMA IF NOT EXISTS "Learner"')
            cursor.execute('''CREATE TABLE IF NOT EXISTS curriculum.ksb_definitions (
                id bigint PRIMARY KEY,
                profile_version_id bigint NOT NULL,
                code varchar(100) NOT NULL,
                UNIQUE (profile_version_id, code)
            )''')
            cursor.execute('''CREATE TABLE IF NOT EXISTS "Learner".learner_ksb_assignments (
                learner_id bigint PRIMARY KEY,
                profile_version_id bigint NOT NULL
            )''')

    @classmethod
    def tearDownClass(cls):
        cls.connection.close()
        super().tearDownClass()

    def setUp(self):
        with self.connection.cursor() as cursor:
            cursor.execute('TRUNCATE "Learner".learner_ksb_assignments, curriculum.ksb_definitions')

    def test_same_code_resolves_inside_each_learner_profile_version(self):
        with self.connection.cursor() as cursor:
            cursor.executemany(
                'INSERT INTO curriculum.ksb_definitions (id,profile_version_id,code) VALUES (%s,%s,%s)',
                [(101, 1001, 'K1'), (202, 2002, 'K1')],
            )
            cursor.executemany(
                'INSERT INTO "Learner".learner_ksb_assignments (learner_id,profile_version_id) VALUES (%s,%s)',
                [(11, 1001), (12, 2002)],
            )

            resolved = assigned_definition_ids(cursor, [11, 12], [{'ksb_code': 'k1'}])

        self.assertEqual(resolved, {(11, 'K1'): 101, (12, 'K1'): 202})

    def test_missing_and_case_ambiguous_definition_are_not_guessed(self):
        with self.connection.cursor() as cursor:
            cursor.executemany(
                'INSERT INTO curriculum.ksb_definitions (id,profile_version_id,code) VALUES (%s,%s,%s)',
                [(301, 3003, 'K1'), (302, 3003, 'k1')],
            )
            cursor.execute(
                'INSERT INTO "Learner".learner_ksb_assignments (learner_id,profile_version_id) VALUES (%s,%s)',
                [13, 3003],
            )

            resolved = assigned_definition_ids(cursor, [13, 14], [{'ksb_code': 'K1'}])

        self.assertEqual(resolved, {})
