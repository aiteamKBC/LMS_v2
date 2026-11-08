"""Carry a cohort's display name to its current placement records atomically."""
from django.db import connection


class CohortRenameConflict(ValueError):
    pass


def propagate_cohort_name(cohort, name):
    # Called inside the cohort PATCH transaction, before writing the parent.
    # Names are still stored on enrolments; ambiguous legacy placements must
    # never be moved to a different cohort just because their labels match.
    from . import views

    cohort_id = cohort['cohort_id']
    old_name = cohort.get('cohort_name') or ''
    programme = cohort.get('programme_name') or ''
    if name == old_name:
        return
    if not connection.in_atomic_block:
        raise RuntimeError('Cohort name propagation requires the parent transaction.')
    from .placement_rename import learners_store_names, placed_learners
    from .archive_state import live_sql

    with connection.cursor() as cursor:
        # The programme is its id; withdrawal is status.
        cursor.execute(
            f'''SELECT cohort_id FROM {views.authoring_table_name(views.COHORT_AUTHORING_DETAILS_TABLE)}
               WHERE programme_id = %s AND cohort_name IN (%s, %s)
                 AND cohort_id <> %s AND {live_sql()}
                 {'FOR UPDATE' if connection.vendor == 'postgresql' else ''}''',
            [cohort.get('programme_id') or '', old_name, name, cohort_id],
        )
        if cursor.fetchone():
            raise CohortRenameConflict('Another cohort in this programme has the old or new name. Resolve the ambiguous placement before renaming.')
        affected = set()
        # Enrolment and learner placement schemas are PostgreSQL-only. The
        # curriculum-only SQLite harness has no learner records to propagate.
        if connection.vendor == 'postgresql' and not learners_store_names():
            # Learner records hold only cohort_id here: nothing to rename, but
            # their cached screens still show the old name.
            affected = placed_learners('cohort_id', cohort_id)
        elif connection.vendor == 'postgresql':
            # All writes use the parent's connection, including the enrolment and
            # profile schemas, so a failure rolls back the entire rename.
            # An enrolment whose profile carries this cohort's id is renamed by
            # that link, even when its programme label has gone stale since; one
            # without an id still needs its programme and old name to match.
            # Either way only the old name is replaced: no learner changes cohort.
            cursor.execute(
                '''UPDATE enrolment."Created_users" u SET "Cohort" = %s
                   WHERE u."Cohort" = %s
                     AND (EXISTS (
                            SELECT 1 FROM "Learner".learners l
                            WHERE l.enrolment_id = u.id AND l.cohort_id = %s)
                          OR (u."Programme" = %s AND NOT EXISTS (
                            SELECT 1 FROM "Learner".learners l
                            WHERE l.enrolment_id = u.id
                              AND nullif(btrim(l.cohort_id), '') IS NOT NULL
                              AND l.cohort_id <> %s)))
                   RETURNING u.id, u."Learner_type"''',
                [name, old_name, cohort_id, programme, cohort_id],
            )
            affected = set(cursor.fetchall())
            cursor.execute(
                '''UPDATE "Learner".learners SET cohort = %s
                   WHERE cohort_id = %s OR
                     (nullif(btrim(cohort_id), '') IS NULL AND programme = %s AND cohort = %s)
                   RETURNING enrolment_id, learner_type''',
                [name, cohort_id, programme, old_name],
            )
            affected.update(cursor.fetchall())
    # Groups and modules hold the cohort by id and read its name from it:
    # there is no copied name to refresh.
    # Raw updates deliberately avoid save helpers that can rebuild placements.
    # Still invalidate the same learner projections as an ordinary record save.
    from learner_api.read_model import enqueue_learner_home_refresh
    for learner_id, kind in affected:
        if learner_id is not None:
            enqueue_learner_home_refresh(
                'commercial' if str(kind or '').strip().casefold() == 'commercial' else 'apprenticeship',
                learner_id, reason='cohort-rename', using='default',
            )
