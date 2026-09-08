from django.db import migrations


def add_updated_at(apps, schema_editor):
    postgres = schema_editor.connection.vendor == 'postgresql'
    quoted = '"curriculum"."live_session_join_launches"' if postgres else '"live_session_join_launches"'
    with schema_editor.connection.cursor() as cursor:
        if postgres:
            cursor.execute(
                f'alter table {quoted} add column if not exists updated_at timestamp not null default current_timestamp'
            )
            return
        cursor.execute("pragma table_info('live_session_join_launches')")
        columns = {row[1] for row in cursor.fetchall()}
        if 'updated_at' not in columns:
            cursor.execute(f'alter table {quoted} add column updated_at timestamp')
            cursor.execute(f'update {quoted} set updated_at = current_timestamp where updated_at is null')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0059_live_session_join_launches')]
    operations = [migrations.RunPython(add_updated_at, migrations.RunPython.noop)]
