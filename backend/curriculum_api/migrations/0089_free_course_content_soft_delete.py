"""Retain removed Free Course content and its learner/quiz references.

The standalone curriculum database can apply ``install`` in a verified schema
transaction without replaying the legacy migration graph. No content is changed.
Keep the columns on code rollback: dropping them would resurrect archived rows.
"""
from django.db import migrations


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        for table, owner, constraint in (
            ('free_course_weeks', 'course_id', 'free_course_weeks_course_display_order_uniq'),
            ('free_programme_components', 'free_module_id', 'free_components_week_display_order_uniq'),
        ):
            cursor.execute(f'ALTER TABLE curriculum.{table} ADD COLUMN IF NOT EXISTS deleted_at timestamptz')
            # Only replace an existing order constraint. The older native schema
            # deliberately permits duplicate positions and must retain that rule.
            cursor.execute('''SELECT pg_get_constraintdef(oid) FROM pg_constraint
                WHERE conrelid=%s::regclass AND conname=%s''', [f'curriculum.{table}', constraint])
            existing = cursor.fetchone()
            if existing and 'active_display_order' not in existing[0]:
                cursor.execute(f'''ALTER TABLE curriculum.{table}
                    ADD COLUMN IF NOT EXISTS active_display_order integer GENERATED ALWAYS AS
                        (CASE WHEN deleted_at IS NULL THEN display_order END) STORED,
                    DROP CONSTRAINT {constraint},
                    ADD CONSTRAINT {constraint} UNIQUE ({owner}, active_display_order)
                        DEFERRABLE INITIALLY DEFERRED''')


class Migration(migrations.Migration):
    atomic = True
    dependencies = [('curriculum_api', '0088_module_schedule_mode')]
    operations = [migrations.RunPython(install)]
