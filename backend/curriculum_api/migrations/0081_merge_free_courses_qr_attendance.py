"""Keep both reviewed migration histories without renaming applied migrations."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0080_free_course_storage'),
        ('curriculum_api', '0079_qr_attendance'),
    ]
    operations = []
