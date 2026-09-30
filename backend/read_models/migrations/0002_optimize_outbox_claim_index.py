from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("read_models", "0001_initial")]

    operations = [
        migrations.RemoveIndex(
            model_name="readmodelevent",
            name="platform_outbox_claim_idx",
        ),
        migrations.AddIndex(
            model_name="readmodelevent",
            index=models.Index(
                fields=["available_at", "created_at"],
                condition=models.Q(status__in=["pending", "retry"]),
                name="platform_outbox_ready_idx",
            ),
        ),
    ]
