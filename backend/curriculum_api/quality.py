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

ACTIONS = versioning.ACTIONS

# How each record type is named to a person, and where its own page lives.
ENTITY_LABELS = {
    'programme': ('Programme', '/curriculum/programmes'),
    'cohort': ('Cohort', '/curriculum/cohorts'),
    'group': ('Group', '/curriculum/groups'),
    'module': ('Module', '/curriculum/module-builder'),
    'module_details': ('Module detail', '/curriculum/module-builder'),
    'module_completion': ('Module completion rule', '/curriculum/module-builder'),
    'week': ('Week', '/curriculum/week-builder'),
    'component': ('Component', '/curriculum/module-builder'),
    'ksb_mapping': ('KSB mapping', '/curriculum/ksb-coverage'),
    'live_session': ('Live session', '/curriculum/teams-meetings'),
    'holiday': ('Holiday', '/curriculum/holidays'),
    'week_template': ('Week template', '/curriculum/week-builder'),
    'week_template_component': ('Week template component', '/curriculum/week-builder'),
}

# What a reader should see instead of a column name. Anything absent falls back
# to the column with its underscores opened out, which is right far more often
# than it is wrong ("start_date" -> "Start date").
FIELD_LABELS = {
    'coach_name': 'Coach',
    'tutor_name': 'Tutor',
    'display_order': 'Position',
    'week_number': 'Week number',
    'week_id': 'Week',
    'module_catalogue_id': 'Module',
    'programme_id': 'Programme',
    'cohort_id': 'Cohort',
    'group_id': 'Group',
    'ksb_mappings': 'KSBs',
    'expected_otjh': 'Expected OTJH',
    'total_otjh': 'Total OTJH',
    'required_otjh': 'Required OTJH',
    'settings_json': 'Content settings',
    'deleted_at': 'Archived on',
    'deleted_by': 'Archived by handler',
    'Reflection_Question': 'Reflection question',
    'ksb_code': 'KSB code',
}

# The sentence a row leads with. The event name is still carried on the event as
# `action`, for anyone who wants it, but nobody should have to read
# "COHORT_EDIT_PARTIAL_UPDATE" to learn that a cohort was edited.
ACTION_LABELS = {
    'created': 'Created',
    'updated': 'Edited',
    'archived': 'Archived',
    'restored': 'Restored',
    'deleted': 'Deleted',
    'moved': 'Moved',
    'reordered': 'Reordered',
    # Not "Created": this record already existed when history started, and its
    # real author is unknown rather than assumed.
    'recorded': 'First recorded',
    'file_uploaded': 'Uploaded file',
    'file_replaced': 'Replaced file',
    'file_removed': 'Removed file',
    # Said plainly so a reader is not left thinking a person retyped this.
    'recalculated': 'Recalculated',
    'imported': 'Imported',
}

# How a save arrived, in words. The stored value stays the machine-readable one.
SOURCE_LABELS = {
    'manual': 'Manual save',
    'auto-save': 'Auto-save',
    'module-builder': 'Module builder',
    'tree-save': 'Programme tree save',
    'import': 'Import',
    'upload': 'File upload',
    'duplicate': 'Duplicate',
    'wizard': 'Wizard',
    'recalculation': 'Recalculation',
    'scheduled-job': 'Scheduled job',
    'system': 'System',
    'api': 'API',
}

ACTOR_TYPE_LABELS = {
    versioning.ACTOR_USER: 'Person',
    versioning.ACTOR_SYSTEM: 'System',
    versioning.ACTOR_INTEGRATION: 'Integration',
    versioning.ACTOR_JOB: 'Scheduled job',
}


def source_label(value):
    text = curriculum_views.clean_str(value)
    return SOURCE_LABELS.get(text, text.replace('-', ' ').capitalize() if text else '')


def field_label(field):
    name = curriculum_views.clean_str(field)
    if name in FIELD_LABELS:
        return FIELD_LABELS[name]
    if name.startswith('settings.'):
        tail = name.split('.', 1)[1]
        # camelCase settings keys read as words: contentHtml -> Content html.
        spaced = ''.join(f' {ch.lower()}' if ch.isupper() else ch for ch in tail).strip()
        return spaced[:1].upper() + spaced[1:]
    spaced = name.replace('_', ' ').strip()
    return spaced[:1].upper() + spaced[1:]


def split_reason(reason):
    """The handler code, save source, actor kind and trigger out of one column.

    Until the Phase 2 columns existed, ``reason`` was the only free column this
    table had, so it was written as
    ``component-delete; source=auto-save; actor=system; by=someone@example.com``
    -- the handler code it always carried, with tags appended. Every one of the
    1.15M rows written that way is still here and still has to be readable, so
    this stays as the fallback for a row whose structured columns are empty. It
    is no longer how new rows are written.
    """
    text = curriculum_views.clean_str(reason)
    handler, source, actor_kind, triggered_by = '', '', '', ''
    for part in text.split(';'):
        part = part.strip()
        if not part:
            continue
        if part.startswith('source='):
            source = part[len('source='):].strip()
        elif part.startswith('actor='):
            actor_kind = part[len('actor='):].strip()
        elif part.startswith('by='):
            triggered_by = part[len('by='):].strip()
        elif not handler:
            handler = part
    return handler, source, actor_kind, triggered_by


def revision_attribution(row):
    """Actor kind, source and trigger for one revision, newest shape winning.

    The order is the whole backwards-compatibility story: a structured column
    when the row has one, the parsed legacy tag when it does not, and an honest
    default when neither says anything. Nothing is rewritten to make this
    simpler -- a row written in September must still read correctly in a year,
    and the only way to guarantee that is to keep being able to read both.
    """
    handler, tag_source, tag_kind, tag_trigger = split_reason(row.get('reason'))
    kind = curriculum_views.clean_str(row.get('actor_type')) or tag_kind
    if kind not in versioning.ACTOR_TYPES:
        # Rows older than any of this carry nothing. They were written by the
        # signed-in account the middleware supplied, so `user` is the reading
        # the data supports -- and where even the actor is empty the UI shows
        # no name rather than inventing one.
        kind = versioning.ACTOR_USER
    source = curriculum_views.clean_str(row.get('source')) or tag_source
    trigger_email = curriculum_views.clean_str(row.get('triggered_by_email')) or tag_trigger
    trigger_name = curriculum_views.clean_str(row.get('triggered_by_name')) or trigger_email
    return handler, kind, source, trigger_email, trigger_name


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
        # The same keys the revision trail returns, so the page renders one
        # shape. The ones this reading cannot know are empty rather than absent
        # -- and empty is the honest answer: these are timestamps, and a
        # timestamp does not record who moved it or what it held before.
        return {
            'id': f'{source["entity"]}:{entity_id}:{action}:{at}',
            'at': at,
            'action': action,
            'actionLabel': ACTION_LABELS.get(action, action.title()),
            'entity': source['entity'],
            'entityLabel': source['label'],
            'entityId': entity_id,
            'revisionNo': 0,
            'title': title,
            'context': context,
            'parents': {},
            'moduleCatalogueId': '',
            'parentId': '',
            'versionLabel': '',
            'contentStatus': '',
            'actorName': '',
            'actorEmail': '',
            'actorType': '',
            'actorTypeLabel': '',
            'triggeredByEmail': '',
            'triggeredByName': '',
            'source': '',
            'sourceLabel': '',
            'metadata': {},
            'changes': [],
            'snapshot': None,
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
    """What changed in the curriculum: who, when, what, and from what to what.

    Answered from ``curriculum.record_revisions`` -- the log the write helpers
    fill -- whenever those tables exist, which is what lets the trail name an
    actor and show a before and an after. When they do not, it falls back to the
    older derived reading of ``created_at`` / ``updated_at`` / ``deleted_at``,
    which covers the same records but can only say what moved and when.

    ``authorRecorded`` on the response says which of the two the caller is
    looking at, so the page can report honestly rather than showing an empty
    column. Rows written before the log existed keep no actor and are never
    given a plausible one.

    ``?days=`` window (default 30), ``?limit=`` events returned (default 200),
    ``?entity=`` / ``?action=`` / ``?actor=`` filter, ``?search=`` matches
    title/context/id, ``?scope=`` + ``?scopeId=`` narrow to one programme,
    cohort, group or module.
    """
    if versioning.history_available():
        try:
            return revision_trail(request)
        except Exception:
            # The derived trail is the fallback for a reason: a Quality read must
            # never be the reason this page fails to open.
            logger.warning('Could not read the revision audit trail.', exc_info=True)
    return derived_trail(request)


def revision_trail(request):
    """The audit trail read from the revision log."""
    days = parse_bounded_int(request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS)
    limit = parse_bounded_int(request.GET.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
    entity_filter = curriculum_views.clean_str(request.GET.get('entity')).lower()
    action_filter = curriculum_views.clean_str(request.GET.get('action')).lower()
    actor_filter = curriculum_views.clean_str(request.GET.get('actor')).lower()
    source_filter = curriculum_views.clean_str(request.GET.get('source')).lower()
    actor_type_filter = curriculum_views.clean_str(request.GET.get('actorType')).lower()
    search = curriculum_views.clean_str(request.GET.get('search')).lower()
    scope = curriculum_views.clean_str(request.GET.get('scope')).lower()
    scope_id = curriculum_views.clean_str(request.GET.get('scopeId'))

    since = datetime.utcnow() - timedelta(days=days)
    where = ['created_at >= %s']
    params = [since]
    if entity_filter and entity_filter != 'all' and entity_filter in versioning.ENTITY_TYPES:
        where.append('entity_type = %s')
        params.append(entity_filter)
    if action_filter and action_filter != 'all' and action_filter in ACTIONS:
        where.append('action = %s')
        params.append(action_filter)
    if actor_filter:
        where.append('lower(actor_email) = %s')
        params.append(actor_filter)
    # Both of these live in columns that only exist once the Phase 2 SQL has
    # run. Offering the filter against a column that is not there would turn one
    # unrecognised query string into a 500, so they are simply not applied until
    # there is something to apply them to -- and the page only offers them when
    # the response says the structured fields are available.
    structured = versioning.metadata_columns_available()
    if structured and source_filter and source_filter != 'all' and source_filter in versioning.SOURCES:
        where.append('source = %s')
        params.append(source_filter)
    if structured and actor_type_filter and actor_type_filter != 'all' and actor_type_filter in versioning.ACTOR_TYPES:
        where.append('actor_type = %s')
        params.append(actor_type_filter)
    # Module scope rides the dedicated index; the wider scopes are answered from
    # the ancestry stored on the snapshot, which is the only place a component
    # records which programme it was under at the time.
    if scope_id and scope == 'module':
        where.append('module_catalogue_id = %s')
        params.append(scope_id)
    elif scope_id and scope in {'programme', 'cohort', 'group'}:
        clause, clause_params = _scope_clause(scope, scope_id)
        where.append(clause)
        params.extend(clause_params)

    revisions_table = versioning.qualified(versioning.REVISIONS_TABLE)
    columns = (
        'id, entity_type, entity_id, revision_no, action, module_catalogue_id, parent_id, '
        'title, version_label, content_status, changed_fields, snapshot, actor_name, actor_email, '
        'reason, created_at'
    )
    if structured:
        columns += ', actor_type, triggered_by_email, triggered_by_name, source, metadata'
    rows = curriculum_views.fetch_all(
        f'select {columns} '
        f'from {revisions_table} where {" and ".join(where)} '
        f'order by created_at desc, id desc limit {int(limit) + 1}',
        params,
    )
    truncated = len(rows) > limit
    rows = rows[:limit]

    events = [revision_event(row) for row in rows]
    if search:
        events = [
            event for event in events
            if search in event['title'].lower()
            or search in event['context'].lower()
            or search in event['entityId'].lower()
            or search in event['actorName'].lower()
        ]

    action_counts = {action: 0 for action in ACTIONS}
    entity_counts = {}
    for event in events:
        action_counts[event['action']] = action_counts.get(event['action'], 0) + 1
        entity_counts[event['entity']] = entity_counts.get(event['entity'], 0) + 1

    return JsonResponse({
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since.isoformat(),
        'limit': limit,
        'total': len(events),
        'truncated': truncated,
        'actionCounts': action_counts,
        'entityCounts': entity_counts,
        'unreadable': [],
        # The log records the signed-in account on every write, so the trail can
        # name one. Rows older than the log still carry none, and are shown as
        # such rather than attributed to whoever happens to be nearby.
        'authorRecorded': True,
        'source': 'revisions',
        # Whether this response can answer "was that a person or the system?"
        # from a column rather than from a parsed string. The page uses it to
        # decide which filters it can honestly offer.
        'structuredMetadata': structured,
        'sources': sorted(versioning.SOURCES),
        'actorTypes': sorted(versioning.ACTOR_TYPES),
        'actors': revision_actors(since),
        'events': events,
    })


def _scope_clause(scope, scope_id):
    """Match a programme / cohort / group id against the snapshot's own ancestry.

    Scoping reads the snapshot rather than joining back to the live records on
    purpose: it answers "what changed under this programme *at the time*", and a
    module that has since moved elsewhere must still appear under the programme
    it was in when the change happened.
    """
    column = {'programme': 'programme_id', 'cohort': 'cohort_id', 'group': 'group_id'}[scope]
    if connection.vendor == 'postgresql':
        # Either the entity's own column or the ancestry recorded beside it.
        return (
            f"(snapshot ->> '{column}' = %s or snapshot -> '{versioning.CONTEXT_KEY}' ->> '{column}' = %s)",
            [scope_id, scope_id],
        )
    # sqlite keeps the snapshot as text, so this is a containment test. Only the
    # local suites run this branch; Postgres answers it properly above.
    return ('snapshot like %s', [f'%"{column}": "{scope_id}"%'])


def revision_actors(since):
    """Who has changed anything in this window, for the filter."""
    revisions_table = versioning.qualified(versioning.REVISIONS_TABLE)
    try:
        rows = curriculum_views.fetch_all(
            'select actor_email, max(actor_name) as actor_name, count(*) as changes '
            f'from {revisions_table} where created_at >= %s and coalesce(actor_email, %s) <> %s '
            'group by actor_email order by count(*) desc limit 100',
            [since, '', ''],
        )
    except Exception:
        return []
    return [
        {
            'email': curriculum_views.clean_str(row.get('actor_email')),
            'name': curriculum_views.clean_str(row.get('actor_name')),
            'changes': int(row.get('changes') or 0),
        }
        for row in rows
    ]


def revision_event(row):
    """One revision as the trail's event shape."""
    entity_type = curriculum_views.clean_str(row.get('entity_type'))
    label, href = ENTITY_LABELS.get(entity_type, (entity_type.replace('_', ' ').title() or 'Record', '/curriculum'))
    action = curriculum_views.clean_str(row.get('action')) or 'updated'
    entity_id = curriculum_views.clean_str(row.get('entity_id'))
    snapshot = versioning.as_dict(row.get('snapshot'))
    context = snapshot.get(versioning.CONTEXT_KEY) or {}
    if not isinstance(context, dict):
        context = {}
    handler, actor_kind, source, trigger_email, trigger_name = revision_attribution(row)
    changes = [
        {
            'field': curriculum_views.clean_str(change.get('field')),
            'label': field_label(change.get('field')),
            'before': change.get('from'),
            'after': change.get('to'),
            'truncated': bool(change.get('truncated')),
        }
        for change in versioning.as_list(row.get('changed_fields'))
    ]
    return {
        'id': f'rev:{row.get("id")}',
        'at': iso(row.get('created_at')),
        'action': action,
        'actionLabel': ACTION_LABELS.get(action, action.title()),
        'entity': entity_type,
        'entityLabel': label,
        'entityId': entity_id,
        'revisionNo': int(row.get('revision_no') or 0),
        'title': curriculum_views.clean_str(row.get('title')) or entity_id,
        'context': context_line(entity_type, context),
        'parents': context,
        'moduleCatalogueId': curriculum_views.clean_str(row.get('module_catalogue_id')),
        'parentId': curriculum_views.clean_str(row.get('parent_id')),
        'versionLabel': curriculum_views.clean_str(row.get('version_label')),
        'contentStatus': curriculum_views.clean_str(row.get('content_status')),
        'actorName': curriculum_views.clean_str(row.get('actor_name')),
        'actorEmail': curriculum_views.clean_str(row.get('actor_email')),
        # `system` is a write no person directly made: a cascade, a recalculation,
        # a management command or a scheduled job. Never a guess.
        'actorType': actor_kind,
        'actorTypeLabel': ACTOR_TYPE_LABELS.get(actor_kind, actor_kind.title()),
        # Who caused a system action. Empty for a person's own edit -- they are
        # the actor, not the trigger -- and empty for a scheduled run, where
        # there is no person and naming one would be a fabrication.
        'triggeredByEmail': trigger_email,
        'triggeredByName': trigger_name,
        # Auto-save is a source, not an action: the event is still the edit.
        'source': source,
        'sourceLabel': source_label(source),
        'metadata': versioning.as_dict(row.get('metadata')),
        'reason': handler,
        'changes': changes,
        # A created record's "after" and a deleted record's "before" are the same
        # stored snapshot; which one it is, is the action. Carried inline for
        # those two because for a deleted record there is nowhere else left to
        # read it from.
        'snapshot': (
            {key: value for key, value in snapshot.items() if not key.startswith('_')}
            if action in {'created', 'deleted'} else None
        ),
        'href': href,
    }


def context_line(entity_type, context):
    """The entity's ancestry as one readable line, from the names it was saved with."""
    order = ('programme_name', 'cohort_name', 'group_name', 'module_name')
    parts = [curriculum_views.clean_str(context.get(key)) for key in order]
    return ' › '.join(part for part in parts if part)


def derived_trail(request):
    """The older trail, read from record timestamps. No actor, no before/after."""
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
        'source': 'timestamps',
        # Same keys as the revision trail, deliberately empty. A caller should
        # not have to branch on which reading it got to know what it may ask
        # for; `authorRecorded` and `structuredMetadata` already say what this
        # response can and cannot answer.
        'structuredMetadata': False,
        'sources': [],
        'actorTypes': [],
        'actors': [],
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
