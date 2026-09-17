-- ###########################################################################
-- ##                                                                       ##
-- ##   DO NOT RUN IN PRODUCTION WITHOUT REVIEW AND BACKUP                  ##
-- ##                                                                       ##
-- ##   This file DELETES rows from an append-only audit table. It has NOT  ##
-- ##   been run by anyone. Read all of it, run every read-only section,     ##
-- ##   agree the counts, take the snapshot, and only then run STEP 5.      ##
-- ##                                                                       ##
-- ###########################################################################
--
-- WHAT THIS CLEANS UP, AND WHY IT EXISTS
--
-- curriculum.record_revisions held ~1,151,566 rows when this was written, of
-- which ~1,132,331 -- 98.3% -- said nothing except that `deleted_at` and
-- `deleted_by` had changed. They are not history. They are the module save
-- describing its own mechanics.
--
-- `save_module_authoring_structure` soft-deletes every week and component in a
-- module and then writes them all straight back. Before the recorder buffered
-- its writes to commit time, each save recorded an archived/restored PAIR for
-- every child, whether or not the author had touched it. One component reached
-- revision 377 in three days that way; its 598 real edits across the whole
-- table were buried under a million rows of withdraw-and-replace.
--
-- The recorder no longer does this -- writes are collapsed per entity at commit,
-- so an untouched child records nothing at all. This file is only about the rows
-- already written.
--
-- WHAT MUST SURVIVE
--
-- A genuine archive looks almost exactly like half of a churn pair: the same
-- action, the same two changed fields. The ONLY thing that distinguishes them is
-- that a churn archive is undone microseconds later by the same save, and a real
-- one is not. So nothing is deleted on the strength of its own shape. A row is a
-- candidate only as part of a matched PAIR, and only when every one of these
-- holds:
--
--   1. consecutive revision numbers on the SAME entity (N archived, N+1 restored)
--   2. BOTH rows changed nothing but deleted_at / deleted_by
--   3. both written within 2 seconds of each other -- one save cycle
--   4. both by the same actor
--   5. the two snapshots are identical once deleted_at / deleted_by are removed
--      (so a save that archived AND edited a component keeps its history)
--   6. neither row is pointed at by curriculum.record_versions
--
-- Point 6 is not optional. record_versions.revision_id is ON DELETE CASCADE, so
-- deleting a revision a named version points at would silently destroy the
-- version too. STEP 4 checks it; the DELETE in STEP 5 excludes it as well, belt
-- and braces.
--
-- Historic rows carry no `source`, so none of this relies on one. Everything
-- above is read off the rows themselves.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
--   * an archive with no restore after it (someone withdrew a record)
--   * a restore with no archive before it
--   * a pair straddling a real edit
--   * anything at all in curriculum.record_versions
--   * revision numbering. Gaps WILL appear -- revision 377 may follow 8. That
--     is the honest outcome: those revisions existed. Renumbering would rewrite
--     history to look tidier than it was, which is the one thing an audit trail
--     may never do.

-- ---------------------------------------------------------------------------
-- STEP 1 - ANALYSIS (read-only). How bad is it, and is this still worth doing?
-- ---------------------------------------------------------------------------

SELECT
    count(*)                                                     AS total_revisions,
    count(*) FILTER (WHERE changed_fields = '[]'::jsonb)         AS no_diff,
    count(*) FILTER (WHERE action IN ('archived', 'restored'))   AS archive_or_restore,
    min(created_at)                                              AS oldest,
    max(created_at)                                              AS newest
FROM curriculum.record_revisions;

-- The shape of the noise: which field-sets dominate.
SELECT
    (SELECT string_agg(c ->> 'field', ',' ORDER BY c ->> 'field')
     FROM jsonb_array_elements(changed_fields) c)                AS fields_changed,
    action,
    count(*)                                                     AS revisions
FROM curriculum.record_revisions
GROUP BY 1, 2
ORDER BY revisions DESC
LIMIT 20;

-- ---------------------------------------------------------------------------
-- STEP 2 - CANDIDATE SELECTION (read-only). Materialised so every later step
-- and the DELETE itself work from ONE agreed set of ids, rather than each
-- re-deriving it and possibly disagreeing.
--
-- UNLOGGED: this is scratch. Drop it when you are done (STEP 6).
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS curriculum.churn_cleanup_candidates;

CREATE UNLOGGED TABLE curriculum.churn_cleanup_candidates AS
WITH only_soft_delete_stamps AS (
    -- Rows whose entire diff is the two soft-delete columns. Nothing else.
    SELECT
        r.id, r.entity_type, r.entity_id, r.revision_no, r.action,
        r.actor_email, r.created_at,
        r.snapshot - 'deleted_at' - 'deleted_by' AS content
    FROM curriculum.record_revisions r
    WHERE r.action IN ('archived', 'restored')
      AND (
          SELECT array_agg(c ->> 'field' ORDER BY c ->> 'field')
          FROM jsonb_array_elements(r.changed_fields) c
      ) = ARRAY['deleted_at', 'deleted_by']
),
pairs AS (
    SELECT
        a.id AS archived_id,
        b.id AS restored_id,
        a.entity_type, a.entity_id, a.revision_no, a.created_at
    FROM only_soft_delete_stamps a
    JOIN only_soft_delete_stamps b
      ON  b.entity_type = a.entity_type
      AND b.entity_id   = a.entity_id
      AND b.revision_no = a.revision_no + 1          -- (1) consecutive
    WHERE a.action = 'archived'
      AND b.action = 'restored'
      AND b.created_at - a.created_at <= interval '2 seconds'   -- (3) one cycle
      AND a.actor_email IS NOT DISTINCT FROM b.actor_email      -- (4) same actor
      AND a.content = b.content                                 -- (5) nothing else moved
)
SELECT archived_id AS revision_id, entity_type, entity_id, revision_no, created_at FROM pairs
UNION ALL
SELECT restored_id, entity_type, entity_id, revision_no, created_at FROM pairs;

CREATE INDEX ON curriculum.churn_cleanup_candidates (revision_id);

-- How many rows this would remove, and what would be left.
SELECT
    (SELECT count(*) FROM curriculum.record_revisions)              AS before_rows,
    (SELECT count(*) FROM curriculum.churn_cleanup_candidates)      AS to_delete,
    (SELECT count(*) FROM curriculum.record_revisions)
        - (SELECT count(*) FROM curriculum.churn_cleanup_candidates) AS after_rows;

-- ---------------------------------------------------------------------------
-- STEP 3 - EYEBALL IT (read-only). Twenty candidates in full, and -- more
-- importantly -- twenty archives that are NOT candidates. If anything in the
-- second list looks like save-cycle noise, or anything in the first looks like
-- a decision somebody made, STOP.
-- ---------------------------------------------------------------------------

SELECT r.entity_type, r.entity_id, r.revision_no, r.action, r.actor_name,
       r.created_at, r.title, r.changed_fields
FROM curriculum.record_revisions r
JOIN curriculum.churn_cleanup_candidates c ON c.revision_id = r.id
ORDER BY r.created_at DESC
LIMIT 20;

SELECT r.entity_type, r.entity_id, r.revision_no, r.action, r.actor_name,
       r.created_at, r.title, r.changed_fields
FROM curriculum.record_revisions r
WHERE r.action = 'archived'
  AND NOT EXISTS (SELECT 1 FROM curriculum.churn_cleanup_candidates c WHERE c.revision_id = r.id)
ORDER BY r.created_at DESC
LIMIT 20;

-- Entities that would lose EVERY revision they have. Expect zero: a component
-- always has a create or a first-recorded revision, and neither is a candidate.
-- Anything here means an entity would vanish from history entirely. STOP if so.
SELECT c.entity_type, c.entity_id, count(*) AS revisions_removed
FROM curriculum.churn_cleanup_candidates c
GROUP BY c.entity_type, c.entity_id
HAVING count(*) = (
    SELECT count(*) FROM curriculum.record_revisions r
    WHERE r.entity_type = c.entity_type AND r.entity_id = c.entity_id
)
LIMIT 20;

-- ---------------------------------------------------------------------------
-- STEP 4 - THE CASCADE CHECK (read-only). MUST return zero rows.
--
-- record_versions.revision_id is ON DELETE CASCADE. A candidate that a named
-- version points at would take that version with it.
-- ---------------------------------------------------------------------------

SELECT v.entity_type, v.entity_id, v.version_label, v.revision_id
FROM curriculum.record_versions v
JOIN curriculum.churn_cleanup_candidates c ON c.revision_id = v.revision_id;

-- ---------------------------------------------------------------------------
-- STEP 5 - THE DELETE.  *** DESTRUCTIVE. NOT RUN BY THE AGENT. ***
--
-- BEFORE RUNNING:
--   1. Take a Neon snapshot / branch of the database (see ROLLBACK below).
--   2. STEP 4 returned zero rows.
--   3. The counts from STEP 2 were agreed by a person.
--
-- Batched at 50k. A single DELETE of ~1.13M rows holds one long transaction and
-- generates a large amount of WAL; batching keeps each transaction short and
-- lets you stop between batches. Run this block repeatedly until it reports
-- 0 rows deleted.
-- ---------------------------------------------------------------------------

-- BEGIN;
--
-- WITH batch AS (
--     SELECT c.revision_id
--     FROM curriculum.churn_cleanup_candidates c
--     WHERE NOT EXISTS (                       -- belt and braces over STEP 4
--         SELECT 1 FROM curriculum.record_versions v WHERE v.revision_id = c.revision_id
--     )
--     LIMIT 50000
-- ),
-- gone AS (
--     DELETE FROM curriculum.record_revisions r
--     USING batch b
--     WHERE r.id = b.revision_id
--     RETURNING r.id
-- )
-- DELETE FROM curriculum.churn_cleanup_candidates c
-- USING gone g
-- WHERE c.revision_id = g.id;
--
-- COMMIT;
--
-- After the last batch:
--   VACUUM (ANALYZE) curriculum.record_revisions;
-- (plain VACUUM, not FULL -- FULL takes an ACCESS EXCLUSIVE lock and rewrites
-- the whole table.)

-- ---------------------------------------------------------------------------
-- STEP 6 - VERIFICATION (read-only). Run after the deletes.
-- ---------------------------------------------------------------------------

-- Row count, and the noise share that should now be near zero.
SELECT
    count(*)                                                        AS total_revisions,
    count(*) FILTER (WHERE action IN ('archived', 'restored'))      AS archive_or_restore
FROM curriculum.record_revisions;

-- Every named version still resolves to a revision. MUST return zero rows.
SELECT v.entity_type, v.entity_id, v.version_label
FROM curriculum.record_versions v
LEFT JOIN curriculum.record_revisions r ON r.id = v.revision_id
WHERE r.id IS NULL;

-- No entity was emptied out. MUST return zero rows.
SELECT entity_type, entity_id
FROM curriculum.record_versions v
WHERE NOT EXISTS (
    SELECT 1 FROM curriculum.record_revisions r
    WHERE r.entity_type = v.entity_type AND r.entity_id = v.entity_id
);

-- Spot-check one previously noisy component: it should now read as a short list
-- of real edits. Substitute an id from the STEP 3 output.
-- SELECT revision_no, action, created_at, actor_name, changed_fields
-- FROM curriculum.record_revisions
-- WHERE entity_type = 'component' AND entity_id = 'COMP-...'
-- ORDER BY revision_no;

DROP TABLE IF EXISTS curriculum.churn_cleanup_candidates;

-- ---------------------------------------------------------------------------
-- ROLLBACK / BACKUP STRATEGY
--
-- There is no in-place undo for a DELETE, so the backup is the rollback.
--
--   PREFERRED - Neon branch. Create a branch from the current head BEFORE STEP 5
--   (Neon console, or `create_branch`). It is copy-on-write, so it is cheap and
--   instant. To roll back, either point the application at the branch or restore
--   the main branch from it. Neon's point-in-time restore covers the same ground
--   as long as the retention window has not passed -- check the window first.
--
--   ALTERNATIVE - keep the rows. Instead of deleting, copy them aside first:
--
--       CREATE TABLE curriculum.record_revisions_churn_archive AS
--       SELECT r.* FROM curriculum.record_revisions r
--       JOIN curriculum.churn_cleanup_candidates c ON c.revision_id = r.id;
--
--   then run STEP 5. This keeps the raw rows recoverable inside the same
--   database, at the cost of most of the space the cleanup was meant to
--   reclaim -- so it is the right choice for a first run and a poor one for a
--   permanent state. Restore with an INSERT ... SELECT back into
--   record_revisions (the id column is a bigserial; insert the ids explicitly
--   and then `SELECT setval` the sequence past them).
--
-- WHETHER TO RUN THIS AT ALL
--
-- Nothing depends on it. The recorder has already stopped producing these rows,
-- the audit trail reads a date window and filters, and 1.15M rows is not a size
-- Postgres struggles with. The case for running it is legibility -- one
-- component's history being 8 entries rather than 377 -- and reclaiming a few
-- hundred MB. The case against is that it deletes from an append-only log. If
-- there is any doubt, the ALTERNATIVE above gives the legibility without the
-- irreversibility.
