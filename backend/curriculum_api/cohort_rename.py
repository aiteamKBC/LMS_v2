"""Rename a cohort atomically: its curriculum name copies, never learner rows."""
from django.db import connection


class CohortRenameConflict(ValueError):
    pass


def propagate_cohort_name(cohort, name):
    # Called inside the cohort PATCH transaction, before writing the parent.
    # The canonical name lives in curriculum.cohorts. "Learner".learners and
    # enrolment."Created_users" keep only the cohort id and read the name
    # through it, so no learner or enrolment row is written here.
    from . import views, versioning
    from .placement_rename import placed_learners, curriculum_columns, rename_child_copy, _refresh
    from .canonical_read_sql import current_status_sql

    cohort_id = cohort['cohort_id']
    old_name = cohort.get('cohort_name') or ''
    programme = cohort.get('programme_name') or ''
    if name == old_name:
        return
    if not connection.in_atomic_block:
        raise RuntimeError('Cohort name propagation requires the parent transaction.')
    columns = curriculum_columns(views.COHORT_AUTHORING_DETAILS_TABLE, connection)
    # Prefer canonical programme identity; support the old curriculum-only shape.
    scope_column = 'programme_id' if 'programme_id' in columns else 'programme_name'
    scope = (cohort.get('programme_id') or '') if scope_column == 'programme_id' else programme
    visibility = current_status_sql('c') if 'status' in columns else 'c.deleted_at IS NULL'
    with connection.cursor() as cursor:
        cursor.execute(
            f'''SELECT cohort_id FROM {views.authoring_table_name(views.COHORT_AUTHORING_DETAILS_TABLE)} c
               WHERE c.{scope_column} = %s AND cohort_name IN (%s, %s)
                 AND cohort_id <> %s AND {visibility}
                 {'FOR UPDATE' if connection.vendor == 'postgresql' else ''}''',
            [scope, old_name, name, cohort_id],
        )
        if cursor.fetchone():
            raise CohortRenameConflict('Another cohort in this programme has the old or new name. Resolve the ambiguous placement before renaming.')
    # Learner placement schemas are PostgreSQL-only. The curriculum-only SQLite
    # harness has no learner records to refresh. A read-only id lookup on the
    # parent's connection, so a failed rename takes its refresh events back.
    affected = placed_learners('cohort_id', cohort_id, connection) if connection.vendor == 'postgresql' else set()
    with versioning.audit_context(
        actor_type=versioning.ACTOR_SYSTEM, source='recalculation', action='recalculated',
        metadata={'recalculated_from': 'cohort_rename', 'reason_code': 'cohort_name_propagation'},
    ):
        for table in (views.GROUPS_TABLE, views.AUTHORING_MODULES_TABLE):
            rename_child_copy(
                views, table, 'cohort_id', cohort_id, 'cohort_name', name, connection,
            )
    # Invalidate the same learner projections as an ordinary record save.
    _refresh(affected, 'cohort-rename', using=connection.alias)
