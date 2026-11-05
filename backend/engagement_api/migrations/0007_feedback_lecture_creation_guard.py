"""Enforce the existing lecture/form creation boundary for every database writer."""
from django.db import migrations


SQL = '''
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
'''

REVERSE_SQL = '''
DROP TRIGGER IF EXISTS feedback_lecture_creation_guard ON "Feedback".feedback_deliveries;
DROP FUNCTION IF EXISTS "Feedback".guard_lecture_delivery_creation();
'''


def _execute(schema_editor, sql):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Isolated unit suites do not implement the unmanaged schema.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Feedback guard requires the canonical PostgreSQL default database.')
    schema_editor.execute(sql, params=None)


def install(apps, schema_editor):
    _execute(schema_editor, SQL)


def uninstall(apps, schema_editor):
    _execute(schema_editor, REVERSE_SQL)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0006_module_feedback')]
    operations = [migrations.RunPython(install, uninstall)]
