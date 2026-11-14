"""Resolve learning content to its physical owner.

Free courses own their rows in the three free-course tables. Ordinary modules
retain their existing tables. Shared readers use read-only projections so the
learning identities already held by progress, files and bookmarks stay valid.
"""
import hashlib
import json
import re
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from inspect import signature
from time import monotonic

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection
from psycopg import sql
from psycopg.types.json import Jsonb

from .free_course_native_schema import TABLES, REFERENCE_VIEWS
from .free_course_contract import NATIVE_VIEWS

READ_VIEWS = {**{table: pair[0] for table, pair in TABLES.items()}, **REFERENCE_VIEWS}

_ready = {}
_not_ready_until = {}
_native_only = ContextVar('native_free_course_authoring', default=False)
JSON_COLUMNS = {'settings_json', 'ksb_mappings', 'learning_outcomes', 'epa_requirements',
                'professional_qualification_outcomes', 'ai_material', 'weekly_schedule',
                'session_holidays', 'session_overrides', 'module_overview'}

NATIVE_REQUIRED_COLUMNS = (
    ('free_courses', 'content_ref'),
    ('free_courses', 'converted_at'),
    ('free_courses', 'authoring_data'),
    ('free_courses', 'managed_by_builder'),
    ('free_courses', 'storage_version'),
    ('free_course_weeks', 'content_ref'),
    ('free_course_weeks', 'course_id'),
    ('free_course_weeks', 'authoring_data'),
    ('free_programme_components', 'content_ref'),
    ('free_programme_components', 'free_module_id'),
    ('free_programme_components', 'authoring_data'),
)


def enabled(db=connection, *, refresh=False):
    if db.vendor != 'postgresql':
        return False
    key = (db.alias, db.settings_dict.get('HOST'), db.settings_dict.get('PORT'), db.settings_dict.get('NAME'))
    if not refresh and key in _ready:
        return _ready[key]
    if not refresh and monotonic() < _not_ready_until.get(key, 0):
        return False
    required_values = ','.join(['(%s,%s)'] * len(NATIVE_REQUIRED_COLUMNS))
    required_params = [value for pair in NATIVE_REQUIRED_COLUMNS for value in pair]
    with db.cursor() as cursor:
        cursor.execute(f"""WITH required_columns(table_name,column_name) AS (
                VALUES {required_values}
            ), required_views(view_name) AS (
                SELECT unnest(%s::text[])
            )
            SELECT
                NOT EXISTS (
                    SELECT 1 FROM required_columns required
                    WHERE NOT EXISTS (
                        SELECT 1 FROM information_schema.columns actual
                        WHERE actual.table_schema='curriculum'
                          AND actual.table_name=required.table_name
                          AND actual.column_name=required.column_name
                    )
                )
                AND NOT EXISTS (
                    SELECT 1 FROM required_views required
                    WHERE to_regclass('curriculum.' || required.view_name) IS NULL
                )""", [*required_params, list(NATIVE_VIEWS.values())])
        ready = cursor.fetchone()[0]
    # A worker may have answered requests before the coordinated cutover.
    # Never keep that negative result for its entire lifetime: after migration
    # it must see the native tables without falling back to ordinary modules.
    if ready is True:
        _ready[key] = True
        _not_ready_until.pop(key, None)
    else:
        _ready.pop(key, None)
        # Keep catalogue reads inexpensive on a database awaiting cutover.
        _not_ready_until[key] = monotonic() + 5
    return ready is True


def reset():
    _ready.clear()
    _not_ready_until.clear()


def is_free_course_payload(payload):
    return isinstance(payload, dict) and (
        payload.get('isFreeCourse') is True
        or payload.get('sourceType', payload.get('source_type')) == 'free_course'
    )


def creation_unavailable_response(payload):
    """Refuse public free-course creation until the storage cutover is installed.

    Historical migration/fixture writers still need to understand the old
    representation. Public creates must never silently use that representation.
    After cutover the ordinary-table CHECK also enforces the storage boundary.
    """
    if not is_free_course_payload(payload) or enabled(refresh=True):
        return None
    from django.http import JsonResponse
    response = JsonResponse({
        'error': 'Free-course creation is temporarily unavailable. Please contact an administrator. '
                 'No course has been created.',
        'code': 'free_course_storage_not_ready',
    }, status=503)
    response['Cache-Control'] = 'no-store'
    return response


def native_only():
    return _native_only.get()


@contextmanager
def native_authoring_scope():
    token = _native_only.set(True)
    try:
        yield
    finally:
        _native_only.reset(token)


def with_course_storage(function):
    """Select storage for a single course without consulting ordinary tables."""
    parameters = signature(function)
    @wraps(function)
    def wrapped(*args, **kwargs):
        if native_only():
            return function(*args, **kwargs)
        binding = parameters.bind(*args, **kwargs)
        bound = binding.arguments
        if bound.get('payloads') is not None:
            # Inspect a bulk iterator once and forward the materialised rows;
            # consuming it solely for routing would silently discard the save.
            bound['payloads'] = list(bound['payloads'])
            args, kwargs = binding.args, binding.kwargs
        payload = bound.get('payload') or {}
        request = bound.get('request')
        if not payload and request is not None and request.method in {'POST', 'PATCH'}:
            try:
                payload = json.loads(request.body)
            except (ValueError, UnicodeDecodeError):
                # Let the endpoint return its normal malformed-body response.
                payload = {}
        reference = (bound.get('module_catalogue_id') or bound.get('identifier')
                     or (payload.get('module_catalogue_id') if isinstance(payload, dict) else None))
        creating = is_free_course_payload(payload)
        batch = bound.get('payloads') or []
        owners = {row.get('module_catalogue_id') for row in batch}
        if enabled(refresh=creating and request is not None) and (creating or course(reference) or (owners and all(course(owner) for owner in owners))):
            with native_authoring_scope():
                return function(*args, **kwargs)
        return function(*args, **kwargs)
    return wrapped


def native_read_table(table):
    return f'"curriculum"."{NATIVE_VIEWS[table]}"'


def read_table(table, db=connection):
    if native_only() and table in NATIVE_VIEWS:
        return native_read_table(table)
    name = READ_VIEWS[table] if table in READ_VIEWS and enabled(db) else table
    return f'"curriculum"."{name}"' if db.vendor == 'postgresql' else db.ops.quote_name(name)


_SQL_PARTS = re.compile(r"(--[^\n]*|/\*[\s\S]*?\*/|'(?:''|[^'])*'|\$([A-Za-z_][A-Za-z_0-9]*|)\$[\s\S]*?\$\2\$)")
_READ_NAMES = '|'.join(map(re.escape, READ_VIEWS))
_READ_SOURCE = re.compile(r'\b(FROM|JOIN)\s+(?:"curriculum"|curriculum)\.(?:"(' + _READ_NAMES + r')"|(' + _READ_NAMES + r'))(?![\w"])', re.I)


def read_sql(statement, db=connection):
    """Opt-in routing for existing shared content SELECTs.

    Applied at explicit read call sites, never installed as a connection hook.
    SQL literals/comments and writes stay untouched. Predicates and parameters
    (including learner ownership) remain the caller's responsibility.
    """
    if not isinstance(statement, str) or not _READ_SOURCE.search(statement):
        return statement
    if not re.match(r'^\s*(SELECT|WITH)\b', statement, re.I) or not enabled(db):
        return statement
    parts = []
    end = 0
    def replace(match):
        table = (match[2] or match[3]).lower()
        following = match.string[match.end():]
        alias = re.match(r'\s+(?:AS\s+)?("[^"\n]+"|[a-zA-Z_][a-zA-Z_0-9]*)', following, re.I)
        reserved = {'WHERE', 'JOIN', 'ON', 'ORDER', 'GROUP', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
                    'FULL', 'CROSS', 'UNION', 'LIMIT', 'OFFSET', 'FOR', 'WINDOW', 'HAVING', 'USING'}
        explicit = alias and alias[1].upper() not in reserved
        return match[1] + ' ' + read_table(table, db) + ('' if explicit else ' AS ' + table)
    for match in _SQL_PARTS.finditer(statement):
        parts.extend((_READ_SOURCE.sub(replace, statement[end:match.start()]), match[0]))
        end = match.end()
    parts.append(_READ_SOURCE.sub(replace, statement[end:]))
    return ''.join(parts)


def free_read_table(table):
    """Retain older API identity field names without retaining their old FKs."""
    aliases = {'free_courses': 'module_catalogue_id', 'free_course_weeks': 'authoring_week_id',
               'free_programme_components': 'authoring_component_id'}
    if table in aliases and enabled():
        return f'(SELECT f.*, content_ref AS {aliases[table]} FROM curriculum.{table} f) free_content'
    return read_table(table)


def _rows(cursor):
    names = [column[0] for column in cursor.description]
    rows = [dict(zip(names, row)) for row in cursor.fetchall()]
    for row in rows:
        for name in ('authoring_data', 'details_json', 'completion_json'):
            if isinstance(row.get(name), str):
                row[name] = json.loads(row[name])
        if 'authoring_data' in row and isinstance(row.get('ksb_mappings'), str):
            row['ksb_mappings'] = json.loads(row['ksb_mappings'])
    return rows


def course(reference, *, lock=False):
    if not reference or not enabled():
        return None
    with connection.cursor() as cursor:
        cursor.execute('SELECT * FROM curriculum.free_courses WHERE content_ref=%s AND converted_at IS NULL'
                       + (' FOR UPDATE' if lock else ''), [reference])
        return next(iter(_rows(cursor)), None)


def _data(values):
    result = dict(values)
    for key in JSON_COLUMNS:
        if isinstance(result.get(key), str):
            result[key] = json.loads(result[key])
    return json.loads(json.dumps(result, cls=DjangoJSONEncoder))


def _write(table, key, identity, values):
    fields = [key, *[name for name in values if name != key]]
    params = [identity, *[Jsonb(values[name]) if isinstance(values[name], (dict, list)) else values[name]
                          for name in fields[1:]]]
    assignments = sql.SQL(', ').join(sql.SQL('{}=excluded.{}').format(sql.Identifier(name), sql.Identifier(name))
                                   for name in fields[1:] if name != 'created_at')
    with connection.cursor() as cursor:
        cursor.execute(sql.SQL('INSERT INTO curriculum.{} ({}) VALUES ({}) ON CONFLICT ({}) DO UPDATE SET {} RETURNING *').format(
            sql.Identifier(table), sql.SQL(', ').join(map(sql.Identifier, fields)),
            sql.SQL(', ').join(sql.Placeholder() for _ in fields), sql.Identifier(key), assignments), params)
        return _rows(cursor)[0]


def upsert(table, values):
    """Return an independent saved row, or None when ordinary storage owns it.

    Call inside the normal authoring transaction. This function never writes to
    modules/weeks/components and never creates an upload request.
    """
    if table not in TABLES or not enabled():
        return None
    reference = values.get('module_catalogue_id')
    owner = course(reference, lock=True)
    creating = table == 'modules' and values.get('source_type') == 'free_course'
    if owner is None and not creating:
        if native_only():
            raise ValueError('The free-course content owner does not exist.')
        return None
    row = _data(values)
    if table == 'modules':
        if row.get('source_type') not in (None, 'free_course'):
            raise ValueError('Use the free-course conversion workflow to move this course into a programme.')
        for field in ('programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name'):
            if str(row.get(field) or '').strip().lower() not in ('', 'unassigned', 'unassigned programme'):
                raise ValueError('An independent free course cannot have a programme, cohort or group.')
        if owner is None:
            identifier = 'FC-' + hashlib.sha256(str(reference).encode()).hexdigest()[:32]
            owner = {'id': identifier, 'authoring_data': {}}
        data = {**{'quality_score': 0, 'is_programme_deleted': False, 'session_overrides': {},
                    'sessions_number': 0, 'learner_roster_mode': 'manual'}, **owner['authoring_data'], **row}
        data.update(source_type='free_course', learner_roster_mode='manual')
        direct = {'title': 'course_name', 'description': 'description', 'cover_image_url': 'cover_image_url',
                  'total_otjh': 'total_otjh', 'is_for_sale': 'is_for_sale', 'price': 'price', 'currency': 'currency',
                  'weeks_number': 'week_count', 'created_at': 'created_at', 'updated_at': 'updated_at', 'deleted_at': 'deleted_at'}
        fields = {destination: row[name] for name, destination in direct.items() if name in row}
        fields.update(content_ref=reference, authoring_data=data, managed_by_builder=True, storage_version=2)
        _write('free_courses', 'id', owner['id'], fields)
    elif table in ('weeks', 'components'):
        physical = TABLES[table][1]
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL('SELECT * FROM curriculum.{} WHERE content_ref=%s').format(sql.Identifier(physical)), [row['id']])
            existing = next(iter(_rows(cursor)), None)
        data = {**{'is_programme_deleted': False, 'library_state': '', 'display_order': 0},
                **((existing or {}).get('authoring_data') or {}), **row}
        if table == 'weeks':
            if existing and existing['course_id'] != owner['id']:
                raise ValueError('This week belongs to another course.')
            direct = {'week_number': 'week_number', 'title': 'week_title', 'display_order': 'display_order',
                      'created_at': 'created_at', 'updated_at': 'updated_at', 'deleted_at': 'deleted_at'}
            fields = {destination: row[name] for name, destination in direct.items() if name in row}
            fields.update(course_id=owner['id'], course_name=owner.get('course_name', ''),
                          content_ref=row['id'], authoring_data=data)
            if not existing:
                fields['week_id'] = row['id']
        else:
            with connection.cursor() as cursor:
                cursor.execute('SELECT id FROM curriculum.free_course_weeks WHERE content_ref=%s AND course_id=%s',
                               [row['week_id'], owner['id']])
                week = cursor.fetchone()
                if not week:
                    raise ValueError('This component week does not belong to the course.')
                if existing:
                    cursor.execute('SELECT course_id FROM curriculum.free_course_weeks WHERE id=%s', [existing['free_module_id']])
                    if cursor.fetchone()[0] != owner['id']:
                        raise ValueError('This component belongs to another course.')
            direct = ('type', 'title', 'description', 'expected_otjh', 'points', 'reflection_required',
                      'workplace_evidence_required', 'tutor_validation_required', 'display_order', 'settings_json',
                      'created_at', 'updated_at', 'deleted_at')
            fields = {name: row[name] for name in direct if name in row}
            fields.update(free_module_id=week[0], week_id=row['week_id'], programme_id='FREE-COURSES',
                          content_ref=row['id'], authoring_data=data)
        _write(physical, 'id', existing['id'] if existing else row['id'], fields)
    else:
        field = {'module_details': 'details_json', 'module_completion_criteria': 'completion_json',
                 'ksb_mappings': 'ksb_mappings'}[table]
        if table == 'ksb_mappings':
            rows = list(owner.get(field) or [])
            old = next((item for item in rows if item['id'] == row['id']), {})
            data = [item for item in rows if item['id'] != row['id']] + [{**old, **row}]
        else:
            data = {**(owner.get(field) or {}), **row}
        with connection.cursor() as cursor:
            cursor.execute(sql.SQL('UPDATE curriculum.free_courses SET {}=%s WHERE id=%s').format(sql.Identifier(field)),
                           [Jsonb(data), owner['id']])
    key = 'id' if table in ('weeks', 'components', 'ksb_mappings') else 'module_catalogue_id'
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT * FROM {native_read_table(table)} WHERE "{key}"=%s', [row[key]])
        return _rows(cursor)[0]


def free_rows(table, where, params):
    if table not in TABLES or not enabled():
        return []
    with connection.cursor() as cursor:
        cursor.execute(f'''SELECT * FROM {native_read_table(table)} WHERE ({where}) AND module_catalogue_id IN
            (SELECT content_ref FROM curriculum.free_courses WHERE storage_version=2 AND converted_at IS NULL)''', params)
        return _rows(cursor)


def update(table, where, params, values):
    saved = []
    for row in free_rows(table, where, params):
        saved.append(upsert(table, {**row, **values}))
    return saved


def refresh_totals(reference):
    owner = course(reference)
    if not owner:
        return
    with connection.cursor() as cursor:
        cursor.execute('''UPDATE curriculum.free_course_weeks w SET
            component_count=(SELECT count(*) FROM curriculum.free_programme_components c WHERE c.free_module_id=w.id AND c.deleted_at IS NULL),
            total_otjh=(SELECT coalesce(sum(c.expected_otjh),0) FROM curriculum.free_programme_components c WHERE c.free_module_id=w.id AND c.deleted_at IS NULL)
            WHERE w.course_id=%s''', [owner['id']])
        cursor.execute('''UPDATE curriculum.free_courses f SET
            week_count=(SELECT count(*) FROM curriculum.free_course_weeks w WHERE w.course_id=f.id AND w.deleted_at IS NULL),
            component_count=(SELECT coalesce(sum(w.component_count),0) FROM curriculum.free_course_weeks w WHERE w.course_id=f.id AND w.deleted_at IS NULL)
            WHERE f.id=%s''', [owner['id']])


def convert_to_module(reference, placement):
    """Materialise a regular module only during the explicit conversion action.

    Retain the native rows as historical targets for learner completion FKs.
    Public content IDs stay the same, so attempts and earned hours do not move.
    The caller holds the course lock in the authoring transaction.
    """
    owner = course(reference, lock=True)
    if owner is None:
        return False
    from . import views
    from django.utils import timezone
    snapshots = {table: views.authoring_fetch_all(table, 'module_catalogue_id=%s', [reference])
                 for table in TABLES}
    with connection.cursor() as cursor:
        cursor.execute('UPDATE curriculum.free_courses SET converted_at=%s WHERE id=%s',
                       [timezone.now(), owner['id']])
    for table in ('modules', 'weeks', 'components', 'module_details', 'module_completion_criteria', 'ksb_mappings'):
        key = 'id' if table in ('weeks', 'components', 'ksb_mappings') else 'module_catalogue_id'
        for row in snapshots[table]:
            if table == 'modules':
                row.update(placement, source_type='module_authoring', learner_roster_mode='inherited')
            views.authoring_upsert(table, [key], row)
    return True
