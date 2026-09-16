-- Learner-specific additional Reviews (coach-created, ONE learner only).
--
-- Forward-only, idempotent, non-destructive. Safe to re-run. Does not drop,
-- rename, or touch any existing row. Adds:
--
--   * curriculum.learner_review_additions -- one row per coach-created
--     additional Review for a single learner (audit trail: created_by,
--     reason). This is NOT curriculum.review_occurrence_overrides -- that
--     table is skip-only (a hard CHECK constraint enforces
--     action = 'skip'), and has no concept of adding a date. Extending it
--     would have meant relaxing a constraint every existing reader/writer
--     relies on for a completely different kind of fact (a removed date vs
--     an added one), with a different lifecycle (audit fields a skip has
--     never needed). This is a small, separate, purpose-built table instead.
--
--   * curriculum.review_instances.occurrence_source /
--     curriculum.review_instances.occurrence_ref -- explicit occurrence
--     identity, so a manual (learner-specific) occurrence and a generated
--     (programme-recurrence) occurrence can coexist for the same
--     (review_template_id, learner_id) without colliding.
--
--     Generated rows: occurrence_source = 'generated',
--                      occurrence_ref = 'generated:' || occurrence_number
--                      (occurrence_number keeps its current meaning/values --
--                       nothing about generated identity changes).
--     Manual rows:     occurrence_source = 'manual',
--                      occurrence_number = NULL,
--                      occurrence_ref = 'manual:' || learner_review_addition.id
--
--     The EXISTING unique index (review_template_id, learner_id,
--     occurrence_number) is left completely alone -- Postgres treats each
--     NULL as distinct, so any number of manual rows (occurrence_number
--     NULL) coexist under it without conflict, and every existing generated
--     row's identity/behaviour is unchanged. A NEW unique index on
--     (review_template_id, learner_id, occurrence_ref) is added alongside
--     it as the identity that understands both kinds of occurrence -- this
--     is additive/staged, not a replacement, so no existing row needs
--     migrating for the old index to keep working exactly as it does today.
--
-- Run against Neon directly -- see backend/sql conventions. NOT applied to
-- production by this change -- see the accompanying report.

BEGIN;

-- 1. Learner-specific Review additions -------------------------------------
CREATE TABLE IF NOT EXISTS curriculum.learner_review_additions (
    id varchar(128) PRIMARY KEY,
    review_template_id varchar(128) NOT NULL,
    programme_id varchar(255) NOT NULL,
    learner_id integer NOT NULL,
    target_date date NOT NULL,
    reason_code varchar(64) NOT NULL DEFAULT '',
    reason varchar(1000) NOT NULL DEFAULT '',
    created_by varchar(255) NOT NULL DEFAULT '',
    created_at timestamp NOT NULL DEFAULT current_timestamp,
    updated_by varchar(255) NOT NULL DEFAULT '',
    updated_at timestamp NOT NULL DEFAULT current_timestamp,
    deleted_at timestamp,
    deleted_by varchar(255)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'learner_review_additions_reason_code_valid'
    ) THEN
        ALTER TABLE curriculum.learner_review_additions
            ADD CONSTRAINT learner_review_additions_reason_code_valid CHECK (
                reason_code = '' OR reason_code IN (
                    'additional-coaching', 'learner-request', 'employer-request',
                    'performance-concern', 'safeguarding-follow-up', 'other'
                )
            );
    END IF;
END $$;

-- At most one ACTIVE addition per (learner, template, target date) -- a
-- partial index (not a plain unique constraint) so a removed-and-re-added
-- addition can accumulate soft-deleted history without ever colliding.
CREATE UNIQUE INDEX IF NOT EXISTS learner_review_additions_active_unique
    ON curriculum.learner_review_additions (review_template_id, learner_id, target_date)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS learner_review_additions_learner_idx
    ON curriculum.learner_review_additions (learner_id);

CREATE INDEX IF NOT EXISTS learner_review_additions_programme_idx
    ON curriculum.learner_review_additions (programme_id);

-- 2. Explicit occurrence identity on review_instances ------------------------
ALTER TABLE curriculum.review_instances
    ALTER COLUMN occurrence_number DROP NOT NULL;

ALTER TABLE curriculum.review_instances
    ADD COLUMN IF NOT EXISTS occurrence_source varchar(16) NOT NULL DEFAULT 'generated';

ALTER TABLE curriculum.review_instances
    ADD COLUMN IF NOT EXISTS occurrence_ref varchar(160);

-- Backfill every EXISTING row (all of them are, by definition, generated --
-- this table had no manual concept before this migration) with the ref form
-- that mirrors its current occurrence_number. This changes no value anyone
-- already reads by occurrence_number/review_template_id/learner_id -- it
-- only populates the two new columns.
UPDATE curriculum.review_instances
SET occurrence_source = 'generated',
    occurrence_ref = 'generated:' || occurrence_number
WHERE occurrence_ref IS NULL AND occurrence_number IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'review_instances_occurrence_source_valid'
    ) THEN
        ALTER TABLE curriculum.review_instances
            ADD CONSTRAINT review_instances_occurrence_source_valid CHECK (
                occurrence_source IN ('generated', 'manual')
            );
    END IF;
END $$;

-- Additive: the existing (review_template_id, learner_id, occurrence_number)
-- unique index (review_instances_identity_uniq) is untouched and still
-- enforces exactly what it always has for generated rows. This new index is
-- the identity that also understands manual rows.
CREATE UNIQUE INDEX IF NOT EXISTS review_instances_occurrence_ref_uniq
    ON curriculum.review_instances (review_template_id, learner_id, occurrence_ref);

COMMIT;
