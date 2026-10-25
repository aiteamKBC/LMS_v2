"""Allow module checkpoint templates on the existing Feedback delivery engine."""
from django.db import migrations


SQL = '''
ALTER TABLE "Feedback".feedback_delivery_recipients
  ADD COLUMN IF NOT EXISTS available_at timestamptz NULL;

DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = '"Feedback".feedback_forms'::regclass
       AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%form_type%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_forms DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
  ALTER TABLE "Feedback".feedback_forms ADD CONSTRAINT feedback_form_type_check
    CHECK (form_type IN ('general', 'post_lecture', 'post_event', 'event_rsvp',
                        'post_mcm_review', 'post_progress_review', 'mid_module', 'end_module'));
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS feedback_module_template_published_scope
  ON "Feedback".feedback_forms (form_type, delivery_scope, module_catalogue_id)
  WHERE form_type IN ('mid_module', 'end_module') AND is_current AND status = 'published';

CREATE INDEX IF NOT EXISTS feedback_module_recipient_available
  ON "Feedback".feedback_delivery_recipients (learner_id, available_at)
  WHERE available_at IS NOT NULL;
'''


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Isolated unit suites use SQLite and stub the unmanaged schema.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Module feedback must be installed on the canonical PostgreSQL default database.')
    schema_editor.execute(SQL, params=None)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0005_merge_learning_policy_event_feedback')]
    # Removing types after use would invalidate preserved feedback history.
    operations = [migrations.RunPython(install)]
