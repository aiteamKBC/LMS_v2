"""Join the existing attendance migration branches without changing schema."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('coach_api', '0034_merge_attendance_profile_links'),
        ('coach_api', '0035_review_attendance_expected_person'),
    ]

    operations = []
