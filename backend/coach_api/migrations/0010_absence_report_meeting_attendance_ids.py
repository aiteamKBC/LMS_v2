"""Allow absence reports to reference non-lecture attendance identities.

Learner absence reports also cover coaching and progress-review meetings. Those
appointments do not have a row in ``Learner.learner_attendance_details``; the
learner API assigns them a stable, namespaced bigint identity instead. The
legacy foreign key on ``attendance_id`` rejected those identities at insert
time, so meeting reports could never be saved.
"""

from django.db import migrations


DROP_ATTENDANCE_FOREIGN_KEY = """
ALTER TABLE "Coach".coach_absence_report
DROP CONSTRAINT IF EXISTS coach_absence_report_attendance_fk;
"""

RESTORE_ATTENDANCE_FOREIGN_KEY = """
ALTER TABLE "Coach".coach_absence_report
ADD CONSTRAINT coach_absence_report_attendance_fk
FOREIGN KEY (attendance_id)
REFERENCES "Learner".learner_attendance_details(id)
ON DELETE RESTRICT;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("coach_api", "0009_coachabsencereport_coach_absence_report_status_valid_and_more"),
    ]

    operations = [
        migrations.RunSQL(
            sql=DROP_ATTENDANCE_FOREIGN_KEY,
            reverse_sql=RESTORE_ATTENDANCE_FOREIGN_KEY,
        ),
    ]
