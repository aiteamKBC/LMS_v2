-- England's bank holidays, as published by GOV.UK.
--
-- Source: https://www.gov.uk/bank-holidays.json -- the feed behind the
-- https://www.gov.uk/bank-holidays page. It carries three divisions; England
-- takes the 'england-and-wales' one, England and Wales sharing a single set of
-- bank holidays. The division is stored so a row states which set it came from.
--
-- Each event carries a title, a date, a notes field (only ever 'Substitute day',
-- marking a holiday moved because the real date fell on a weekend) and a bunting
-- flag (whether GOV.UK marks the day as a flag-flying one). All four are kept.
--
-- Keyed on (division, holiday_date): the feed never lists two events on the same
-- date within a division. fetched_at is the last time the feed still listed the
-- date, so it moves on every load; updated_at moves only when the holiday itself
-- changed. A stale load is the gap between the two.
--
-- This is reference data nobody here edits -- distinct from curriculum.holidays,
-- which holds this organisation's own authored closure periods.
--
-- The seed below is the feed as it stood on 2026-09-13: 83 holidays spanning
-- 2019-01-01 to 2028-12-26. Re-running refreshes a changed title/note rather than
-- duplicating the row. GOV.UK publishes a rolling window of roughly ten years,
-- so keep it current with:
--
--     python manage.py fetch_england_holidays --apply
--
-- Forward-only, idempotent, non-destructive. Safe to re-run.

BEGIN;

CREATE SCHEMA IF NOT EXISTS curriculum;

CREATE TABLE IF NOT EXISTS curriculum.england_holidays (
    id            varchar(128)  PRIMARY KEY,
    division      varchar(64)   NOT NULL DEFAULT 'england-and-wales',
    title         varchar(255)  NOT NULL,
    holiday_date  date          NOT NULL,
    notes         varchar(255)  NOT NULL DEFAULT '',
    bunting       boolean       NOT NULL DEFAULT false,
    fetched_at    timestamptz,
    created_at    timestamptz   NOT NULL DEFAULT now(),
    updated_at    timestamptz   NOT NULL DEFAULT now()
);

-- One row per date per division is the rule the feed itself follows, and it is
-- what makes the re-runnable upsert below safe.
CREATE UNIQUE INDEX IF NOT EXISTS england_holidays_division_date_idx
    ON curriculum.england_holidays (division, holiday_date);
-- Every read is "which bank holidays fall in this range", for scheduling.
CREATE INDEX IF NOT EXISTS england_holidays_date_idx
    ON curriculum.england_holidays (holiday_date);

INSERT INTO curriculum.england_holidays AS stored
    (id, division, title, holiday_date, notes, bunting, fetched_at)
VALUES
    ('england-and-wales:2019-01-01', 'england-and-wales', 'New Year’s Day', '2019-01-01', '', true, now()),
    ('england-and-wales:2019-04-19', 'england-and-wales', 'Good Friday', '2019-04-19', '', false, now()),
    ('england-and-wales:2019-04-22', 'england-and-wales', 'Easter Monday', '2019-04-22', '', true, now()),
    ('england-and-wales:2019-05-06', 'england-and-wales', 'Early May bank holiday', '2019-05-06', '', true, now()),
    ('england-and-wales:2019-05-27', 'england-and-wales', 'Spring bank holiday', '2019-05-27', '', true, now()),
    ('england-and-wales:2019-08-26', 'england-and-wales', 'Summer bank holiday', '2019-08-26', '', true, now()),
    ('england-and-wales:2019-12-25', 'england-and-wales', 'Christmas Day', '2019-12-25', '', true, now()),
    ('england-and-wales:2019-12-26', 'england-and-wales', 'Boxing Day', '2019-12-26', '', true, now()),
    ('england-and-wales:2020-01-01', 'england-and-wales', 'New Year’s Day', '2020-01-01', '', true, now()),
    ('england-and-wales:2020-04-10', 'england-and-wales', 'Good Friday', '2020-04-10', '', false, now()),
    ('england-and-wales:2020-04-13', 'england-and-wales', 'Easter Monday', '2020-04-13', '', false, now()),
    ('england-and-wales:2020-05-08', 'england-and-wales', 'Early May bank holiday (VE day)', '2020-05-08', '', true, now()),
    ('england-and-wales:2020-05-25', 'england-and-wales', 'Spring bank holiday', '2020-05-25', '', true, now()),
    ('england-and-wales:2020-08-31', 'england-and-wales', 'Summer bank holiday', '2020-08-31', '', true, now()),
    ('england-and-wales:2020-12-25', 'england-and-wales', 'Christmas Day', '2020-12-25', '', true, now()),
    ('england-and-wales:2020-12-28', 'england-and-wales', 'Boxing Day', '2020-12-28', 'Substitute day', true, now()),
    ('england-and-wales:2021-01-01', 'england-and-wales', 'New Year’s Day', '2021-01-01', '', true, now()),
    ('england-and-wales:2021-04-02', 'england-and-wales', 'Good Friday', '2021-04-02', '', false, now()),
    ('england-and-wales:2021-04-05', 'england-and-wales', 'Easter Monday', '2021-04-05', '', true, now()),
    ('england-and-wales:2021-05-03', 'england-and-wales', 'Early May bank holiday', '2021-05-03', '', true, now()),
    ('england-and-wales:2021-05-31', 'england-and-wales', 'Spring bank holiday', '2021-05-31', '', true, now()),
    ('england-and-wales:2021-08-30', 'england-and-wales', 'Summer bank holiday', '2021-08-30', '', true, now()),
    ('england-and-wales:2021-12-27', 'england-and-wales', 'Christmas Day', '2021-12-27', 'Substitute day', true, now()),
    ('england-and-wales:2021-12-28', 'england-and-wales', 'Boxing Day', '2021-12-28', 'Substitute day', true, now()),
    ('england-and-wales:2022-01-03', 'england-and-wales', 'New Year’s Day', '2022-01-03', 'Substitute day', true, now()),
    ('england-and-wales:2022-04-15', 'england-and-wales', 'Good Friday', '2022-04-15', '', false, now()),
    ('england-and-wales:2022-04-18', 'england-and-wales', 'Easter Monday', '2022-04-18', '', true, now()),
    ('england-and-wales:2022-05-02', 'england-and-wales', 'Early May bank holiday', '2022-05-02', '', true, now()),
    ('england-and-wales:2022-06-02', 'england-and-wales', 'Spring bank holiday', '2022-06-02', '', true, now()),
    ('england-and-wales:2022-06-03', 'england-and-wales', 'Platinum Jubilee bank holiday', '2022-06-03', '', true, now()),
    ('england-and-wales:2022-08-29', 'england-and-wales', 'Summer bank holiday', '2022-08-29', '', true, now()),
    ('england-and-wales:2022-09-19', 'england-and-wales', 'Bank Holiday for the State Funeral of Queen Elizabeth II', '2022-09-19', '', false, now()),
    ('england-and-wales:2022-12-26', 'england-and-wales', 'Boxing Day', '2022-12-26', '', true, now()),
    ('england-and-wales:2022-12-27', 'england-and-wales', 'Christmas Day', '2022-12-27', 'Substitute day', true, now()),
    ('england-and-wales:2023-01-02', 'england-and-wales', 'New Year’s Day', '2023-01-02', 'Substitute day', true, now()),
    ('england-and-wales:2023-04-07', 'england-and-wales', 'Good Friday', '2023-04-07', '', false, now()),
    ('england-and-wales:2023-04-10', 'england-and-wales', 'Easter Monday', '2023-04-10', '', true, now()),
    ('england-and-wales:2023-05-01', 'england-and-wales', 'Early May bank holiday', '2023-05-01', '', true, now()),
    ('england-and-wales:2023-05-08', 'england-and-wales', 'Bank holiday for the coronation of King Charles III', '2023-05-08', '', true, now()),
    ('england-and-wales:2023-05-29', 'england-and-wales', 'Spring bank holiday', '2023-05-29', '', true, now()),
    ('england-and-wales:2023-08-28', 'england-and-wales', 'Summer bank holiday', '2023-08-28', '', true, now()),
    ('england-and-wales:2023-12-25', 'england-and-wales', 'Christmas Day', '2023-12-25', '', true, now()),
    ('england-and-wales:2023-12-26', 'england-and-wales', 'Boxing Day', '2023-12-26', '', true, now()),
    ('england-and-wales:2024-01-01', 'england-and-wales', 'New Year’s Day', '2024-01-01', '', true, now()),
    ('england-and-wales:2024-03-29', 'england-and-wales', 'Good Friday', '2024-03-29', '', false, now()),
    ('england-and-wales:2024-04-01', 'england-and-wales', 'Easter Monday', '2024-04-01', '', true, now()),
    ('england-and-wales:2024-05-06', 'england-and-wales', 'Early May bank holiday', '2024-05-06', '', true, now()),
    ('england-and-wales:2024-05-27', 'england-and-wales', 'Spring bank holiday', '2024-05-27', '', true, now()),
    ('england-and-wales:2024-08-26', 'england-and-wales', 'Summer bank holiday', '2024-08-26', '', true, now()),
    ('england-and-wales:2024-12-25', 'england-and-wales', 'Christmas Day', '2024-12-25', '', true, now()),
    ('england-and-wales:2024-12-26', 'england-and-wales', 'Boxing Day', '2024-12-26', '', true, now()),
    ('england-and-wales:2025-01-01', 'england-and-wales', 'New Year’s Day', '2025-01-01', '', true, now()),
    ('england-and-wales:2025-04-18', 'england-and-wales', 'Good Friday', '2025-04-18', '', false, now()),
    ('england-and-wales:2025-04-21', 'england-and-wales', 'Easter Monday', '2025-04-21', '', true, now()),
    ('england-and-wales:2025-05-05', 'england-and-wales', 'Early May bank holiday', '2025-05-05', '', true, now()),
    ('england-and-wales:2025-05-26', 'england-and-wales', 'Spring bank holiday', '2025-05-26', '', true, now()),
    ('england-and-wales:2025-08-25', 'england-and-wales', 'Summer bank holiday', '2025-08-25', '', true, now()),
    ('england-and-wales:2025-12-25', 'england-and-wales', 'Christmas Day', '2025-12-25', '', true, now()),
    ('england-and-wales:2025-12-26', 'england-and-wales', 'Boxing Day', '2025-12-26', '', true, now()),
    ('england-and-wales:2026-01-01', 'england-and-wales', 'New Year’s Day', '2026-01-01', '', true, now()),
    ('england-and-wales:2026-04-03', 'england-and-wales', 'Good Friday', '2026-04-03', '', false, now()),
    ('england-and-wales:2026-04-06', 'england-and-wales', 'Easter Monday', '2026-04-06', '', true, now()),
    ('england-and-wales:2026-05-04', 'england-and-wales', 'Early May bank holiday', '2026-05-04', '', true, now()),
    ('england-and-wales:2026-05-25', 'england-and-wales', 'Spring bank holiday', '2026-05-25', '', true, now()),
    ('england-and-wales:2026-08-31', 'england-and-wales', 'Summer bank holiday', '2026-08-31', '', true, now()),
    ('england-and-wales:2026-12-25', 'england-and-wales', 'Christmas Day', '2026-12-25', '', true, now()),
    ('england-and-wales:2026-12-28', 'england-and-wales', 'Boxing Day', '2026-12-28', 'Substitute day', true, now()),
    ('england-and-wales:2027-01-01', 'england-and-wales', 'New Year’s Day', '2027-01-01', '', true, now()),
    ('england-and-wales:2027-03-26', 'england-and-wales', 'Good Friday', '2027-03-26', '', false, now()),
    ('england-and-wales:2027-03-29', 'england-and-wales', 'Easter Monday', '2027-03-29', '', true, now()),
    ('england-and-wales:2027-05-03', 'england-and-wales', 'Early May bank holiday', '2027-05-03', '', true, now()),
    ('england-and-wales:2027-05-31', 'england-and-wales', 'Spring bank holiday', '2027-05-31', '', true, now()),
    ('england-and-wales:2027-08-30', 'england-and-wales', 'Summer bank holiday', '2027-08-30', '', true, now()),
    ('england-and-wales:2027-12-27', 'england-and-wales', 'Christmas Day', '2027-12-27', 'Substitute day', true, now()),
    ('england-and-wales:2027-12-28', 'england-and-wales', 'Boxing Day', '2027-12-28', 'Substitute day', true, now()),
    ('england-and-wales:2028-01-03', 'england-and-wales', 'New Year’s Day', '2028-01-03', 'Substitute day', true, now()),
    ('england-and-wales:2028-04-14', 'england-and-wales', 'Good Friday', '2028-04-14', '', false, now()),
    ('england-and-wales:2028-04-17', 'england-and-wales', 'Easter Monday', '2028-04-17', '', true, now()),
    ('england-and-wales:2028-05-01', 'england-and-wales', 'Early May bank holiday', '2028-05-01', '', true, now()),
    ('england-and-wales:2028-05-29', 'england-and-wales', 'Spring bank holiday', '2028-05-29', '', true, now()),
    ('england-and-wales:2028-08-28', 'england-and-wales', 'Summer bank holiday', '2028-08-28', '', true, now()),
    ('england-and-wales:2028-12-25', 'england-and-wales', 'Christmas Day', '2028-12-25', '', true, now()),
    ('england-and-wales:2028-12-26', 'england-and-wales', 'Boxing Day', '2028-12-26', '', true, now())
ON CONFLICT (division, holiday_date) DO UPDATE
    SET title      = EXCLUDED.title,
        notes      = EXCLUDED.notes,
        bunting    = EXCLUDED.bunting,
        -- The feed still lists this date, whether or not anything about it moved.
        fetched_at = now(),
        updated_at = CASE
            WHEN stored.title   IS DISTINCT FROM EXCLUDED.title
              OR stored.notes   IS DISTINCT FROM EXCLUDED.notes
              OR stored.bunting IS DISTINCT FROM EXCLUDED.bunting
            THEN now()
            ELSE stored.updated_at
        END;

COMMIT;
