-- Owner-run SQL only; no Django migration.
--
-- A saved, not-yet-created "Create Teams calendar" form, one per module.
-- "Save draft" in the create dialog writes the form here so it can be closed
-- and finished later, by the same person or another member of staff. Saving a
-- draft never calls Microsoft and sends no email; only Create does that, and a
-- successful Create removes the module's draft.
--
-- Creates one new, empty table. No existing table is altered and nothing is
-- backfilled: no module has a draft until someone saves one. Takes no lock on
-- any existing relation.
--
-- Until this is applied, Save draft answers that drafts are unavailable and
-- the dialog behaves exactly as before; Create is unaffected.
CREATE TABLE IF NOT EXISTS curriculum.teams_calendar_create_drafts (
    module_key varchar(300) PRIMARY KEY,
    form jsonb NOT NULL,
    updated_by_email varchar(254) NOT NULL DEFAULT '',
    updated_by_name varchar(254) NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Read-only verification (run separately after creation).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'curriculum' AND table_name = 'teams_calendar_create_drafts'
ORDER BY ordinal_position;
