from django.db import migrations


def normalize_quiz_course_links(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("create schema if not exists curriculum")
        cursor.execute("select to_regclass('curriculum.quizzes')")
        if not cursor.fetchone()[0]:
            return
        cursor.execute(
            """
            create table if not exists curriculum.quiz_course_links (
              id bigserial primary key,
              quiz_id bigint not null references curriculum.quizzes(id) on delete cascade,
              training_plan_id varchar(128) not null,
              created_at timestamptz not null default now(),
              unique (quiz_id, training_plan_id)
            )
            """
        )
        cursor.execute(
            """
            alter table curriculum.quiz_course_links
            alter column training_plan_id type varchar(128)
            using training_plan_id::varchar
            """
        )


class Migration(migrations.Migration):
    dependencies = []

    operations = [
        migrations.RunPython(normalize_quiz_course_links, migrations.RunPython.noop),
    ]
