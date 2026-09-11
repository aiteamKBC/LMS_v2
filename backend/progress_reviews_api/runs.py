"""DB access for the three progress_review_* tables.

Raw SQL against the `enrolment` connection alias, same as every other Neon-
backed table in this project (see tables.py for why). Kept separate from
views.py so the generation pipeline in views._generate_for_learner reads as a
sequence of named steps rather than a page of inline SQL.
"""
import json
import uuid

from django.db import connections

from .tables import ensure_progress_review_tables

CONN = "enrolment"


def _conn():
    return connections[CONN]


def new_run_id() -> str:
    return uuid.uuid4().hex


def create_run(*, run_id, learner_kind, learner_id, period, generated_by):
    ensure_progress_review_tables()
    with _conn().cursor() as cur:
        cur.execute(
            '''
            insert into "Learner"."progress_review_runs"
              (id, learner_kind, learner_id, review_number, review_date,
               review_period_start, review_period_end, action_period_start, action_period_end,
               generation_status, generated_by)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'running', %s)
            ''',
            [
                run_id, learner_kind, learner_id, period.review_number, period.review_date,
                period.review_period_start, period.review_period_end,
                period.action_period_start, period.action_period_end, generated_by,
            ],
        )


def mark_run_completed(run_id):
    with _conn().cursor() as cur:
        cur.execute(
            '''update "Learner"."progress_review_runs"
               set generation_status = 'completed', generated_at = now(), updated_at = now()
               where id = %s''',
            [run_id],
        )


def mark_run_failed(run_id, errors: list):
    with _conn().cursor() as cur:
        cur.execute(
            '''update "Learner"."progress_review_runs"
               set generation_status = 'failed', errors = %s::jsonb, updated_at = now()
               where id = %s''',
            [json.dumps(errors), run_id],
        )


def save_warnings(run_id, warnings: list):
    with _conn().cursor() as cur:
        cur.execute(
            '''update "Learner"."progress_review_runs"
               set source_warnings = %s::jsonb, updated_at = now()
               where id = %s''',
            [json.dumps(warnings), run_id],
        )


def insert_snapshot(run_id, pack: dict):
    with _conn().cursor() as cur:
        cur.execute(
            'insert into "Learner"."progress_review_source_snapshots" (run_id, pack) values (%s, %s::jsonb)',
            [run_id, json.dumps(pack)],
        )


def insert_pptx_file(run_id, *, container, blob_name, original_filename, size_bytes, generated_by):
    with _conn().cursor() as cur:
        cur.execute(
            '''
            insert into "Learner"."progress_review_pptx_files"
              (run_id, container, blob_name, original_filename, size_bytes, generated_by)
            values (%s, %s, %s, %s, %s, %s)
            ''',
            [run_id, container, blob_name, original_filename, size_bytes, generated_by],
        )


def get_run(run_id):
    ensure_progress_review_tables()
    with _conn().cursor() as cur:
        cur.execute(
            '''
            select id, learner_kind, learner_id, review_number, review_date,
                   review_period_start, review_period_end, action_period_start, action_period_end,
                   generation_status, errors, source_warnings, generated_by, generated_at
              from "Learner"."progress_review_runs" where id = %s
            ''',
            [run_id],
        )
        row = cur.fetchone()
        if not row:
            return None
        columns = [c[0] for c in cur.description]
        return dict(zip(columns, row))


def get_pptx_file_for_run(run_id):
    with _conn().cursor() as cur:
        cur.execute(
            '''
            select container, blob_name, original_filename
              from "Learner"."progress_review_pptx_files"
             where run_id = %s
             order by generated_at desc
             limit 1
            ''',
            [run_id],
        )
        row = cur.fetchone()
        if not row:
            return None
        return {"container": row[0], "blob_name": row[1], "original_filename": row[2]}


def list_runs_for_learner(learner_id, limit=20):
    ensure_progress_review_tables()
    with _conn().cursor() as cur:
        cur.execute(
            '''
            select id, review_number, review_date, review_period_start, review_period_end,
                   generation_status, generated_at
              from "Learner"."progress_review_runs"
             where learner_id = %s
             order by review_date desc
             limit %s
            ''',
            [learner_id, limit],
        )
        columns = [c[0] for c in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]
