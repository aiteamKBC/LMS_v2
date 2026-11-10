"""Names of curriculum entities, by id, for the normalised curriculum schema.

The curriculum tables keep keys, not copies: a module holds ``programme_id``,
``cohort_id``, ``group_id`` and ``tutor_id``; a group holds ``coach_id``. A
display name is therefore read from the owning row. This module answers those
reads from one round trip of the small reference tables, held briefly per
thread: long enough that one request's many reads share it, short enough that a
write is visible on the next request. ``invalidate()`` is called on every
curriculum write.

Lifecycle is one ``status`` column: ``inactive`` is archived/withdrawn,
anything else (``active``, a cohort's ``planned``) is live.
"""
from __future__ import annotations

import threading
import time

from django.db import connections

INACTIVE = 'inactive'
ACTIVE = 'active'
# 'archived' is accepted on read so a value written by an older process is never
# shown as live; the normalised schema itself only stores 'inactive'.
INACTIVE_STATUSES = ('inactive', 'archived')

_TTL_SECONDS = 2.0
_LOCAL = threading.local()

_LOOKUP_SQL = '''
    select 'p', programme_id::text, name::text, null::text, null::text, null::text, null::text, status::text from curriculum.programmes
    union all select 'c', cohort_id::text, cohort_name::text, programme_id::text, null, null, null, status::text from curriculum.cohorts
    union all select 'g', group_id::text, group_name::text, cohort_id::text, programme_id::text, {group_coach}, null, status::text from curriculum.groups
    union all select 'm', module_catalogue_id::text, title::text, group_id::text, cohort_id::text, tutor_id::text, programme_id::text, status::text from curriculum.modules
    union all select 't', id::text, name::text, email::text, null, null, null, status::text from curriculum.tutors
    union all select 'k', id::text, name::text, email::text, null, null, null, status::text from curriculum.coaches
'''
# A cohort's holiday choices ride the same round trip (they are read wherever a
# cohort row is). h.id keeps the order they were chosen in.
_CHOICES_SQL = '''
    union all select 'h', h.cohort_id::text, ch.source_record_id::text, h.is_selected::text, h.is_excluded::text,
                     null, null, h.id::text
    from curriculum.cohort_calendar_holidays h join curriculum.calendar_holidays ch on ch.id = h.calendar_holiday_id
'''
# A group's coaches, where they live in curriculum.group_coaches (the group row
# no longer carries coach_id; a group may have several). See group_coaches.
_GROUP_COACHES_SQL = '''
    union all select 'gc', gc.group_id::text, gc.coach_id::text, null, null, null, null, null
    from curriculum.group_coaches gc
'''
# A digest of every apprenticeship-standard KSB row (reference data the team
# edits in the database): the rows are re-read only when it changes, without a
# round trip of their own. Computed by the database; 32 characters come back.
_STANDARDS_SQL = '''
    union all select 's', md5(coalesce(string_agg(t::text, '|' order by t.id), '')), null, null, null, null, null, null
    from curriculum.standard_ksbs t
'''


def is_inactive(status):
    return str(status or '').strip().lower() in INACTIVE_STATUSES


# The tables lookups() reads. A write to any other table (weeks, components,
# KSB mappings, history ...) leaves every name it answers unchanged.
NAME_TABLES = frozenset({
    'programmes', 'cohorts', 'groups', 'modules', 'tutors', 'coaches', 'group_coaches',
    'cohort_calendar_holidays', 'calendar_holidays', 'standard_ksbs',
})


def invalidate():
    _LOCAL.lookups = None


def invalidate_for(table):
    """Drop the cached names only when ``table`` is one they are read from."""
    if str(table or '').split('.')[-1].strip('"') in NAME_TABLES:
        invalidate()


def begin_request():
    """Hold the names read during one request for the rest of it.

    The 2 s TTL exists for the other processes' writes (there is no shared
    cache). Inside one request it only made a long save re-read every name
    table every two seconds; a write here to a name table still invalidates.
    """
    _LOCAL.request_token = object()


def end_request():
    _LOCAL.request_token = None


def lookups(using='default'):
    """``{'programmes': {id: {...}}, 'cohorts': ..., 'groups': ..., 'modules': ..., 'tutors': ..., 'coaches': ...}``."""
    cached = getattr(_LOCAL, 'lookups', None)
    token = getattr(_LOCAL, 'request_token', None)
    if cached and (cached['at'] + _TTL_SECONDS > time.monotonic()
                   or (token is not None and cached.get('request_token') is token)):
        return cached
    data = {'programmes': {}, 'cohorts': {}, 'groups': {}, 'modules': {}, 'tutors': {}, 'coaches': {},
            'cohort_holidays': {}}
    choices = []
    coach_links = []
    with connections[using].cursor() as cursor:
        extra = _optional_tables(using)
        group_coach = 'coach_id::text' if extra.get('group_coach_column') else 'null::text'
        cursor.execute(_LOOKUP_SQL.format(group_coach=group_coach)
                       + (_GROUP_COACHES_SQL if extra.get('group_coaches') else '')
                       + (_CHOICES_SQL if extra['choices'] else '')
                       + (_STANDARDS_SQL if extra['standards'] else ''))
        for kind, key, name, a, b, c, d, status in cursor.fetchall():
            if kind == 's':
                data['standards_digest'] = key
                continue
            if kind == 'h':
                choices.append((int(status), key, name, a == 'true', b == 'true'))
                continue
            if kind == 'gc':
                coach_links.append((key, name))
                continue
            if kind == 'p':
                data['programmes'][key] = {'name': name or '', 'status': status}
            elif kind == 'c':
                data['cohorts'][key] = {'name': name or '', 'programme_id': a, 'status': status}
            elif kind == 'g':
                data['groups'][key] = {'name': name or '', 'cohort_id': a, 'programme_id': b, 'coach_id': c,
                                       'coach_ids': [c] if c else [], 'status': status}
            elif kind == 'm':
                data['modules'][key] = {'title': name or '', 'group_id': a, 'cohort_id': b, 'tutor_id': c,
                                         'programme_id': d, 'status': status}
            elif kind == 't':
                data['tutors'][key] = {'name': name or '', 'email': a or '', 'status': status}
            elif kind == 'k':
                data['coaches'][key] = {'name': name or '', 'email': a or '', 'status': status}
    for group_id, coach_id in coach_links:
        group = data['groups'].get(group_id)
        if group is not None and coach_id and coach_id not in group['coach_ids']:
            group['coach_ids'].append(coach_id)
    for group in data['groups'].values():
        if len(group['coach_ids']) > 1:
            # Shown in name order, so the joined label is stable between reads.
            group['coach_ids'].sort(key=lambda key: ((data['coaches'].get(key) or {}).get('name', '').lower(), key))
        # coach_id stays the first coach for callers that read one.
        group['coach_id'] = group['coach_ids'][0] if group['coach_ids'] else None
    for _order, cohort_id, holiday_id, is_selected, is_excluded in sorted(choices):
        entry = data['cohort_holidays'].setdefault(cohort_id, {'selected': [], 'excluded': []})
        if is_selected:
            entry['selected'].append(holiday_id)
        if is_excluded:
            entry['excluded'].append(holiday_id)
    data['at'] = time.monotonic()
    data['request_token'] = getattr(_LOCAL, 'request_token', None)
    _LOCAL.lookups = data
    return data


_OPTIONAL_TABLES = {}


def _optional_tables(using='default'):
    """Which optional parts the lookup query can include (cached per process)."""
    if using not in _OPTIONAL_TABLES:
        with connections[using].cursor() as cursor:
            cursor.execute(
                "select to_regclass('curriculum.cohort_calendar_holidays') is not null "
                "and to_regclass('curriculum.calendar_holidays') is not null, "
                "to_regclass('curriculum.standard_ksbs') is not null"
            )
            choices, standards = cursor.fetchone()
            cursor.execute(
                "select to_regclass('curriculum.group_coaches') is not null, "
                "exists (select 1 from information_schema.columns where table_schema = 'curriculum' "
                "and table_name = 'groups' and column_name = 'coach_id')"
            )
            group_coaches, group_coach_column = cursor.fetchone()
        _OPTIONAL_TABLES[using] = {'choices': bool(choices), 'standards': bool(standards),
                                   'group_coaches': bool(group_coaches),
                                   'group_coach_column': bool(group_coach_column)}
    return _OPTIONAL_TABLES[using]


def standards_digest(using='default'):
    """The current digest of curriculum.standard_ksbs, or '' when unknown."""
    if connections[using].vendor != 'postgresql':
        return ''
    return lookups(using).get('standards_digest') or ''


def name_of(kind, key, field='name', using='default'):
    """The ``field`` of one ``kind`` ('programmes', 'groups', ...) row by id, else ''."""
    if not key:
        return ''
    return (lookups(using)[kind].get(str(key)) or {}).get(field, '') or ''


# --- names on rows ------------------------------------------------------------
# The rest of the curriculum code reads a module's programme / cohort / group /
# tutor / coach names off the row, as it always has. The tables keep only the
# ids, so the names are put on the rows here, after the read, from the cached
# lookups -- never selected, never stored.

NAME_FIELDS = {
    'modules': ('programme_name', 'cohort_name', 'group_name', 'tutor_name', 'tutor_email', 'coach_name'),
    'groups': ('programme_name', 'cohort_name', 'coach_name', 'coach_names'),
    'cohorts': ('programme_name',),
}

# Lists the rows used to carry and the schema now answers by key: a group's
# modules are the live modules naming it, a cohort's groups the live groups
# naming it, a tutor's modules the live modules naming the tutor, a coach's
# groups the live groups naming the coach. Ordered as the stored lists were
# rebuilt: modules by title, groups by name, staff assignments by id.
LIST_FIELDS = {
    'groups': ('module_ids', 'module_names'),
    'cohorts': ('group_ids', 'module_names'),
    'tutors': ('assigned_module_ids',),
    'coaches': ('assigned_group_ids',),
}

# Staff profile fields the curriculum's tutors / coaches no longer keep (the
# staff directory holds the person); rows still answer them, empty.
EMPTY_FIELDS = {
    'tutors': ('job_title', 'notes'),
    'coaches': ('job_title', 'notes', 'phone'),
}

ROW_FIELDS = {
    table: (*NAME_FIELDS.get(table, ()), *LIST_FIELDS.get(table, ()), *EMPTY_FIELDS.get(table, ()))
    for table in {*NAME_FIELDS, *LIST_FIELDS, *EMPTY_FIELDS}
}


def _text(value):
    return str(value or '').strip()


def _names(table, row, data):
    programme = data['programmes'].get(_text(row.get('programme_id'))) or {}
    cohort = data['cohorts'].get(_text(row.get('cohort_id'))) or {}
    if table == 'cohorts':
        return {'programme_name': programme.get('name', '')}
    if table == 'groups':
        coaches = _group_coach_names(data, row.get('group_id'), row.get('coach_id'))
        return {'programme_name': programme.get('name', ''), 'cohort_name': cohort.get('name', ''),
                'coach_name': COACH_SEPARATOR.join(coaches), 'coach_names': coaches}
    group = data['groups'].get(_text(row.get('group_id'))) or {}
    tutor = data['tutors'].get(_text(row.get('tutor_id'))) or {}
    # A module's coaches are its group's coaches.
    coaches = _group_coach_names(data, row.get('group_id'))
    return {
        'programme_name': programme.get('name', ''), 'cohort_name': cohort.get('name', ''),
        'group_name': group.get('name', ''), 'tutor_name': tutor.get('name', ''),
        'tutor_email': tutor.get('email', ''), 'coach_name': COACH_SEPARATOR.join(coaches),
    }


# Several coaches share one ``coach_name`` string (see group_coaches).
COACH_SEPARATOR = ', '


def _group_coach_names(data, group_id, row_coach_id=None):
    """Names of a group's coaches; ``row_coach_id`` is a row that still stores one."""
    group = data['groups'].get(_text(group_id)) or {}
    coach_ids = list(group.get('coach_ids') or ())
    if not coach_ids:
        single = _text(row_coach_id) or _text(group.get('coach_id'))
        coach_ids = [single] if single else []
    names = []
    for coach_id in coach_ids:
        name = _text((data['coaches'].get(coach_id) or {}).get('name'))
        if name:
            names.append(name)
    return names


def _index(data):
    """Live children per parent, built once per lookups snapshot."""
    index = data.get('_index')
    if index is not None:
        return index
    index = {'modules_by_group': {}, 'modules_by_cohort': {}, 'modules_by_tutor': {},
             'groups_by_cohort': {}, 'groups_by_coach': {}}
    modules = sorted(
        ((key, value) for key, value in data['modules'].items() if not is_inactive(value.get('status'))),
        key=lambda item: (item[1].get('title') or '', item[0]),
    )
    for module_id, module in modules:
        entry = (module_id, module.get('title') or '')
        for parent, bucket in ((module.get('group_id'), 'modules_by_group'),
                               (module.get('cohort_id'), 'modules_by_cohort'),
                               (module.get('tutor_id'), 'modules_by_tutor')):
            if parent:
                index[bucket].setdefault(parent, []).append(entry)
    groups = sorted(
        ((key, value) for key, value in data['groups'].items() if not is_inactive(value.get('status'))),
        key=lambda item: (item[1].get('name') or '', item[0]),
    )
    for group_id, group in groups:
        if group.get('cohort_id'):
            index['groups_by_cohort'].setdefault(group['cohort_id'], []).append(group_id)
        for coach_id in group.get('coach_ids') or ([group['coach_id']] if group.get('coach_id') else []):
            index['groups_by_coach'].setdefault(coach_id, []).append(group_id)
    data['_index'] = index
    return index


def _lists(table, row, data):
    index = _index(data)
    if table == 'groups':
        owned = index['modules_by_group'].get(_text(row.get('group_id')), [])
        return {'module_ids': [key for key, _ in owned], 'module_names': [title for _, title in owned]}
    if table == 'cohorts':
        cohort_id = _text(row.get('cohort_id'))
        return {'group_ids': list(index['groups_by_cohort'].get(cohort_id, [])),
                'module_names': [title for _, title in index['modules_by_cohort'].get(cohort_id, [])]}
    if table == 'tutors':
        return {'assigned_module_ids': sorted(key for key, _ in index['modules_by_tutor'].get(_text(row.get('id')), []))}
    if table == 'coaches':
        return {'assigned_group_ids': sorted(index['groups_by_coach'].get(_text(row.get('id')), []))}
    return {}


def attach(table, rows, requested=None, excluded=None, using='default'):
    """Put what ``table``'s rows refer to by id on ``rows``: names, child lists.

    ``requested`` / ``excluded`` are the caller's narrowed column list and its
    exclusions: a field is added only where a ``select *`` would have returned
    it. A key the row already has (a column the SQL selected) is kept. Off
    PostgreSQL (the SQLite test schema still stores these columns) nothing is
    done. Mutates and returns ``rows``.
    """
    if table == 'cohorts' and rows and connections[using].vendor == 'postgresql':
        # A cohort's holiday choices: cohort_calendar_holidays, by cohort id.
        from . import calendar_holidays
        calendar_holidays.attach_cohort_choices(rows, requested=requested, excluded=excluded)
    fields = [
        field for field in ROW_FIELDS.get(table, ())
        if (requested is None or field in requested) and field not in (excluded or ())
    ]
    if not rows or not fields or connections[using].vendor != 'postgresql':
        return rows
    # SQL-resolved labels (including empty names for missing FKs) are final.
    # Fetch the cached lookup only if a row still needs a projection.
    data = None
    names = set(NAME_FIELDS.get(table, ()))
    lists = set(LIST_FIELDS.get(table, ()))
    for row in rows:
        if row is None:
            continue
        missing = [field for field in fields if field not in row]
        if not missing:
            continue
        values = {}
        if data is None and (names | lists).intersection(missing):
            data = lookups(using)
        if names.intersection(missing):
            values.update(_names(table, row, data))
        if lists.intersection(missing):
            values.update(_lists(table, row, data))
        for field in missing:
            row[field] = values.get(field, '')
    return rows


def programme_name_sql(alias, programmes_table='"curriculum"."programmes"'):
    """SQL for the programme name of ``alias``'s row (for ORDER BY): the name is not on the row."""
    return f'(select p.name from {programmes_table} p where p.programme_id = {alias}.programme_id)'


def cohort_name_sql(alias, cohorts_table='"curriculum"."cohorts"'):
    return f'(select c.cohort_name from {cohorts_table} c where c.cohort_id = {alias}.cohort_id)'


# --- staff on writes ----------------------------------------------------------
# Screens choose a tutor / coach from the staff directory by name and email; the
# module stores ``tutor_id`` and the group ``coach_id``, keys of the curriculum's
# own tutors / coaches records.

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
