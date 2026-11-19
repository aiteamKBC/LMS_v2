"""PostgreSQL-only regression for canonical reflection ownership.

Set ``REFLECTION_OWNERSHIP_TEST_DATABASE_URL`` to a verified non-production
PostgreSQL database.  The test opens a read-only transaction and uses VALUES
fixtures only: it performs no DDL or data writes.
"""
import os
import unittest

import psycopg


TEST_DATABASE_URL = os.environ.get("REFLECTION_OWNERSHIP_TEST_DATABASE_URL", "").strip()


@unittest.skipUnless(TEST_DATABASE_URL, "REFLECTION_OWNERSHIP_TEST_DATABASE_URL is not set")
class CanonicalReflectionOwnershipPostgresTests(unittest.TestCase):
    def test_profile_and_kind_select_each_submission_once(self):
        with psycopg.connect(
            TEST_DATABASE_URL,
            autocommit=True,
            options="-c default_transaction_read_only=on",
        ) as connection, connection.cursor() as cursor:
            cursor.execute(
                """
                WITH owners(profile_id, enrolment_id, learner_kind) AS (
                    VALUES (%s::bigint, %s::bigint, %s::text),
                           (%s::bigint, %s::bigint, %s::text)
                ), submissions(id, learner_id, learner_kind, hours) AS (
                    VALUES ('commercial-owned', %s::bigint, 'commercial'::text, 1::numeric),
                           ('commercial-enrolment', %s::bigint, 'commercial'::text, 99::numeric),
                           ('commercial-wrong-kind', %s::bigint, 'apprenticeship'::text, 99::numeric),
                           ('apprenticeship-owned', %s::bigint, 'apprenticeship'::text, 2::numeric),
                           ('apprenticeship-enrolment', %s::bigint, 'apprenticeship'::text, 99::numeric),
                           ('cross-learner', %s::bigint, 'commercial'::text, 99::numeric)
                )
                SELECT owners.profile_id, owners.learner_kind,
                       array_agg(submissions.id ORDER BY submissions.id) AS ids,
                       sum(submissions.hours) AS hours
                  FROM owners
                  JOIN submissions
                    ON submissions.learner_id = owners.profile_id
                   AND submissions.learner_kind = owners.learner_kind
                 GROUP BY owners.profile_id, owners.learner_kind
                 ORDER BY owners.profile_id
                """,
                [1701, 2701, "commercial", 1702, 2702, "apprenticeship",
                 1701, 2701, 1701, 1702, 2702, 1702],
            )
            self.assertEqual(
                cursor.fetchall(),
                [
                    (1701, "commercial", ["commercial-owned"], 1),
                    (1702, "apprenticeship", ["apprenticeship-owned"], 2),
                ],
            )


if __name__ == "__main__":
    unittest.main()
