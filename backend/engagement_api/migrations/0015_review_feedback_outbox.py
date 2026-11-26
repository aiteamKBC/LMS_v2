"""Capture imported Review changes without scanning or assigning feedback."""
from django.db import migrations


SQL = r'''
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
BEGIN
  IF to_regclass('"Learner".reviews') IS NULL THEN
    RAISE EXCEPTION 'Review source table is missing';
  END IF;
  IF to_regclass('"Feedback".review_feedback_outbox') IS NOT NULL
     AND obj_description(to_regclass('"Feedback".review_feedback_outbox'), 'pg_class')
         IS DISTINCT FROM 'LMS review feedback change outbox v1' THEN
    RAISE EXCEPTION 'An unrecognized review feedback outbox already exists';
  END IF;
END;
$$;
CREATE TABLE IF NOT EXISTS "Feedback".review_feedback_outbox (
  source_review_id bigint PRIMARY KEY,
  requested_version bigint NOT NULL DEFAULT 1 CHECK (requested_version > 0),
  processed_version bigint NOT NULL DEFAULT 0,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  processed_at timestamptz,
  CHECK (processed_version >= 0 AND processed_version <= requested_version)
);
COMMENT ON TABLE "Feedback".review_feedback_outbox IS
  'LMS review feedback change outbox v1';
CREATE INDEX IF NOT EXISTS review_feedback_outbox_pending_idx
  ON "Feedback".review_feedback_outbox (requested_at, source_review_id)
  WHERE processed_version < requested_version;
REVOKE ALL ON "Feedback".review_feedback_outbox FROM PUBLIC;

DO $$
BEGIN
  IF to_regprocedure('"Feedback".capture_review_feedback_change()') IS NOT NULL
     AND obj_description(to_regprocedure('"Feedback".capture_review_feedback_change()'), 'pg_proc')
         IS DISTINCT FROM 'LMS review feedback change capture v1' THEN
    RAISE EXCEPTION 'An unrecognized review feedback trigger function already exists';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION "Feedback".capture_review_feedback_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  INSERT INTO "Feedback".review_feedback_outbox AS pending
      (source_review_id, requested_version, requested_at)
  VALUES (NEW.id, 1, clock_timestamp())
  ON CONFLICT (source_review_id) DO UPDATE SET
      requested_version = pending.requested_version + 1,
      requested_at = EXCLUDED.requested_at;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION "Feedback".capture_review_feedback_change() IS
  'LMS review feedback change capture v1';
REVOKE ALL ON FUNCTION "Feedback".capture_review_feedback_change() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='"Learner".reviews'::regclass
             AND tgname IN ('review_feedback_capture_insert','review_feedback_capture_update')
             AND (tgfoid <> '"Feedback".capture_review_feedback_change()'::regprocedure
                  OR tgisinternal)) THEN
    RAISE EXCEPTION 'An unrelated trigger uses a review feedback capture name';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='"Learner".reviews'::regclass
                 AND tgname='review_feedback_capture_insert') THEN
    CREATE TRIGGER review_feedback_capture_insert
    AFTER INSERT ON "Learner".reviews FOR EACH ROW
    WHEN (NEW.completed_date IS NOT NULL)
    EXECUTE FUNCTION "Feedback".capture_review_feedback_change();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='"Learner".reviews'::regclass
                 AND tgname='review_feedback_capture_update') THEN
    CREATE TRIGGER review_feedback_capture_update
    AFTER UPDATE OF status, completed_date ON "Learner".reviews FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.completed_date IS DISTINCT FROM NEW.completed_date)
    EXECUTE FUNCTION "Feedback".capture_review_feedback_change();
  END IF;
END;
$$;
'''

# Stop capturing without dropping queued work or needing ownership of the source
# table. Reapplying the forward migration restores capture and preserves versions.
DISABLE_SQL = r'''
SET LOCAL lock_timeout = '3s';
CREATE OR REPLACE FUNCTION "Feedback".capture_review_feedback_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$ BEGIN RETURN NEW; END; $$;
COMMENT ON FUNCTION "Feedback".capture_review_feedback_change() IS
  'LMS review feedback change capture v1';
REVOKE ALL ON FUNCTION "Feedback".capture_review_feedback_change() FROM PUBLIC;
'''


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Review feedback capture requires the canonical PostgreSQL default database.')
    schema_editor.execute(SQL, params=None)


def disable(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Review feedback capture requires the canonical PostgreSQL default database.')
    schema_editor.execute(DISABLE_SQL, params=None)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0014_feedback_email_ticket_close')]
    operations = [migrations.RunPython(install, disable)]
