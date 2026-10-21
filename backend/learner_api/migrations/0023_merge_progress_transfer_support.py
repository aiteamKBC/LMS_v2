"""Join the independent transfer-storage and support-ticket migration branches."""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('learner_api', '0022_install_progress_transfer_storage'),
        ('learner_api', '0022_support_tickets'),
    ]

    operations = []
