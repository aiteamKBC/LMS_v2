-- Programme Review Templates -- sections and conditional fields.
--
-- Extends curriculum.review_templates / curriculum.review_fields (created by
-- sql/2026-09-10_curriculum_review_templates.sql, already applied) to support
-- the real Aptem-equivalent shape:
--
--   Review -> Section(s) -> Field(s) -> optional YES/NO conditional children
--
-- This file is FORWARD-ONLY, IDEMPOTENT and NON-DESTRUCTIVE:
--   * no existing table is dropped or renamed
--   * no existing column is dropped
--   * every DDL statement is guarded (IF NOT EXISTS, or a pg_constraint /
--     information_schema probe for the things Postgres has no IF NOT EXISTS
--     spelling for)
--   * the data backfill only ever touches review_fields rows that do not yet
--     have a section_id, so re-running this file after it has already
--     succeeded is a no-op
--
-- Effect on existing data: every Review created by the first implementation
-- has its (flat) fields left exactly as they are, except each gets assigned
-- into one generated section titled "General" per Review, so the Reviews ID
-- tab keeps working immediately for reviews written before this patch.
--
-- Safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. New columns on curriculum.review_fields: section_id, parent_field_id,
--    condition_value. Added nullable first -- section_id is tightened to
--    NOT NULL below, once the backfill guarantees no existing row is left
--    without one.
-- ---------------------------------------------------------------------------

ALTER TABLE curriculum.review_fields ADD COLUMN IF NOT EXISTS section_id varchar(128);
ALTER TABLE curriculum.review_fields ADD COLUMN IF NOT EXISTS parent_field_id varchar(128);
ALTER TABLE curriculum.review_fields ADD COLUMN IF NOT EXISTS condition_value varchar(16);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'review_fields_condition_value_valid'
    ) THEN
        ALTER TABLE curriculum.review_fields
            ADD CONSTRAINT review_fields_condition_value_valid
            CHECK (condition_value IS NULL OR condition_value IN ('yes', 'no'));
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. curriculum.review_sections -- one row per Form Builder section.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS curriculum.review_sections (
    id                  varchar(128)  PRIMARY KEY,
    review_id           varchar(128)  NOT NULL,
    title               varchar(500)  NOT NULL DEFAULT '',
    estimated_minutes   integer       NOT NULL DEFAULT 0,
    display_order       integer       NOT NULL DEFAULT 0,
    enabled             boolean       NOT NULL DEFAULT true,
    deleted_at          timestamptz,
    deleted_by          varchar(255),
    deleted_via_parent  varchar(255),
    created_by          varchar(255)  NOT NULL DEFAULT '',
    updated_by          varchar(255)  NOT NULL DEFAULT '',
    created_at          timestamptz   NOT NULL DEFAULT now(),
    updated_at          timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT review_sections_estimated_minutes_non_negative CHECK (estimated_minutes >= 0)
);

CREATE INDEX IF NOT EXISTS review_sections_review_id_idx ON curriculum.review_sections (review_id);
CREATE INDEX IF NOT EXISTS review_sections_review_id_order_idx ON curriculum.review_sections (review_id, display_order);
CREATE INDEX IF NOT EXISTS review_sections_review_live_idx ON curriculum.review_sections (review_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS review_fields_section_id_idx ON curriculum.review_fields (section_id);
CREATE INDEX IF NOT EXISTS review_fields_parent_field_id_idx ON curriculum.review_fields (parent_field_id);
CREATE INDEX IF NOT EXISTS review_fields_section_id_order_idx ON curriculum.review_fields (section_id, display_order);

-- ---------------------------------------------------------------------------
-- 3. Backfill: every review_fields row that predates sections gets a
--    generated "General" section for its Review, and is attached to it.
--    Idempotent: once every row has a section_id, the EXISTS guard below is
--    false for every Review, so a second run inserts and updates zero rows.
-- ---------------------------------------------------------------------------

WITH backfill_sections AS (
    INSERT INTO curriculum.review_sections (
        id, review_id, title, estimated_minutes, display_order, enabled,
        created_by, updated_by, created_at, updated_at
    )
    SELECT
        'REVS-' || to_char(now(), 'YYYYMMDDHH24MISS')
            || lpad((900000 + row_number() OVER (ORDER BY rt.id))::text, 6, '0'),
        rt.id,
        'General',
        0,
        0,
        true,
        'system-backfill',
        'system-backfill',
        now(),
        now()
    FROM curriculum.review_templates rt
    WHERE EXISTS (
        SELECT 1 FROM curriculum.review_fields rf
        WHERE rf.review_id = rt.id AND rf.section_id IS NULL
    )
    RETURNING id, review_id
)
UPDATE curriculum.review_fields rf
SET section_id = bs.id
FROM backfill_sections bs
WHERE rf.review_id = bs.review_id AND rf.section_id IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Now that every row has a section_id, enforce it at the database level.
--    Safe: the backfill above is unconditional over every review_fields row
--    with a NULL section_id, so none remain by this point.
-- ---------------------------------------------------------------------------

ALTER TABLE curriculum.review_fields ALTER COLUMN section_id SET NOT NULL;

COMMIT;
