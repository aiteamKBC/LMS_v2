from django.db import migrations


LEARNER_SCHEMA = "Learner"


def table_exists(cursor, table):
    cursor.execute(
        """
        select 1
          from information_schema.tables
         where table_schema = %s
           and table_name = %s
        """,
        [LEARNER_SCHEMA, table],
    )
    return bool(cursor.fetchone())


def column_exists(cursor, table, column):
    cursor.execute(
        """
        select 1
          from information_schema.columns
         where table_schema = %s
           and table_name = %s
           and column_name = %s
        """,
        [LEARNER_SCHEMA, table, column],
    )
    return bool(cursor.fetchone())


def qtable(table):
    return f'"{LEARNER_SCHEMA}"."{table}"'


def add_column(cursor, table, column, ddl):
    cursor.execute(f"alter table {qtable(table)} add column if not exists {column} {ddl}")


def add_index(cursor, table, name, columns, where=None):
    where_sql = f" where {where}" if where else ""
    cursor.execute(f"create index if not exists {name} on {qtable(table)} ({columns}){where_sql}")


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if table_exists(cursor, "learner_progress_entries"):
            for column, ddl in (
                ("programme_ref", "text"),
                ("programme_title", "text not null default ''"),
                ("cohort_ref", "text"),
                ("cohort_title", "text not null default ''"),
                ("group_ref", "text"),
                ("group_title", "text not null default ''"),
                ("expected_otjh", "numeric(8,2)"),
                ("points", "integer"),
            ):
                add_column(cursor, "learner_progress_entries", column, ddl)
            add_index(
                cursor,
                "learner_progress_entries",
                "learner_progress_curriculum_scope_idx",
                "programme_ref, cohort_ref, group_ref, module_ref, week_ref, component_ref",
            )
            add_index(
                cursor,
                "learner_progress_entries",
                "learner_progress_component_ref_idx",
                "component_ref",
                "component_ref is not null",
            )

        if table_exists(cursor, "learner_progress_ksbs"):
            for column, ddl in (
                ("ksb_description", "text not null default ''"),
                ("source_type", "varchar(32) not null default ''"),
                ("source_id", "text not null default ''"),
                ("classification", "varchar(32) not null default ''"),
                ("weight", "numeric(5,2)"),
                ("weight_class", "varchar(32) not null default 'soft'"),
            ):
                add_column(cursor, "learner_progress_ksbs", column, ddl)
            cursor.execute(
                f"""
                update {qtable("learner_progress_ksbs")}
                   set weight_class = 'soft'
                 where weight_class is null or weight_class = ''
                """
            )
            cursor.execute(
                f"""
                alter table {qtable("learner_progress_ksbs")}
                drop constraint if exists learner_progress_ksbs_weight_class_chk
                """
            )
            cursor.execute(
                f"""
                alter table {qtable("learner_progress_ksbs")}
                add constraint learner_progress_ksbs_weight_class_chk
                check (weight_class in ('hard', 'soft', 'possible', ''))
                """
            )
            add_index(
                cursor,
                "learner_progress_ksbs",
                "learner_progress_ksbs_code_weight_idx",
                "ksb_code, weight_class",
            )

        if table_exists(cursor, "learning_reflection_submissions"):
            for column, ddl in (
                ("progress_entry_id", "bigint"),
                ("component_ref", "text"),
                ("programme_ref", "text"),
                ("cohort_ref", "text"),
                ("group_ref", "text"),
                ("module_ref", "text"),
                ("week_ref", "text"),
            ):
                add_column(cursor, "learning_reflection_submissions", column, ddl)
            if column_exists(cursor, "learning_reflection_submissions", "activity_id"):
                cursor.execute(
                    f"""
                    update {qtable("learning_reflection_submissions")} r
                       set component_ref = r.activity_id
                      from curriculum.components c
                     where r.component_ref is null
                       and c.id = r.activity_id
                    """
                )
            if table_exists(cursor, "learner_progress_entries"):
                cursor.execute(
                    f"""
                    with matches as (
                        select distinct on (r.id)
                               r.id as reflection_id,
                               p.id as progress_id,
                               p.component_ref,
                               p.programme_ref,
                               p.cohort_ref,
                               p.group_ref,
                               p.module_ref,
                               p.week_ref
                          from {qtable("learning_reflection_submissions")} r
                          join {qtable("learner_progress_entries")} p
                            on p.learner_id::text = r.learner_id::text
                           and p.component_ref = coalesce(r.component_ref, r.activity_id)
                         where r.progress_entry_id is null
                         order by r.id, p.submitted_at desc nulls last, p.id desc
                    )
                    update {qtable("learning_reflection_submissions")} r
                       set progress_entry_id = matches.progress_id,
                           component_ref = coalesce(r.component_ref, matches.component_ref),
                           programme_ref = coalesce(r.programme_ref, matches.programme_ref),
                           cohort_ref = coalesce(r.cohort_ref, matches.cohort_ref),
                           group_ref = coalesce(r.group_ref, matches.group_ref),
                           module_ref = coalesce(r.module_ref, matches.module_ref),
                           week_ref = coalesce(r.week_ref, matches.week_ref)
                      from matches
                     where r.id = matches.reflection_id
                    """
                )
            add_index(
                cursor,
                "learning_reflection_submissions",
                "idx_learning_reflections_progress_entry",
                "progress_entry_id",
                "progress_entry_id is not null",
            )
            add_index(
                cursor,
                "learning_reflection_submissions",
                "idx_learning_reflections_component_ref",
                "component_ref",
                "component_ref is not null",
            )

        if table_exists(cursor, "evidence_files"):
            for column, ddl in (
                ("progress_entry_id", "bigint"),
                ("component_ref", "text"),
            ):
                add_column(cursor, "evidence_files", column, ddl)
            cursor.execute(
                f"""
                update {qtable("evidence_files")} e
                   set component_ref = e.section_ref
                  from curriculum.components c
                 where e.component_ref is null
                   and c.id = e.section_ref
                """
            )
            if table_exists(cursor, "learner_progress_entries"):
                cursor.execute(
                    f"""
                    with matches as (
                        select distinct on (e.id)
                               e.id as evidence_id,
                               p.id as progress_id
                          from {qtable("evidence_files")} e
                          join {qtable("learner_progress_entries")} p
                            on p.learner_id::text = e.learner_id::text
                           and p.component_ref = coalesce(e.component_ref, e.section_ref)
                         where e.progress_entry_id is null
                         order by e.id, p.submitted_at desc nulls last, p.id desc
                    )
                    update {qtable("evidence_files")} e
                       set progress_entry_id = matches.progress_id
                      from matches
                     where e.id = matches.evidence_id
                    """
                )
            add_index(
                cursor,
                "evidence_files",
                "idx_evidence_files_component_ref",
                "component_ref",
                "component_ref is not null",
            )
            add_index(
                cursor,
                "evidence_files",
                "idx_evidence_files_progress_entry",
                "progress_entry_id",
                "progress_entry_id is not null",
            )


def revert_schema(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        for index_name in (
            "learner_progress_curriculum_scope_idx",
            "learner_progress_component_ref_idx",
            "learner_progress_ksbs_code_weight_idx",
            "idx_learning_reflections_progress_entry",
            "idx_learning_reflections_component_ref",
            "idx_evidence_files_component_ref",
            "idx_evidence_files_progress_entry",
        ):
            cursor.execute(f'drop index if exists "{LEARNER_SCHEMA}".{index_name}')


class Migration(migrations.Migration):
    dependencies = [
        ("learner_api", "0003_progress_curriculum_snapshot"),
    ]

    operations = [
        migrations.RunPython(apply_schema, revert_schema),
    ]
