from django.db import migrations


LEARNER_SCHEMA = "Learner"


def qtable(table):
    return f'"{LEARNER_SCHEMA}"."{table}"'


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


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    with schema_editor.connection.cursor() as cursor:
        has_progress = table_exists(cursor, "learner_progress_entries")
        has_reflections = table_exists(cursor, "learning_reflection_submissions")
        has_evidence = table_exists(cursor, "evidence_files")

        if has_progress and has_reflections and column_exists(cursor, "learning_reflection_submissions", "progress_entry_id"):
            cursor.execute(
                f"""
                with source_profiles as (
                    select cu.id::text as source_id,
                           l.id::text as profile_id
                      from enrolment."Created_users" cu
                      join {qtable("learners")} l
                        on lower(l.email) = lower(cu."Email")
                     where cu."Email" is not null
                       and l.email is not null
                ),
                matches as (
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
                        on p.component_ref = coalesce(r.component_ref, r.activity_id)
                       and (
                            p.learner_id::text = r.learner_id::text
                            or exists (
                                select 1
                                  from source_profiles sp
                                 where sp.source_id = r.learner_id::text
                                   and sp.profile_id = p.learner_id::text
                            )
                       )
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

        if has_progress and has_evidence and column_exists(cursor, "evidence_files", "progress_entry_id"):
            cursor.execute(
                f"""
                with source_profiles as (
                    select cu.id::text as source_id,
                           l.id::text as profile_id
                      from enrolment."Created_users" cu
                      join {qtable("learners")} l
                        on lower(l.email) = lower(cu."Email")
                     where cu."Email" is not null
                       and l.email is not null
                ),
                matches as (
                    select distinct on (e.id)
                           e.id as evidence_id,
                           p.id as progress_id,
                           p.component_ref
                      from {qtable("evidence_files")} e
                      join {qtable("learner_progress_entries")} p
                        on p.component_ref = coalesce(e.component_ref, e.section_ref)
                       and (
                            p.learner_id::text = e.learner_id::text
                            or exists (
                                select 1
                                  from source_profiles sp
                                 where sp.source_id = e.learner_id::text
                                   and sp.profile_id = p.learner_id::text
                            )
                       )
                     where e.progress_entry_id is null
                     order by e.id, p.submitted_at desc nulls last, p.id desc
                )
                update {qtable("evidence_files")} e
                   set progress_entry_id = matches.progress_id,
                       component_ref = coalesce(e.component_ref, matches.component_ref)
                  from matches
                 where e.id = matches.evidence_id
                """
            )


def revert_schema(apps, schema_editor):
    return None


class Migration(migrations.Migration):
    dependencies = [
        ("learner_api", "0005_apply_progress_lineage_repair"),
    ]

    operations = [
        migrations.RunPython(
            apply_schema,
            revert_schema,
            hints={"learner_schema_migration": True},
        ),
    ]
