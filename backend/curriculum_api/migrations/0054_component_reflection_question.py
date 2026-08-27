from django.db import migrations, models


def add_reflection_question(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('''
            alter table curriculum.components
            add column if not exists "Reflection_Question" text
        ''')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0052_drop_curriculum_staff_profile_tables'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(add_reflection_question, migrations.RunPython.noop),
            ],
            state_operations=[
                migrations.AddField(
                    model_name='moduleauthoringcomponent',
                    name='reflection_question',
                    field=models.TextField(
                        blank=True,
                        db_column='Reflection_Question',
                        null=True,
                    ),
                ),
            ],
        ),
    ]
