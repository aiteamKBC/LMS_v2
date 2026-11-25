"""State alignment only: Development normalization was applied externally.

No DDL or data writes. The four display aliases are private query fields;
Django must never recreate them on the canonical calendar table.
"""
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0040_rename_learner_identity_fields'),
                    ('learner_api', '0031_placementcoach_placementcohort_placementgroup_and_more')]
    operations = [migrations.SeparateDatabaseAndState(database_operations=[], state_operations=[
        migrations.RemoveIndex('coachcalendarevent', 'coach_owner_date_status_idx'),
        migrations.RemoveConstraint('coachcalendarevent', 'coach_calendar_owner_idempotency_uniq'),
        *[migrations.RemoveField('coachcalendarevent', name) for name in
          ('owner_email', 'owner_name', 'learner_email', 'learner_name')],
        migrations.AddField('coachcalendarevent', 'owner_coach', models.ForeignKey(
            to='learner_api.placementcoach', db_column='owner_coach_id',
            on_delete=django.db.models.deletion.PROTECT, related_name='+', db_index=False)),
        migrations.AlterModelTable('coachcalendarevent', 'Learner"."coach_calendar_event'),
        migrations.AddConstraint('coachcalendarevent', models.UniqueConstraint(
            fields=['owner_coach', 'idempotency_key'], condition=~models.Q(idempotency_key=''),
            name='coach_calendar_owner_coach_idempotency_uniq')),
    ])]
