from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0004_map_existing_chat_schema"),
    ]

    operations = [
        migrations.RunSQL(
            sql='CREATE SCHEMA IF NOT EXISTS "chat"',
            reverse_sql=migrations.RunSQL.noop,
        ),
        migrations.CreateModel(
            name="MessageDeletion",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("message_id", models.BigIntegerField(db_column="message_id")),
                ("participant_type", models.CharField(max_length=20)),
                ("participant_id", models.CharField(max_length=255)),
                (
                    "deleted_at",
                    models.DateTimeField(default=django.utils.timezone.now),
                ),
            ],
            options={
                "db_table": 'chat"."message_deletions',
                "managed": True,
            },
        ),
        migrations.AddConstraint(
            model_name="messagedeletion",
            constraint=models.UniqueConstraint(
                fields=("message_id", "participant_type", "participant_id"),
                name="uq_chat_message_delete_participant",
            ),
        ),
        migrations.AddIndex(
            model_name="messagedeletion",
            index=models.Index(
                fields=("participant_type", "participant_id"),
                name="chat_delete_participant_idx",
            ),
        ),
    ]
