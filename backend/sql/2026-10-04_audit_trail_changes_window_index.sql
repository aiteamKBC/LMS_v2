-- Audit Trail: the Changes feed's whole-window count over the revision log.
-- Written 2026-10-04. NOT YET RUN anywhere. For the owner to review and apply.
--
-- WHY
--   The Changes feed now reads 7 (default), 30 or 60 days in every workspace.
--   Each request counts the whole filtered window (so the total, the action and
--   record-type counts and the page always agree), and lists the authors in it.
--   On production (read-only EXPLAIN ANALYZE, 2026-10-04, system-wide 60 days)
--   that count is a sequential scan of curriculum.record_revisions:
--       Seq Scan on record_revisions ... rows=1,311,510  actual 1.39 s
--       HashAggregate                                    actual 1.93 s total
--   The timestamp-recovered half of the same statement took ~110 ms; the LMS
--   tables it reads need no index. Warm, the request takes ~4.8 s; on a cold
--   compute the first system-wide 30-day read exceeded the 15 s statement
--   timeout once and fell back to the log alone (recoveryFailed = true).
--
-- WHAT THIS INDEX IS FOR
--   Lets the system-wide count and the author list (quality.revision_actors)
--   be answered by an index-only scan of the window instead of the heap:
--     select ..., count(*) ... where created_at >= $since
--       and not (action = 'updated' and cast(changed_fields as text) in ('[]', 'null'))
--   The WHERE below must stay textually identical to
--   system_audit/writes.py EMPTY_EDIT_CLAUSE, or the planner cannot prove the
--   query implies it and will not use the index.
--
-- LIMITS -- read before applying
--   * Untested: whether the planner chooses it, and how much it saves, has not
--     been measured. Verify with step 6 below on a branch first.
--   * Index-only scans need the visibility map to be current. This table is
--     updated after insert (burst merges, snapshot trimming), so heap fetches
--     will remain until autovacuum catches up.
--   * Workspace-scoped feeds (Curriculum, Coach, ...) also filter on
--     metadata ->> 'page_workspace', which this index does not hold; they will
--     still visit the heap for the rows in the window. This targets the
--     system-wide feed, which reads the most rows.
--   * Size: one entry per non-empty revision (~1.3M rows today), roughly
--     100-200 MB.
--
-- HOW TO RUN
--   1. Run on a Neon branch first, not production.
--   2. CREATE INDEX CONCURRENTLY cannot run inside a transaction block: run it
--      on its own, not wrapped in BEGIN/COMMIT.
--   3. CONCURRENTLY does not block reads or writes; it takes longer to build.
--   4. An interrupted build leaves an INVALID index: drop it and re-run.
--   5. ANALYZE afterwards.
--   6. Compare EXPLAIN (ANALYZE, BUFFERS) of the system-wide 30/60-day count
--      before and after (the statement starting
--      "select provenance, action, entity, count(*)" in system_audit/derived.py).
--
-- ---------------------------------------------------------------------------
-- 1. The system-wide count and author list.
--
-- Rollback: DROP INDEX CONCURRENTLY curriculum.record_revisions_feed_window_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS record_revisions_feed_window_idx
    ON curriculum.record_revisions (created_at DESC)
    INCLUDE (entity_type, action, id, actor_email, actor_name)
    WHERE NOT (action = 'updated' AND CAST(changed_fields AS text) IN ('[]', 'null'));

-- ---------------------------------------------------------------------------
-- 2. Workspace-scoped feeds (Admin, Coach, Enrolment, ...) over 30/60 days.
--    Measured 2026-10-04 (read-only): Admin 30 days returned 146 events in
--    2.7-8.8 s, Employer 20 events in 3.3-5.2 s -- a scan of the whole window
--    to find a few rows. The scope is (system_audit/writes.py _workspace_scope):
--      (metadata ->> 'page_workspace' = $ws
--       or (coalesce(metadata ->> 'page_workspace', '') = '' and entity_type in (...)))
--    record_revisions_type_created_idx already serves the second arm; this
--    serves the first, so the planner can BitmapOr the two instead of scanning.
--    Untested, like (1): verify with EXPLAIN (ANALYZE, BUFFERS) of
--    ?workspace=admin&days=30 before and after.
--
-- Rollback: DROP INDEX CONCURRENTLY curriculum.record_revisions_page_workspace_created_idx;

CREATE INDEX CONCURRENTLY IF NOT EXISTS record_revisions_page_workspace_created_idx
    ON curriculum.record_revisions ((metadata ->> 'page_workspace'), created_at DESC);

ANALYZE curriculum.record_revisions;

-- Find an INVALID leftover from an interrupted build:
-- select indexrelid::regclass from pg_index where not indisvalid;
