"""Refresh the learners placed on a renamed programme or group.

The canonical name lives only in its owning curriculum table. Curriculum
children hold the parent's id and read the name through it, so a rename
writes no curriculum child row either.
Learner records do not: "Learner".learners and enrolment."Created_users" keep
only the placement ids, and the learner and enrolment models read the name
through those ids (learner_api.models._learner_placement_names). A rename
therefore never writes a learner or enrolment row.

What it still does for learners, as before, is request a fresh home projection
for everyone linked to the renamed record, found by a read-only id lookup on
the caller's connection -- so, inside the save's transaction, a failed save
takes the queued refresh events back with it.
"""
from django.db import DatabaseError, connection


def _s(value):
    return str(value or '').strip()


def _default_connection():
    return connection


def _refresh(affected, reason, *, using='default'):
    # Invalidate the same learner projections an ordinary record save would.
    from learner_api.read_model import enqueue_learner_home_refresh

    for learner_id, kind in affected:
        if learner_id is not None:
            enqueue_learner_home_refresh(
                'commercial' if _s(kind).casefold() == 'commercial' else 'apprenticeship',
                learner_id, reason=reason, using=using,
            )


def placed_learners(id_column, placement_id, db=None, *, connection=None):
    """``{(enrolment_id, learner_type)}`` for learners placed on one record; read-only.

    The optional connection accepts the historical third positional ``db``
    argument or the explicit ``connection=`` keyword. Two-argument callers
    continue using Django's default connection. No placement is written.
    """
    if id_column not in {'programme_id', 'cohort_id', 'group_id'}:
        raise ValueError(f'Unknown placement column: {id_column}')
    if db is not None and connection is not None and db is not connection:
        raise ValueError('Pass only one rename connection.')
    selected = connection if connection is not None else db
    if selected is None:
        selected = _default_connection()
    with selected.cursor() as cursor:
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
    _refresh(placed_learners('programme_id', programme_id, connection),
             'programme-rename', using=connection.alias)


def propagate_group_name_to_learners(group, name):
    """Refresh the learners placed on a renamed group.

    ``group`` is the row as it was before the rename.
    """
    group_id, old_name, name = _s(group.get('group_id')), _s(group.get('group_name')), _s(name)
    if not group_id or not name or name == old_name:
        return
    if not connection.in_atomic_block:
        raise RuntimeError('Group name propagation requires the parent transaction.')
    if not old_name or connection.vendor != 'postgresql':
        return
    _refresh(placed_learners('group_id', group_id, connection),
             'group-rename', using=connection.alias)
