"""Add opt-in calendar settings; leave every existing delivery unchanged."""
from django.db import migrations


def add_delivery_calendars(apps, schema_editor):
    db = schema_editor.connection
    with db.cursor() as cursor:
        if db.vendor == 'postgresql':
            cursor.execute('''CREATE TABLE IF NOT EXISTS curriculum.country_holiday_calendars (
                id varchar(16) PRIMARY KEY, country varchar(2) NOT NULL, year integer NOT NULL,
                holidays jsonb NOT NULL DEFAULT '[]', fetched_at timestamptz,
                last_error text NOT NULL DEFAULT '', UNIQUE(country, year))''')
            for table in ('cohorts', 'modules'):
                cursor.execute(f'ALTER TABLE curriculum.{table} ADD COLUMN IF NOT EXISTS calendar_policy jsonb')
            cursor.execute("select to_regclass('curriculum.learning_courses')")
            if cursor.fetchone()[0] is not None:
                from curriculum_api.free_course_native_schema import create_read_views
                create_read_views(db, tables={'modules'})
        else:
            cursor.execute('''CREATE TABLE IF NOT EXISTS country_holiday_calendars (
                id varchar(16) PRIMARY KEY, country varchar(2) NOT NULL, year integer NOT NULL,
                holidays text NOT NULL DEFAULT '[]', fetched_at datetime,
                last_error text NOT NULL DEFAULT '', UNIQUE(country, year))''')
            for table in ('cohorts', 'modules'):
                cursor.execute(f'pragma table_info({table})')
                columns = {row[1] for row in cursor.fetchall()}
                if columns and 'calendar_policy' not in columns:
                    cursor.execute(f'alter table {table} add column calendar_policy text')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0089_module_week_starts_on')]
    # Previous application code can ignore these additive fields during rollback.
    operations = [migrations.RunPython(add_delivery_calendars, migrations.RunPython.noop)]
