from django.db import migrations, models


class Migration(migrations.Migration):
    # Join the existing leaves without changing either history.
    dependencies = [("coach_api", "0021_migrated_meeting_intelligence"),
                    ("coach_api", "0019_catchupreminder")]

    operations = [
        # Audited existing rows are programme assignments. Preserve IDs, families,
        # definitions, active state and every reference from initialized reviews.
        migrations.AddField("migratedreviewtemplate", "scope", models.CharField(
            max_length=9, choices=[("GLOBAL", "Global"), ("PROGRAMME", "Programme")], default="PROGRAMME")),
        migrations.AddField("migratedreviewtemplate", "source_metadata", models.JSONField(default=dict, blank=True)),
        migrations.AlterField("migratedreviewtemplate", "programme_key", models.CharField(max_length=255, blank=True, default="")),
        migrations.RemoveConstraint("migratedreviewtemplate", "coach_migrated_template_one_active"),
        migrations.RemoveConstraint("migratedreviewtemplate", "coach_migrated_template_family_valid"),
        migrations.AlterField("migratedreviewtemplate", "review_family", models.CharField(
            max_length=15, choices=[("MCM", "Monthly Coaching Meeting"), ("PR", "Progress Review"),
                                   ("PR_SKILLS_RADAR", "Progress Review + Skills Radar")])),
        migrations.AddConstraint("migratedreviewtemplate", models.UniqueConstraint(
            fields=["scope", "programme_key", "review_family"], condition=models.Q(is_active=True, scope="PROGRAMME"),
            name="coach_migrated_programme_active")),
        migrations.AddConstraint("migratedreviewtemplate", models.UniqueConstraint(
            fields=["scope", "review_family"], condition=models.Q(is_active=True, scope="GLOBAL"),
            name="coach_migrated_global_active")),
        migrations.AddConstraint("migratedreviewtemplate", models.CheckConstraint(
            condition=models.Q(review_family__in=["MCM", "PR", "PR_SKILLS_RADAR"]), name="coach_migrated_template_family_valid")),
        migrations.AddConstraint("migratedreviewtemplate", models.CheckConstraint(
            condition=(models.Q(scope="GLOBAL", programme_key="")
                       | (models.Q(scope="PROGRAMME") & ~models.Q(programme_key=""))),
            name="coach_migrated_template_scope_valid")),
    ]
