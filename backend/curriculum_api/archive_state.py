"""Archive and restore on the normalised curriculum schema.

State: one ``status`` column on the lifecycle tables -- ``inactive`` is archived,
anything else (``active``, a cohort's ``planned``) is live. Nothing else on the
row records an archive.

Provenance -- when a row was archived, why (``module-delete``, ``week-delete``
...) and whether it went *with a parent* -- lives in the version history
(``curriculum.record_revisions``), which records every archive with its reason.
A restore brings back exactly what was archived with the parent, as before:

* archives written by this code carry ``metadata.archived_via = <parent id>``;
* archives written before it carry only the cascade reason, which names the
  parent exactly -- every cascade archived a row's own parent of that kind
  (``module-delete`` on a week: its module; ``week-delete`` on a component: its
  week ...). ``programme-tree-save`` named either a programme or a cohort, so
  those rows are never restored by a parent (they stay archived, as a row
  archived on its own does).

``annotate`` returns the legacy-named facts (``deleted_at`` = archive time,
``deleted_by`` = reason, ``deleted_via_parent`` = parent id) the archive logic
reads. It costs one query, so it is called only where provenance matters --
restore, reading an archived module, learner visibility of archived weeks,
recordings, the archive screen -- never on ordinary reads, which need only
``status``.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from django.db import connection

from .curriculum_names import ACTIVE, INACTIVE, INACTIVE_STATUSES, is_inactive

STATUS_TABLES = frozenset({
    'programmes', 'cohorts', 'groups', 'modules', 'weeks', 'components', 'ksb_mappings', 'coaches', 'tutors',
})
# Tables whose rows follow their module (no lifecycle column of their own).
MODULE_OWNED_TABLES = frozenset({'module_details', 'module_completion_criteria'})

# One archive writes all of its rows inside a single request.
ARCHIVE_EVENT_WINDOW = timedelta(minutes=5)

# Legacy cascade reason -> {table: how the row names that parent}.
_LEGACY_VIA = {
    'module-delete': {'weeks': 'module', 'components': 'module', 'ksb_mappings': 'module',
                      'module_details': 'module', 'module_completion_criteria': 'module'},
    'week-delete': {'components': 'week', 'ksb_mappings': 'week'},
    'component-delete': {'ksb_mappings': 'component'},
    'cohort-delete': {'groups': 'cohort'},
    'programme-delete': {'cohorts': 'programme', 'groups': 'programme', 'modules': 'programme',
                         'weeks': 'programme', 'components': 'programme', 'ksb_mappings': 'programme',
                         'module_details': 'programme', 'module_completion_criteria': 'programme'},
}


def uses_status(table):
    return table in STATUS_TABLES


def live_sql(alias=''):
    prefix = f'{alias}.' if alias and not alias.endswith('.') else alias
    return f"{prefix}\"status\" not in ('inactive', 'archived')"


def inactive_sql(alias=''):
    prefix = f'{alias}.' if alias and not alias.endswith('.') else alias
    return f"{prefix}\"status\" in ('inactive', 'archived')"


def row_inactive(row):
    return bool(row) and is_inactive(row.get('status'))


def archive_values():
    return {'status': INACTIVE, 'updated_at': datetime.utcnow()}


def restore_values():
    return {'status': ACTIVE, 'updated_at': datetime.utcnow()}


def normalise_write(table, payload):
    """The normalised schema stores one archived value: ``inactive``.

    Older writers still say ``archived`` (programme/cohort archive, the cohort
    status a restore recomputes); on a lifecycle table that is stored as
    ``inactive`` so the data keeps the shape the schema defines. Returns a copy.
    """
    if table not in STATUS_TABLES or not payload or 'status' not in payload:
        return payload
    if str(payload.get('status') or '').strip().lower() == 'archived':
        return {**payload, 'status': INACTIVE}
    return payload


def archive_context(deleted_by='', via_parent=''):
    """History context for one archive: its reason and the parent it went with."""
    from . import versioning
    return versioning.audit_context(
        reason=str(deleted_by or ''),
        metadata={'archived_via': str(via_parent)} if via_parent else None,
    )


def _chunks(values, size=1000):
    values = list(values)
    for index in range(0, len(values), size):
        yield values[index:index + size]


def _latest_archives(entity_type, ids):
    """``{entity_id: (created_at, reason, archived_via)}`` of each id's latest archive."""
    found = {}
    for chunk in _chunks(sorted(set(ids))):
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                select distinct on (entity_id) entity_id, created_at, coalesce(reason, ''),
                       coalesce(metadata ->> 'archived_via', snapshot ->> 'deleted_via_parent', '')
                from curriculum.record_revisions
                where entity_type = %s and entity_id = any(%s) and action = 'archived'
                order by entity_id, created_at desc
                ''',
                [entity_type, chunk],
            )
            for entity_id, created_at, reason, via in cursor.fetchall():
                found[str(entity_id)] = (created_at, reason, via)
    return found


def _parents(table, rows):
    """``{row key: {'module': id, 'week': id, 'component': id, 'cohort': id, 'programme': id}}``."""
    from .curriculum_names import lookups
    names = lookups()
    component_ids = [str(row.get('component_id') or '') for row in rows if table == 'ksb_mappings']
    components = {}
    if component_ids:
        for chunk in _chunks([cid for cid in component_ids if cid]):
            with connection.cursor() as cursor:
                cursor.execute(
                    'select id, module_catalogue_id, week_id from curriculum.components where id = any(%s)', [chunk],
                )
                components.update({str(cid): (str(mid or ''), str(wid or '')) for cid, mid, wid in cursor.fetchall()})
    def text(row, column):
        return str(row.get(column) or '')

    out = []
    for row in rows:
        parent = {'module': '', 'week': '', 'component': '', 'cohort': text(row, 'cohort_id'),
                  'programme': text(row, 'programme_id')}
        if table == 'ksb_mappings':
            parent['component'] = text(row, 'component_id')
            parent['module'], parent['week'] = components.get(parent['component'], ('', ''))
        elif table == 'components':
            parent.update(module=text(row, 'module_catalogue_id'), week=text(row, 'week_id'), component=text(row, 'id'))
        elif table == 'weeks':
            parent.update(module=text(row, 'module_catalogue_id'), week=text(row, 'id'))
        elif table in MODULE_OWNED_TABLES:
            parent['module'] = text(row, 'module_catalogue_id')
        if not parent['programme'] and parent['module']:
            parent['programme'] = (names['modules'].get(parent['module']) or {}).get('programme_id') or ''
        out.append(parent)
    return out


def annotate(table, rows, key_column=None):
    """Set ``deleted_at`` / ``deleted_by`` / ``deleted_via_parent`` on ``rows`` from history.

    Live rows get None for all three. Mutates and returns ``rows``.
    """
    from . import versioning
    rows = [row for row in rows if row is not None]
    if not rows:
        return rows
    config = versioning.VERSIONED_TABLES.get(table) or {}
    key_column = key_column or config.get('key') or 'id'
    inactive = [row for row in rows if row_inactive(row)] if table in STATUS_TABLES else list(rows)
    for row in rows:
        row['deleted_at'] = row['deleted_by'] = row['deleted_via_parent'] = None
    if not inactive:
        return rows
    archives = _latest_archives(config.get('entity_type', ''), [str(row.get(key_column) or '') for row in inactive]) \
        if config and connection.vendor == 'postgresql' else {}
    parents = _parents(table, inactive)
    for row, parent in zip(inactive, parents):
        created_at, reason, via = archives.get(str(row.get(key_column) or ''), (None, '', ''))
        if not via:
            kind = _LEGACY_VIA.get(reason, {}).get(table)
            via = parent.get(kind, '') if kind else ''
        row['deleted_at'] = created_at or row.get('updated_at') or row.get('created_at')
        row['deleted_by'] = reason or None
        row['deleted_via_parent'] = via or None
    return rows


def event_bounds(archived_at):
    """(earliest, latest) archive time of a row archived with a parent archived at ``archived_at``."""
    if not isinstance(archived_at, datetime):
        return None
    return archived_at - ARCHIVE_EVENT_WINDOW, archived_at + ARCHIVE_EVENT_WINDOW


def archived_with(table, parent_id, candidates, bounds=None, key_column=None):
    """The rows of ``candidates`` archived with ``parent_id`` (inside ``bounds`` when given)."""
    annotate(table, candidates, key_column=key_column)
    chosen = []
    for row in candidates:
        if not row.get('deleted_at') or str(row.get('deleted_via_parent') or '') != str(parent_id):
            continue
        if bounds is not None:
            stamp = row['deleted_at']
            try:
                if not (bounds[0] <= stamp <= bounds[1]):
                    continue
            except TypeError:
                # Naive against aware: the two stamps came from different
                # writers. Fall back to the marker rather than guess an offset.
                pass
        chosen.append(row)
    return chosen


__all__ = [
    'ACTIVE', 'INACTIVE', 'INACTIVE_STATUSES', 'STATUS_TABLES', 'MODULE_OWNED_TABLES', 'ARCHIVE_EVENT_WINDOW',
    'uses_status', 'normalise_write', 'live_sql', 'inactive_sql', 'row_inactive', 'archive_values', 'restore_values',
    'archive_context', 'annotate', 'event_bounds', 'archived_with',
]
