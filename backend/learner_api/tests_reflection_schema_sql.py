"""PostgreSQL tests for the reflection deployment SQL artifact."""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from django.db import connections
from django.test import SimpleTestCase


SQL_PATH = (
    Path(__file__).resolve().parent
    / "sql"
    / "learning_reflection_submissions.sql"
)
DEPLOYMENT_SQL = SQL_PATH.read_text(encoding="utf-8")


LEGACY_CREATE_SQL = """
create table "Learner".learning_reflection_submissions (
    id uuid primary key,
    learner_kind varchar(32) not null,
    learner_id varchar(128) not null,
    learner_name text,
    programme_name text,
    activity_type varchar(64) not null,
    activity_id varchar(255) not null,
    activity_title text,
    module_title text,
    week_title text,
    planned_otjh text,
    status varchar(64) not null default 'submitted_for_tutor_review',
    learning_reflection text not null,
    ksb_codes jsonb not null default '[]'::jsonb,
    ksb_explanations jsonb not null default '{}'::jsonb,
    confidence_before jsonb not null default '{}'::jsonb,
    confidence_after jsonb not null default '{}'::jsonb,
    application_type varchar(64),
    application_text text,
    evidence_files jsonb not null default '[]'::jsonb,
    evidence_consent_confirmed boolean not null default false,
    selected_benefits jsonb not null default '[]'::jsonb,
    benefit_explanation text,
    actual_time_hours text,
    completed_during_paid_hours varchar(32),
    date_completed date,
    otjh_confirmed boolean not null default false,
    signed_declaration boolean not null default false,
    quality_score smallint not null default 0,
    full_submission jsonb not null default '{}'::jsonb,
    submitted_at timestamptz not null default now()
)
"""


class ReflectionSubmissionSqlTests(SimpleTestCase):
    databases = {"default", "enrolment"}

    @property
    def connection(self):
        return connections["enrolment"]

    def _assert_test_database(self):
        name = self.connection.settings_dict["NAME"]
        self.assertTrue(
            name.startswith("test_"),
            f"Refusing destructive SQL test outside a test database: {name}",
        )

    def _reset_schema(self):
        self._assert_test_database()
        with self.connection.cursor() as cursor:
            cursor.execute(
                'drop table if exists "Learner".learning_reflection_submissions'
            )
            cursor.execute('drop table if exists curriculum.ksb_mappings')

    def _apply_sql(self):
        with self.connection.cursor() as cursor:
            cursor.execute(DEPLOYMENT_SQL)

    def tearDown(self):
        self._apply_sql()
        super().tearDown()

    def test_fresh_database_is_ready_from_deployment_sql(self):
        self._reset_schema()

        self._apply_sql()
        self._apply_sql()

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select column_name, udt_name, is_nullable
                  from information_schema.columns
                 where table_schema='Learner'
                   and table_name='learning_reflection_submissions'
                """
            )
            columns = {row[0]: (row[1], row[2]) for row in cursor.fetchall()}
            cursor.execute(
                """
                select indexname
                  from pg_indexes
                 where schemaname='Learner'
                   and tablename='learning_reflection_submissions'
                """
            )
            indexes = {row[0] for row in cursor.fetchall()}
            cursor.execute(
                """
                select conname, contype
                  from pg_constraint
                 where conrelid='"Learner".learning_reflection_submissions'::regclass
                """
            )
            constraints = set(cursor.fetchall())

        self.assertEqual(columns["id"], ("uuid", "NO"))
        self.assertEqual(columns["ksb_weights"], ("jsonb", "NO"))
        self.assertEqual(columns["progress_entry_id"], ("int8", "YES"))
        self.assertEqual(columns["enrolment_id"], ("int8", "YES"))
        self.assertTrue(
            {
                "idx_learning_reflections_learner",
                "idx_learning_reflections_activity",
                "idx_learning_reflections_submitted",
                "uq_learning_reflections_activity",
                "idx_learning_reflections_progress_entry",
                "idx_learning_reflections_component_ref",
            }
            <= indexes
        )
        self.assertIn(("learning_reflection_submissions_pkey", "p"), constraints)

    def test_existing_rows_survive_and_legacy_weights_are_backfilled(self):
        self._reset_schema()
        submission_id = uuid.uuid4()

        with self.connection.cursor() as cursor:
            cursor.execute(LEGACY_CREATE_SQL)
            cursor.execute('create schema if not exists curriculum')
            cursor.execute(
                """
                create table curriculum.ksb_mappings (
                    component_id text,
                    ksb_code text,
                    weight numeric(5,2)
                )
                """
            )
            cursor.execute(
                "insert into curriculum.ksb_mappings values (%s, %s, %s)",
                ["component-legacy", "K1", "25.00"],
            )
            cursor.execute(
                """
                insert into "Learner".learning_reflection_submissions (
                    id, learner_kind, learner_id, activity_type, activity_id,
                    learning_reflection
                ) values (
                    %s, 'apprenticeship', '19', 'reflection',
                    'component-legacy', 'Legacy reflection'
                )
                """,
                [submission_id],
            )

        self._apply_sql()

        with self.connection.cursor() as cursor:
            cursor.execute(
                """
                select id, learning_reflection, ksb_weights,
                       coach_feedback, reviewed_by, reviewed_at,
                       progress_entry_id, component_ref
                  from "Learner".learning_reflection_submissions
                 where id = %s
                """,
                [submission_id],
            )
            row = cursor.fetchone()
            cursor.execute(
                'select count(*) from "Learner".learning_reflection_submissions'
            )
            count = cursor.fetchone()[0]

        weights = json.loads(row[2]) if isinstance(row[2], str) else row[2]
        self.assertEqual(count, 1)
        self.assertEqual(row[0], submission_id)
        self.assertEqual(row[1], "Legacy reflection")
        self.assertEqual(weights, {"K1": 25.0})
        self.assertEqual(row[3:7], (None, None, None, None))
        self.assertIsNone(row[7])
