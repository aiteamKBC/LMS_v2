"""Concrete free-course storage routing and reads.

The optional course row lock belongs to the existing authoring transaction.
No schema provisioning or content mutation occurs in this module.
"""
import json
import re
from functools import wraps
from inspect import signature
from django.db import connection
from .storage_context import native_only, native_authoring_scope
from .learning_relations import TABLES
from .learning_read_routes import READ_VIEWS, enabled, native_read_table, read_table


def is_free_course_payload(payload):
    return isinstance(payload, dict) and (
        payload.get('isFreeCourse') is True
        or payload.get('sourceType', payload.get('source_type')) == 'free_course'
    )


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


def free_rows(table, where, params):
    if table not in TABLES or not enabled():
        return []
    with connection.cursor() as cursor:
        cursor.execute(f'''SELECT * FROM {native_read_table(table)} WHERE ({where}) AND module_catalogue_id IN
            (SELECT content_ref FROM curriculum.free_courses WHERE storage_version=2 AND converted_at IS NULL)''', params)
        return _rows(cursor)
