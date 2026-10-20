"""Read-only Curriculum Home totals, independent of the overview projection."""

import json
import logging
from datetime import datetime, timezone

from django.db import DatabaseError, connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .schema_gate import CURRICULUM_SCHEMA


_FIELDS = {
    'programmes': ('programme_id', 'is_archived', 'is_active', 'status', 'deleted_at'),
    'modules': ('module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'status', 'is_archived',
                'deleted_at', 'is_programme_deleted', 'is_deleted'),
    'cohorts': ('cohort_id', 'programme_id', 'status', 'is_archived',
                'deleted_at', 'is_programme_deleted', 'is_deleted'),
    'groups': ('group_id', 'programme_id', 'cohort_id', 'status', 'is_archived',
               'deleted_at', 'is_programme_deleted', 'is_deleted'),
    'live_sessions': ('id', 'module_catalogue_id', 'status', 'deleted_at', 'is_deleted'),
}

logger = logging.getLogger(__name__)


def read_totals_rows(db=None):
    """One SELECT gives every count the same database statement snapshot.

    Only identity/lifecycle columns cross the database boundary. Optional legacy
    flags are selected through JSON keys; no schema bootstrap, external calls,
    read-model refresh jobs or source data writes are invoked.
    """
    db = db if db is not None else connection
    if db.vendor != 'postgresql':
        raise ValueError('Curriculum live totals require PostgreSQL.')
    selections, params = [], []
    for table, fields in _FIELDS.items():
        selections.append(
            "(SELECT coalesce(jsonb_agg("
            "(SELECT jsonb_object_agg(key, value) FROM jsonb_each(to_jsonb(r)) "
            "WHERE key = ANY(%s))), '[]'::jsonb) "
            f"FROM {db.ops.quote_name(CURRICULUM_SCHEMA)}.{db.ops.quote_name(table)} r)"
        )
        params.append(list(fields))
    with db.cursor() as cursor:
        cursor.execute('SELECT ' + ', '.join(selections), params)
        values = cursor.fetchone()
    return {
        table: json.loads(value) if isinstance(value, str) else value
        for table, value in zip(_FIELDS, values)
    }


def _key(value):
    return str(value or '').strip()


def _truthy(value):
    return _key(value).lower() in {'1', 'true', 'yes', 'y', 'on'}


def _live(row):
    return not row.get('deleted_at') and not any(
        _truthy(row.get(flag)) for flag in ('is_programme_deleted', 'is_deleted', 'is_archived')
    ) and _key(row.get('status')).lower() not in {'archived', 'cancelled', 'canceled', 'deleted', 'superseded'}


def _unique_rows(rows, identity):
    """Deduplicate stable IDs, never names shared by legitimate records."""
    selected = {}
    for row in rows:
        key = _key(row.get(identity))
        if not key:
            raise ValueError('A curriculum record has no stable identity.')
        if key in selected and selected[key] != row:
            raise ValueError('Conflicting curriculum records share an identity.')
        selected[key] = row
    return selected


def core_totals(rows):
    """Count live entities while respecting their existing parent identities."""
    programmes = _unique_rows(rows['programmes'], 'programme_id')
    modules = _unique_rows(rows['modules'], 'module_catalogue_id')
    cohorts = _unique_rows(rows['cohorts'], 'cohort_id')
    groups = _unique_rows(rows['groups'], 'group_id')
    sessions = _unique_rows(rows['live_sessions'], 'id')

    def programme_live(row):
        # The programme archive flag is authoritative in the existing UI.
        return not row.get('deleted_at') and not _truthy(row.get('is_archived'))

    def parent_live(row, field, parents, eligible):
        key = _key(row.get(field))
        # Library modules may intentionally be unassigned. An explicit link to
        # a known archived parent must never make its descendants look live.
        return not key or key not in parents or key in eligible

    live_programmes = {key for key, row in programmes.items() if programme_live(row)}
    live_cohorts = {key for key, row in cohorts.items() if _live(row) and parent_live(row, 'programme_id', programmes, live_programmes)}
    live_groups = {key for key, row in groups.items() if _live(row) and parent_live(row, 'programme_id', programmes, live_programmes) and parent_live(row, 'cohort_id', cohorts, live_cohorts)}
    live_modules = {
        key for key, row in modules.items() if _live(row)
        and parent_live(row, 'programme_id', programmes, live_programmes)
        and parent_live(row, 'cohort_id', cohorts, live_cohorts)
        and parent_live(row, 'group_id', groups, live_groups)
    }
    live_sessions = {
        key for key, row in sessions.items()
        if _live(row) and _key(row.get('status')).lower() in {'active', 'week-meeting'}
        and _key(row.get('module_catalogue_id')) in live_modules
    }
    return {
        key: {'active': len(live), 'total': len(rows[table])}
        for key, live, table in (
            ('modules', live_modules, 'modules'), ('cohorts', live_cohorts, 'cohorts'),
            ('groups', live_groups, 'groups'), ('sessions', live_sessions, 'live_sessions'),
            ('programmes', live_programmes, 'programmes'),
        )
    }


def build_live_totals(db=None):
    return {
        'metrics': core_totals(read_totals_rows(db)),
        'checkedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
    }


@require_GET
@never_cache
def curriculum_live_totals(request):
    # The existing curriculum_api staff/session gate protects this route.
    try:
        payload = build_live_totals()
    except (DatabaseError, ValueError, TypeError, KeyError):
        logger.exception('Curriculum live totals could not be verified')
        return JsonResponse({'error': 'Curriculum live totals could not be verified. Please retry.'}, status=503)
    return JsonResponse(payload)
