from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("coach_api", "0006_coachcalendarevent_graph_organizer_email"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="coachcalendarevent",
            index=models.Index(fields=["owner_email", "target_date", "status"], name="coach_owner_date_status_idx"),
        ),
        migrations.AddIndex(
            model_name="coachcalendarevent",
            index=models.Index(fields=["learner_id", "event_type", "target_date"], name="coach_learner_type_date_idx"),
        ),
        migrations.AddIndex(
            model_name="coachabsencereport",
            index=models.Index(fields=["owner_email", "status", "-session_date"], name="coach_abs_owner_status_idx"),
        ),
        migrations.AddIndex(
            model_name="coachabsencereport",
            index=models.Index(fields=["learner_id", "-session_date"], name="coach_abs_learner_date_idx"),
        ),
    ]
