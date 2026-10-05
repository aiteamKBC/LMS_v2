from django.db import migrations


def add_ksb_remap_report(apps, schema_editor):
    connection = schema_editor.connection
    table = 'curriculum.modules' if connection.vendor == 'postgresql' else 'modules'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(
                f'alter table {table} add column if not exists ksb_remap_report text'
            )
        else:
            cursor.execute(f'pragma table_info({table})')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'ksb_remap_report' not in columns:
                cursor.execute(f'alter table {table} add column ksb_remap_report text')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0068_module_learner_roster_mode')]
    operations = [migrations.RunPython(add_ksb_remap_report, migrations.RunPython.noop)]
