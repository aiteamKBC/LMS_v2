"""Compatibility exports for placement reads; existing staff writes stay here.

Names, SQL and request-local caches have one owner in catalogue infrastructure.
Staff identity resolution and writes retain their existing behavior.
"""
from __future__ import annotations
from django.db import connections
from .catalogue.domain.archive_policy import ACTIVE, INACTIVE, INACTIVE_STATUSES, is_inactive
from .catalogue.domain.placement_labels import (
    NAME_FIELDS, LIST_FIELDS, EMPTY_FIELDS, ROW_FIELDS, COACH_SEPARATOR, _text, _names, _group_coach_names, _index, _lists
)
from .catalogue.infrastructure.placement_reads import (
    _TTL_SECONDS, _LOCAL, _LOOKUP_SQL, _CHOICES_SQL,
    _GROUP_COACHES_SQL, _STANDARDS_SQL, NAME_TABLES, invalidate,
    invalidate_for, begin_request, end_request, lookups,
    _OPTIONAL_TABLES, _optional_tables, standards_digest, name_of,
    attach, programme_name_sql, cohort_name_sql
)


STAFF_FIELDS = {
    'modules': ('tutors', 'TUTOR', 'tutor_id', 'tutor_name', 'tutor_email'),
    'groups': ('coaches', 'COACH', 'coach_id', 'coach_name', 'coach_email'),
}


def staff_id(kind, prefix, name, email, using='default'):
    """Id of the ``kind`` ('tutors'/'coaches') record for this person; created when absent.

    Matched by email first, then by name (a live record before an archived
    one). A person first chosen for a module gets a record, as the directory
    is where staff are kept and this table only names who is assigned.
    """
    from datetime import datetime
    name, email = _text(name), _text(email)
    if not name and not email:
        return None
    table = f'"curriculum"."{kind}"'
    with connections[using].cursor() as cursor:
        for column, value in (('email', email), ('name', name)):
            if not value:
                continue
            match = 'lower(email) = lower(%s)' if column == 'email' else 'lower(btrim(name)) = lower(%s)'
            cursor.execute(
                f'select id from {table} where {match} order by (status = %s) desc, id limit 1', [value, ACTIVE],
            )
            found = cursor.fetchone()
            if found:
                return found[0]
        new_id = f'{prefix}-{datetime.utcnow():%Y%m%d%H%M%S%f}'
        cursor.execute(
            f'insert into {table} (id, name, email, status, created_at, updated_at) values (%s, %s, %s, %s, now(), now())',
            [new_id, name or email, email, ACTIVE],
        )
    invalidate()
    return new_id


def store_staff(table, payload, columns, using='default'):
    """``(payload, nullable)``: the chosen tutor / coach written as its id.

    A payload naming the person (``tutor_name``/``tutor_email``, ``coach_name``)
    and not the id gets the id; naming nobody clears it. Applies only where the
    table stores the id and not the name (the SQLite test schema still stores
    the name). The names themselves are left for the column filter to drop.
    """
    spec = STAFF_FIELDS.get(table)
    columns = set(columns or ())
    if not spec or not payload or connections[using].vendor != 'postgresql':
        return payload, set()
    kind, prefix, id_column, name_key, email_key = spec
    if id_column not in columns or name_key in columns:
        return payload, set()
    if name_key not in payload and email_key not in payload:
        return payload, set()
    name, email = payload.get(name_key), payload.get(email_key)
    if id_column in payload:
        # A payload built from the stored row (``{**row, 'tutor_name': new}``)
        # carries the old id, and the old email, beside the new choice. The
        # name/email decide: the id stands only while they still describe it.
        current = lookups(using)[kind].get(_text(payload.get(id_column))) or {}
        same_name = name_key not in payload or _text(name).lower() == _text(current.get('name')).lower()
        same_email = email_key not in payload or _text(email).lower() == _text(current.get('email')).lower()
        if same_name and same_email:
            return payload, set()
        if not same_name and same_email:
            email = ''  # the previous person's address: not the new choice's
    payload = dict(payload)
    if not _text(name) and not _text(email):
        payload[id_column] = None
        return payload, {id_column}
    payload[id_column] = staff_id(kind, prefix, name, email, using=using)
    return payload, set()
