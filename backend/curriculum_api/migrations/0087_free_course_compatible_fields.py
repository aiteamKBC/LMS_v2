"""Expose architecture fields without replacing native authoring or identities.

Week metadata has one writer: the existing authoring fields/JSON. Stored
generated columns expose the architecture names without divergent copies.
Display-order uniqueness is intentionally omitted: courses share positions,
and archived weeks/components retain positions reused by current content.
The source title CHECK is also omitted: native partial UPSERTs evaluate the
empty INSERT default before resolving an existing row's conflict.
"""
from django.db import migrations


def install(apps, schema_editor):
    db = schema_editor.connection
    if db.vendor != 'postgresql':
        return
    if db.alias != 'default':
        raise RuntimeError('Free-course alignment requires the canonical default database.')
    with db.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout = '5s'")
        cursor.execute('''ALTER TABLE curriculum.free_course_weeks
            ADD COLUMN title text GENERATED ALWAYS AS (week_title) STORED NOT NULL,
            ADD COLUMN summary text GENERATED ALWAYS AS (authoring_data->>'summary') STORED,
            ADD COLUMN learning_outcomes jsonb GENERATED ALWAYS AS (authoring_data->'learning_outcomes') STORED,
            ADD COLUMN status varchar GENERATED ALWAYS AS (
                CASE WHEN deleted_at IS NOT NULL THEN 'inactive'
                     ELSE coalesce(authoring_data->>'status', 'active') END) STORED NOT NULL,
            ADD COLUMN holiday_note_enabled boolean GENERATED ALWAYS AS (
                coalesce((authoring_data->>'holiday_note_enabled')::boolean, false)) STORED NOT NULL,
            ADD COLUMN holiday_note text GENERATED ALWAYS AS (authoring_data->>'holiday_note') STORED,
            ADD COLUMN legacy_copied_from_week_id varchar GENERATED ALWAYS AS (
                authoring_data->>'legacy_copied_from_week_id') STORED''')
        cursor.execute('''ALTER TABLE curriculum.free_course_weeks
            ALTER COLUMN week_number SET DEFAULT 1,
            ADD CONSTRAINT free_course_weeks_id_course_unique UNIQUE (id, course_id),
            ADD CONSTRAINT free_course_weeks_number_positive_chk CHECK (week_number >= 1),
            ADD CONSTRAINT free_course_weeks_status_chk CHECK (status IN ('active','inactive'))''')
        cursor.execute('''CREATE INDEX idx_free_course_weeks_course_order
            ON curriculum.free_course_weeks (course_id, display_order, id)''')
        cursor.execute('''CREATE INDEX idx_free_components_free_week
            ON curriculum.free_programme_components (free_module_id)''')


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0086_merge_independent_free_course_storage')]
    operations = [migrations.RunPython(install)]
