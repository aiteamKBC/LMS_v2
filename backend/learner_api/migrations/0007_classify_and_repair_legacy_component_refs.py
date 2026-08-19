"""Classify every learner progress row's component link, and repair the ones
whose original Component can be recovered deterministically.

Background
----------
``learner_progress_entries.component_ref`` was written straight from the client
with no validation, so rows accumulated referring to identifiers that do not
exist in ``curriculum.components``. Those rows were not corrupt — they pointed
at the learner's *training plan* component id (the per-learner plan snapshot in
``Learner.learner_training_plan_components``) rather than the curriculum
component id.

That plan table carries an explicit ``curriculum_component_id`` column mapping
each plan component to the curriculum component it was built from. This
migration uses that mapping — but only where it is corroborated by independent
structural evidence, never on its own and never on title similarity.

The determinism rule
--------------------
A legacy reference is repaired only when ALL of these hold:

1. it matches no ``curriculum.components.id``;
2. every plan row carrying it agrees on a single ``curriculum_component_id``
   (no ambiguity);
3. that target component exists;
4. the plan week's ``curriculum_week_id`` equals the target's ``week_id``
   (week lineage agrees);
5. the plan component type equals the target's type;
6. the target is the only component of that type inside that week, so the
   resolution cannot be confused with a sibling.

Across the whole plan table those conditions hold for 108/108 populated
mappings with 100% week and type agreement, which is what makes the column
trustworthy here.

Deliberate exclusion
--------------------
``COMP-202607090937403244390237`` satisfies the structural rule but is NOT
repaired. The learner's recorded activity is a "Workplace evidence upload tile"
while the mapping's target is the week's quiz — a different activity — and no
workplace-evidence component exists anywhere in curriculum, including
soft-deleted rows. Attributing that row to the quiz would record a quiz the
learner never took and would send its KSB/OTJH attribution to the wrong
component. It is classified ``historical_component_no_longer_available``
instead, which is an explanation, not a guess.

What is preserved
-----------------
Nothing is destroyed. The original identifier is copied to
``legacy_component_ref`` before ``component_ref`` is rewritten, and
``component_link_source`` records how the link was established. Snapshot
columns are only ever filled where they are blank, so historical titles and any
lineage the row already carried survive untouched. ``expected_otjh`` is left
alone: its historical value is unknown, and inventing one would change OTJH
reporting for past activity.
"""
from django.db import migrations


LEARNER_SCHEMA = "Learner"
PROGRESS_TABLE = f'"{LEARNER_SCHEMA}"."learner_progress_entries"'

# Structurally resolvable, but the recorded activity contradicts the target.
# See "Deliberate exclusion" above.
AMBIGUOUS_LEGACY_REFS = ("COMP-202607090937403244390237",)

# The determinism rule, shared by the repair and the verification query.
DETERMINISTIC_CTE = """
deterministic as (
    select tc.component_ref as legacy_ref,
           min(tc.curriculum_component_id) as target_id
      from "Learner"."learner_training_plan_components" tc
      join "Learner"."learner_training_plan_weeks" tw
        on tw.id = tc.plan_week_id
      join curriculum.components c
        on c.id = tc.curriculum_component_id
     where tc.curriculum_component_id is not null
       and tc.curriculum_component_id <> ''
       and tw.curriculum_week_id = c.week_id
       and lower(tc.component_type) = lower(c.type)
       and (select count(*)
              from curriculum.components x
             where x.week_id = c.week_id
               and lower(x.type) = lower(c.type)) = 1
       and tc.component_ref <> all(%s)
     group by tc.component_ref
    having count(distinct tc.curriculum_component_id) = 1
)
"""


def table_exists(cursor, table):
    cursor.execute(
        """
        select 1 from information_schema.tables
         where table_schema = %s and table_name = %s
        """,
        [LEARNER_SCHEMA, table],
    )
    return bool(cursor.fetchone())


def apply_schema(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return

    with schema_editor.connection.cursor() as cursor:
        if not table_exists(cursor, "learner_progress_entries"):
            print("  [skip] Learner.learner_progress_entries absent")
            return

        for name, ddl in (
            ("component_link_status", "text"),
            ("legacy_component_ref", "text"),
            ("component_link_source", "text"),
        ):
            cursor.execute(
                f"alter table {PROGRESS_TABLE} add column if not exists {name} {ddl}"
            )

        has_plan_tables = table_exists(cursor, "learner_training_plan_components") and table_exists(
            cursor, "learner_training_plan_weeks"
        )

        repaired = 0
        if has_plan_tables:
            # Repair. Only rows that are still orphaned are touched, so re-running
            # this migration is a no-op rather than a second rewrite.
            cursor.execute(
                f"""
                with {DETERMINISTIC_CTE}
                update {PROGRESS_TABLE} p
                   set legacy_component_ref  = coalesce(nullif(p.legacy_component_ref, ''), p.component_ref),
                       component_ref         = d.target_id,
                       component_link_source = 'learner_training_plan_components.curriculum_component_id',
                       programme_ref  = coalesce(nullif(p.programme_ref, ''),  l.programme_id),
                       cohort_ref     = coalesce(nullif(p.cohort_ref, ''),     l.cohort_id),
                       group_ref      = coalesce(nullif(p.group_ref, ''),      l.group_id),
                       module_ref     = coalesce(nullif(p.module_ref, ''),     l.module_catalogue_id),
                       week_ref       = coalesce(nullif(p.week_ref, ''),       l.week_id),
                       module_title   = coalesce(nullif(p.module_title, ''),   l.module_title, ''),
                       week_title     = coalesce(nullif(p.week_title, ''),     l.week_title, ''),
                       component_title = coalesce(nullif(p.component_title, ''), l.component_title, '')
                  from deterministic d
                  join curriculum.component_learning_lineage l on l.component_id = d.target_id
                 where p.component_ref = d.legacy_ref
                   and not exists (
                        select 1 from curriculum.components x where x.id = p.component_ref
                   )
                """,
                [list(AMBIGUOUS_LEGACY_REFS)],
            )
            repaired = cursor.rowcount

        # Classify every row. Recomputed from scratch each run so the column can
        # never drift from the data it describes.
        cursor.execute(
            f"""
            update {PROGRESS_TABLE} p
               set component_link_status = case
                     when p.component_ref is null or p.component_ref = '' then
                          case when coalesce(p.quiz_ref, '') <> ''
                               then 'valid_legacy_non_component_activity'
                               else 'invalid_legacy_reference' end
                     when exists (
                            select 1 from curriculum.components c
                             where c.id = p.component_ref
                               and c.deleted_at is null
                               and coalesce(c.is_programme_deleted, false) = false
                          ) then 'resolved_to_current_component'
                     when exists (
                            select 1 from curriculum.components c
                             where c.id = p.component_ref
                          ) then 'resolved_to_deleted_component'
                     when p.component_ref = any(%s)
                          then 'historical_component_no_longer_available'
                     else 'invalid_legacy_reference'
                   end,
                   component_link_source = coalesce(
                       nullif(p.component_link_source, ''),
                       case
                         when p.component_ref is null or p.component_ref = '' then
                              case when coalesce(p.quiz_ref, '') <> '' then 'quiz_ref' else 'none' end
                         when exists (select 1 from curriculum.components c where c.id = p.component_ref)
                              then 'direct'
                         else 'none'
                       end
                   )
            """,
            [list(AMBIGUOUS_LEGACY_REFS)],
        )

        cursor.execute(
            f"""
            create index if not exists learner_progress_component_link_status_idx
                on {PROGRESS_TABLE} (component_link_status)
            """
        )

        cursor.execute(
            f"select component_link_status, count(*) from {PROGRESS_TABLE} group by 1 order by 2 desc"
        )
        print(f"  [repair] rewrote {repaired} legacy component_ref value(s)")
        for status, count in cursor.fetchall():
            print(f"  [classify] {status}: {count}")

        # An unclassified row would mean the case analysis above missed something.
        cursor.execute(
            f"select count(*) from {PROGRESS_TABLE} where coalesce(component_link_status, '') = ''"
        )
        unexplained = cursor.fetchone()[0]
        if unexplained:
            raise RuntimeError(
                f"{unexplained} progress row(s) could not be classified; refusing to leave them unexplained"
            )


def revert_schema(apps, schema_editor):
    """Restore the original identifiers and drop the audit columns."""
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        if not table_exists(cursor, "learner_progress_entries"):
            return
        cursor.execute(
            f"""
            update {PROGRESS_TABLE}
               set component_ref = legacy_component_ref
             where coalesce(legacy_component_ref, '') <> ''
            """
        )
        cursor.execute("drop index if exists \"Learner\".learner_progress_component_link_status_idx")
        for name in ("component_link_source", "legacy_component_ref", "component_link_status"):
            cursor.execute(f"alter table {PROGRESS_TABLE} drop column if exists {name}")


class Migration(migrations.Migration):
    dependencies = [
        ("learner_api", "0006_backfill_lineage_by_source_identity"),
    ]

    operations = [
        migrations.RunPython(
            apply_schema,
            revert_schema,
            hints={"learner_schema_migration": True},
        ),
    ]
