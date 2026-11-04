"""Refresh the learners placed on a renamed programme or group.

The canonical name lives only in its owning curriculum table. Curriculum
children hold the parent's id, and propagate_programme_name /
propagate_group_name_to_learners refresh the copy of the name they carry.
Learner records do not: "Learner".learners and enrolment."Created_users" keep
only the placement ids, and the learner and enrolment models read the name
through those ids (learner_api.models._learner_placement_names). A rename
therefore never writes a learner or enrolment row.

What it still does for learners, as before, is request a fresh home projection
for everyone linked to the renamed record, found by a read-only id lookup on
the caller's connection -- so, inside the save's transaction, a failed save
takes the queued refresh events back with it.
"""
from django.db import connection


def _s(value):
    return str(value or '').strip()


def _refresh(affected, reason):
    # Invalidate the same learner projections an ordinary record save would.
    from learner_api.read_model import enqueue_learner_home_refresh

    for learner_id, kind in affected:
        if learner_id is not None:
            enqueue_learner_home_refresh(
                'commercial' if _s(kind).casefold() == 'commercial' else 'apprenticeship',
                learner_id, reason=reason, using='default',
            )


def placed_learners(id_column, placement_id, db=None):
    """``{(enrolment_id, learner_type)}`` for learners placed on one record; read-only.

    ``db`` is the caller's connection (default: this module's), so the lookup
    runs inside the caller's transaction.
    """
    if id_column not in {'programme_id', 'cohort_id', 'group_id'}:
        raise ValueError(f'Unknown placement column: {id_column}')
    with (db or connection).cursor() as cursor:
        cursor.execute(
            f'SELECT enrolment_id, learner_type FROM "Learner".learners WHERE {id_column} = %s',
            [placement_id],
        )
        return set(cursor.fetchall())


def propagate_programme_name_to_learners(programme_id, old_name, name):
    """Refresh the learners placed on a renamed programme; their rows keep the id."""
    programme_id, old_name, name = _s(programme_id), _s(old_name), _s(name)
    if not programme_id or not old_name or not name or old_name == name:
        return
    # Learner placement schemas are PostgreSQL-only.
    if connection.vendor != 'postgresql':
        return
    _refresh(placed_learners('programme_id', programme_id), 'programme-rename')


def propagate_group_name_to_learners(group, name):
    """Rename a group on its modules' copy of the name and refresh its learners.

    ``group`` is the row as it was before the rename.
    """
    from . import views, versioning

    group_id, old_name, name = _s(group.get('group_id')), _s(group.get('group_name')), _s(name)
    if not group_id or not name or name == old_name:
        return
    # Modules carry the group's name beside its id, as they carry the cohort's;
    # the cohort rename refreshes that copy, and so must this.
    with versioning.audit_context(
        actor_type=versioning.ACTOR_SYSTEM, source='recalculation', action='recalculated',
        metadata={'recalculated_from': 'group_rename', 'reason_code': 'group_name_propagation'},
    ):
        views.update_authoring_rows(
            views.AUTHORING_MODULES_TABLE, 'group_id = %s and coalesce(group_name, \'\') <> %s',
            [group_id, name], {'group_name': name},
        )
    if not old_name or connection.vendor != 'postgresql':
        return
    _refresh(placed_learners('group_id', group_id), 'group-rename')
