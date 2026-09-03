-- Indexes for the measured hotspots in claude-code-prompt-lms-db-performance-v2.md
-- Written 2026-09-01. NOT YET RUN anywhere.
--
-- Every predicate below was read out of the application code (file:line given
-- with each). Whether the index is actually missing is inferred from that
-- document's pg_stat_user_tables snapshot -- average rows read per scan equals
-- the whole table -- not verified against the live database. IF NOT EXISTS
-- makes each statement safe to run either way.
--
-- HOW TO RUN
--   1. Run on branch br-sparkling-art-ab64k0zx first, not production.
--   2. CREATE INDEX CONCURRENTLY CANNOT RUN INSIDE A TRANSACTION BLOCK.
--      Execute these ONE STATEMENT AT A TIME. Do not wrap in BEGIN/COMMIT, and
--      note that some SQL consoles open a transaction for you -- if you get
--      "CREATE INDEX CONCURRENTLY cannot run inside a transaction block",
--      that is what happened.
--   3. CONCURRENTLY does not block reads or writes. It takes longer and costs
--      some CPU/IO while it builds; on these table sizes expect seconds to a
--      minute each.
--   4. If a build is interrupted it leaves an INVALID index behind. It is inert,
--      but find it with the query at the bottom, drop it, and re-run.
--   5. ANALYZE each table afterwards so the planner sees the new index.
--   6. Capture EXPLAIN (ANALYZE, BUFFERS) for the named query before and after.
--
-- Rollback for any of these: DROP INDEX CONCURRENTLY <name>;


-- ---------------------------------------------------------------------------
-- 1. fetching_evidence.evidence_items
--    Measured: 4,087,060,554 tuples read over 85,468 seq scans of 48,826 rows.
--    Serves: audit_api/evidence_explorer_views.py:128 -- "WHERE learner_id = %s"
--            behind GET /audit_api/last-audit/evidence/list, which the Learner
--            Log Pro frontend calls every time an auditor opens a learner.
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS evidence_items_learner_id_idx
    ON fetching_evidence.evidence_items (learner_id);

ANALYZE fetching_evidence.evidence_items;


-- ---------------------------------------------------------------------------
-- 2. structured_manual_activities.manual_learner_activities
--    Measured: 3,355,422,278 tuples read over 53,940 seq scans of 167,484 rows.
--
--    2a serves the correlated subquery in the SELECT list at
--       audit_api/evidence_explorer_views.py:145-149, which re-scans this table
--       once per evidence row returned by query 1 above -- so a learner with 200
--       evidence items triggers 200 full scans inside a single request:
--         WHERE m.aptem_id = e.learner_id AND m.deleted_at IS NULL
--           AND (m.source_ref = 'ev:'||e.evidence_id
--                OR m.source_ref = 'asg:'||e.component_id)
--       Both OR branches are equality on source_ref, so with aptem_id leading
--       the planner can BitmapOr the two lookups.
--
--    2b serves audit_api/actual_hours/journal_hours.py:325:
--         where m.aptem_id = %s and m.month = %s and m.deleted_at is null
--
--    Both are partial on deleted_at IS NULL because every caller filters on it.
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS manual_learner_activities_aptem_source_idx
    ON structured_manual_activities.manual_learner_activities (aptem_id, source_ref)
    WHERE deleted_at IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS manual_learner_activities_aptem_month_idx
    ON structured_manual_activities.manual_learner_activities (aptem_id, month)
    WHERE deleted_at IS NULL;

ANALYZE structured_manual_activities.manual_learner_activities;


-- ---------------------------------------------------------------------------
-- 3. "Manual_audit".activity_results
--    Serves the join at manual_audit_api/plan_projection.py:453-454:
--      join "Manual_audit".activity_results r
--        on r.learner_id = l.learner_id and r.activity_id = c.lms_id
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS activity_results_learner_activity_idx
    ON "Manual_audit".activity_results (learner_id, activity_id);

ANALYZE "Manual_audit".activity_results;


-- ---------------------------------------------------------------------------
-- 4. "Audit".ilr_learning_deliveries -- EXPRESSION indexes, deliberately
--    Measured: 386,513 seq scans, only 1,202 index scans in the table's
--    lifetime, over 1,066 rows.
--
--    The performance plan attributes this to a client-side loop. It is not: it
--    is the JOIN LATERAL at audit_api/manual_ledger_views.py:245, which runs
--    once per "LMS"."Aptem_users" row. Its predicates wrap the column in
--    function calls:
--      WHERE lower(btrim(delivery.email)) = lower(btrim(aptem."Email"))
--         OR lower(btrim(concat_ws(' ', delivery.given_names,
--                                       delivery.family_name)))
--            = lower(btrim(aptem."FullName"))
--
--    A plain btree on email therefore cannot be used at all -- the index has to
--    match the expression exactly, character for character, as written below.
--    Two indexes, because the OR needs a BitmapOr over both branches.
--
--    Verify with EXPLAIN that both are picked up before promoting this one:
--    if the planner still seq-scans, the expression text does not match.
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS ilr_learning_deliveries_email_lower_idx
    ON "Audit".ilr_learning_deliveries (lower(btrim(email)));

CREATE INDEX CONCURRENTLY IF NOT EXISTS ilr_learning_deliveries_fullname_lower_idx
    ON "Audit".ilr_learning_deliveries
       (lower(btrim(concat_ws(' ', given_names, family_name))));

ANALYZE "Audit".ilr_learning_deliveries;


-- ---------------------------------------------------------------------------
-- NOT INCLUDED, and why
--
-- "Last_audit".activity_results (999,975,724 tuples read) already shows
-- 77,228,974 index scans, so it has usable indexes and its remaining seq scans
-- need their own predicate traced before adding anything. I did not find the
-- query responsible.
--
-- fetching_evidence.break_periods (11,637,307 scans of 34 rows) has zero
-- references anywhere in the Django codebase -- it is n8n-owned. An index will
-- not help; the call frequency is the defect and it needs a workflow fix.
--
-- The month filter on query 1 is
--   to_char(coalesce(o.evidence_date, e.completed_date, e.submission_date,
--                    e.created_date), 'YYYY-MM')
-- which spans a LEFT JOIN to the overrides table and so cannot be served by a
-- single-table index. Fix the learner_id scan first and re-measure before
-- attempting anything here.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- Find indexes left INVALID by an interrupted CONCURRENTLY build
-- ---------------------------------------------------------------------------
-- SELECT c.relname, n.nspname
-- FROM pg_index i
-- JOIN pg_class c ON c.oid = i.indexrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE NOT i.indisvalid;
