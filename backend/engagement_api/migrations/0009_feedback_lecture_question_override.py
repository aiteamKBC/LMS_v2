"""Allow a correction for unstarted recipients of an already delivered lecture."""
from django.db import migrations, models
import django.db.models.deletion


def install(apps, schema_editor):
    if schema_editor.connection.vendor == 'sqlite':
        return  # Isolated suites do not create the unmanaged Feedback schema.
    if schema_editor.connection.vendor != 'postgresql' or schema_editor.connection.alias != 'default':
        raise RuntimeError('Lecture question overrides require the canonical PostgreSQL default database.')
    schema_editor.execute('''
        CREATE TABLE IF NOT EXISTS "Feedback".feedback_delivery_question_overrides (
            id bigserial PRIMARY KEY,
            recipient_id bigint NOT NULL REFERENCES "Feedback".feedback_delivery_recipients(id) ON DELETE RESTRICT,
            original_question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
            replacement_question_id bigint NOT NULL REFERENCES "Feedback".feedback_questions(id) ON DELETE RESTRICT,
            effective_at timestamptz NOT NULL,
            CONSTRAINT feedback_delivery_question_override_distinct CHECK (original_question_id <> replacement_question_id),
            CONSTRAINT feedback_delivery_question_override_unique UNIQUE (recipient_id, original_question_id)
        )
    ''')


class Migration(migrations.Migration):
    dependencies = [('engagement_api', '0008_feedbackdeliveryquestion_feedbackreviewdelivery')]
    operations = [
        migrations.CreateModel(
            name='FeedbackDeliveryQuestionOverride',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('effective_at', models.DateTimeField()),
                ('recipient', models.ForeignKey(
                    db_column='recipient_id', on_delete=django.db.models.deletion.PROTECT,
                    related_name='question_overrides', to='engagement_api.feedbackdeliveryrecipient',
                )),
                ('original_question', models.ForeignKey(
                    db_column='original_question_id', on_delete=django.db.models.deletion.PROTECT,
                    related_name='+', to='engagement_api.feedbackquestion',
                )),
                ('replacement_question', models.ForeignKey(
                    db_column='replacement_question_id', on_delete=django.db.models.deletion.PROTECT,
                    related_name='+', to='engagement_api.feedbackquestion',
                )),
            ],
            options={'db_table': 'Feedback"."feedback_delivery_question_overrides', 'managed': False},
        ),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
