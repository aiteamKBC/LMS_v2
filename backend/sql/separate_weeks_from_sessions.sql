-- ============================================================================
-- Split the module week count away from the module session count.
--
-- Background
-- ----------
-- curriculum.modules.sessions_number was doing two jobs at once:
--   * the number of WEEKS the module is authored as (what the week builder and
--     the "Weeks" field in Edit module show), and
--   * the number of calendar SESSIONS it runs (weeks x the group's delivery
--     days per week -- what the session dates, the tutor clash check and the
--     Teams series are built from).
-- For any group delivering more than one day a week those are different
-- numbers, so every edit round-trip multiplied the weeks shown by the delivery
-- days (5 -> 10 -> 20 -> 40 ...).
--
-- weeks_number now owns the authored week count; sessions_number keeps its name
-- and means only calendar sessions.
--
-- Run this against the curriculum database by hand. Not a Django migration.
-- Postgres syntax. Every statement is idempotent -- re-running is safe.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. The column. Nullable on purpose: NULL means "never split", and the
--    application falls back to the authored week rows for those.
-- ----------------------------------------------------------------------------
ALTER TABLE curriculum.modules
  ADD COLUMN IF NOT EXISTS weeks_number integer;


-- ----------------------------------------------------------------------------
-- 2. Backfill from the authored week rows, which are the one trustworthy
--    signal: they were never touched by the conflation.
-- ----------------------------------------------------------------------------
UPDATE curriculum.modules AS m
SET weeks_number = GREATEST(1, w.week_rows)
FROM (
  SELECT module_catalogue_id, COUNT(*) AS week_rows
  FROM curriculum.weeks
  WHERE deleted_at IS NULL
  GROUP BY module_catalogue_id
) AS w
WHERE m.module_catalogue_id = w.module_catalogue_id
  AND m.weeks_number IS NULL;


-- ----------------------------------------------------------------------------
-- 3. Modules with no weeks authored yet.
--
--    For these, the stored number IS the week count: the Edit module drawer's
--    "Weeks" field has been writing straight into sessions_number, which is the
--    whole bug. So it is carried across as-is rather than divided by the
--    delivery days -- dividing would turn a 5-week Mon+Thu module into 2 weeks.
-- ----------------------------------------------------------------------------
UPDATE curriculum.modules
SET weeks_number = GREATEST(1, sessions_number)
WHERE weeks_number IS NULL
  AND COALESCE(sessions_number, 0) > 0;


-- ----------------------------------------------------------------------------
-- 4. REPAIR: give sessions_number its real meaning back.
--
--    Every row whose sessions_number was actually a week count now understates
--    its sessions, so the session plan and the Teams series come out short. This
--    recomputes it as weeks x delivery days. A single-delivery-day module is
--    unchanged (x1), so only multi-day groups actually move.
-- ----------------------------------------------------------------------------
UPDATE curriculum.modules
SET sessions_number = weeks_number * COALESCE(
      array_length(
        array_remove(
          string_to_array(regexp_replace(COALESCE(session_week_day, ''), '\s', '', 'g'), ','),
          ''
        ),
        1
      ),
      1
    )
WHERE weeks_number IS NOT NULL
  AND weeks_number > 0
  AND sessions_number = weeks_number;


COMMIT;


-- ----------------------------------------------------------------------------
-- Verify: weeks and sessions should now differ exactly by the delivery days.
-- ----------------------------------------------------------------------------
-- SELECT module_catalogue_id,
--        title,
--        session_week_day,
--        weeks_number,
--        sessions_number,
--        (SELECT COUNT(*) FROM curriculum.weeks w
--          WHERE w.module_catalogue_id = m.module_catalogue_id
--            AND w.deleted_at IS NULL) AS authored_week_rows
-- FROM curriculum.modules m
-- ORDER BY updated_at DESC
-- LIMIT 25;
