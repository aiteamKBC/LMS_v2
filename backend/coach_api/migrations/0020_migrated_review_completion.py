from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("coach_api", "0019_migrated_review_foundation")]

    operations = [
        migrations.AddField(
            model_name="importedreviewinstance", name="signature_requirements",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.CreateModel(
            name="MigratedReviewSignature",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role", models.CharField(max_length=16)),
                ("signer_account_id", models.BigIntegerField()),
                ("signer_name", models.CharField(max_length=255)),
                ("signer_email", models.EmailField(blank=True, max_length=255)),
                ("signature", models.TextField()),
                ("signed_at", models.DateTimeField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("overlay", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="migrated_signatures", to="coach_api.importedreviewinstance")),
            ],
            options={"db_table": 'Coach"."coach_migrated_review_signature'},
        ),
        migrations.AddConstraint(
            model_name="migratedreviewsignature",
            constraint=models.UniqueConstraint(fields=("overlay", "role"), name="coach_migrated_signature_role_unique"),
        ),
        migrations.CreateModel(
            name="MigratedReviewDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("pdf_bytes", models.BinaryField()),
                ("sha256", models.CharField(max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("overlay", models.OneToOneField(on_delete=django.db.models.deletion.PROTECT, related_name="migrated_document", to="coach_api.importedreviewinstance")),
            ],
            options={"db_table": 'Coach"."coach_migrated_review_document'},
        ),
    ]
