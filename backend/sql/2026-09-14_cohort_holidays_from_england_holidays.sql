-- Cohort holidays move from the authored `curriculum.holidays` table to
-- `curriculum.england_holidays`.
--
-- Curriculum used to keep its own closure periods -- "Summer Break 26",
-- "Workshop Oct", "Fanar 3" -- in curriculum.holidays, and a cohort ticked the
-- ones that applied to it. That selection lived in curriculum.cohorts.holiday_ids
-- as a list of numeric keys into that table.
--
-- Holidays are now England's published bank holidays and nothing else, and a
-- cohort no longer picks them: it takes every bank holiday that falls inside its
-- own start_date..end_date. So the stored selection is not a selection any more,
-- it is a record of what those dates resolve to, and the old numeric ids point
-- at rows nothing reads.
--
-- This rewrites those four columns for every cohort from the cohort's own dates.
-- curriculum.holidays itself is left completely alone: it is not read by any
-- code path after this change, and dropping a table holding four years of
-- authored closure dates is not something a forward-only migration should do
-- on its own. Archive or drop it deliberately, once you are satisfied nothing
-- outside this repository reads it.
--
-- The application derives these same four values on every read (see
-- serialize_cohort_authoring_detail), so nothing depends on this having run --
-- it is here so the table itself tells the truth to anything reading it
-- directly: a report, a query, a person looking.
--
-- Forward-only, idempotent, non-destructive to any other column. Safe to re-run,
-- and worth re-running after a bulk change to cohort dates.

BEGIN;

WITH cohort_holidays AS (
    SELECT
        c.cohort_id,
        -- The delivery period. end_date is the practical end, not the end of the
        -- EPA window that follows it, which is the window the application uses.
        -- A cohort with no end date recorded falls back to its contracted
        -- duration: start + duration months, minus a day, the same rule
        -- calculate_cohort_end_date applies.
        COALESCE(
            c.end_date,
            CASE
                WHEN c.start_date IS NOT NULL AND c.duration_months > 0
                THEN (c.start_date + make_interval(months => c.duration_months) - INTERVAL '1 day')::date
            END
        ) AS period_end,
        h.id,
        h.title,
        h.holiday_date
    FROM curriculum.cohorts c
    JOIN curriculum.england_holidays h
      ON h.holiday_date >= c.start_date
    WHERE c.start_date IS NOT NULL
),
in_period AS (
    SELECT cohort_id, id, title, holiday_date
    FROM cohort_holidays
    WHERE period_end IS NOT NULL
      AND holiday_date <= period_end
),
-- One row per cohort carrying its holidays, already in date order. Serialized
-- in the shape serialize_holiday_row returns, because that is what every reader
-- of selected_holidays / holidays_in_range expects: a bank holiday is a one-day
-- period, so startDate and endDate are the same date.
rolled AS (
    SELECT
        cohort_id,
        jsonb_agg(id ORDER BY holiday_date, title) AS holiday_ids,
        jsonb_agg(
            jsonb_build_object(
                'id', id,
                'label', title,
                'startDate', to_char(holiday_date, 'YYYY-MM-DD'),
                'endDate', to_char(holiday_date, 'YYYY-MM-DD'),
                'type', 'Bank holiday',
                'color', '#91d64c'
            )
            ORDER BY holiday_date, title
        ) AS holidays,
        count(*) AS in_range
    FROM in_period
    GROUP BY cohort_id
),
total AS (SELECT count(*) AS global FROM curriculum.england_holidays)
UPDATE curriculum.cohorts c
   SET holiday_ids      = COALESCE(r.holiday_ids, '[]'::jsonb),
       selected_holidays = COALESCE(r.holidays, '[]'::jsonb),
       holidays_in_range = COALESCE(r.holidays, '[]'::jsonb),
       holiday_summary   = jsonb_build_object(
           'global', (SELECT global FROM total),
           'inRange', COALESCE(r.in_range, 0),
           'selected', COALESCE(r.in_range, 0)
       ),
       updated_at = now()
  FROM (SELECT cohort_id FROM curriculum.cohorts) ids
  LEFT JOIN rolled r ON r.cohort_id = ids.cohort_id
 WHERE c.cohort_id = ids.cohort_id
   -- Only touch a cohort whose stored answer is actually wrong, so a re-run is
   -- a no-op and updated_at stays meaningful.
   AND (
        c.holiday_ids IS DISTINCT FROM COALESCE(r.holiday_ids, '[]'::jsonb)
     OR c.selected_holidays IS DISTINCT FROM COALESCE(r.holidays, '[]'::jsonb)
     OR c.holidays_in_range IS DISTINCT FROM COALESCE(r.holidays, '[]'::jsonb)
   );

COMMIT;
