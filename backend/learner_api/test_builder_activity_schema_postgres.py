"""Read-only PostgreSQL regression for normalized module schedule metadata.

Run explicitly against the verified Development database.  The test opens its
own read-only connection, verifies the legacy physical column is absent, and
executes the production projection.  It performs no DDL or data writes.
"""
import json
import os
import unittest

import psycopg
from django.conf import settings

from .builder_activity_dates import STUDY_WEEK_SCHEDULE_SQL


RUN_TEST = os.environ.get("RUN_NORMALIZED_SCHEMA_POSTGRES_TESTS", "").strip() == "1"
EXPECTED_ENDPOINT = os.environ.get("LEARNER_NORMALIZED_SCHEMA_EXPECTED_ENDPOINT", "").strip()


@unittest.skipUnless(
    RUN_TEST and EXPECTED_ENDPOINT,
    "Set RUN_NORMALIZED_SCHEMA_POSTGRES_TESTS=1 and the expected Development endpoint.",
)
class BuilderActivityNormalizedSchemaPostgresTests(unittest.TestCase):
    def test_schedule_projection_compiles_without_legacy_weeks_number_column(self):
        config = settings.DATABASES["enrolment"]
        host = str(config.get("HOST") or "")
        self.assertEqual(host.split(".")[0], EXPECTED_ENDPOINT)

        with psycopg.connect(
            dbname=config["NAME"],
            user=config["USER"],
            password=config["PASSWORD"],
            host=host,
            port=config.get("PORT") or None,
            sslmode="require",
            autocommit=True,
        ) as connection, connection.cursor() as cursor:
            cursor.execute("SET default_transaction_read_only=on")
            cursor.execute("SET statement_timeout=30000")
            cursor.execute("SHOW transaction_read_only")
            self.assertEqual(cursor.fetchone()[0], "on")
            cursor.execute(
                """SELECT count(*) FROM information_schema.columns
                   WHERE table_schema='curriculum' AND table_name='modules'
                     AND column_name='weeks_number'"""
            )
            self.assertEqual(cursor.fetchone()[0], 0)
            cursor.execute(
                f"""SELECT m.module_catalogue_id,
                            {STUDY_WEEK_SCHEDULE_SQL} AS study_schedule
                       FROM curriculum.modules m
                      ORDER BY m.module_catalogue_id
                      LIMIT 1"""
            )
            row = cursor.fetchone()
            self.assertIsNotNone(row)
            projection = json.loads(row[1]) if isinstance(row[1], str) else row[1]
            self.assertIsInstance(projection, dict)


if __name__ == "__main__":
    unittest.main()
