"""Join the independent course catalogue and per-module attendance histories."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0072_course_type'),
        ('curriculum_api', '0073_live_register_session_date'),
    ]
    operations = []
