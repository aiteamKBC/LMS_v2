-- The record of every check against GOV.UK's bank holiday feed.
--
-- curriculum.england_holidays is a mirror of https://www.gov.uk/bank-holidays.json.
-- A mirror that silently repairs itself answers "are these dates current?" but
-- not "what changed, and when?" -- and a bank holiday moving is exactly the kind
-- of thing a curriculum designer has to know about, because every cohort inside
-- that date is rescheduled around it.
--
-- So every check writes a row here, whether or not it found anything: the empty
-- ones are what let the England Holidays page say "checked today, nothing moved"
-- rather than leaving the last real change looking like the last check. `added`
-- and `changed` carry the holidays themselves, as JSON, so the page can name
-- them without re-reading the feed.
--
-- `source` says what triggered the check:
--   auto    -- the background refresh, at most once per interval (24h default)
--   manual  -- someone pressed "Check GOV.UK now"
--   command -- python manage.py fetch_england_holidays
--
-- `status` is 'ok' when the feed was read, 'error' when it could not be (the
-- reason is in `message`). A failed check is kept deliberately: "we have not
-- reached GOV.UK since Tuesday" is the thing worth seeing.
--
-- JSON is stored as text rather than jsonb: nothing queries inside these two
-- columns, they are read whole by the page, and text keeps the table identical
-- on SQLite, where the tests run.
--
-- Forward-only, idempotent, non-destructive. Safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS curriculum;

CREATE TABLE IF NOT EXISTS curriculum.england_holiday_syncs (
    id             varchar(64)  PRIMARY KEY,
    checked_at     timestamptz  NOT NULL DEFAULT now(),
    source         varchar(32)  NOT NULL DEFAULT 'auto',
    status         varchar(32)  NOT NULL DEFAULT 'ok',
    feed_count     integer      NOT NULL DEFAULT 0,
    added_count    integer      NOT NULL DEFAULT 0,
    changed_count  integer      NOT NULL DEFAULT 0,
    added          text         NOT NULL DEFAULT '[]',
    changed        text         NOT NULL DEFAULT '[]',
    message        text         NOT NULL DEFAULT ''
);

-- Every read is "the most recent checks, newest first", and the auto-refresh
-- asks for the single newest one on the way past.
CREATE INDEX IF NOT EXISTS england_holiday_syncs_checked_at_idx
    ON curriculum.england_holiday_syncs (checked_at DESC);

COMMIT;
