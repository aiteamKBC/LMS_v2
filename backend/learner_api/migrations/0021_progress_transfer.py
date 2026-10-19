"""Learner-requested, administrator-approved module transfer snapshots."""
from django.db import migrations


SQL = '''
CREATE TABLE IF NOT EXISTS "Learner".progress_transfer_requests (
    id uuid PRIMARY KEY,
    enrolment_id bigint NOT NULL,
    learner_id bigint NOT NULL REFERENCES "Learner".learners(id),
    learner_kind text NOT NULL CHECK (learner_kind IN ('commercial','apprenticeship')),
    requested_by bigint NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
    approved_by bigint,
    approved_at timestamptz,
    records jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(records)='array'),
    CHECK ((status='pending' AND approved_by IS NULL AND approved_at IS NULL)
        OR (status='approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS progress_transfer_one_pending
    ON "Learner".progress_transfer_requests(enrolment_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS "Learner".progress_transfer_items (
    request_id uuid NOT NULL REFERENCES "Learner".progress_transfer_requests(id),
    enrolment_id bigint NOT NULL,
    course_ref text NOT NULL,
    module_id text NOT NULL,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
    PRIMARY KEY(enrolment_id,course_ref),
    UNIQUE(enrolment_id,module_id)
);
'''


def install(apps, schema_editor):
    if schema_editor.connection.alias == 'enrolment' and schema_editor.connection.vendor == 'postgresql':
        schema_editor.execute(SQL)


class Migration(migrations.Migration):
    dependencies = [('learner_api', '0020_progress_soft_archive_state')]
    operations = [migrations.RunPython(install, reverse_code=None)]
