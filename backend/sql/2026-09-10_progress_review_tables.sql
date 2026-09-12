-- Progress Review PPTX generation. Owner-run SQL only; no Django migration.
--
-- Mirrors progress_reviews_api.tables.ensure_progress_review_tables exactly —
-- that function (and `python manage.py apply_progress_review_tables`) can
-- create the same tables lazily, so running this by hand is optional. It is
-- provided for anyone who would rather provision schema themselves before the
-- feature's first request than rely on the request-path safety net.
--
-- Three tables, one per stage of a generation run:
--
--   progress_review_runs               one row per (learner, 12-week period)
--                                       generation attempt: the period dates,
--                                       status, and any errors/warnings.
--   progress_review_source_snapshots   the full JSON review pack captured at
--                                       generation time, one row per run.
--   progress_review_pptx_files         the generated .pptx file's Azure
--                                       location, one row per run. A
--                                       regenerated review is a NEW run with
--                                       its own file, never an overwrite, so a
--                                       previously downloaded deck never
--                                       changes under its own link.
--
-- `id` on progress_review_runs is an application-generated uuid4 hex string
-- (a `text` column, not Postgres `uuid`), so the same id format works
-- unchanged under the SQLite test backend used by `manage.py test`.

BEGIN;

CREATE SCHEMA IF NOT EXISTS "Learner";

CREATE TABLE IF NOT EXISTS "Learner"."progress_review_runs" (
    id                   text         PRIMARY KEY,
    learner_kind         varchar(32)  NOT NULL,
    learner_id           bigint       NOT NULL,
    review_number        integer,
    review_date          date         NOT NULL,
    review_period_start  date         NOT NULL,
    review_period_end    date         NOT NULL,
    action_period_start  date,
    action_period_end    date,
    generation_status    varchar(32)  NOT NULL DEFAULT 'pending',
    errors               jsonb        NOT NULL DEFAULT '[]'::jsonb,
    source_warnings      jsonb        NOT NULL DEFAULT '[]'::jsonb,
    generated_by         varchar(255),
    generated_at         timestamptz,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_review_runs_learner
    ON "Learner"."progress_review_runs" (learner_kind, learner_id, review_period_end DESC);
CREATE INDEX IF NOT EXISTS idx_progress_review_runs_status
    ON "Learner"."progress_review_runs" (generation_status);

CREATE TABLE IF NOT EXISTS "Learner"."progress_review_source_snapshots" (
    id          bigserial   PRIMARY KEY,
    run_id      text        NOT NULL
                            REFERENCES "Learner"."progress_review_runs" (id) ON DELETE CASCADE,
    pack        jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_review_snapshots_run
    ON "Learner"."progress_review_source_snapshots" (run_id);

CREATE TABLE IF NOT EXISTS "Learner"."progress_review_pptx_files" (
    id                 bigserial    PRIMARY KEY,
    run_id             text         NOT NULL
                                    REFERENCES "Learner"."progress_review_runs" (id) ON DELETE CASCADE,
    container          varchar(128) NOT NULL,
    blob_name          varchar(1024) NOT NULL UNIQUE,
    original_filename  varchar(512) NOT NULL,
    content_type       varchar(255) NOT NULL
        DEFAULT 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    size_bytes         bigint,
    generated_by       varchar(255),
    generated_at       timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_review_pptx_run
    ON "Learner"."progress_review_pptx_files" (run_id);

COMMIT;

-- Confirms all three tables landed and reports what already exists.
SELECT 'progress_review_runs' AS table_name, count(*) AS rows FROM "Learner"."progress_review_runs"
UNION ALL
SELECT 'progress_review_source_snapshots', count(*) FROM "Learner"."progress_review_source_snapshots"
UNION ALL
SELECT 'progress_review_pptx_files', count(*) FROM "Learner"."progress_review_pptx_files";
