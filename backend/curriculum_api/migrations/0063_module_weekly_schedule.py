from django.db import migrations


def add_weekly_schedule(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('alter table curriculum.modules add column if not exists weekly_schedule jsonb')
            cursor.execute('alter table curriculum.live_sessions add column if not exists calendar_series jsonb')
        else:
            cursor.execute('pragma table_info(modules)')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'weekly_schedule' not in columns:
                cursor.execute('alter table modules add column weekly_schedule text')
            cursor.execute('pragma table_info(live_sessions)')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'calendar_series' not in columns:
                cursor.execute('alter table live_sessions add column calendar_series text')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0062_englandholiday')]
    # Keep the nullable data on rollback; older code ignores this additive column.
    operations = [migrations.RunPython(add_weekly_schedule, migrations.RunPython.noop)]
