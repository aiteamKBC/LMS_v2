import uuid

from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0076_module_hours_targets')]
    operations = [migrations.CreateModel(
        name='CurriculumVideoImport',
        fields=[
            ('id', models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ('target_kind', models.CharField(max_length=16)),
            ('target_id', models.CharField(max_length=128)),
            ('component_id', models.CharField(max_length=128)),
            ('fingerprint', models.CharField(max_length=64, unique=True)),
            ('title', models.TextField()),
            ('source_url', models.TextField(blank=True, default='')),
            ('source_at_start', models.TextField(blank=True, default='')),
            ('scope', models.JSONField(default=dict)),
            ('library_id', models.CharField(max_length=32, default='798153')),
            ('collection_id', models.CharField(max_length=64, blank=True, default='')),
            ('video_id', models.CharField(max_length=64, blank=True, default='')),
            ('status', models.CharField(max_length=24, default='queued', db_index=True)),
            ('error', models.TextField(blank=True, default='')),
            ('lease_until', models.DateTimeField(null=True, blank=True)),
            ('requested_at', models.DateTimeField(default=django.utils.timezone.now)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('updated_at', models.DateTimeField(auto_now=True)),
        ],
        options={'db_table': 'curriculum_video_import'},
    )]
