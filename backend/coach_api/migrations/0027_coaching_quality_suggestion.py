import uuid
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0026_migrated_review_revisions')]

    operations = [migrations.CreateModel(
        name='CoachingQualitySuggestion',
        fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('event_key', models.CharField(max_length=255)),
            ('fingerprint', models.CharField(max_length=64)),
            ('state', models.CharField(default='running', max_length=16)),
            ('claim', models.UUIDField(default=uuid.uuid4)),
            ('lease_until', models.DateTimeField()),
            ('result', models.JSONField(default=dict)),
            ('created_at', models.DateTimeField(auto_now_add=True)),
            ('updated_at', models.DateTimeField(auto_now=True)),
        ],
        options={'db_table': 'Coach"."coaching_quality_suggestion', 'constraints': [
            models.UniqueConstraint(fields=('event_key', 'fingerprint'), name='coach_quality_input_unique'),
        ]},
    )]
