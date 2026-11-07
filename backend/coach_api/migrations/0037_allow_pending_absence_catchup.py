"""Allow the absence report to be saved before its catch-up is booked.

Only the recovery CHECK changes. No reports, meetings or attendance are rewritten.
Rollback restores the old rule for new writes with NOT VALID, preserving any
pending reports already saved; those can still be linked to a booking normally.
"""
from django.db import migrations


FORWARD_SQL = """
ALTER TABLE "Coach".coach_absence_report
  DROP CONSTRAINT IF EXISTS coach_absence_recovery_valid;
ALTER TABLE "Coach".coach_absence_report
  ADD CONSTRAINT coach_absence_recovery_valid CHECK (
       (recovery_method IN ('', 'recorded') AND catchup_event_key IS NULL)
    OR (recovery_method = 'catch-up'
        AND (catchup_event_key IS NULL
             OR (catchup_event_key <> ''
                 AND catchup_event_key NOT LIKE 'alternative:%')))
    OR (recovery_method = 'alternative'
        AND catchup_event_key LIKE 'alternative:%'
        AND length(catchup_event_key) > length('alternative:'))
  );
"""

REVERSE_SQL = """
ALTER TABLE "Coach".coach_absence_report
  DROP CONSTRAINT IF EXISTS coach_absence_recovery_valid;
ALTER TABLE "Coach".coach_absence_report
  ADD CONSTRAINT coach_absence_recovery_valid CHECK (
       (recovery_method IN ('', 'recorded') AND catchup_event_key IS NULL)
    OR (recovery_method = 'catch-up'
        AND catchup_event_key IS NOT NULL
        AND catchup_event_key <> ''
        AND catchup_event_key NOT LIKE 'alternative:%')
    OR (recovery_method = 'alternative'
        AND catchup_event_key LIKE 'alternative:%'
        AND length(catchup_event_key) > length('alternative:'))
  ) NOT VALID;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("coach_api", "0036_merge_attendance_profile_and_expected_person"),
    ]

    operations = [
        migrations.RunSQL(FORWARD_SQL, reverse_sql=REVERSE_SQL),
    ]
