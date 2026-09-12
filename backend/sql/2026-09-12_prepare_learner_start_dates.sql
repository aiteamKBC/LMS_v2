-- Run manually in the Neon SQL Editor after installing the invitation gate.
-- Optional persistence of the same dates now resolved read-only by the app.
-- Does not activate learners, create accounts, send invitations, or change plans.
-- Existing individual dates and ambiguous cohort matches are left alone.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

WITH cohorts AS (
    SELECT lower(btrim(programme_name)) AS programme,
           lower(btrim(cohort_name)) AS cohort,
           min(start_date) AS start_date
    FROM curriculum.cohorts
    GROUP BY lower(btrim(programme_name)), lower(btrim(cohort_name))
    HAVING count(*) = 1
), prepared AS (
    UPDATE enrolment."Created_users" AS u
    SET "Start_date" = c.start_date::text
    FROM cohorts AS c
    WHERE u."Learner_type" = 'commercial'
      AND u."Programme_status" = 'Delivery'
      AND nullif(btrim(u."Start_date"), '') IS NULL
      AND lower(btrim(u."Programme")) = c.programme
      AND lower(btrim(u."Cohort")) = c.cohort
      AND c.start_date IS NOT NULL
    RETURNING u.id
)
SELECT count(*) AS enrolment_start_dates_filled FROM prepared;

WITH prepared AS (
    UPDATE "Learner".learners AS l
    SET start_date = btrim(u."Start_date")::date,
        updated_at = CURRENT_TIMESTAMP
    FROM enrolment."Created_users" AS u
    WHERE l.enrolment_id = u.id
      AND u."Learner_type" = 'commercial'
      AND l.start_date IS NULL
      AND btrim(u."Start_date") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    RETURNING l.id
)
SELECT count(*) AS profile_start_dates_filled FROM prepared;

SELECT "Programme_status", count(*) AS learners
FROM enrolment."Created_users"
WHERE "Learner_type" = 'commercial'
GROUP BY "Programme_status"
ORDER BY "Programme_status";
COMMIT;
