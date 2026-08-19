-- Drop legacy/unused columns from curriculum.programmes
--
-- ⚠️  DO NOT RUN THIS ALONE. Three code changes MUST land first, or the
--     application breaks. See "PREREQUISITES" below.
--
-- Target : Neon production, database `neondb`, schema `curriculum`
-- Table  : curriculum.programmes  (4 rows at time of writing)
--
-- ============================================================================
-- PREREQUISITES — code changes, APPLIED 2026-08-16 (commit alongside this file)
-- ============================================================================
--
-- 1. ensure_program_config_archive_columns()  — DONE
--    Removed standard/owner/created_by/is_active/structure_type from the
--    ensure_columns({...}) dict and rewrote the NULL-backfill WHERE clause.
--    WHY: this runs on startup and RECREATED these columns; without the edit
--    the DROP silently reverts on the next server restart.
--
-- 2. Write paths (3 sites) — DONE
--    curriculum_programme_tree_save() insert+update, save_programme_config(),
--    and ensure_programme_config(): dropped-column keys removed.
--    NOTE: insert_row()/update_rows() both route through filtered_payload(),
--    which strips keys absent from the table, so these writes would NOT have
--    500'd. The edits keep the code honest; the one REAL crash was
--    `updates['standard']` (KeyError) in the create response, now fixed.
--
-- 3. Read paths — DONE
--    build_programmes(): `standard` now derives from the KSB profile name,
--    falling back to the programme name; structure_type hardcoded 'scheduled'.
--    is_archived_program_config(): is_active clause removed.
--
-- ============================================================================
-- BEHAVIOUR THIS PERMANENTLY REMOVES
-- ============================================================================
--   * Free-programme support        (structure_type)   — all become scheduled
--   * Programme active/inactive flag (is_active)       — is_archived remains
--   * "STANDARD / FRAMEWORK" on cards (standard, sub)
--   * Programme owner attribution    (owner, created_by)
--
-- ============================================================================
-- BEFORE YOU RUN — take a restore point
-- ============================================================================
-- A dropped column cannot be recovered by re-adding it; the DATA is gone.
-- In the Neon console: Branches → create a branch from `production`.
-- That is your rollback. This script's "rollback" section only restores the
-- empty columns, NOT their contents.
--
-- Verify current contents first:
--     SELECT programme_id, name, sub, standard, owner, created_by,
--            status, is_active, structure_type, legacy_numeric_id
--     FROM curriculum.programmes ORDER BY name;

BEGIN;

-- Guard: abort if the table is not the expected shape, so this cannot be
-- run against an unrelated database by mistake.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'curriculum' AND table_name = 'programmes'
    ) THEN
        RAISE EXCEPTION 'curriculum.programmes not found — wrong database?';
    END IF;
END $$;

-- No code references at all. Unambiguously safe.
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS legacy_numeric_id;

-- No read path on this table; archive state is carried by is_archived.
-- archive_payload() guards this with has_column(), so it degrades cleanly.
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS status;

-- Only ever mirrored `owner`; never read back independently.
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS created_by;

-- Legacy duplicate of `standard` (verified identical on all rows).
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS sub;

-- ⚠️  Requires PREREQUISITE 2 and 3. Programme cards lose STANDARD/FRAMEWORK.
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS standard;

-- ⚠️  Requires PREREQUISITE 2. Owner attribution is lost.
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS owner;

-- ⚠️  Requires PREREQUISITE 1. is_archived becomes the sole archive signal.
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS is_active;

-- ⚠️  Requires PREREQUISITE 1, 2 and 3. FREE PROGRAMMES STOP WORKING —
--     every programme is treated as 'scheduled' from here on.
ALTER TABLE curriculum.programmes DROP COLUMN IF EXISTS structure_type;

COMMIT;

-- Confirm the resulting shape:
--     SELECT column_name, data_type
--     FROM information_schema.columns
--     WHERE table_schema = 'curriculum' AND table_name = 'programmes'
--     ORDER BY ordinal_position;
--
-- Expected remaining columns:
--     programme_id, name, color, created_at, updated_at,
--     is_archived, level, description, ksb_profile_source_id


-- ============================================================================
-- ROLLBACK — structure only. DOES NOT restore data.
-- ============================================================================
-- To recover the VALUES, restore from the Neon branch you took above.
--
-- BEGIN;
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS legacy_numeric_id integer;
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS status            varchar(32);
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS created_by        varchar(255);
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS sub               text;
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS standard          varchar(255);
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS owner             varchar(255);
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS is_active         boolean;
-- ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS structure_type    varchar(32);
-- UPDATE curriculum.programmes
--    SET is_active = true, structure_type = 'scheduled'
--  WHERE is_active IS NULL OR structure_type IS NULL;
-- COMMIT;
