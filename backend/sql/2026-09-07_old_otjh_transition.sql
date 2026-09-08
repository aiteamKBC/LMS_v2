-- Run manually in Neon SQL Editor before enabling OLD_OTJH_ENABLED.
-- Metadata only: existing activity, document, signoff and finalization tables
-- are not altered. No triggers or foreign keys constrain external source edits.
BEGIN;
CREATE TABLE IF NOT EXISTS "Audit".learner_transitions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    learner_id integer NOT NULL UNIQUE,
    aptem_id bigint NOT NULL UNIQUE CHECK (aptem_id > 0),
    cutoff_date date NOT NULL DEFAULT DATE '2026-08-31'
        CHECK (cutoff_date = DATE '2026-08-31'),
    required_months jsonb NOT NULL CHECK (jsonb_typeof(required_months) = 'array'),
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "Audit".learner_transition_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    transition_id bigint NOT NULL REFERENCES "Audit".learner_transitions(id),
    report_month text CHECK (report_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    event_type text NOT NULL CHECK (event_type IN
        ('started','signed','completed','reopened','months_refreshed')),
    actor_id bigint NOT NULL,
    actor_role text NOT NULL CHECK (actor_role IN ('learner','coach','admin')),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learner_transition_events_scope_idx
    ON "Audit".learner_transition_events (transition_id, id DESC);
COMMIT;
