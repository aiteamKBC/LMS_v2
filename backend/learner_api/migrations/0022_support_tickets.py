"""LMS-owned general support tickets, separate from Inclusion cases."""
from django.db import migrations

SQL = '''
CREATE TABLE IF NOT EXISTS "Learner".support_tickets (
    id uuid PRIMARY KEY,
    owner_account_id bigint NOT NULL,
    enrolment_id bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    data jsonb NOT NULL CHECK(jsonb_typeof(data) = 'object')
);
CREATE INDEX IF NOT EXISTS support_tickets_owner_created
    ON "Learner".support_tickets(owner_account_id, created_at DESC);
'''


def install(apps, schema_editor):
    if schema_editor.connection.alias == 'enrolment' and schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(SQL)


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0021_progress_transfer')]
    operations = [migrations.RunPython(install, reverse_code=None)]
