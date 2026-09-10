"""Curriculum Quality reads.

Quality does not own a record store of its own. Everything here is derived from
the authoring tables that already hold the curriculum, so a number on a Quality
page is the same number the record's own page shows.

The audit trail below is the weaker of the two histories here. It is derived
from ``created_at`` / ``updated_at`` / ``deleted_at`` alone, so it covers every
record but can only say *what* moved and *when* -- those tables carry no author
column, and ``deleted_by`` holds the write handler's reason code
(``component-delete``), not a person. It therefore reports the reason and states
plainly that no author is recorded.

The version history in ``versioning`` is the stronger one, and for modules,
weeks and components it supersedes the trail: it records the content itself, a
field-level diff, and the signed-in account that saved. It needs its tables to
exist, which is why every read here answers ``available: false`` with the SQL to
run rather than failing, and why the derived trail stays.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from . import versioning
from . import views as curriculum_views

logger = logging.getLogger(__name__)

DEFAULT_WINDOW_DAYS = 30
MAX_WINDOW_DAYS = 365
DEFAULT_LIMIT = 200
MAX_LIMIT = 1000

# One entry per authoring table the trail reads. ``title`` and ``context`` are
# column names, not values: a table that lacks one simply reports it blank.
AUDIT_SOURCES = (
    {
        'entity': 'module',
        'label': 'Module',
        'table': curriculum_views.AUTHORING_MODULES_TABLE,
        'key': 'module_catalogue_id',
        'title': 'title',
        'context': 'programme_name',
        'href': '/curriculum/module-builder',
    },
    {
        'entity': 'week',
        'label': 'Week',
        'table': curriculum_views.AUTHORING_WEEKS_TABLE,
        'key': 'id',
        'title': 'title',
        'context': 'module_catalogue_id',
        'href': '/curriculum/week-builder',
    },
    {
        'entity': 'component',
        'label': 'Component',
        'table': curriculum_views.AUTHORING_COMPONENTS_TABLE,
        'key': 'id',
        'title': 'title',
        'context': 'module_catalogue_id',
        'href': '/curriculum/module-builder',
    },
    {
        'entity': 'cohort',
        'label': 'Cohort',
        'table': curriculum_views.COHORT_AUTHORING_DETAILS_TABLE,
        'key': 'cohort_id',
        'title': 'cohort_name',
        'context': 'programme_name',
        'href': '/curriculum/cohorts',
    },
    {
        'entity': 'group',
        'label': 'Group',
        'table': curriculum_views.GROUPS_TABLE,
        'key': 'group_id',
        'title': 'group_name',
        'context': 'programme_name',
        'href': '/curriculum/groups',
    },
    {
        'entity': 'programme',
        'label': 'Programme',
        'table': 'programmes',
        'key': '',  # resolved at read time - the column differs by deployment
        'title': 'name',
        'context': 'standard',
        'href': '/curriculum/programmes',
    },
)

ACTIONS = ('created', 'updated', 'archived')


def parse_bounded_int(value, default, minimum, maximum):
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def iso(value):
    """A timestamp as a sortable ISO string, or '' when there is none."""
    if isinstance(value, datetime):
        return value.isoformat()
    text = curriculum_views.clean_str(value)
    if not text:
        return ''
    return text.replace(' ', 'T', 1)


def source_key_column(source):
    if source['entity'] != 'programme':
        return source['key']
    return curriculum_views.programme_config_key_column()


def read_source_rows(source, since, row_cap):
    """Rows this table changed since ``since``, newest write first.

    ``updated_at`` is the single ordering column on purpose: every authoring
    write goes through ``authoring_upsert``/``soft_delete_payload``, and both set
    it, so an archive and an edit are ordered against each other correctly
    without a portable ``greatest()``.
    """
    table = source['table']
    if not curriculum_views.table_exists(table):
        return []
    columns = curriculum_views.column_names(table)
    key_column = source_key_column(source)
    wanted = [
        column for column in (
            key_column, source['title'], source['context'],
            'created_at', 'updated_at', 'deleted_at', 'deleted_by', 'deleted_via_parent',
        )
        if column and column in columns
    ]
    if 'updated_at' not in wanted and 'created_at' not in wanted:
        return []
    select_sql = ', '.join(curriculum_views.quote_ident(column) for column in dict.fromkeys(wanted))
    stamps = [column for column in ('created_at', 'updated_at', 'deleted_at') if column in columns]
    where_sql = ' or '.join(f'{curriculum_views.quote_ident(column)} >= %s' for column in stamps)
    order_column = 'updated_at' if 'updated_at' in columns else 'created_at'
    query = (
        f'select {select_sql} from {curriculum_views.table_name(table)} '
        f'where {where_sql} '
        f'order by {curriculum_views.quote_ident(order_column)} desc '
        f'limit {int(row_cap)}'
    )
    try:
        return curriculum_views.fetch_all(query, [since] * len(stamps))
    except Exception:
        # A Quality read must never be the reason a page 500s. A table that
        # cannot be read is reported as contributing nothing, and the caller
        # sees it in `unreadable`.
        logger.warning('Audit trail could not read %s.', table, exc_info=True)
        raise


def row_events(source, row, key_column, since_iso):
    """The events one row contributes: at most one create, one edit, one archive."""
    created = iso(row.get('created_at'))
    updated = iso(row.get('updated_at'))
    deleted = iso(row.get('deleted_at'))
    entity_id = curriculum_views.clean_str(row.get(key_column))
    title = curriculum_views.clean_str(row.get(source['title'])) or entity_id
    context = curriculum_views.clean_str(row.get(source['context']))
    reason = curriculum_views.clean_str(row.get('deleted_by'))
    via_parent = curriculum_views.clean_str(row.get('deleted_via_parent'))

    def event(action, at):
        return {
            'id': f'{source["entity"]}:{entity_id}:{action}:{at}',
            'at': at,
            'action': action,
            'entity': source['entity'],
            'entityLabel': source['label'],
            'entityId': entity_id,
            'title': title,
            'context': context,
            # The write handler's reason code, only ever set by an archive.
            # Not a person: see the module docstring.
            'reason': reason if action == 'archived' else '',
            'viaParent': via_parent if action == 'archived' else '',
            'href': source['href'],
        }

    events = []
    if deleted and deleted >= since_iso:
        events.append(event('archived', deleted))
    if created and created >= since_iso:
        events.append(event('created', created))
    # An edit is only reported when it is a distinct write from the create and
    # from the archive. A row saved once has updated_at == created_at, and an
    # archive sets updated_at to the same stamp as deleted_at; reporting those
    # as edits would triple every archive in the feed.
    if updated and updated >= since_iso and updated != created and updated != deleted:
        events.append(event('updated', updated))
    return events


@require_GET
@never_cache
def curriculum_quality_audit_trail(request):
    """Record activity across the curriculum authoring tables.

    ``?days=`` window (default 30), ``?limit=`` events returned (default 200),
    ``?entity=`` and ``?action=`` filter, ``?search=`` matches title/context/id.
    """
    days = parse_bounded_int(request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS)
    limit = parse_bounded_int(request.GET.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
    entity_filter = curriculum_views.clean_str(request.GET.get('entity')).lower()
    action_filter = curriculum_views.clean_str(request.GET.get('action')).lower()
    search = curriculum_views.clean_str(request.GET.get('search')).lower()

    since = datetime.utcnow() - timedelta(days=days)
    since_iso = since.isoformat()

    try:
        curriculum_views.ensure_module_authoring_tables()
    except Exception:
        logger.warning('Audit trail could not verify authoring tables.', exc_info=True)

    sources = [
        source for source in AUDIT_SOURCES
        if not entity_filter or entity_filter == 'all' or source['entity'] == entity_filter
    ]

    events = []
    unreadable = []
    entity_counts = {}
    # Each table is capped rather than the union, so one busy table (components
    # runs to ~18k rows) cannot crowd every other entity out of the feed.
    row_cap = max(limit, 200)
    for source in sources:
        key_column = source_key_column(source)
        try:
            rows = read_source_rows(source, since, row_cap)
        except Exception:
            unreadable.append(source['entity'])
            continue
        for row in rows:
            for item in row_events(source, row, key_column, since_iso):
                events.append(item)
                entity_counts[source['entity']] = entity_counts.get(source['entity'], 0) + 1

    if action_filter and action_filter != 'all':
        events = [item for item in events if item['action'] == action_filter]
    if search:
        events = [
            item for item in events
            if search in item['title'].lower()
            or search in item['context'].lower()
            or search in item['entityId'].lower()
        ]

    events.sort(key=lambda item: item['at'], reverse=True)
    total = len(events)
    truncated = total > limit
    events = events[:limit]

    action_counts = {action: 0 for action in ACTIONS}
    for item in events:
        action_counts[item['action']] = action_counts.get(item['action'], 0) + 1

    return JsonResponse({
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since_iso,
        'limit': limit,
        'total': total,
        'truncated': truncated,
        'actionCounts': action_counts,
        'entityCounts': entity_counts,
        # Named so the page can say which entity is missing instead of quietly
        # under-reporting.
        'unreadable': unreadable,
        # No authoring table records an author, so the trail never claims one.
        'authorRecorded': False,
        'events': events,
    })


# ---------------------------------------------------------------- versions

def revision_row(row):
    return {
        'id': row.get('id'),
        'entityType': curriculum_views.clean_str(row.get('entity_type')),
        'entityId': curriculum_views.clean_str(row.get('entity_id')),
        'revisionNo': int(row.get('revision_no') or 0),
        'action': curriculum_views.clean_str(row.get('action')),
        'moduleCatalogueId': curriculum_views.clean_str(row.get('module_catalogue_id')),
        'parentId': curriculum_views.clean_str(row.get('parent_id')),
        'title': curriculum_views.clean_str(row.get('title')),
        'versionLabel': curriculum_views.clean_str(row.get('version_label')),
        'contentStatus': curriculum_views.clean_str(row.get('content_status')),
        'changedFields': versioning.as_list(row.get('changed_fields')),
        'actorName': curriculum_views.clean_str(row.get('actor_name')),
        'actorEmail': curriculum_views.clean_str(row.get('actor_email')),
        'reason': curriculum_views.clean_str(row.get('reason')),
        'at': iso(row.get('created_at')),
    }


def history_off_response():
    """The one honest answer when the history tables are not there.

    A 200 carrying ``available: false`` rather than a 404: the feature exists,
    the store behind it has not been created yet, and the page has to be able to
    say which of those it is looking at.
    """
    return JsonResponse({
        'available': False,
        'reason': (
            'Version history is not switched on. Run '
            'backend/sql/2026-09-09_curriculum_record_versions.sql against the database '
            'to create curriculum.record_revisions and curriculum.record_versions.'
        ),
        'totalRevisions': 0,
        'totalNamedVersions': 0,
        'count': 0,
        'entities': [],
        'versions': [],
        'revisions': [],
    })


@require_GET
@never_cache
def curriculum_quality_versions(request):
    """Versioned records, most recently changed first.

    ``?module=`` narrows to one module's whole tree, ``?entity_type=`` to one
    kind of record, ``?search=`` matches the title or the id.
    """
    if not versioning.history_available():
        return history_off_response()

    module = curriculum_views.clean_str(request.GET.get('module'))
    entity_type = curriculum_views.clean_str(request.GET.get('entity_type')).lower()
    search = curriculum_views.clean_str(request.GET.get('search')).lower()
    limit = parse_bounded_int(request.GET.get('limit'), 200, 1, 1000)

    where = ['1 = 1']
    params = []
    if module:
        where.append('module_catalogue_id = %s')
        params.append(module)
    if entity_type and entity_type != 'all' and entity_type in versioning.ENTITY_TYPES:
        where.append('entity_type = %s')
        params.append(entity_type)

    revisions_table = versioning.qualified(versioning.REVISIONS_TABLE)
    versions_table = versioning.qualified(versioning.VERSIONS_TABLE)

    # One row per versioned record: how many revisions it has and when it last
    # moved. Aggregated in SQL because components run to thousands, and reading
    # every revision back to count them in Python is the one thing this page
    # must not do.
    query = (
        'select entity_type, entity_id, '
        'max(revision_no) as revisions, '
        'max(created_at) as last_change, '
        'min(created_at) as first_change '
        f'from {revisions_table} where {" and ".join(where)} '
        'group by entity_type, entity_id '
        f'order by max(created_at) desc limit {int(limit)}'
    )
    try:
        summary_rows = curriculum_views.fetch_all(query, params)
    except Exception:
        logger.warning('Could not read curriculum version summaries.', exc_info=True)
        return history_off_response()

    keys = [
        (curriculum_views.clean_str(row.get('entity_type')), curriculum_views.clean_str(row.get('entity_id')))
        for row in summary_rows
    ]
    latest = latest_revision_by_entity(keys)
    named = named_version_counts(keys)

    entities = []
    for row in summary_rows:
        row_type = curriculum_views.clean_str(row.get('entity_type'))
        entity_id = curriculum_views.clean_str(row.get('entity_id'))
        head = latest.get((row_type, entity_id)) or {}
        title = curriculum_views.clean_str(head.get('title'))
        if search and search not in title.lower() and search not in entity_id.lower():
            continue
        entities.append({
            'entityType': row_type,
            'entityId': entity_id,
            'title': title,
            'moduleCatalogueId': curriculum_views.clean_str(head.get('module_catalogue_id')),
            'parentId': curriculum_views.clean_str(head.get('parent_id')),
            'versionLabel': curriculum_views.clean_str(head.get('version_label')),
            'contentStatus': curriculum_views.clean_str(head.get('content_status')),
            'action': curriculum_views.clean_str(head.get('action')),
            'revisions': int(row.get('revisions') or 0),
            'namedVersions': named.get((row_type, entity_id), 0),
            'lastChangeAt': iso(row.get('last_change')),
            'firstChangeAt': iso(row.get('first_change')),
            'lastActorName': curriculum_views.clean_str(head.get('actor_name')),
        })

    try:
        totals = curriculum_views.fetch_all(
            f'select (select count(*) from {revisions_table}) as revisions, '
            f'(select count(*) from {versions_table}) as versions'
        )
        total_revisions = int((totals[0] if totals else {}).get('revisions') or 0)
        total_versions = int((totals[0] if totals else {}).get('versions') or 0)
    except Exception:
        total_revisions = total_versions = 0

    return JsonResponse({
        'available': True,
        'generatedAt': datetime.utcnow().isoformat(),
        'totalRevisions': total_revisions,
        'totalNamedVersions': total_versions,
        'count': len(entities),
        'entities': entities,
    })


def latest_revision_by_entity(keys):
    """The newest revision for each (type, id), in one read."""
    if not keys:
        return {}
    revisions_table = versioning.qualified(versioning.REVISIONS_TABLE)
    clauses = ' or '.join(['(entity_type = %s and entity_id = %s)'] * len(keys))
    params = [value for key in keys for value in key]
    columns = (
        'entity_type, entity_id, id, revision_no, action, module_catalogue_id, parent_id, '
        'title, version_label, content_status, actor_name, created_at'
    )
    if connection.vendor == 'postgresql':
        query = (
            f'select distinct on (entity_type, entity_id) {columns} from {revisions_table} '
            f'where {clauses} order by entity_type, entity_id, revision_no desc'
        )
    else:
        query = f'select {columns} from {revisions_table} where {clauses} order by revision_no'
    rows = curriculum_views.fetch_all(query, params)
    result = {}
    for row in rows:
        key = (curriculum_views.clean_str(row.get('entity_type')), curriculum_views.clean_str(row.get('entity_id')))
        existing = result.get(key)
        if existing and int(existing.get('revision_no') or 0) >= int(row.get('revision_no') or 0):
            continue
        result[key] = row
    return result


def named_version_counts(keys):
    if not keys:
        return {}
    versions_table = versioning.qualified(versioning.VERSIONS_TABLE)
    clauses = ' or '.join(['(entity_type = %s and entity_id = %s)'] * len(keys))
    params = [value for key in keys for value in key]
    query = (
        f'select entity_type, entity_id, count(*) as total from {versions_table} '
        f'where {clauses} group by entity_type, entity_id'
    )
    try:
        rows = curriculum_views.fetch_all(query, params)
    except Exception:
        return {}
    return {
        (curriculum_views.clean_str(row.get('entity_type')), curriculum_views.clean_str(row.get('entity_id'))):
            int(row.get('total') or 0)
        for row in rows
    }


@require_GET
@never_cache
def curriculum_quality_record_history(request, entity_type, entity_id):
    """One record's timeline: its named versions, and every revision beneath them.

    Revisions come back newest first with their diffs. ``?snapshot=<n>`` also
    returns the stored content of revision ``n`` -- what the record actually held
    at that point, which is the question a version number exists to answer.
    """
    if not versioning.history_available():
        return history_off_response()
    entity_type = curriculum_views.clean_str(entity_type).lower()
    entity_id = curriculum_views.clean_str(entity_id)
    if entity_type not in versioning.ENTITY_TYPES:
        return curriculum_views.json_error(f'Unknown record type "{entity_type}".', status=404)

    revisions_table = versioning.qualified(versioning.REVISIONS_TABLE)
    versions_table = versioning.qualified(versioning.VERSIONS_TABLE)
    limit = parse_bounded_int(request.GET.get('limit'), 200, 1, 1000)

    try:
        revisions = curriculum_views.fetch_all(
            'select id, entity_type, entity_id, revision_no, action, module_catalogue_id, parent_id, title, '
            'version_label, content_status, changed_fields, actor_name, actor_email, reason, created_at '
            f'from {revisions_table} where entity_type = %s and entity_id = %s '
            f'order by revision_no desc limit {int(limit)}',
            [entity_type, entity_id],
        )
    except Exception:
        logger.warning('Could not read the revision timeline for %s %s.', entity_type, entity_id, exc_info=True)
        return history_off_response()

    if not revisions:
        return JsonResponse({
            'available': True,
            'entityType': entity_type,
            'entityId': entity_id,
            'title': '',
            'moduleCatalogueId': '',
            'versions': [],
            'revisions': [],
            'snapshot': None,
        })

    versions = curriculum_views.fetch_all(
        'select v.id, v.version_label, v.revision_id, v.content_status, v.note, v.actor_name, '
        'v.actor_email, v.created_at, r.revision_no '
        f'from {versions_table} v join {revisions_table} r on r.id = v.revision_id '
        'where v.entity_type = %s and v.entity_id = %s order by v.created_at desc',
        [entity_type, entity_id],
    )

    snapshot = None
    wanted = curriculum_views.clean_str(request.GET.get('snapshot'))
    if wanted:
        rows = curriculum_views.fetch_all(
            f'select revision_no, snapshot, created_at from {revisions_table} '
            'where entity_type = %s and entity_id = %s and revision_no = %s',
            [entity_type, entity_id, parse_bounded_int(wanted, 1, 1, 10_000_000)],
        )
        if rows:
            snapshot = {
                'revisionNo': int(rows[0].get('revision_no') or 0),
                'at': iso(rows[0].get('created_at')),
                'content': versioning.as_dict(rows[0].get('snapshot')),
            }

    return JsonResponse({
        'available': True,
        'entityType': entity_type,
        'entityId': entity_id,
        'title': curriculum_views.clean_str(revisions[0].get('title')),
        'moduleCatalogueId': curriculum_views.clean_str(revisions[0].get('module_catalogue_id')),
        'versions': [
            {
                'id': row.get('id'),
                'versionLabel': curriculum_views.clean_str(row.get('version_label')),
                'revisionNo': int(row.get('revision_no') or 0),
                'contentStatus': curriculum_views.clean_str(row.get('content_status')),
                'note': curriculum_views.clean_str(row.get('note')),
                'actorName': curriculum_views.clean_str(row.get('actor_name')),
                'at': iso(row.get('created_at')),
            }
            for row in versions
        ],
        'revisions': [revision_row(row) for row in revisions],
        'snapshot': snapshot,
    })
