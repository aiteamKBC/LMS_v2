-- This organisation's own closure periods: curriculum.holidays.
--
-- The other half of the holiday calendar. curriculum.england_holidays mirrors
-- the bank holidays GOV.UK publishes -- single dates, nobody here authors them.
-- This table holds the closures this college decides for itself: the Christmas
-- shutdown, a half term, an exam week, a staff training day. Unlike a bank
-- holiday, one of these usually spans a RANGE of dates, which is why it carries
-- both start_date and end_date.
--
-- A single-day closure is stored with end_date equal to start_date rather than
-- null, so every reader measures a period and no reader has to special-case
-- "one day" (see holiday_date_payload in views.py).
--
-- `type` and `color` are the holiday's category as it is shown on the calendar
-- -- "College closure", "Exam week" -- and the colour its chip takes. The type
-- is plain text held on the holiday itself rather than a row in a types table:
-- a type with no holiday carrying it has nothing to say, and renaming one is a
-- rewrite of the holidays that carry it. The Holidays page does exactly that.
--
-- `is_archived` is how a closure period stops applying without being forgotten:
-- an archived holiday no longer shifts future session dates, while the sessions
-- already generated around it keep their dates and the record of why.
--
-- Most environments already have this table -- it predates the GOV.UK mirror and
-- was left in place when cohorts moved onto bank holidays. This file is written
-- for the ones that do not, and to guarantee the columns the Holidays page
-- writes are all present on the ones that do.
--
-- Forward-only, idempotent, non-destructive. Safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS curriculum;

CREATE TABLE IF NOT EXISTS curriculum.holidays (
    id           bigserial     PRIMARY KEY,
    label        varchar(255)  NOT NULL DEFAULT '',
    start_date   date,
    end_date     date,
    type         varchar(128)  NOT NULL DEFAULT '',
    color        varchar(32)   NOT NULL DEFAULT '',
    notes        text,
    is_archived  boolean       NOT NULL DEFAULT false,
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now()
);

-- The columns the Holidays page writes, added to a table that predates them.
-- Each is a no-op where it is already there.
ALTER TABLE curriculum.holidays ADD COLUMN IF NOT EXISTS type        varchar(128) NOT NULL DEFAULT '';
ALTER TABLE curriculum.holidays ADD COLUMN IF NOT EXISTS color       varchar(32)  NOT NULL DEFAULT '';
ALTER TABLE curriculum.holidays ADD COLUMN IF NOT EXISTS notes       text;
ALTER TABLE curriculum.holidays ADD COLUMN IF NOT EXISTS is_archived boolean      NOT NULL DEFAULT false;
ALTER TABLE curriculum.holidays ADD COLUMN IF NOT EXISTS created_at  timestamptz  NOT NULL DEFAULT now();
ALTER TABLE curriculum.holidays ADD COLUMN IF NOT EXISTS updated_at  timestamptz  NOT NULL DEFAULT now();

-- Every read is "which holidays fall in this cohort's period", the same question
-- the bank holiday table is indexed for.
CREATE INDEX IF NOT EXISTS holidays_start_date_idx ON curriculum.holidays (start_date);
CREATE INDEX IF NOT EXISTS holidays_end_date_idx   ON curriculum.holidays (end_date);

-- A single-day closure left with a null end date reads as an open-ended one to
-- anything that takes end_date at face value. Close them against their own start.
UPDATE curriculum.holidays
   SET end_date = start_date
 WHERE end_date IS NULL
   AND start_date IS NOT NULL;

COMMIT;
