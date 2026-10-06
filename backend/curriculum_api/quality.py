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

from django.db import connection, transaction
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from . import versioning
from . import views as curriculum_views

logger = logging.getLogger(__name__)

# The Audit Trail reads the last 7 days, matching the page activity it sits
# beside -- except Curriculum Studio, whose history is kept and read in full.
# Record History panels are not windowed by this.
DEFAULT_WINDOW_DAYS = 7
MAX_WINDOW_DAYS = 7
UNLIMITED_WORKSPACES = frozenset({'curriculum'})
UNLIMITED_WINDOW_DAYS = 3650


#: The Changes feed reads saved history, not page activity: the revision log
#: and the records' own timestamps are kept, so every workspace may look back
#: further than the seven days page activity survives. Seven stays the default.
MAX_CHANGE_WINDOW_DAYS = 60


def window_limit(workspace):
    """The longest window a workspace's page activity (People) may read, in days."""
    return UNLIMITED_WINDOW_DAYS if workspace in UNLIMITED_WORKSPACES else MAX_WINDOW_DAYS


def change_window_limit(workspace):
    """The longest window a workspace's Changes feed may read, in days."""
    return UNLIMITED_WINDOW_DAYS if workspace in UNLIMITED_WORKSPACES else MAX_CHANGE_WINDOW_DAYS
DEFAULT_LIMIT = 200
MAX_LIMIT = 1000

#: One page of the change feed. `DEFAULT_LIMIT` stays what it was for the
#: callers that ask for a bare window and expect the old cap; a page is what the
#: Audit Trail reads at a time.
DEFAULT_PAGE_SIZE = 50

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
    # Learner and staff records. The underscore fallback below already reads
    # most of these correctly; named here are the ones where it does not, and
    # the handful where the column name is not what the LMS calls the field.
    'uuid': 'Internal reference',
    'aptem_id': 'Aptem id',
    'username': 'Name',
    'access': 'Access level',
    'access_extra': 'Extra access',
    'organization': 'Organisation',
    'programme_status': 'Programme status',
    'learner_type': 'Learner type',
    'case_owner': 'Case owner',
    'learning_provider': 'Learning provider',
    'rpl_hours': 'RPL hours',
    'minimum_required_hours': 'Minimum required hours',
    'national_insurance_number': 'National insurance number',
    'invite_to_platform': 'Invited to the platform',
    'allow_access_to_checkpoint': 'Checkpoint access',
    'allow_access_to_console': 'Console access',
    'allow_access_to_classic': 'Classic access',
    'onboarding_completed': 'Onboarding completed',
    'practical_period_end_date': 'Practical period end date',
    'apprenticeship_end_date': 'Apprenticeship end date',
    # Employers and organisations.
    'edrs_ern_number': 'EDRS / ERN number',
    'apprenticeship_agreement_id': 'Apprenticeship agreement',
    'levy_payer': 'Levy payer',
    'approx_no_of_employees': 'Approximate employees',
    'health_and_safety': 'Health and safety',
    'send_hours_verification_emails': 'Sends hours verification emails',
    'post_code': 'Postcode',
    'town_city': 'Town / city',
    'city_town': 'Town / city',
    # Coaching meetings and absence reports.
    'event_key': 'Meeting reference',
    'event_type': 'Meeting type',
    'owner_email': 'Coach email',
    'owner_name': 'Coach',
    'learner_name': 'Learner',
    'learner_email': 'Learner email',
    'learner_id': 'Learner',
    'occurrence_number': 'Occurrence',
    'duration_minutes': 'Duration (minutes)',
    'meeting_provider': 'Meeting provider',
    'graph_event_id': 'Teams event id',
    'graph_organizer_email': 'Teams organiser',
    'review_template_id': 'Review template',
    'review_instance_id': 'Review instance',
    'review_completed_at': 'Review completed',
    'review_responses': 'Review answers',
    'manager_signed_at': 'Manager signed on',
    'manager_signed_by': 'Manager signed by',
    'sync_state': 'Teams sync state',
    'attendance_id': 'Attendance record',
    'reason_category': 'Reason category',
    'evidence_provided': 'Evidence provided',
    'evidence_kind': 'Evidence type',
    'evidence_text': 'Evidence',
    'coach_note': 'Coach note',
    'previous_absences': 'Previous absences',
    'attendance_rate': 'Attendance rate',
    'recovery_method': 'Recovery method',
    'catchup_event_key': 'Catch-up meeting',
}

# The sentence a row leads with. The event name is still carried on the event as
# `action`, for anyone who wants it, but nobody should have to read
# "COHORT_EDIT_PARTIAL_UPDATE" to learn that a cohort was edited.
#: Where an event in the Changes feed comes from, in words.
PROVENANCE_LABELS = {
    'revision': 'Revision history',
    'timestamps': 'Recovered from timestamps',
}

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

# What the handler code means, as a phrase that completes "... as part of".
#
# `reason` holds the write handler, or the row's own `deleted_by` when the
# handler said nothing (``versioning.build_revision``). Either way it is the only
# column that records WHY a record a person never touched went away: a week
# removed by the orphan sweep and a week removed with its module are both
# "Deleted", and only this tells them apart. Anything absent keeps the code
# itself rather than being given an invented meaning.
REASON_LABELS = {
    'hard-delete': 'a cleanup sweep',
    'bulk-delete': 'a bulk delete',
    'module-save': 'a module save',
    'component-save': 'a component save',
    'programme-tree-save': 'a programme tree save',
    'module-delete': 'its module being deleted',
    'week-delete': 'its week being deleted',
    'component-delete': 'its component being deleted',
    'programme-delete': 'its programme being deleted',
    'cohort-delete': 'its cohort being deleted',
    'group-delete': 'its group being deleted',
    'week-template-delete': 'its week template being deleted',
    'programme-archive': 'its programme being archived',
    'ksb-mapping-delete': 'a KSB mapping being removed',
    'ksb-mapping-patch': 'a KSB mapping update',
    'component-ksb-sync': 'a KSB sync',
    'component-ksb-post': 'a KSB update',
}


def source_label(value):
    text = curriculum_views.clean_str(value)
    return SOURCE_LABELS.get(text, text.replace('-', ' ').capitalize() if text else '')


def cause_label(reason):
    """The handler code as the cause phrase a reader can use, or ''.

    Empty for an unmapped code: "as part of ksb-mapping-patch" explains nothing,
    and the raw handler is still on the event as ``reason`` for anyone auditing
    it. Saying nothing is better than dressing a code up as an explanation.
    """
    return REASON_LABELS.get(curriculum_views.clean_str(reason), '')


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


@require_GET
@never_cache
def curriculum_quality_audit_trail(request):
    """What changed in the curriculum: who, when, what, and from what to what.

    Answered from ``curriculum.record_revisions`` -- the log the write helpers
    fill -- whenever those tables exist, which is what lets the trail name an
    actor and show a before and an after. History from before each record
    type's first revision is recovered from the records' own timestamps and
    read into the same feed (``system_audit.derived.read_hybrid``); every event
    says which of the two it came from. Where the log does not exist at all,
    the timestamp reading is the whole trail.

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
            logger.warning('Could not read the revision audit trail.', exc_info=True)
            return JsonResponse({'error': 'Audit history could not be read. Please retry.'}, status=503)
    return derived_trail(request)


def revision_trail(request):
    """The audit trail read from the revision log."""
    days = parse_bounded_int(
        request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1,
        change_window_limit(curriculum_views.clean_str(request.GET.get('workspace')).lower()),
    )
    limit = parse_bounded_int(request.GET.get('limit'), DEFAULT_PAGE_SIZE, 1, MAX_LIMIT)
    page = parse_bounded_int(request.GET.get('page'), 1, 1, 10_000)
    entity_filter = curriculum_views.clean_str(request.GET.get('entity')).lower()
    action_filter = curriculum_views.clean_str(request.GET.get('action')).lower()
    actor_filter = curriculum_views.clean_str(request.GET.get('actor')).lower()
    source_filter = curriculum_views.clean_str(request.GET.get('source')).lower()
    actor_type_filter = curriculum_views.clean_str(request.GET.get('actorType')).lower()
    search = curriculum_views.clean_str(request.GET.get('search')).lower()
    scope = curriculum_views.clean_str(request.GET.get('scope')).lower()
    scope_id = curriculum_views.clean_str(request.GET.get('scopeId'))
    workspace = curriculum_views.clean_str(request.GET.get('workspace')).lower()

    since = datetime.utcnow() - timedelta(days=days)
    where = ['created_at >= %s']
    params = [since]
    # One revision log for the whole LMS, read through a workspace's door. The
    # scoped door at /curriculum/audit-trail must keep showing curriculum and
    # nothing else now that learner, staff and coaching saves land in the same
    # table -- so the workspace narrows the record types rather than the page
    # filtering afterwards and reporting a total that counts what it hid.
    from system_audit import pages as audit_pages, writes as system_writes
    clause, scope_params = system_writes.revision_workspace_clause(workspace)
    where.append(clause)
    params.extend(scope_params)
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
    # Answered in SQL rather than over the rows that came back, now that the feed
    # is paged: filtering afterwards would search one page and report the result
    # as the whole window, and the count beside it would not agree with it.
    # `context` is not searchable here -- it is derived from the snapshot's
    # ancestry as each event is built, so it is not a column to match on.
    if search:
        where.append(
            '(lower(title) like %s or lower(entity_id) like %s '
            'or lower(actor_name) like %s or lower(actor_email) like %s)'
        )
        params.extend([f'%{search}%'] * 4)

    revisions_table = versioning.qualified(versioning.REVISIONS_TABLE)
    columns = [
        'id', 'entity_type', 'entity_id', 'revision_no', 'action', 'module_catalogue_id', 'parent_id',
        'title', 'version_label', 'content_status', 'changed_fields', 'snapshot', 'actor_name', 'actor_email',
        'reason', 'created_at',
    ]
    if structured:
        columns += ['actor_type', 'triggered_by_email', 'triggered_by_name', 'source', 'metadata']

    # The log is the authority from each record type's first revision onward;
    # before it, the records' own timestamps are all the history there is, and
    # they are read in beside the log as one feed (`system_audit.derived`). Not
    # for a filter only the log can answer -- a scope read from the snapshot's
    # ancestry, an automated source, a kind of actor -- because a timestamp
    # cannot say any of those, and adding it would show what was excluded.
    from system_audit import derived
    recover = not (
        (scope_id and scope in {'module', 'programme', 'cohort', 'group'})
        or (structured and source_filter and source_filter != 'all' and source_filter in versioning.SOURCES)
        or (structured and actor_type_filter and actor_type_filter != 'all'
            and actor_type_filter in versioning.ACTOR_TYPES)
    )
    hybrid = {
        'since': since,
        'revision_table': revisions_table,
        'revision_where': ' and '.join(where),
        'revision_params': params,
        'revision_columns': columns,
        'workspace': workspace,
        'entity': entity_filter if entity_filter in versioning.ENTITY_TYPES else '',
        'action': action_filter if action_filter in ACTIONS else '',
        'search': search,
        'actor': actor_filter,
        'limit': limit,
        'page': page,
    }
    recovery_failed = False
    try:
        with transaction.atomic():
            result = derived.read_hybrid(recover=recover, **hybrid)
    except Exception:
        if not recover:
            raise
        # The log on its own is still a true answer. It is given, and the
        # response says the older history could not be read this time, rather
        # than the whole trail failing over the part that is only a supplement.
        logger.warning('Could not recover pre-log history; reading the revision log alone.', exc_info=True)
        recovery_failed = True
        result = derived.read_hybrid(recover=False, **hybrid)

    total = result['total']
    page = result['page']
    pages_total = result['pages']
    truncated = total > limit

    # The page's revisions arrive in full -- snapshot, changes, metadata --
    # joined on in the same statement, in the order the combined feed put them.
    events = []
    for row in result['rows']:
        if row.get('provenance') == derived.PROVENANCE_REVISION:
            events.append(revision_event({column: row.get(f'rev_{column}') for column in columns}))
        else:
            events.append(derived_event(row))

    # Counted in SQL over the whole combined window rather than over the page,
    # so the headline figures answer "what happened in this period" and do not
    # change as somebody pages through it.
    action_counts = {action: 0 for action in ACTIONS}
    action_counts.update(result['action_counts'])
    entity_counts = result['entity_counts']
    try:
        recovered_workspaces = derived.coverage() if recover and not recovery_failed else []
    except Exception:
        logger.warning('Could not read timestamp coverage.', exc_info=True)
        recovered_workspaces = []

    return JsonResponse({
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since.isoformat(),
        'limit': limit,
        'page': page,
        'pageSize': limit,
        'pages': pages_total,
        'total': total,
        'truncated': truncated,
        'actionCounts': action_counts,
        'entityCounts': entity_counts,
        'unreadable': sorted(set(result['unreadable'])),
        # How much of this window is the log's and how much was recovered from
        # timestamps, so the page can say so instead of letting a recovered
        # event read as though the log had seen it.
        'provenanceCounts': {
            derived.PROVENANCE_REVISION: int(result['provenance_counts'].get(derived.PROVENANCE_REVISION, 0)),
            derived.PROVENANCE_TIMESTAMPS: int(result['provenance_counts'].get(derived.PROVENANCE_TIMESTAMPS, 0)),
        },
        # Whether older, timestamp-recovered history was read into this feed.
        # False for a filter only the log can answer, and when it failed.
        'recoveredHistory': recover and not recovery_failed,
        'recoveryFailed': recovery_failed,
        # Where each record type's revision history begins. Recovered events of
        # that type stop strictly before it; null means the log has none yet.
        'revisionStartedAt': {
            entity: (moment.isoformat() if moment is not None else None)
            for entity, moment in sorted(result['boundaries'].items())
        },
        # The log records the signed-in account on every write, so the trail can
        # name one. Rows older than the log still carry none, and are shown as
        # such rather than attributed to whoever happens to be nearby.
        'authorRecorded': True,
        'source': 'revisions',
        # Whether this response can answer "was that a person or the system?"
        # from a column rather than from a parsed string. The page uses it to
        # decide which filters it can honestly offer.
        'structuredMetadata': structured,
        'workspaces': audit_pages.workspace_options(),
        # Real history from the log, and history recovered from timestamps
        # before it. Never the same moment twice: see `derived.read_hybrid`.
        **coverage_keys(
            audit_pages.workspace_options(),
            revision=system_writes.change_workspaces(),
            derived=recovered_workspaces if recover and not recovery_failed else [],
        ),
        'sources': sorted(versioning.SOURCES),
        'actorTypes': sorted(versioning.ACTOR_TYPES),
        # The record types this door can actually show, named by the server.
        # The page used to hold its own list, which was the curriculum's ten
        # types -- so the system-wide Audit Trail offered a Record type filter
        # that could not name a learner, a coaching meeting or an employer, and
        # read as though the curriculum were the only thing being audited.
        'entityTypes': entity_type_options('' if structured else workspace),
        # The Who list is a facet of the other filters, not a global directory
        # of everybody who changed anything in the window. Otherwise choosing
        # a person from the unfiltered list can legitimately return zero rows
        # once Action or Record type has narrowed the feed.
        'actors': merge_actors(revision_actors(
            since, workspace, entity_filter, action_filter, source_filter, actor_type_filter,
        ), result['recovered_actors']),
        'events': events,
    })


def merge_actors(logged, recovered):
    """One author list over both readings, so its counts match the feed.

    A recovered event names an author only where the row recorded an email.
    The log's spelling of a name wins; the counts add, because the two readings
    never hold the same event.
    """
    merged = {}
    for row in logged:
        email = curriculum_views.clean_str(row.get('email')).lower()
        if email:
            merged[email] = {'email': email, 'name': row.get('name') or '', 'changes': int(row.get('changes') or 0)}
    for row in recovered:
        email = curriculum_views.clean_str(row.get('email')).lower()
        if not email:
            continue
        entry = merged.setdefault(email, {'email': email, 'name': '', 'changes': 0})
        entry['name'] = entry['name'] or curriculum_views.clean_str(row.get('name'))
        entry['changes'] += int(row.get('changes') or 0)
    return sorted(merged.values(), key=lambda entry: (-entry['changes'], entry['email']))[:100]


def entity_type_options(workspace):
    """Every audited record type in this workspace, as ``{value, label}``.

    Derived from what is registered, so a newly-wired record type is offered on
    the day it starts being recorded rather than on the day somebody remembers
    to edit a list in the browser.
    """
    from system_audit import writes as system_writes
    options = []
    for entity_type in system_writes.entity_types_for_workspace(workspace):
        label = (
            ENTITY_LABELS.get(entity_type)
            or system_writes.ENTITY_LABELS.get(entity_type)
            or (entity_type.replace('_', ' ').capitalize(),)
        )[0]
        options.append({'value': entity_type, 'label': label})
    return sorted(options, key=lambda option: option['label'].lower())


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


def revision_actors(since, workspace='', entity='', action='', source='', actor_type=''):
    """Who has changed anything in this window, for the filter.

    Scoped to one workspace and the active non-person filters, because the count travels: it is both the "Who"
    filter's label and the Changes column on the People list. One revision log
    now holds every workspace's saves, so an unscoped count against a scoped
    door reported changes the door itself will not show -- a person with three
    coaching saves and no curriculum ones appeared in Curriculum Studio's list
    as having changed three things there.
    """
    revisions_table = versioning.qualified(versioning.REVISIONS_TABLE)
    where = ['created_at >= %s', 'coalesce(actor_email, %s) <> %s']
    params = [since, '', '']
    from system_audit import writes as system_writes
    clause, scope_params = system_writes.revision_workspace_clause(workspace)
    where.append(clause)
    params.extend(scope_params)
    if entity and entity != 'all' and entity in versioning.ENTITY_TYPES:
        where.append('entity_type = %s')
        params.append(entity)
    if action and action != 'all' and action in ACTIONS:
        where.append('action = %s')
        params.append(action)
    if versioning.metadata_columns_available():
        if source and source != 'all' and source in versioning.SOURCES:
            where.append('source = %s')
            params.append(source)
        if actor_type and actor_type != 'all' and actor_type in versioning.ACTOR_TYPES:
            where.append('actor_type = %s')
            params.append(actor_type)
    try:
        rows = curriculum_views.fetch_all(
            'select actor_email, max(actor_name) as actor_name, count(*) as changes '
            f'from {revisions_table} where {" and ".join(where)} '
            'group by actor_email order by count(*) desc limit 100',
            params,
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
    # Curriculum's own types first, then whatever `system_audit` registered for
    # the rest of the LMS. The last fallback keeps `/curriculum` only for a type
    # nothing claims, which by then is a bug rather than a record to link to.
    from system_audit import pages as audit_pages, writes as system_writes
    label, href = ENTITY_LABELS.get(entity_type) or system_writes.ENTITY_LABELS.get(entity_type) or (
        entity_type.replace('_', ' ').title() or 'Record', '/curriculum',
    )
    action = curriculum_views.clean_str(row.get('action')) or 'updated'
    entity_id = curriculum_views.clean_str(row.get('entity_id'))
    # A record with a page of its own opens at that record. Curriculum's rows
    # are refined further by the browser, which knows how to open a component
    # at its week inside Module Builder; the rest are resolved here because the
    # path is a plain function of the id.
    href = system_writes.record_href(entity_type, entity_id, fallback=href)
    snapshot = {key: versioning.audit_display_value(entity_type, key, value)
                for key, value in versioning.as_dict(row.get('snapshot')).items()}
    context = snapshot.get(versioning.CONTEXT_KEY) or {}
    if not isinstance(context, dict):
        context = {}
    handler, actor_kind, source, trigger_email, trigger_name = revision_attribution(row)
    metadata = versioning.as_dict(row.get('metadata'))
    workspace = curriculum_views.clean_str(metadata.get('page_workspace')) or system_writes.workspace_for_entity(entity_type) or ''
    changes = [
        change for change in (revision_change(entity_type, item) for item in versioning.as_list(row.get('changed_fields')))
        if change is not None
    ]
    return {
        'id': f'rev:{row.get("id")}',
        # Where this event comes from. The log saw this save happen.
        'provenance': 'revision',
        'provenanceLabel': PROVENANCE_LABELS['revision'],
        'at': iso(row.get('created_at')),
        'action': action,
        'actionLabel': ACTION_LABELS.get(action, action.title()),
        'entity': entity_type,
        'entityLabel': label,
        'workspace': workspace,
        'workspaceLabel': audit_pages.WORKSPACES.get(workspace, workspace.title() if workspace else ''),
        'entityId': entity_id,
        'revisionNo': int(row.get('revision_no') or 0),
        'title': (curriculum_views.clean_str(snapshot.get('reason_code')) or entity_id
                  if entity_type == 'learner_review_addition' else curriculum_views.clean_str(row.get('title')) or entity_id),
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
        'metadata': metadata,
        'reason': handler,
        # The handler in words, for the sentence a row leads with. Empty when the
        # code has no mapped meaning, so a reader is never shown a guess.
        'causeLabel': cause_label(handler),
        # The page name recorded with the write. `page_path` is still in
        # `metadata` for anyone who wants the URL; this is the one to show.
        'pageLabel': curriculum_views.clean_str(metadata.get('page_label')),
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


def revision_change(entity_type, change):
    """One entry of a revision's ``changed_fields``, as the trail shows it.

    Revisions written by an older version of the log stored the names of the
    fields that moved and nothing else (``["orientation_ksb_mappings"]``). The
    field is still listed, and its values are reported as not recorded --
    ``None``, shown as a dash -- never as empty, which would be a claim about
    what the field held. Anything else unreadable is skipped, not raised.
    """
    if isinstance(change, str):
        field = curriculum_views.clean_str(change)
        if not field:
            return None
        return {'field': field, 'label': field_label(field), 'before': None, 'after': None,
                'truncated': False, 'valuesRecorded': False}
    if not isinstance(change, dict):
        return None
    field = curriculum_views.clean_str(change.get('field'))
    return {
        'field': field,
        'label': field_label(change.get('field')),
        'before': versioning.audit_display_value(entity_type, field, change.get('from')),
        'after': versioning.audit_display_value(entity_type, field, change.get('to')),
        'truncated': bool(change.get('truncated')),
    }


def context_line(entity_type, context):
    """The entity's ancestry as one readable line, from the names it was saved with.

    The curriculum's ancestry is a programme tree and reads in that order. The
    rest of the LMS does not have one -- a coaching meeting is placed by whose
    it is and when, a learner by their programme, cohort and group -- so those
    record types declare their own order at registration and it is read back
    here. Without this every non-curriculum row fell through to an empty line,
    which the page then filled with the words "Curriculum record".
    """
    registered = versioning.ENTITY_CONTEXT_FIELDS.get(entity_type)
    order = registered or ('programme_name', 'cohort_name', 'group_name', 'module_name')
    parts = [curriculum_views.clean_str(context.get(key)) for key in order]
    return ' › '.join(part for part in parts if part)


def derived_trail(request):
    """The trail read from the records' own timestamps, across the whole LMS.

    Used only where the revision log does not exist. Every table it can read is
    declared in ``system_audit.derived``, which also says what each stamp is
    allowed to prove. Filtered, counted and paged in SQL over the whole window,
    so a page, its total and the headline counts always describe the same set.
    """
    from system_audit import derived, pages as audit_pages
    workspace = curriculum_views.clean_str(request.GET.get('workspace')).lower()
    days = parse_bounded_int(request.GET.get('days'), DEFAULT_WINDOW_DAYS, 1, change_window_limit(workspace))
    limit = parse_bounded_int(request.GET.get('limit'), DEFAULT_PAGE_SIZE, 1, MAX_LIMIT)
    page = parse_bounded_int(request.GET.get('page'), 1, 1, 10_000)
    entity_filter = curriculum_views.clean_str(request.GET.get('entity')).lower()
    action_filter = curriculum_views.clean_str(request.GET.get('action')).lower()
    actor_filter = curriculum_views.clean_str(request.GET.get('actor')).lower()
    search = curriculum_views.clean_str(request.GET.get('search')).lower()
    since = datetime.utcnow() - timedelta(days=days)

    try:
        curriculum_views.ensure_module_authoring_tables()
    except Exception:
        logger.warning('Audit trail could not verify authoring tables.', exc_info=True)

    try:
        result = derived.read(
            since=since,
            workspace=workspace,
            entity=entity_filter,
            action=action_filter if action_filter in ACTIONS else '',
            search=search,
            actor=actor_filter,
            limit=limit,
            page=page,
        )
        derived_workspaces = derived.coverage()
    except Exception:
        logger.warning('Could not read the timestamp audit trail.', exc_info=True)
        return JsonResponse({'error': 'Audit history could not be read. Please retry.'}, status=503)

    action_counts = {action: 0 for action in ACTIONS}
    action_counts.update(result['action_counts'])
    workspaces = audit_pages.workspace_options()
    return JsonResponse({
        'generatedAt': datetime.utcnow().isoformat(),
        'windowDays': days,
        'since': since.isoformat(),
        'limit': limit,
        'page': result['page'],
        'pageSize': limit,
        'pages': result['pages'],
        'total': result['total'],
        'truncated': result['total'] > limit,
        'actionCounts': action_counts,
        'entityCounts': result['entity_counts'],
        # Named so the page can say which record types are missing instead of
        # quietly under-reporting.
        'unreadable': sorted(set(result['unreadable'])),
        # A timestamp does not record who moved it. Some rows name a person of
        # their own, and those are shown; the reading as a whole cannot.
        'authorRecorded': False,
        'source': 'timestamps',
        # Same keys as the revision trail, so a caller never branches on which
        # reading it got to know what it may ask for.
        'structuredMetadata': False,
        'sources': [],
        'actorTypes': [],
        'workspaces': workspaces,
        **coverage_keys(workspaces, revision=[], derived=derived_workspaces),
        'entityTypes': derived_entity_options(),
        'actors': [
            {
                'email': curriculum_views.clean_str(row.get('email')),
                'name': curriculum_views.clean_str(row.get('name')),
                'changes': int(row.get('changes') or 0),
            }
            for row in result['actors']
        ],
        'events': [derived_event(row) for row in result['rows']],
    })


def coverage_keys(workspaces, *, revision, derived):
    """Which workspaces this response can speak for, and through what.

    ``changeWorkspaces`` keeps its old meaning -- "covered by this response" --
    so an older page still reads it correctly. The three lists beside it are
    the honest breakdown: real revision history, timestamps only, and nothing.
    """
    covered = sorted(set(revision) | set(derived))
    return {
        'changeWorkspaces': covered,
        'revisionWorkspaces': sorted(revision),
        'derivedWorkspaces': sorted(derived),
        'uncoveredWorkspaces': [entry['value'] for entry in workspaces if entry['value'] not in covered],
    }


def derived_entity_options():
    """The record types the timestamp reading can show, named as the log names them."""
    from system_audit import derived, writes as system_writes
    seen = {}
    for source in derived.DERIVED_AUDIT_SOURCES:
        label = (ENTITY_LABELS.get(source.entity) or system_writes.ENTITY_LABELS.get(source.entity)
                 or (source.entity.replace('_', ' ').capitalize(), ''))[0]
        seen.setdefault(source.entity, label)
    return sorted(({'value': key, 'label': label} for key, label in seen.items()),
                  key=lambda option: option['label'].lower())


def derived_event(row):
    """One timestamp-derived event, in the same shape as a revision event.

    The keys this reading cannot know are empty rather than absent, and empty
    is the honest answer: a timestamp does not record what a record held before.
    """
    from system_audit import derived, pages as audit_pages, writes as system_writes
    entity = curriculum_views.clean_str(row.get('entity'))
    source = next((item for item in derived.DERIVED_AUDIT_SOURCES if item.entity == entity), None)
    label, href = ENTITY_LABELS.get(entity) or system_writes.ENTITY_LABELS.get(entity) or (
        entity.replace('_', ' ').capitalize() or 'Record', '',
    )
    if source is not None and source.href:
        href = source.href
    action = curriculum_views.clean_str(row.get('action')) or 'recorded'
    at = iso(row.get('at'))
    entity_id = curriculum_views.clean_str(row.get('entity_id'))
    title_join = ' '
    if source is not None:
        title_join = source.title_join if source.title_join is not None else (
            (versioning.ENTITY_FACT_FIELDS.get(entity) or {}).get('title_join') or ' ')
    title = (title_join.join(derived.split(row.get('title')))
             or ' '.join(derived.split(row.get('title_fallback'))) or entity_id)
    actor = curriculum_views.clean_str(row.get('actor'))
    reason = curriculum_views.clean_str(row.get('reason'))
    workspace = system_writes.workspace_for_entity(entity) or ''
    return {
        'id': f'{row.get("origin")}:{entity_id}:{action}:{at}',
        # Read back from a timestamp the record keeps: weaker evidence than a
        # revision, and said so wherever the event is shown.
        'provenance': 'timestamps',
        'provenanceLabel': PROVENANCE_LABELS['timestamps'],
        'at': at,
        'action': action,
        'actionLabel': ACTION_LABELS.get(action, action.title()),
        'entity': entity,
        'entityLabel': label,
        'workspace': workspace,
        'workspaceLabel': audit_pages.WORKSPACES.get(workspace, workspace.title() if workspace else ''),
        'entityId': entity_id,
        'revisionNo': 0,
        'title': title,
        'context': ' › '.join(derived.split(row.get('context'))),
        'parents': {},
        'moduleCatalogueId': '',
        'parentId': '',
        'versionLabel': '',
        'contentStatus': '',
        # Exactly what the row records, for the event that column describes.
        # Never the current user, and never "System" unless the row says so.
        'actorName': actor,
        'actorEmail': actor.lower() if '@' in actor else '',
        'actorType': '',
        'actorTypeLabel': '',
        'triggeredByEmail': '',
        'triggeredByName': '',
        'source': '',
        'sourceLabel': '',
        'metadata': {},
        'changes': [],
        'snapshot': None,
        # The write handler's reason code, only ever set by an archive. Not a
        # person: see the module docstring.
        'reason': reason if action == 'archived' else '',
        'viaParent': curriculum_views.clean_str(row.get('via_parent')) if action == 'archived' else '',
        'href': system_writes.record_href(entity, entity_id, fallback=href),
    }


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
