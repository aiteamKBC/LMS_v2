"""Point chat's coach identity at ``enrolment.Staff_users``.

Chat was the last reader of ``curriculum.coaches``. ``ChatCoach`` mapped that
table and three real foreign keys hung off it -- ``chat.conversations.coach_id``,
``chat.messages.sender_coach_id``, ``chat.message_receipts.recipient_coach_id``
-- which is why ``curriculum_api.0052`` could not drop it: PostgreSQL refused,
and the ``DROP ... CASCADE`` it suggested would have taken chat's coach identity
with it.

A coach is a staff user an administrator granted coach access to, so the three
columns are repointed at the directory the rest of the platform already reads.
That is a type change as well as a target change: ``curriculum.coaches.id`` was
a ``varchar`` business key (``COACH-20260822120608834735``) while
``Staff_users.id`` is ``integer GENERATED ALWAYS AS IDENTITY``.

The old varchar keys therefore cannot be carried across -- there is no mapping
from ``COACH-...`` to a directory id that this migration could apply on its own.
Both directions guard on the three tables being empty and refuse with an
explanation rather than letting the cast fail halfway; they were empty when this
was written, which is what makes the conversion safe.

The new constraints keep ``ON DELETE CASCADE``, matching what they replace:
deleting a coach still removes their conversations and messages. They drop
``ON UPDATE CASCADE``, which the previous varchar key needed and an identity
column cannot use.
"""

from django.db import migrations, models
import django.db.models.deletion


#: table, column, constraint name -- the three coach references in the schema.
COACH_REFERENCES = (
    ('conversations', 'coach_id', 'fk_chat_conversation_coach'),
    ('messages', 'sender_coach_id', 'fk_chat_message_sender_coach'),
    ('message_receipts', 'recipient_coach_id', 'fk_chat_receipt_coach'),
)


def _require_empty_chat_tables(cursor, direction):
    """Refuse to convert the key type while rows still hold the old ids."""
    populated = []
    for table, _column, _constraint in COACH_REFERENCES:
        cursor.execute(f'select count(*) from chat."{table}"')
        count = cursor.fetchone()[0]
        if count:
            populated.append(f'chat.{table} ({count} rows)')
    if populated:
        raise RuntimeError(
            'Cannot convert the chat coach key '
            f'{direction}: {", ".join(populated)}. The old and new coach ids '
            'are unrelated -- a varchar COACH-... key against the directory '
            'integer identity -- so existing rows need a deliberate mapping '
            'written before this migration can run.'
        )


def _repoint(schema_editor, target, on_update, direction, column_type):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        _require_empty_chat_tables(cursor, direction)
        for table, column, constraint in COACH_REFERENCES:
            cursor.execute(
                f'alter table chat."{table}" drop constraint if exists {constraint}'
            )
            cursor.execute(
                f'alter table chat."{table}" alter column {column} '
                f'type {column_type} using {column}::{column_type}'
            )
            cursor.execute(
                f'alter table chat."{table}" add constraint {constraint} '
                f'foreign key ({column}) references {target}(id)'
                f'{on_update} on delete cascade'
            )


def point_coach_at_staff_directory(apps, schema_editor):
    _repoint(
        schema_editor,
        target='enrolment."Staff_users"',
        on_update='',
        direction='to enrolment.Staff_users',
        column_type='integer',
    )


def point_coach_back_at_curriculum(apps, schema_editor):
    _repoint(
        schema_editor,
        target='curriculum."coaches"',
        on_update=' on update cascade',
        direction='back to curriculum.coaches',
        column_type='varchar',
    )


class Migration(migrations.Migration):
    dependencies = [
        ('chat', '0005_message_deletion'),
    ]

    # 0052 drops curriculum.coaches, which fails while the foreign keys below
    # still reference it. Declared from this side rather than as a dependency
    # over there: DJANGO_USE_SQLITE sets MIGRATION_MODULES['chat'] = None, so a
    # curriculum_api migration naming this node would break the whole test run,
    # while an absent run_before target is simply ignored.
    run_before = [
        ('curriculum_api', '0052_drop_curriculum_staff_profile_tables'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    point_coach_at_staff_directory,
                    point_coach_back_at_curriculum,
                ),
            ],
            state_operations=[
                migrations.AlterModelTable(
                    name='chatcoach',
                    table='enrolment"."Staff_users',
                ),
                migrations.AlterField(
                    model_name='chatcoach',
                    name='id',
                    field=models.AutoField(primary_key=True, serialize=False),
                ),
                migrations.AlterField(
                    model_name='chatcoach',
                    name='name',
                    field=models.TextField(db_column='Username'),
                ),
                migrations.AlterField(
                    model_name='chatcoach',
                    name='email',
                    field=models.TextField(db_column='Email'),
                ),
                migrations.AlterField(
                    model_name='chatcoach',
                    name='job_title',
                    field=models.TextField(db_column='Position'),
                ),
                migrations.AddField(
                    model_name='chatcoach',
                    name='access',
                    field=models.TextField(blank=True, db_column='Access', null=True),
                ),
                migrations.AlterField(
                    model_name='conversation',
                    name='coach',
                    field=models.ForeignKey(
                        db_column='coach_id',
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='chat_conversations_as_coach',
                        to='chat.chatcoach',
                    ),
                ),
                migrations.AlterField(
                    model_name='message',
                    name='sender_coach',
                    field=models.ForeignKey(
                        blank=True,
                        db_column='sender_coach_id',
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='chat_messages_as_coach',
                        to='chat.chatcoach',
                    ),
                ),
                migrations.AlterField(
                    model_name='messagereceipt',
                    name='recipient_coach',
                    field=models.ForeignKey(
                        blank=True,
                        db_column='recipient_coach_id',
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='chat_receipts_as_coach',
                        to='chat.chatcoach',
                    ),
                ),
            ],
        ),
    ]
