"""Authoritative placement lookup SQL, request-local cache and row completion.

The legacy names facade and calendar consumers share this single cache owner.
No API import, staff write capability or provider operation.
"""
import threading
import time
from django.db import connections
from ..domain.placement_labels import NAME_FIELDS, LIST_FIELDS, ROW_FIELDS, _names, _lists
from .holiday_reads import calendar_in_use

CHOICE_FIELDS = ('holiday_ids', 'excluded_holiday_ids')

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


_CHOICES_SQL = '''
    union all select 'h', h.cohort_id::text, ch.source_record_id::text, h.is_selected::text, h.is_excluded::text,
                     null, null, h.id::text
    from curriculum.cohort_calendar_holidays h join curriculum.calendar_holidays ch on ch.id = h.calendar_holiday_id
'''


_GROUP_COACHES_SQL = '''
    union all select 'gc', gc.group_id::text, gc.coach_id::text, null, null, null, null, null
    from curriculum.group_coaches gc
'''


_STANDARDS_SQL = '''
    union all select 's', md5(coalesce(string_agg(t::text, '|' order by t.id), '')), null, null, null, null, null, null
    from curriculum.standard_ksbs t
'''


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
        attach_cohort_choices(rows, requested=requested, excluded=excluded)
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


def attach_cohort_choices(rows, requested=None, excluded=None):
    from ..application.cohort_calendar import attach_cohort_choices as implementation
    return implementation(
        rows, requested, excluded, CHOICE_FIELDS=CHOICE_FIELDS, in_use=calendar_in_use, lookups=lookups,
    )
