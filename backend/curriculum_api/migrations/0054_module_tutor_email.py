from django.db import migrations


def add_module_tutor_email_column(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == "postgresql":
            cursor.execute("select to_regclass('curriculum.modules')")
            if not cursor.fetchone()[0]:
                return
            cursor.execute("alter table curriculum.modules add column if not exists tutor_email varchar(320)")
        else:
            cursor.execute("select name from sqlite_master where type='table' and name='modules'")
            if not cursor.fetchone():
                return
            cursor.execute('pragma table_info("modules")')
            columns = {row[1] for row in cursor.fetchall()}
            if "tutor_email" not in columns:
                cursor.execute('alter table "modules" add column tutor_email varchar(320)')


class Migration(migrations.Migration):
    dependencies = [
        # 0052 and 0053 both branch off 0051 and neither depends on the other --
        # a pre-existing unmerged fork in this app's migration graph. Depending on
        # both here closes it without a separate no-op merge migration.
        ("curriculum_api", "0052_drop_curriculum_staff_profile_tables"),
        ("curriculum_api", "0053_curriculum_content_library"),
    ]

    operations = [
        migrations.RunPython(add_module_tutor_email_column, migrations.RunPython.noop),
    ]
