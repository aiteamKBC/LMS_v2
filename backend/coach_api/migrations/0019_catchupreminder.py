from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0018_coachattendancesourceadjustment")]

    operations = [
        migrations.CreateModel(
            name="CatchupReminder",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_key", models.CharField(max_length=255)),
                ("kind", models.CharField(choices=[("24h", "24 hours before"), ("1h", "1 hour before")], max_length=8)),
                ("starts_at", models.DateTimeField()),
                ("recipient", models.EmailField(max_length=255)),
                ("sent", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "db_table": 'Coach"."catchup_reminder',
                "constraints": [
                    models.UniqueConstraint(fields=("event_key", "kind", "starts_at"), name="catchup_reminder_once"),
                ],
            },
        ),
    ]
