"""Real-PostgreSQL contract tests for the final Progress Review run schema.

Set ``PROGRESS_REVIEW_TEST_DATABASE_URL`` to a disposable local PostgreSQL
database whose name starts with ``test_``. The guard also requires PostgreSQL
to report a loopback server address, so this test cannot target Neon or another
remote database by mistake.
"""
import os
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

import psycopg
from psycopg.errors import ForeignKeyViolation, UniqueViolation

from . import integrity, runs, tables

TEST_DATABASE_URL = "PROGRESS_REVIEW_TEST_DATABASE_URL"


def _period(review_date=date(2026, 10, 26)):
    return SimpleNamespace(
        review_number=2,
        review_date=review_date,
        review_period_start=date(2026, 8, 4),
        review_period_end=review_date,
        action_period_start=date(2026, 10, 27),
        action_period_end=date(2027, 1, 18),
    )


class FinalSchemaPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        dsn = os.environ.get(TEST_DATABASE_URL)
        if not dsn:
            raise unittest.SkipTest(f"{TEST_DATABASE_URL} is not configured.")

        cls.connection = psycopg.connect(dsn, autocommit=True)
        with cls.connection.cursor() as cursor:
            cursor.execute("select current_database()")
            database_name = cursor.fetchone()[0]
        connection_host = cls.connection.info.host
        if not str(database_name).startswith("test_") or connection_host not in {
            "localhost", "127.0.0.1", "::1",
        }:
            cls.connection.close()
            raise RuntimeError(
                "Progress Review PostgreSQL tests require a loopback database "
                "whose name starts with test_."
            )

        with cls.connection.cursor() as cursor:
            cursor.execute('drop schema if exists "Learner" cascade')
            cursor.execute('create schema "Learner"')
            cursor.execute(
                '''
                create table "Learner"."learners" (
                    id bigint primary key,
                    enrolment_id bigint not null unique
                )
                '''
            )
        cls.tables_connections = patch.object(
            tables, "connections", {"enrolment": cls.connection},
        )
        cls.tables_connections.start()
        tables._READY = False
        tables.ensure_progress_review_tables()

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "connection") and not cls.connection.closed:
            with cls.connection.cursor() as cursor:
                cursor.execute('drop schema if exists "Learner" cascade')
            cls.connection.close()
        if hasattr(cls, "tables_connections"):
            cls.tables_connections.stop()
        tables._READY = False
        super().tearDownClass()

    def setUp(self):
        with self.connection.cursor() as cursor:
            cursor.execute('truncate "Learner"."progress_review_runs" cascade')
            cursor.execute('truncate "Learner"."learners" cascade')
            # The ids deliberately differ and collide across identity spaces:
            # enrolment 42 owns canonical profile 501, while profile 42 belongs
            # to enrolment 20.
            cursor.execute(
                'insert into "Learner"."learners" (id, enrolment_id) values (%s, %s), (%s, %s)',
                [501, 42, 42, 20],
            )

    def _run_patches(self):
        return (
            patch.object(runs, "_conn", return_value=self.connection),
            patch.object(runs, "ensure_progress_review_tables", return_value=None),
            patch.object(runs, "_record_run"),
            patch.object(runs, "_atomic", side_effect=self.connection.transaction),
        )

    def test_final_schema_has_one_canonical_not_null_foreign_key(self):
        with self.connection.cursor() as cursor:
            cursor.execute(
                '''
                select column_name, is_nullable
                  from information_schema.columns
                 where table_schema = 'Learner'
                   and table_name = 'progress_review_runs'
                   and column_name in ('learner_id', 'learner_profile_id')
                 order by column_name
                '''
            )
            columns = cursor.fetchall()
            cursor.execute(
                '''
                select kcu.column_name, ccu.table_schema, ccu.table_name, ccu.column_name
                  from information_schema.table_constraints tc
                  join information_schema.key_column_usage kcu
                    on tc.constraint_name = kcu.constraint_name
                   and tc.constraint_schema = kcu.constraint_schema
                  join information_schema.constraint_column_usage ccu
                    on tc.constraint_name = ccu.constraint_name
                   and tc.constraint_schema = ccu.constraint_schema
                 where tc.constraint_type = 'FOREIGN KEY'
                   and tc.table_schema = 'Learner'
                   and tc.table_name = 'progress_review_runs'
                '''
            )
            foreign_keys = cursor.fetchall()

        self.assertEqual(columns, [("learner_id", "NO")])
        self.assertIn(("learner_id", "Learner", "learners", "id"), foreign_keys)

    def test_create_read_list_snapshot_pptx_and_revision_use_canonical_id(self):
        conn_patch, ensure_patch, audit_patch, atomic_patch = self._run_patches()
        with conn_patch, ensure_patch, audit_patch, atomic_patch:
            runs.create_run(
                run_id="run-501",
                learner_kind="apprenticeship",
                learner_id=501,
                period=_period(),
                generated_by="coach@example.invalid",
            )
            runs.insert_snapshot("run-501", {"learner": {"id": "42"}})
            runs.finalize_run_with_pptx(
                "run-501",
                container="test-decks",
                blob_name="apprenticeship/42/run-501/deck.pptx",
                original_filename="deck.pptx",
                size_bytes=4,
                generated_by="coach@example.invalid",
            )
            runs.create_run(
                run_id="collision-run",
                learner_kind="apprenticeship",
                learner_id=42,
                period=_period(date(2026, 11, 1)),
                generated_by="coach@example.invalid",
            )
            runs.create_run(
                run_id="revision-501",
                learner_kind="apprenticeship",
                learner_id=501,
                period=_period(),
                generated_by="coach@example.invalid",
                parent_run_id="run-501",
                revision_source="edited",
            )

            run = runs.get_run("run-501")
            listed = runs.list_runs_for_learner(501)
            snapshot = runs.get_snapshot("run-501")
            pptx = runs.get_pptx_file_for_run("run-501")
            revision = runs.get_run("revision-501")

        self.assertEqual(run["learner_id"], 501)
        self.assertNotIn("learner_profile_id", run)
        self.assertEqual({row["id"] for row in listed}, {"run-501", "revision-501"})
        self.assertEqual(snapshot["learner"]["id"], "42")
        self.assertEqual(pptx["original_filename"], "deck.pptx")
        self.assertEqual(revision["learner_id"], 501)
        self.assertEqual(revision["parent_run_id"], "run-501")

    def test_database_rejects_a_nonexistent_canonical_owner(self):
        conn_patch, ensure_patch, audit_patch, atomic_patch = self._run_patches()
        with conn_patch, ensure_patch, audit_patch, atomic_patch, self.assertRaises(ForeignKeyViolation):
            runs.create_run(
                run_id="orphan-run",
                learner_kind="apprenticeship",
                learner_id=999,
                period=_period(),
                generated_by="coach@example.invalid",
            )

    def test_a_migrated_historical_run_remains_retrievable(self):
        with self.connection.cursor() as cursor:
            cursor.execute(
                '''
                insert into "Learner"."progress_review_runs"
                  (id, learner_kind, learner_id, review_number, review_date,
                   review_period_start, review_period_end, generation_status,
                   generated_by, generated_at)
                values (%s, %s, %s, %s, %s, %s, %s, 'completed', %s, now())
                ''',
                [
                    "historical-501", "apprenticeship", 501, 1,
                    date(2026, 7, 27), date(2026, 5, 5), date(2026, 7, 27),
                    "coach@example.invalid",
                ],
            )
            cursor.execute(
                '''insert into "Learner"."progress_review_pptx_files"
                     (run_id, container, blob_name, original_filename, size_bytes, generated_by)
                   values ('historical-501', 'test-decks',
                           'apprenticeship/42/historical-501/deck.pptx',
                           'deck.pptx', 4, 'coach@example.invalid')'''
            )

        conn_patch, ensure_patch, audit_patch, atomic_patch = self._run_patches()
        with conn_patch, ensure_patch, audit_patch, atomic_patch:
            run = runs.get_run("historical-501")
            latest = runs.get_latest_completed_run_for_period(501, date(2026, 7, 27))

        self.assertEqual(run["learner_id"], 501)
        self.assertEqual(run["generation_status"], "completed")
        self.assertEqual(latest["id"], "historical-501")

    def test_completion_without_pptx_metadata_is_rejected(self):
        conn_patch, ensure_patch, audit_patch, atomic_patch = self._run_patches()
        with conn_patch, ensure_patch, audit_patch, atomic_patch:
            runs.create_run(
                run_id="no-file", learner_kind="apprenticeship", learner_id=501,
                period=_period(), generated_by="coach@example.invalid",
            )
            with self.assertRaises(runs.RunFinalizationError):
                runs.mark_run_completed("no-file")
            run = runs.get_run("no-file")

        self.assertEqual(run["generation_status"], "running")

    def test_failed_metadata_insert_cannot_complete_the_run(self):
        conn_patch, ensure_patch, audit_patch, atomic_patch = self._run_patches()
        with conn_patch, ensure_patch, audit_patch, atomic_patch:
            runs.create_run(
                run_id="existing-file", learner_kind="apprenticeship", learner_id=501,
                period=_period(date(2026, 10, 25)), generated_by="coach@example.invalid",
            )
            runs.finalize_run_with_pptx(
                "existing-file", container="test-decks",
                blob_name="duplicate/blob-name.pptx",
                original_filename="deck.pptx", size_bytes=4,
                generated_by="coach@example.invalid",
            )
            runs.create_run(
                run_id="bad-metadata", learner_kind="apprenticeship", learner_id=501,
                period=_period(), generated_by="coach@example.invalid",
            )
            with self.assertRaises(UniqueViolation):
                runs.finalize_run_with_pptx(
                    "bad-metadata", container="test-decks",
                    blob_name="duplicate/blob-name.pptx",
                    original_filename="deck.pptx", size_bytes=4,
                    generated_by="coach@example.invalid",
                )
            run = runs.get_run("bad-metadata")
            pptx = runs.get_pptx_file_for_run("bad-metadata")

        self.assertEqual(run["generation_status"], "running")
        self.assertIsNone(pptx)

    def test_invalid_transition_rolls_back_inserted_metadata(self):
        conn_patch, ensure_patch, audit_patch, atomic_patch = self._run_patches()
        with conn_patch, ensure_patch, audit_patch, atomic_patch:
            runs.create_run(
                run_id="failed-run", learner_kind="apprenticeship", learner_id=501,
                period=_period(), generated_by="coach@example.invalid",
            )
            runs.mark_run_failed("failed-run", ["earlier failure"])
            with self.assertRaises(runs.RunFinalizationError):
                runs.finalize_run_with_pptx(
                    "failed-run", container="test-decks",
                    blob_name="apprenticeship/42/failed-run/deck.pptx",
                    original_filename="deck.pptx", size_bytes=4,
                    generated_by="coach@example.invalid",
                )
            pptx = runs.get_pptx_file_for_run("failed-run")
            run = runs.get_run("failed-run")

        self.assertIsNone(pptx)
        self.assertEqual(run["generation_status"], "failed")

    def test_draft_finalization_is_atomic_and_publish_requires_metadata(self):
        conn_patch, ensure_patch, audit_patch, atomic_patch = self._run_patches()
        with conn_patch, ensure_patch, audit_patch, atomic_patch:
            runs.create_run(
                run_id="draft-run", learner_kind="apprenticeship", learner_id=501,
                period=_period(), generated_by="coach@example.invalid",
            )
            runs.finalize_run_with_pptx(
                "draft-run", container="test-decks",
                blob_name="apprenticeship/42/draft-run/deck.pptx",
                original_filename="deck.pptx", size_bytes=4,
                generated_by="coach@example.invalid", generation_status="draft",
            )
            draft = runs.get_run("draft-run")
            published = runs.publish_run("draft-run")
            completed = runs.get_run("draft-run")

        self.assertEqual(draft["generation_status"], "draft")
        self.assertTrue(published)
        self.assertEqual(completed["generation_status"], "completed")

    def test_restore_integrity_report_finds_file_state_and_metadata_problems(self):
        with self.connection.cursor() as cursor:
            for run_id, status in (("completed-missing", "completed"), ("draft-missing", "draft")):
                cursor.execute(
                    '''insert into "Learner"."progress_review_runs"
                         (id, learner_kind, learner_id, review_number, review_date,
                          review_period_start, review_period_end, generation_status)
                       values (%s, 'apprenticeship', 501, 1, %s, %s, %s, %s)''',
                    [run_id, date(2026, 10, 26), date(2026, 8, 4), date(2026, 10, 26), status],
                )
            cursor.execute(
                '''insert into "Learner"."progress_review_runs"
                     (id, learner_kind, learner_id, review_number, review_date,
                      review_period_start, review_period_end, generation_status)
                   values ('duplicate-files', 'apprenticeship', 501, 1, %s, %s, %s, 'completed')''',
                [date(2026, 10, 26), date(2026, 8, 4), date(2026, 10, 26)],
            )
            cursor.execute(
                '''insert into "Learner"."progress_review_pptx_files"
                     (run_id, container, blob_name, original_filename, size_bytes)
                   values
                     ('duplicate-files', 'test-decks', 'duplicate-files/a.pptx', 'a.pptx', 4),
                     ('duplicate-files', 'test-decks', 'duplicate-files/b.pptx', 'b.pptx', 4),
                     ('duplicate-files', '', 'duplicate-files/invalid', 'invalid.txt', 0)'''
            )

        with patch.object(integrity, "connections", {"enrolment": self.connection}):
            report = integrity.build_integrity_report()

        self.assertFalse(report["ok"])
        self.assertEqual(report["checks"]["completed_runs_without_pptx"]["run_ids"], ["completed-missing"])
        self.assertEqual(report["checks"]["draft_runs_without_pptx"]["run_ids"], ["draft-missing"])
        self.assertEqual(report["checks"]["duplicate_pptx_records_per_run"]["count"], 1)
        self.assertEqual(report["checks"]["missing_or_invalid_file_metadata"]["count"], 1)
        self.assertEqual(report["checks"]["invalid_canonical_learner_references"]["count"], 0)
        self.assertEqual(report["checks"]["orphan_pptx_records"]["count"], 0)
