"""Join attendance profile links with the existing Coach migration history."""
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("coach_api", "0027_attendance_profile_links"),
        ("coach_api", "0033_aptem_imported_meeting_ownership"),
    ]

    operations = []
