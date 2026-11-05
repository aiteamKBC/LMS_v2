from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0033_aptem_imported_meeting_ownership')]
    operations = [migrations.CreateModel(
        name='ReviewAttendanceLink',
        fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('calendar_event_id', models.BigIntegerField(db_index=True)),
            ('learner_id', models.IntegerField()),
            ('session_key', models.CharField(max_length=64)),
            ('participant_key', models.CharField(max_length=64)),
            ('evidence', models.JSONField()),
            ('reason', models.CharField(max_length=500)),
            ('confirmed_by', models.EmailField(max_length=255)),
            ('confirmed_at', models.DateTimeField(auto_now_add=True)),
            ('revoked_by', models.EmailField(blank=True, max_length=255)),
            ('revoked_at', models.DateTimeField(blank=True, null=True)),
            ('revoke_reason', models.CharField(blank=True, max_length=500)),
        ],
        options={'db_table': 'Coach"."review_attendance_link', 'constraints': [
            models.UniqueConstraint(fields=('calendar_event_id', 'session_key', 'learner_id'),
                condition=models.Q(revoked_at__isnull=True), name='review_att_link_active_learner'),
            models.UniqueConstraint(fields=('calendar_event_id', 'session_key', 'participant_key'),
                condition=models.Q(revoked_at__isnull=True), name='review_att_link_active_person'),
        ]},
    )]
