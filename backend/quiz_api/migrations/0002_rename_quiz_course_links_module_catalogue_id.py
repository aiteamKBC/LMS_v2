from django.db import migrations


def rename_quiz_course_link_column(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("select to_regclass('curriculum.quiz_course_links')")
        if not cursor.fetchone()[0]:
            cursor.execute("select to_regclass('curriculum.quizzes')")
            if not cursor.fetchone()[0]:
                return
            cursor.execute(
                """
                create table curriculum.quiz_course_links (
                  id bigserial primary key,
                  quiz_id bigint not null references curriculum.quizzes(id) on delete cascade,
                  module_catalogue_id varchar(128) not null,
                  created_at timestamptz not null default now(),
                  unique (quiz_id, module_catalogue_id)
                )
                """
            )
            return

        cursor.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'curriculum'
              and table_name = 'quiz_course_links'
              and column_name in ('training_plan_id', 'module_catalogue_id')
            """
        )
        columns = {row[0] for row in cursor.fetchall()}
        if "training_plan_id" in columns and "module_catalogue_id" not in columns:
            cursor.execute(
                """
                alter table curriculum.quiz_course_links
                rename column training_plan_id to module_catalogue_id
                """
            )
        elif "training_plan_id" in columns and "module_catalogue_id" in columns:
            cursor.execute(
                """
                update curriculum.quiz_course_links
                set module_catalogue_id = coalesce(nullif(module_catalogue_id, ''), training_plan_id::varchar)
                """
            )
            cursor.execute("alter table curriculum.quiz_course_links drop column training_plan_id")
        elif "module_catalogue_id" not in columns:
            cursor.execute(
                """
                alter table curriculum.quiz_course_links
                add column module_catalogue_id varchar(128) not null
                """
            )

        cursor.execute(
            """
            alter table curriculum.quiz_course_links
            alter column module_catalogue_id type varchar(128)
            using module_catalogue_id::varchar
            """
        )
        cursor.execute(
            """
            create unique index if not exists quiz_course_links_quiz_module_catalogue_key
            on curriculum.quiz_course_links (quiz_id, module_catalogue_id)
            """
        )


class Migration(migrations.Migration):
    dependencies = [
        ("quiz_api", "0001_normalize_quiz_course_links_module_ids"),
    ]

    operations = [
        migrations.RunPython(rename_quiz_course_link_column, migrations.RunPython.noop),
    ]
