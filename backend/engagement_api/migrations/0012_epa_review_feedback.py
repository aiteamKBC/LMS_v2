"""Allow EPA templates without assigning historical Gateway reviews."""
from django.db import migrations, models


SQL = '''
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN SELECT conname FROM pg_constraint
    WHERE conrelid = '"Feedback".feedback_forms'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%form_type%'
  LOOP
    EXECUTE format('ALTER TABLE "Feedback".feedback_forms DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
  ALTER TABLE "Feedback".feedback_forms ADD CONSTRAINT feedback_form_type_check
    CHECK (form_type IN ('general','post_lecture','post_event','event_rsvp','post_mcm_review',
      'post_progress_review','post_progress_review_employer','post_epa_review','mid_module','end_module'));
END $$;
'''


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Tests create the unmanaged form/delivery tables in temporary SQLite files.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('EPA feedback requires the canonical PostgreSQL default database.')
    schema_editor.execute(SQL, params=None)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0011_public_lecture_feedback')]
    operations = [
        migrations.AlterField(
            model_name='feedbackform', name='form_type',
            field=models.CharField(max_length=40, default='general', choices=[
                ('general', 'General'), ('post_lecture', 'Live Sessions Feedback'),
                ('post_event', 'Post-event'), ('event_rsvp', 'Event RSVP'),
                ('post_mcm_review', 'MCM Feedback'), ('post_progress_review', 'Progress Review Feedback'),
                ('post_epa_review', 'EPA Feedback'),
                ('post_progress_review_employer', 'Progress Review – Employer Feedback'),
                ('mid_module', 'Wellbeing'), ('end_module', 'End-module Feedback'),
            ]),
        ),
        # Removing a used type on rollback would invalidate preserved form history.
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
