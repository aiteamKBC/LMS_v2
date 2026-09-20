-- Widen the activity trail from Curriculum Studio to the whole LMS.
--
-- NOT RUN AUTOMATICALLY. Apply against Neon when you are ready; nothing in the
-- application requires it, and everything keeps working before it lands.
--
-- What this is for
-- ----------------
-- curriculum.activity_events now records page opens and read actions for every
-- workspace, not just Curriculum Studio. The table keeps its name and every row
-- already in it: renaming it would either lose that history or need a migration
-- to move it, and the audit trail is the last place to trade recorded evidence
-- for a tidier name. See backend/system_audit/activity.py.
--
-- What changes when this runs
-- ---------------------------
-- Before: the workspace is derived from the stored `path` on every read, by
-- mapping it through the route table (system_audit/pages.py). That is correct,
-- but it cannot be filtered in SQL, so the workspace filter falls back to a set
-- of path-prefix LIKE tests and the per-person workspace rollup groups by
-- `path` instead of by workspace.
--
-- After: the workspace is stored as its own column, filtered with an equality
-- test that rides the index below, and grouped directly.
--
-- Rows recorded before this column existed keep '' and are backfilled by the
-- statement at the bottom, which is the one part you may want to run in
-- batches on a large table.
--
-- Nothing else in the LMS depends on this column, and no existing behaviour
-- changes when it appears: activity.workspace_column_available() probes for it
-- on every read and picks the reading it can honestly do.

ALTER TABLE curriculum.activity_events
    ADD COLUMN IF NOT EXISTS workspace text NOT NULL DEFAULT '';

-- The audit trail's workspace filter: "who used Coach in the last 30 days".
CREATE INDEX IF NOT EXISTS activity_events_workspace_occurred_idx
    ON curriculum.activity_events (workspace, occurred_at DESC);

-- One person inside one workspace, which is what opening a person from a
-- workspace-scoped trail asks for.
CREATE INDEX IF NOT EXISTS activity_events_workspace_actor_idx
    ON curriculum.activity_events (workspace, actor_email, occurred_at DESC);


-- Backfill. Every row already in the table was recorded from a Curriculum
-- Studio page, because that is all the recorder reported until now -- so the
-- general case is one statement. The CASE is still written out rather than
-- assumed: a row whose path says otherwise is labelled by its path, not by
-- what we expect to be true.
--
-- On a large table run this in batches (add `AND id BETWEEN ... AND ...`)
-- rather than as one statement.
UPDATE curriculum.activity_events
   SET workspace = CASE
           WHEN path LIKE '/curriculum%'          THEN 'curriculum'
           WHEN path LIKE '/coach%'               THEN 'coach'
           WHEN path LIKE '/tutor%'               THEN 'tutor'
           WHEN path LIKE '/learner%'             THEN 'learner'
           WHEN path LIKE '/employer%'            THEN 'employer'
           WHEN path LIKE '/engagement%'          THEN 'engagement'
           WHEN path LIKE '/mis%'                 THEN 'mis'
           WHEN path LIKE '/leadership%'          THEN 'leadership'
           WHEN path LIKE '/qa%'                  THEN 'qa'
           WHEN path LIKE '/safeguarding%'        THEN 'safeguarding'
           WHEN path LIKE '/support%'             THEN 'support'
           WHEN path LIKE '/finance%'             THEN 'finance'
           WHEN path LIKE '/admin%'               THEN 'admin'
           WHEN path LIKE '/users%'               THEN 'admin'
           WHEN path LIKE '/internal-panel%'      THEN 'admin'
           WHEN path LIKE '/audit%'               THEN 'audit'
           WHEN path LIKE '/activity-categories%' THEN 'audit'
           ELSE 'platform'
       END
 WHERE workspace = '';


-- Verification (read-only). Run after the statements above.
--
--   SELECT workspace, count(*) AS rows_recorded, min(occurred_at), max(occurred_at)
--     FROM curriculum.activity_events
--    GROUP BY workspace
--    ORDER BY count(*) DESC;
--
-- Expected immediately after backfilling an existing installation: every row
-- under 'curriculum', because that is the only workspace that was being
-- recorded. Other workspaces appear as people use them.
--
--   SELECT count(*) AS unlabelled FROM curriculum.activity_events WHERE workspace = '';
--
-- Expected: 0.
