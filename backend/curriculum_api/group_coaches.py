"""A group's coaches, stored in ``curriculum.group_coaches``.

The normalised schema moved the coach off the group row: ``curriculum.groups``
has no ``coach_id`` any more, and a group may have several coaches, one
``group_coaches`` row each (``group_id`` -> groups, ``coach_id`` -> coaches,
both RESTRICT).

The rest of the curriculum code still speaks of a group's coach through the
``coach_name`` key of a row or a write payload. Several coaches travel in that
one string, separated by ``COACH_SEPARATOR`` -- so a payload rebuilt from a
stored row (``{**row, 'coach_name': new}``) still means what it says. Reads
put ``coach_name`` (joined) and ``coach_names`` (the list) on group rows from
``curriculum_names.lookups``; writes go through ``store`` right after the group
row is written, as ``calendar_holidays.store_cohort_choices`` does for a
cohort's holiday choices.

Everything here is a no-op unless the table exists and the group row no longer
carries the coach itself (the SQLite test schema and older databases keep
``coach_name`` / ``coach_id`` on the row, handled as before).
"""
from __future__ import annotations

from django.db import connections

TABLE = '"curriculum"."group_coaches"'
GROUPS = '"curriculum"."groups"'
COACH_SEPARATOR = ', '

_IN_USE = {}


def in_use(using='default'):
    """True when group coaches live in ``curriculum.group_coaches`` (cached per process)."""
    if connections[using].vendor != 'postgresql':
        return False
    if using not in _IN_USE:
        with connections[using].cursor() as cursor:
            cursor.execute(
                "select to_regclass('curriculum.group_coaches') is not null, "
                "exists (select 1 from information_schema.columns where table_schema = 'curriculum' "
                "and table_name = 'groups' and column_name in ('coach_id', 'coach_name'))"
            )
            table_exists, coach_on_row = cursor.fetchone()
        _IN_USE[using] = bool(table_exists) and not bool(coach_on_row)
    return _IN_USE[using]


def split_names(value):
    """The coach names one ``coach_name`` value carries, in order, without repeats.

    Accepts a list as well as the joined string. Blank and 'Unassigned' are nobody.
    """
    if value is None:
        return []
    parts = value if isinstance(value, (list, tuple)) else str(value).split(',')
    names = []
    seen = set()
    for part in parts:
        name = str(part or '').strip()
        key = name.lower()
        if not name or key in ('unassigned', 'none', 'n/a') or key in seen:
            continue
        seen.add(key)
        names.append(name)
    return names


def join_names(names):
    return COACH_SEPARATOR.join(split_names(names))


def store(payload, rows, using='default'):
    """Write the coaches a group save carries (only when it carries ``coach_name``).

    Replaces the group's set: coaches no longer named are removed, new ones
    added, and the ones kept keep their row. Runs on the caller's connection and
    transaction. The rows handed back by the save are updated to show what is
    stored from now on.
    """
    if not payload or 'coach_name' not in payload or not in_use(using):
        return
    from . import curriculum_names
    group_ids = {str(row.get('group_id')) for row in (rows or []) if row and row.get('group_id')}
    if not group_ids and payload.get('group_id'):
        group_ids.add(str(payload['group_id']))
    if not group_ids:
        return
    names = split_names(payload.get('coach_name'))
    # An email names one person: it can only belong to a single chosen coach.
    email = str(payload.get('coach_email') or '').strip() if len(names) == 1 else ''
    coach_ids = []
    for name in names:
        coach_id = curriculum_names.staff_id('coaches', 'COACH', name, email, using=using)
        if coach_id and coach_id not in coach_ids:
            coach_ids.append(coach_id)
    with connections[using].cursor() as cursor:
        for group_id in sorted(group_ids):
            if coach_ids:
                cursor.execute(
                    f'delete from {TABLE} where group_id = %s and not (coach_id = any(%s))',
                    [group_id, coach_ids],
                )
                cursor.execute(
                    f'insert into {TABLE} (group_id, coach_id, created_at) '
                    f'select %s, unnest(%s::varchar[]), now() on conflict (group_id, coach_id) do nothing',
                    [group_id, coach_ids],
                )
            else:
                cursor.execute(f'delete from {TABLE} where group_id = %s', [group_id])
    curriculum_names.invalidate()
    data = curriculum_names.lookups(using)
    for row in rows or []:
        if row is None or not row.get('group_id'):
            continue
        stored = coach_names(data, row.get('group_id'))
        row['coach_name'] = join_names(stored)
        row['coach_names'] = stored


def coach_names(data, group_id):
    """The names of a group's coaches from a ``curriculum_names.lookups`` snapshot."""
    from .curriculum_names import _group_coach_names
    return _group_coach_names(data, group_id)


def release_groups(where_sql, params, using='default'):
    """Before groups matching ``where_sql`` are deleted: their coach links go with
    them (they reference the group with RESTRICT)."""
    if not in_use(using):
        return
    with connections[using].cursor() as cursor:
        cursor.execute(
            f'delete from {TABLE} where group_id in (select group_id from {GROUPS} where {where_sql})',
            params or [],
        )
    from .curriculum_names import invalidate
    invalidate()
