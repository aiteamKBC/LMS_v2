"""Update migration state to match the pre-existing Neon chat schema."""

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [("chat", "0003_alter_conversation_options_alter_message_options_and_more")]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[],
            state_operations=[
                migrations.DeleteModel(name="MessageReceipt"),
                migrations.DeleteModel(name="Message"),
                migrations.DeleteModel(name="Conversation"),
                migrations.CreateModel(
                    name="ChatCoach",
                    fields=[
                        (
                            "id",
                            models.CharField(max_length=255, primary_key=True, serialize=False),
                        ),
                        ("name", models.CharField(max_length=255)),
                        ("email", models.EmailField(max_length=320)),
                        ("job_title", models.CharField(max_length=255)),
                    ],
                    options={
                        "db_table": 'curriculum"."coaches',
                        "managed": False,
                    },
                ),
                migrations.CreateModel(
                    name="ChatLearner",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(primary_key=True, serialize=False),
                        ),
                        ("full_name", models.TextField()),
                        ("email", models.EmailField(max_length=320)),
                    ],
                    options={
                        "db_table": 'Learner"."learners',
                        "managed": False,
                    },
                ),
                migrations.CreateModel(
                    name="Conversation",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"),
                        ),
                        ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                        ("updated_at", models.DateTimeField(default=django.utils.timezone.now)),
                        (
                            "coach",
                            models.ForeignKey(
                                db_column="coach_id",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="chat_conversations_as_coach",
                                to="chat.chatcoach",
                            ),
                        ),
                        (
                            "learner",
                            models.ForeignKey(
                                db_column="learner_id",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="chat_conversations_as_learner",
                                to="chat.chatlearner",
                            ),
                        ),
                    ],
                    options={
                        "db_table": 'chat"."conversations',
                        "managed": False,
                        "ordering": ("-updated_at", "-id"),
                    },
                ),
                migrations.CreateModel(
                    name="Message",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"),
                        ),
                        ("sender_type", models.CharField(db_column="sender_type", max_length=20)),
                        (
                            "sender_coach",
                            models.ForeignKey(
                                blank=True,
                                db_column="sender_coach_id",
                                null=True,
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="chat_messages_as_coach",
                                to="chat.chatcoach",
                            ),
                        ),
                        (
                            "sender_learner",
                            models.ForeignKey(
                                blank=True,
                                db_column="sender_learner_id",
                                null=True,
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="chat_messages_as_learner",
                                to="chat.chatlearner",
                            ),
                        ),
                        ("body", models.TextField(max_length=5000)),
                        ("created_at", models.DateTimeField()),
                        ("edited_at", models.DateTimeField(blank=True, null=True)),
                        ("is_deleted", models.BooleanField(default=False)),
                        (
                            "conversation",
                            models.ForeignKey(
                                db_column="conversation_id",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="messages",
                                to="chat.conversation",
                            ),
                        ),
                    ],
                    options={
                        "db_table": 'chat"."messages',
                        "managed": False,
                        "ordering": ("created_at", "id"),
                    },
                ),
                migrations.CreateModel(
                    name="MessageReceipt",
                    fields=[
                        (
                            "id",
                            models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID"),
                        ),
                        (
                            "recipient_type",
                            models.CharField(db_column="recipient_type", max_length=20),
                        ),
                        (
                            "recipient_coach",
                            models.ForeignKey(
                                blank=True,
                                db_column="recipient_coach_id",
                                null=True,
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="chat_receipts_as_coach",
                                to="chat.chatcoach",
                            ),
                        ),
                        (
                            "recipient_learner",
                            models.ForeignKey(
                                blank=True,
                                db_column="recipient_learner_id",
                                null=True,
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="chat_receipts_as_learner",
                                to="chat.chatlearner",
                            ),
                        ),
                        ("delivered_at", models.DateTimeField(blank=True, null=True)),
                        ("read_at", models.DateTimeField(blank=True, null=True)),
                        (
                            "message",
                            models.OneToOneField(
                                db_column="message_id",
                                on_delete=django.db.models.deletion.CASCADE,
                                related_name="message_receipt",
                                to="chat.message",
                            ),
                        ),
                    ],
                    options={"db_table": 'chat"."message_receipts', "managed": False},
                ),
                migrations.AddConstraint(
                    model_name="conversation",
                    constraint=models.UniqueConstraint(
                        fields=("coach", "learner"), name="uq_chat_coach_learner"
                    ),
                ),
                migrations.AddIndex(
                    model_name="conversation",
                    index=models.Index(
                        fields=("coach", "-updated_at"),
                        name="chat_conv_coach_upd_idx",
                    ),
                ),
                migrations.AddIndex(
                    model_name="conversation",
                    index=models.Index(
                        fields=("learner", "-updated_at"),
                        name="chat_conv_learner_upd_idx",
                    ),
                ),
                migrations.AddIndex(
                    model_name="message",
                    index=models.Index(
                        fields=("conversation", "created_at"),
                        name="chat_msg_conv_created_idx",
                    ),
                ),
                migrations.AddIndex(
                    model_name="messagereceipt",
                    index=models.Index(
                        fields=("recipient_type", "read_at"),
                        name="chat_receipt_type_read_idx",
                    ),
                ),
            ],
        )
    ]
