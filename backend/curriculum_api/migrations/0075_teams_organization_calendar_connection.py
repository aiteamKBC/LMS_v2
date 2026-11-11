"""Encrypted, administrator-managed delegation for original group calendars."""
from django.db import migrations


CREATE_SQL = '''CREATE TABLE IF NOT EXISTS curriculum.teams_organization_calendar_connections (
    tenant_id text NOT NULL,
    client_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'reauth_required', 'disconnected')),
    revision text NOT NULL,
    credential_ciphertext text,
    connected_by text NOT NULL,
    updated_by text NOT NULL,
    last_error_code text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, client_id)
)'''


def create_connection_table(apps, schema_editor):
    if schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(CREATE_SQL)


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0074_merge_course_type_and_module_attendance')]
    operations = [migrations.RunPython(create_connection_table, reverse_code=migrations.RunPython.noop)]
