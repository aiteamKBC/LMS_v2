"""Add opt-in rules without activating or rewriting existing quizzes/history."""
from django.db import migrations, models


GENERAL = {'attemptMode': 'unlimited', 'attemptLimit': 3, 'attemptHistory': True,
           'retakeAfterPass': True, 'quizStyle': 'pagination'}
GRADES = {'resultDisplay': 'grade_percentage', 'scoreSeparator': '/', 'coursePageDisplay': 'inside_quiz',
          'rows': [{'grade': name, 'point': point, 'min': minimum, 'color': color}
                   for name, point, minimum, color in (
                       ('A+', 5, 95, '#1d7df2'), ('A', 4.5, 90, '#2148f3'), ('A-', 4, 85, '#1457ee'),
                       ('B+', 3.5, 80, '#10a957'), ('B', 3, 75, '#08a51d'), ('B-', 2.5, 70, '#0aa650'),
                       ('C+', 2, 65, '#ef1717'), ('C', 1.5, 60, '#f20707'), ('C-', 1, 55, '#ef1717'),
                       ('D', 0, 50, '#8f8a8d'))]}


def install(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != 'postgresql':
        return
    if connection.alias != 'default':
        raise RuntimeError('Quiz policy schema must use the default curriculum database.')
    with connection.cursor() as cursor:
        cursor.execute("SET LOCAL lock_timeout='2s'")
        cursor.execute("SET LOCAL statement_timeout='30s'")
        cursor.execute('''ALTER TABLE curriculum.quizzes
            ADD COLUMN IF NOT EXISTS policy_enabled boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS attempt_limit integer NOT NULL DEFAULT 3 CHECK (attempt_limit BETWEEN 1 AND 20),
            ADD COLUMN IF NOT EXISTS grade_settings jsonb''')
        # Global defaults were retired. Keep the historical state transition for
        # 0007, but never recreate its physical table during fresh/replayed setup.


class Migration(migrations.Migration):
    dependencies = [('quiz_api', '0005_learner_question_foreign_key')]
    operations = [migrations.SeparateDatabaseAndState(
        database_operations=[migrations.RunPython(install)],
        state_operations=[
            migrations.AddField('quizpackage', 'policy_enabled', models.BooleanField(default=False)),
            migrations.AddField('quizpackage', 'attempt_limit', models.PositiveIntegerField(default=3)),
            migrations.AddField('quizpackage', 'grade_settings', models.JSONField(null=True, blank=True)),
            migrations.CreateModel(name='QuizDefaults', fields=[
                ('id', models.PositiveIntegerField(primary_key=True, default=1, serialize=False)),
                ('general', models.JSONField()), ('grades', models.JSONField()),
                ('revision', models.PositiveIntegerField(default=1)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ], options={'managed': False, 'db_table': '"curriculum"."quiz_defaults"'}),
        ])]
