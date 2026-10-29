from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0027_coaching_quality_suggestion')]
    operations = [migrations.CreateModel(
        name='CoachingRecordingJob',
        fields=[
            ('key', models.CharField(max_length=96, primary_key=True, serialize=False)),
            ('kind', models.CharField(max_length=16)),
            ('owner_email', models.EmailField(max_length=320)),
            ('context', models.JSONField(default=dict)),
            ('result', models.JSONField(default=dict)),
            ('state', models.CharField(default='queued', max_length=16)),
            ('claim', models.UUIDField(null=True)),
            ('lease_until', models.DateTimeField(null=True)),
            ('next_run_at', models.DateTimeField(null=True)),
            ('last_success_at', models.DateTimeField(null=True)),
            ('error_code', models.CharField(default='', max_length=64)),
            ('retryable', models.BooleanField(default=True)),
            ('attempts', models.PositiveIntegerField(default=0)),
            ('updated_at', models.DateTimeField(auto_now=True)),
        ],
        options={'db_table': 'Coach"."coaching_recording_job', 'indexes': [
            models.Index(fields=['kind', 'next_run_at'], name='coach_recording_job_due'),
        ]},
    )]
