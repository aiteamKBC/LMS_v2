"""Opt in future modules to explicit study weeks; never backfill old modules."""
from django.db import migrations


def add_week_boundary_mode(apps, schema_editor):
    db = schema_editor.connection
    with db.cursor() as cursor:
        if db.vendor == 'postgresql':
            cursor.execute('ALTER TABLE curriculum.modules ADD COLUMN IF NOT EXISTS week_boundary_mode varchar(16)')
            cursor.execute("SELECT to_regclass('curriculum.learning_courses')")
            if cursor.fetchone()[0] is not None:
                from curriculum_api.catalogue.infrastructure.free_course_native_schema import create_read_views
                create_read_views(db, tables={'modules'})
        else:
            cursor.execute('pragma table_info(modules)')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'week_boundary_mode' not in columns:
                cursor.execute('ALTER TABLE modules ADD COLUMN week_boundary_mode varchar(16)')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0090_delivery_calendars')]
    operations = [migrations.RunPython(add_week_boundary_mode, migrations.RunPython.noop)]
