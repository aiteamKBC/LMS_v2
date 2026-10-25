from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0026_migrated_review_revisions")]

    operations = [
        migrations.RemoveConstraint("migratedreviewtemplate", "coach_migrated_template_family_valid"),
        migrations.AlterField("migratedreviewtemplate", "review_family", models.CharField(
            max_length=15, choices=[("MCM", "Monthly Coaching Meeting"), ("PR", "Progress Review"),
                                   ("PR_SKILLS_RADAR", "Progress Review + Skills Radar"),
                                   ("PSP", "Personal Support Plan")])),
        migrations.AddConstraint("migratedreviewtemplate", models.CheckConstraint(
            condition=models.Q(review_family__in=["MCM", "PR", "PR_SKILLS_RADAR", "PSP"]),
            name="coach_migrated_template_family_valid")),
    ]
