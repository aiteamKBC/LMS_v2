"""Rename a cohort atomically: its curriculum name copies, never learner rows."""
from django.db import connection


class CohortRenameConflict(ValueError):
    pass


def propagate_cohort_name(cohort, name):
    # Called inside the cohort PATCH transaction, before writing the parent.
    # The canonical name lives in curriculum.cohorts. "Learner".learners and
    # enrolment."Created_users" keep only the cohort id and read the name
    # through it, so no learner or enrolment row is written here.
    from . import views
    from .placement_rename import placed_learners, _refresh
    from .canonical_read_sql import current_status_sql

    cohort_id = cohort['cohort_id']
    old_name = cohort.get('cohort_name') or ''
    if name == old_name:
        return
    if not connection.in_atomic_block:
        raise RuntimeError('Cohort name propagation requires the parent transaction.')
    # A cohort belongs to its programme by id; ``status`` is its archive record.
    visibility = current_status_sql('c')
    with connection.cursor() as cursor:
        cursor.execute(
            f'''SELECT cohort_id FROM {views.authoring_table_name(views.COHORT_AUTHORING_DETAILS_TABLE)} c
               WHERE c.programme_id = %s AND cohort_name IN (%s, %s)
                 AND cohort_id <> %s AND {visibility}
                 {'FOR UPDATE' if connection.vendor == 'postgresql' else ''}''',
            [cohort.get('programme_id') or '', old_name, name, cohort_id],
        )
        if cursor.fetchone():
            raise CohortRenameConflict('Another cohort in this programme has the old or new name. Resolve the ambiguous placement before renaming.')
    # Learner placement schemas are PostgreSQL-only. The curriculum-only SQLite
    # harness has no learner records to refresh. A read-only id lookup on the
    # parent's connection, so a failed rename takes its refresh events back.
    affected = placed_learners('cohort_id', cohort_id, connection) if connection.vendor == 'postgresql' else set()
    # Invalidate the same learner projections as an ordinary record save.
    _refresh(affected, 'cohort-rename', using=connection.alias)
