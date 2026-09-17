-- Curriculum audit trail, phase 2: audit metadata as first-class columns.
-- Owner-run SQL only; no Django migration. NOT APPLIED BY THE AGENT.
--
-- WHAT THIS IS FOR
--
-- Phase 1 had one free column to work with, so the save source and the actor
-- kind rode inside `reason` as tagged pairs:
--
--     component-delete; source=auto-save; actor=system
--
-- That works, but it is a string that has to be parsed to be queried, it cannot
-- be indexed, and it cannot hold the one distinction the trail most needs:
-- an action the SYSTEM performed BECAUSE OF something a person did. "Ayman
-- changed the session count" and "the module end date moved as a result" are
-- two different facts, and only the first one is a person editing a field.
--
-- After this runs, curriculum_api.versioning writes the columns instead of the
-- tags. It probes for them first (see metadata_columns_available), so the
-- application keeps recording correctly both before and after this SQL is run,
-- and rows written under either shape stay readable -- quality.py reads the
-- columns when present and falls back to parsing the old `reason` tags when
-- they are empty. NOTHING IS REWRITTEN: historic rows keep their tags.
--
-- COST ON THE LIVE TABLE
--
-- curriculum.record_revisions held ~1.15M rows when this was written. Every
-- column below is added with a non-volatile DEFAULT, which PostgreSQL 11+
-- records in the catalogue rather than rewriting the heap -- so the ALTER is
-- effectively instantaneous and takes only a brief ACCESS EXCLUSIVE lock.
--
-- The three indexes are the expensive part (a few seconds to a minute each on a
-- table this size) and they DO block writes to this table for their duration in
-- the form below. Audit writes failing is not the same as saves failing --
-- versioning swallows its own errors -- but if you would rather not hold the
-- lock at all, run the CREATE INDEX statements separately with CONCURRENTLY,
-- outside this transaction (see the note at the bottom).

BEGIN;

ALTER TABLE curriculum.record_revisions
    -- user | system | integration | job. Empty on every row written before this
    -- column existed; the reader treats empty as "read it off the old tags".
    ADD COLUMN IF NOT EXISTS actor_type         varchar(32)  NOT NULL DEFAULT '',
    -- The person whose action caused a SYSTEM write. Null-equivalent (empty) for
    -- a direct user edit -- they are the actor, not the trigger -- and for a
    -- scheduled run, where there is no person and guessing one would be a lie.
    ADD COLUMN IF NOT EXISTS triggered_by_email varchar(255) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS triggered_by_name  varchar(255) NOT NULL DEFAULT '',
    -- manual | auto-save | module-builder | tree-save | import | upload |
    -- duplicate | wizard | recalculation | scheduled-job | system | api.
    -- A machine-readable identifier, never the words shown in the UI.
    ADD COLUMN IF NOT EXISTS source             varchar(64)  NOT NULL DEFAULT '',
    -- Small, allowlisted descriptive context: the file an upload carried, the
    -- batch an import belonged to. Never record content, never a URL query
    -- string, never anything secret -- see versioning.safe_metadata, which is
    -- what decides whether a key is allowed to reach this column at all.
    ADD COLUMN IF NOT EXISTS metadata           jsonb        NOT NULL DEFAULT '{}'::jsonb;

-- Indexes, one per filter the audit trail actually offers. `created_at DESC`
-- leads none of them because every query is already bounded by the date window
-- through record_revisions_created_idx; these each serve the *additional*
-- predicate, with created_at second so the window is still an index range.
--
-- No index for actor_type or triggered_by_email: neither is a filter the page
-- offers, and both are low-cardinality enough that one would rarely be chosen.

CREATE INDEX IF NOT EXISTS record_revisions_actor_created_idx
    ON curriculum.record_revisions (actor_email, created_at DESC);

CREATE INDEX IF NOT EXISTS record_revisions_type_created_idx
    ON curriculum.record_revisions (entity_type, created_at DESC);

-- Partial: `source` is empty on all 1.15M historic rows, and an index over them
-- would be large and never used. Only rows that name a source are worth listing.
CREATE INDEX IF NOT EXISTS record_revisions_source_created_idx
    ON curriculum.record_revisions (source, created_at DESC)
    WHERE source <> '';

COMMIT;

-- ---------------------------------------------------------------------------
-- VERIFICATION (read-only). Run after the COMMIT above.
--
-- Expect: five rows, one per new column, with the types and defaults declared
-- above; three index rows; and a distribution that is entirely '(legacy)' at
-- first -- nothing is backfilled, so the new columns fill up only as new
-- revisions are written.

SELECT column_name, data_type, character_maximum_length, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'curriculum'
  AND table_name = 'record_revisions'
  AND column_name IN ('actor_type', 'triggered_by_email', 'triggered_by_name', 'source', 'metadata')
ORDER BY column_name;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'curriculum'
  AND tablename = 'record_revisions'
  AND indexname IN (
    'record_revisions_actor_created_idx',
    'record_revisions_type_created_idx',
    'record_revisions_source_created_idx'
  )
ORDER BY indexname;

-- How many revisions now carry structured metadata, over the last 7 days.
SELECT
    CASE WHEN actor_type = '' THEN '(legacy: read from reason tags)' ELSE actor_type END AS actor_type,
    CASE WHEN source = ''     THEN '(legacy: read from reason tags)' ELSE source     END AS source,
    count(*) AS revisions
FROM curriculum.record_revisions
WHERE created_at >= now() - interval '7 days'
GROUP BY 1, 2
ORDER BY revisions DESC;

-- ---------------------------------------------------------------------------
-- IF YOU PREFER NOT TO LOCK THE TABLE WHILE THE INDEXES BUILD
--
-- Run the ALTER inside its own BEGIN/COMMIT, then these three on their own,
-- each outside any transaction (CONCURRENTLY cannot run inside one):
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS record_revisions_actor_created_idx
--       ON curriculum.record_revisions (actor_email, created_at DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS record_revisions_type_created_idx
--       ON curriculum.record_revisions (entity_type, created_at DESC);
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS record_revisions_source_created_idx
--       ON curriculum.record_revisions (source, created_at DESC) WHERE source <> '';
--
-- A CONCURRENTLY build that is interrupted leaves an INVALID index behind; check
-- with:  SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- and DROP INDEX that name before retrying.
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Nothing here destroys data, so undoing it is only a matter of dropping what
-- was added. The application keeps working either way: versioning re-probes for
-- the columns and falls back to the tagged `reason` encoding when they are gone.
--
--   BEGIN;
--   DROP INDEX IF EXISTS curriculum.record_revisions_actor_created_idx;
--   DROP INDEX IF EXISTS curriculum.record_revisions_type_created_idx;
--   DROP INDEX IF EXISTS curriculum.record_revisions_source_created_idx;
--   ALTER TABLE curriculum.record_revisions
--       DROP COLUMN IF EXISTS actor_type,
--       DROP COLUMN IF EXISTS triggered_by_email,
--       DROP COLUMN IF EXISTS triggered_by_name,
--       DROP COLUMN IF EXISTS source,
--       DROP COLUMN IF EXISTS metadata;
--   COMMIT;
--
-- Revisions written while the columns existed lose their structured metadata if
-- you do this, and they do NOT get the old tags back -- so prefer leaving the
-- columns in place and simply not reading them.
