"""Persist effective delivery periods without rewriting attendance evidence."""
from importlib import import_module

from django.db import connections, migrations


SQL = '''
CREATE TABLE IF NOT EXISTS "Learner".attendance_preferences (
    learner_id bigint PRIMARY KEY REFERENCES enrolment."Created_users"(id) ON DELETE CASCADE,
    mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'lazy')),
    requested_mode text CHECK (requested_mode = 'lazy'),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'approved', 'declined')),
    request_id uuid,
    manager_email text NOT NULL DEFAULT '',
    email_sent boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'pending') = (requested_mode IS NOT NULL AND request_id IS NOT NULL))
);
CREATE TABLE "Learner".attendance_mode_changes (
    id bigserial PRIMARY KEY,
    learner_id bigint NOT NULL REFERENCES enrolment."Created_users"(id) ON DELETE CASCADE,
    previous_mode text NOT NULL CHECK (previous_mode IN ('live', 'lazy')),
    mode text NOT NULL CHECK (mode IN ('live', 'lazy')),
    effective_at timestamptz NOT NULL,
    inferred boolean NOT NULL DEFAULT false
);
CREATE INDEX attendance_mode_changes_learner_time
    ON "Learner".attendance_mode_changes (learner_id, effective_at, id);
CREATE FUNCTION "Learner".record_attendance_mode_change() RETURNS trigger
LANGUAGE plpgsql AS $body$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO "Learner".attendance_mode_changes (learner_id, previous_mode, mode, effective_at)
        VALUES (NEW.learner_id, NEW.mode, NEW.mode, clock_timestamp());
    ELSIF OLD.mode IS DISTINCT FROM NEW.mode THEN
        INSERT INTO "Learner".attendance_mode_changes (learner_id, previous_mode, mode, effective_at)
        VALUES (NEW.learner_id, OLD.mode, NEW.mode, clock_timestamp());
    END IF;
    RETURN NEW;
END;
$body$;
CREATE TRIGGER attendance_mode_change_history
    AFTER INSERT OR UPDATE OF mode ON "Learner".attendance_preferences
    FOR EACH ROW EXECUTE FUNCTION "Learner".record_attendance_mode_change();
'''


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    identity = import_module('learner_api.migrations.0024_activity_timing_drafts')._database_identity
    if connection.alias != 'default' or identity(connection) != identity(connections['enrolment']):
        raise RuntimeError('Verify default and enrolment target the same database before installing attendance history.')
    schema_editor.execute("SET LOCAL lock_timeout = '5s'")
    schema_editor.execute(SQL)


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0027_free_course_progress_state')]
    operations = [migrations.RunPython(install, hints={'learner_schema_migration': True})]
