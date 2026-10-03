from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0017_coachmanualattendance")]

    operations = [
        migrations.CreateModel(
            name="CoachAttendanceSourceAdjustment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_email", models.EmailField(max_length=255)),
                ("learner_id", models.IntegerField(db_index=True)),
                ("source", models.CharField(max_length=40)),
                ("source_id", models.CharField(max_length=255)),
                ("session_date", models.DateField(blank=True, null=True)),
                ("module_name", models.CharField(blank=True, max_length=255)),
                ("session_title", models.CharField(blank=True, max_length=255)),
                ("status", models.CharField(blank=True, choices=[("present", "Present"), ("absent", "Absent")], max_length=16)),
                ("is_deleted", models.BooleanField(default=False)),
                ("updated_by", models.EmailField(max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": 'Coach"."coach_attendance_adjustment',
                "constraints": [
                    models.UniqueConstraint(fields=("learner_id", "source", "source_id"), name="coach_attendance_adjustment_source_uniq"),
                    models.CheckConstraint(condition=models.Q(("status__in", ["", "present", "absent"])), name="coach_attendance_adjustment_status_valid"),
                ],
            },
        ),
    ]
