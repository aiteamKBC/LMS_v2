-- Live Sessions Feedback: enforce the existing form-creation boundary.
-- Matches engagement_api migration 0007_feedback_lecture_creation_guard.
-- Schema only: no rows, responses or attendance are changed. Safe to rerun.
-- Manual application does not mark the Django migration as applied.
-- Deploy the reviewed rejection handler first, then prefer the Django migration
-- on the verified canonical database. Older writers are still blocked, but may
-- abort their feedback batch at the first rejected occurrence.
-- Before applying: save the existing definitions of the named trigger/function.
-- Rollback: reverse migration 0007 (to 0006); only this guard is removed.
-- This prevents new invalid deliveries; it does not delete historical rows.
-- Application logs: feedback_delivery_audit; database logs: feedback_lecture_creation_guard.
-- Older untagged writers have no host/PID/code identity in the writer field.
BEGIN;

CREATE OR REPLACE FUNCTION "Feedback".guard_lecture_delivery_creation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $guard$
DECLARE
    target_type text;
    form_created_at timestamptz;
    diagnostic text;
BEGIN
    -- Historical rows and responses are not rewritten. Unchanged identity/date
    -- fields on an UPDATE do not retrospectively validate a legacy delivery.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.form_id IS NOT DISTINCT FROM OLD.form_id
           AND NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at
           AND NEW.occurrence_key IS NOT DISTINCT FROM OLD.occurrence_key THEN
            RETURN NEW;
        END IF;
    END IF;

    SELECT f.form_type, f.created_at INTO target_type, form_created_at
      FROM "Feedback".feedback_forms f WHERE f.id = NEW.form_id;
    -- Missing forms retain the existing foreign-key error. Other feedback
    -- types keep their own eligibility rules.
    IF NOT FOUND OR target_type <> 'post_lecture' THEN
        RETURN NEW;
    END IF;

    IF NEW.starts_at IS NULL OR form_created_at IS NULL OR NEW.starts_at < form_created_at THEN
        diagnostic := jsonb_build_object(
            'event', 'feedback_lecture_creation_rejected',
            'form_id', NEW.form_id,
            'occurrence_fingerprint', md5(coalesce(NEW.occurrence_key, '')),
            'starts_at', NEW.starts_at,
            'form_created_at', form_created_at,
            'backend_pid', pg_backend_pid(),
            'application', left(current_setting('application_name', true), 100),
            'writer', left(current_setting('feedback.writer_context', true), 1000)
        )::text;
        -- A table insert in this transaction would roll back with the rejection.
        -- Server logging survives rollback; no learner/answer fields are logged.
        RAISE LOG 'feedback_lecture_creation_guard %', diagnostic;
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'feedback_lecture_creation_guard',
            SCHEMA = 'Feedback', TABLE = 'feedback_deliveries',
            MESSAGE = 'Live Sessions Feedback requires a lecture starting at or after form creation.',
            DETAIL = diagnostic;
    END IF;
    RETURN NEW;
END;
$guard$;

CREATE OR REPLACE TRIGGER feedback_lecture_creation_guard
BEFORE INSERT OR UPDATE OF form_id, starts_at, occurrence_key ON "Feedback".feedback_deliveries
FOR EACH ROW EXECUTE FUNCTION "Feedback".guard_lecture_delivery_creation();

COMMIT;

-- Read-only verification.
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgrelid = '"Feedback".feedback_deliveries'::regclass
  AND tgname = 'feedback_lecture_creation_guard';
