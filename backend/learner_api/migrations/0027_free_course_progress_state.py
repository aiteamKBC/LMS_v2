"""Retain incomplete/archived branch progress without inventing completion."""
from django.db import migrations, models


def install(apps, schema_editor):
    db = schema_editor.connection
    if db.vendor != 'postgresql':
        return
    if db.alias != 'default':
        raise RuntimeError('Free-course progress state requires the default database.')
    schema_editor.execute("SET LOCAL lock_timeout = '5s'")
    schema_editor.execute('''ALTER TABLE "Learner".learner_free_course_progress
        ADD COLUMN status varchar(20) NOT NULL DEFAULT 'active',
        ADD COLUMN deleted_at timestamptz,
        ALTER COLUMN completed_at DROP NOT NULL,
        ALTER COLUMN completed_at DROP DEFAULT,
        ADD CONSTRAINT free_progress_status_check CHECK (status IN ('active','inactive'))''')
    for table, field, name in (
        ('learner_free_courses', 'free_course_ref', 'idx_lrn_fk_29a9c8219056c5bed5c63899021aa179'),
        ('learner_free_course_progress', 'free_course_ref', 'idx_lrn_fk_b666206eaa373880ecf106d407b2fbd5'),
        ('learner_free_course_progress', 'component_ref', 'idx_lrn_fk_d0e76483345f73ed298714d7976527d5'),
    ):
        schema_editor.execute(f'CREATE INDEX "{name}" ON "Learner"."{table}" ("{field}")')


class Migration(migrations.Migration):
    dependencies = [
        ('learner_api', '0026_free_course_relations'),
        ('curriculum_api', '0087_free_course_compatible_fields'),
    ]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(install, hints={'learner_schema_migration': True})],
        state_operations=[migrations.AlterField(
            model_name='learnerfreecourseprogress', name='completed_at',
            field=models.DateTimeField(null=True, blank=True),
        )],
    )]
