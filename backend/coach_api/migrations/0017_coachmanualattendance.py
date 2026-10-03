from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0016_booking_seq_uniq_uln_privacy")]

    operations = [
        migrations.CreateModel(
            name="CoachManualAttendance",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("owner_email", models.EmailField(db_index=True, max_length=255)),
                ("learner_id", models.IntegerField(db_index=True)),
                ("enrolment_id", models.IntegerField(blank=True, null=True)),
                ("learner_name", models.CharField(max_length=255)),
                ("learner_email", models.EmailField(blank=True, max_length=255)),
                ("session_date", models.DateField(db_index=True)),
                ("module_name", models.CharField(max_length=255)),
                ("session_title", models.CharField(max_length=255)),
                ("status", models.CharField(choices=[("present", "Present"), ("absent", "Absent")], max_length=16)),
                ("created_by", models.EmailField(max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": 'Coach"."coach_manual_attendance',
                "ordering": ["-session_date", "-id"],
                "indexes": [models.Index(fields=["owner_email", "learner_id", "-session_date"], name="coach_manual_att_owner_idx")],
                "constraints": [models.CheckConstraint(condition=models.Q(("status__in", ["present", "absent"])), name="coach_manual_att_status_valid")],
            },
        ),
    ]
