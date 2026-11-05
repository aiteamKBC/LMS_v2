from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('coach_api', '0038_review_booking_reschedule')]
    operations = [
        migrations.AddField(
            model_name='reviewbookingreschedule', name='evidence_manifest',
            field=models.JSONField(blank=True, default=dict, null=True),
        ),
    ]
