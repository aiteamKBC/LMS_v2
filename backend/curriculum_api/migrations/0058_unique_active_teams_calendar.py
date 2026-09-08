from django.db import migrations


def add_unique_active_calendar_indexes(apps, schema_editor):
    table = (
        '"curriculum"."live_sessions"'
        if schema_editor.connection.vendor == 'postgresql'
        else '"live_sessions"'
    )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            f"create unique index if not exists curriculum_one_active_teams_calendar_per_module "
            f"on {table} (module_catalogue_id) "
            "where status = 'active' and module_catalogue_id is not null and module_catalogue_id <> ''"
        )
        cursor.execute(
            f"create unique index if not exists curriculum_one_active_teams_calendar_per_draft "
            f"on {table} (module_draft_id) "
            "where status = 'active' and module_draft_id <> ''"
        )


def remove_unique_active_calendar_indexes(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        if schema_editor.connection.vendor == 'postgresql':
            cursor.execute('drop index if exists "curriculum"."curriculum_one_active_teams_calendar_per_module"')
            cursor.execute('drop index if exists "curriculum"."curriculum_one_active_teams_calendar_per_draft"')
        else:
            cursor.execute('drop index if exists curriculum_one_active_teams_calendar_per_module')
            cursor.execute('drop index if exists curriculum_one_active_teams_calendar_per_draft')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0057_merge_curriculum_api_0056s'),
    ]

    operations = [
        migrations.RunPython(add_unique_active_calendar_indexes, remove_unique_active_calendar_indexes),
    ]
