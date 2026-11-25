"""Join the canonical identity history and review-feedback capture history."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('engagement_api', '0015_merge_engagement_heads'),
        ('engagement_api', '0015_review_feedback_outbox'),
    ]
    operations = []
