-- Run in one transaction on the verified target database.
-- Preserve the installed view's current joins, formula, columns and permissions.
-- Both timestamps describe the live projection's query time. Snapshot history
-- remains in Learner.learner_target_hours_daily; no source rows are updated.

DO $timestamps$
DECLARE
    view_definition text;
    old_projection text := E'    calculated_at,\n    COALESCE(updated_at, now()) AS updated_at';
    new_projection text := E'    statement_timestamp() AS calculated_at,\n    statement_timestamp() AS updated_at';
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'Learner'
          AND c.relname = 'learner_target_hours_current'
          AND c.relkind = 'v'
    ) THEN
        RAISE EXCEPTION 'Expected Learner.learner_target_hours_current to be an ordinary view';
    END IF;

    SELECT pg_get_viewdef('"Learner".learner_target_hours_current'::regclass, true)
    INTO view_definition;

    IF strpos(view_definition, old_projection) > 0 THEN
        EXECUTE format(
            'CREATE OR REPLACE VIEW %I.%I AS %s',
            'Learner', 'learner_target_hours_current',
            replace(view_definition, old_projection, new_projection)
        );
    ELSIF strpos(view_definition, new_projection) = 0 THEN
        RAISE EXCEPTION 'Unexpected target-hours timestamp projection; inspect the installed view before applying';
    END IF;
END
$timestamps$;

COMMENT ON COLUMN "Learner"."learner_target_hours_current".calculated_at IS
    'Time the current view query began. Historical snapshot calculation times remain in learner_target_hours_daily.';

COMMENT ON COLUMN "Learner"."learner_target_hours_current".updated_at IS
    'Time the current view query began; not the last write to source data. Historical snapshot update times remain in learner_target_hours_daily.';
