import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0028_coaching_recording_job')]
    operations = [
        migrations.CreateModel(
            name='CoachingCalendarIndex',
            fields=[
                ('key', models.CharField(max_length=96, primary_key=True, serialize=False)),
                ('owner_email', models.EmailField(max_length=320)),
                ('starts_at', models.DateTimeField()),
                ('ends_at', models.DateTimeField()),
                ('source_success_at', models.DateTimeField()),
                ('event_count', models.PositiveIntegerField(default=0)),
            ],
            options={'db_table': 'Coach"."coaching_calendar_index', 'indexes': [
                models.Index(fields=['owner_email', 'starts_at', 'ends_at'], name='coach_cal_index_owner_window'),
            ]},
        ),
        migrations.CreateModel(
            name='CoachingCalendarMeeting',
            fields=[
                ('key', models.CharField(max_length=64, primary_key=True, serialize=False)),
                ('starts_at', models.DateTimeField()),
                ('ends_at', models.DateTimeField()),
                ('event', models.JSONField(default=dict)),
                ('snapshot', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE,
                                              related_name='meetings', to='coach_api.coachingcalendarindex')),
            ],
            options={'db_table': 'Coach"."coaching_calendar_meeting', 'indexes': [
                models.Index(fields=['snapshot', 'starts_at', 'ends_at'], name='coach_cal_meeting_window'),
            ]},
        ),
    ]
