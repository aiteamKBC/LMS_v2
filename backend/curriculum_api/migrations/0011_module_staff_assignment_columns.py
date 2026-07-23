from django.db import migrations


def add_module_staff_columns(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute("select to_regclass('curriculum.modules')")
            if not cursor.fetchone()[0]:
                return
            cursor.execute("alter table curriculum.modules add column if not exists tutor_name varchar(255)")
            cursor.execute("alter table curriculum.modules add column if not exists coach_name varchar(255)")
        else:
            cursor.execute("select name from sqlite_master where type='table' and name='modules'")
            if not cursor.fetchone():
                return
            cursor.execute('pragma table_info("modules")')
            columns = {row[1] for row in cursor.fetchall()}
            if "tutor_name" not in columns:
                cursor.execute('alter table "modules" add column tutor_name varchar(255)')
            if "coach_name" not in columns:
                cursor.execute('alter table "modules" add column coach_name varchar(255)')


class Migration(migrations.Migration):
    dependencies = [
        ("curriculum_api", "0010_clean_staff_profile_assignment_columns"),
    ]

    operations = [
        migrations.RunPython(add_module_staff_columns, migrations.RunPython.noop),
    ]
