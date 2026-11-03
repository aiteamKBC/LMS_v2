"""Independent employer assignments and responses; no historical backfill."""
from django.db import migrations, models
import django.db.models.deletion


SQL = '''
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS "Feedback".feedback_employer_review_deliveries (
    id bigserial PRIMARY KEY,
    form_id bigint NOT NULL REFERENCES "Feedback".feedback_forms(id) ON DELETE RESTRICT,
    source_review_id bigint NOT NULL UNIQUE,
    aptem_review_id text NOT NULL DEFAULT '',
    learner_id varchar(100) NOT NULL,
    learner_name varchar(255) NOT NULL DEFAULT '',
    review_type varchar(255) NOT NULL,
    review_name varchar(500) NOT NULL DEFAULT '',
    completed_at timestamptz NOT NULL,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    employer_id bigint NULL,
    employer_name varchar(255) NOT NULL DEFAULT '',
    employer_email text NOT NULL DEFAULT '',
    pending_reason varchar(80) NOT NULL DEFAULT 'missing_employer_link',
    CHECK ((employer_id IS NULL AND pending_reason <> '') OR (employer_id IS NOT NULL AND pending_reason = ''))
);
ALTER TABLE "Feedback".feedback_responses
    ADD COLUMN IF NOT EXISTS employer_review_delivery_id bigint NULL
    REFERENCES "Feedback".feedback_employer_review_deliveries(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS feedback_response_unique_employer_review
    ON "Feedback".feedback_responses (employer_review_delivery_id)
    WHERE employer_review_delivery_id IS NOT NULL;
DROP INDEX IF EXISTS "Feedback".feedback_response_unique_general;
CREATE UNIQUE INDEX feedback_response_unique_general
    ON "Feedback".feedback_responses (form_id, learner_id)
    WHERE delivery_id IS NULL AND event_recipient_id IS NULL AND rsvp_recipient_id IS NULL
      AND review_delivery_id IS NULL AND employer_review_delivery_id IS NULL;
CREATE INDEX IF NOT EXISTS feedback_employer_review_owner
    ON "Feedback".feedback_employer_review_deliveries (employer_id, assigned_at DESC);
CREATE INDEX IF NOT EXISTS feedback_employer_review_pending
    ON "Feedback".feedback_employer_review_deliveries (learner_id) WHERE employer_id IS NULL;
CREATE INDEX IF NOT EXISTS feedback_employer_review_form
    ON "Feedback".feedback_employer_review_deliveries (form_id);
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
      'post_progress_review','post_progress_review_employer','mid_module','end_module'));
END $$;
'''


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Disposable test databases create their own unmanaged models.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Employer feedback requires the canonical PostgreSQL default database.')
    schema_editor.execute(SQL, params=None)


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0009_lecture_tutor_snapshot')]
    operations = [
        migrations.CreateModel(
            name='FeedbackEmployerReviewDelivery',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('form', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='employer_review_deliveries', to='engagement_api.feedbackform')),
                ('source_review_id', models.BigIntegerField(unique=True)),
                ('aptem_review_id', models.TextField(blank=True, default='')),
                ('learner_id', models.CharField(max_length=100)),
                ('learner_name', models.CharField(max_length=255, blank=True, default='')),
                ('review_type', models.CharField(max_length=255)),
                ('review_name', models.CharField(max_length=500, blank=True, default='')),
                ('completed_at', models.DateTimeField()),
                ('assigned_at', models.DateTimeField(auto_now_add=True)),
                ('employer_id', models.BigIntegerField(null=True, blank=True)),
                ('employer_name', models.CharField(max_length=255, blank=True, default='')),
                ('employer_email', models.TextField(blank=True, default='')),
                ('pending_reason', models.CharField(max_length=80, blank=True, default='missing_employer_link')),
            ],
            options={'managed': False, 'db_table': 'Feedback"."feedback_employer_review_deliveries'},
        ),
        migrations.AddField(
            model_name='feedbackresponse', name='employer_review_delivery',
            field=models.ForeignKey(null=True, blank=True, db_column='employer_review_delivery_id',
                on_delete=django.db.models.deletion.PROTECT, related_name='responses',
                to='engagement_api.feedbackemployerreviewdelivery'),
        ),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
