from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0037_allow_pending_absence_catchup')]
    operations = [
        migrations.CreateModel(
            name='ReviewBookingReschedule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('calendar_event_id', models.BigIntegerField(db_index=True)),
                ('learner_id', models.IntegerField()),
                ('event_key', models.CharField(max_length=255)),
                ('graph_event_id', models.CharField(max_length=255)),
                ('owner_email', models.EmailField(max_length=255)),
                ('booking_fingerprint', models.CharField(max_length=64)),
                ('scheduled_date', models.DateField()),
                ('scheduled_time', models.TimeField()),
                ('duration_minutes', models.PositiveIntegerField()),
                ('session_claim', models.JSONField(blank=True, default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
            options={'db_table': 'Coach"."coach_review_reschedule'},
        ),
        migrations.AddConstraint(model_name='reviewbookingreschedule', constraint=models.UniqueConstraint(
            fields=('calendar_event_id', 'booking_fingerprint'), name='coach_review_reschedule_once')),
    ]
