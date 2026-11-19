"""Join native free-course storage and the main attendance migration history."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0082_independent_free_course_storage'),
        ('curriculum_api', '0085_qr_attendance_delete_cleanup'),
    ]

    operations = []
