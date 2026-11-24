"""Retire shared defaults without changing any per-quiz or learner data.

Historical 0006 is immutable. Fresh installations run it then this removal;
already upgraded databases may have had the obsolete table removed manually.
No CASCADE and no reverse recreation of the discontinued store.
"""
from django.db import migrations


def remove_defaults(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    if connection.alias != 'default':
        raise RuntimeError('Quiz schema must use the default curriculum database.')
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='2s'")
        cursor.execute('DROP TABLE IF EXISTS curriculum.quiz_defaults')


class Migration(migrations.Migration):
    dependencies = [('quiz_api', '0006_quiz_policies')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(remove_defaults)],
        state_operations=[migrations.DeleteModel('QuizDefaults')],
    )]
