"""Changes read from the records' own timestamps, across the whole LMS.

The Changes feed has two readings. The revision log (``curriculum.record_revisions``)
is the real one: it names who saved, and what each field held before and after.
This is the other one, used only where the log does not exist. It reads the
``created_at`` / ``updated_at`` / ``deleted_at`` columns that tables keep anyway,
and it can therefore only ever say *that* a record moved and *when* -- never
what changed inside it, and who moved it only where the record itself says so.

It used to read six curriculum authoring tables and nothing else, which made a
system-wide Changes feed on such a database a curriculum feed with a different
heading. This module is the list of every table in the LMS that keeps honest
enough timestamps to be read this way, and one query that reads them all.

**What a timestamp can prove, and the word each one earns.**

* ``Created`` -- only from a column that is stamped once, when the row is
  inserted, and never again (``created`` below). A column that a later write can
  move is not evidence of creation.
* ``Edited`` -- a last-write stamp that differs from the creation stamp: the row
  existed at one moment and was written again at a later one.
* ``First recorded`` -- a last-write stamp with no creation stamp to compare it
  with, or an insert-time column that a later save may rewrite. The record was
  there at that moment; whether it was born then is not something the row says.
* ``Archived`` -- an archive stamp. Its reason column is a code the write
  handler used, never a person.

A NULL stamp produces nothing. A missing column produces nothing. Nothing here
is ever inferred from the absence of evidence.

**Who.** Only from a column on the row that records it, and only for the event
that column describes: ``creator`` for the creation, ``last_writer`` for the
most recent write, ``archiver`` for the archive. A value is shown as recorded;
it becomes an email -- and so filterable -- only when it is one. Nobody is ever
given the current user, and nothing is called "System" that the row does not
call that itself.

**Coverage.** A workspace is reported as covered only when at least one of its
sources was found in the database with the columns this reading needs. That is
decided from the catalogue on every read, never from this list: a source named
here whose table is absent from a deployment covers nothing there.

**Cost.** One ``UNION ALL`` with the window pushed into every branch, counted,
grouped and paged in SQL. Nothing is filtered or sliced in Python, so page 40
is as correct as page 1 and the totals agree with what is listed.

**Beside the revision log.** Where the log exists it is the authority, and this
reading only fills in what happened before it. Each record type's boundary is
the moment of its own first revision (``revision_boundaries``): a recovered
event is read only from strictly before it -- less a five-minute guard, see
``BOUNDARY_GUARD`` -- and the revision log from it onward. The two sets
cannot meet, so nothing is ever shown twice and nothing has to be
de-duplicated afterwards. A record type the log has never recorded
has no boundary, and is recovered for the whole window. ``read_hybrid`` reads
both as one feed, filtered, counted and paged together.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import connection

logger = logging.getLogger(__name__)

#: Separates the parts of a composite title or context inside one SQL value. A
#: control character no name contains, so splitting it back is exact and a
#: search typed by a person can never match across two parts.
UNIT = '\x1f'

CURRICULUM_SCHEMA = 'curriculum'


@dataclass(frozen=True)
class DerivedSource:
    """One table the timestamp reading can speak for.

    ``entity`` is the same record type the revision log records, so the two
    readings share their labels, their links, their Record type filter and their
    workspace. Naming (``title`` / ``title_fallback`` / ``context``) defaults to
    what that registration declares; it is spelled out here only where the
    physical column names differ from it.

    Every column name is resolved case-insensitively against the real table, so
    ``username`` finds ``"Username"`` on the enrolment schema. A naming column
    the table lacks is simply blank; a key or timestamp column it lacks takes
    the whole source out of the reading.
    """

    entity: str
    table: str
    schema: str = CURRICULUM_SCHEMA
    #: Column, or columns joined with ``:``. Defaults to the registered key.
    key: tuple = ()
    #: Stamped once, on insert. The only column that can prove a creation.
    created: str = ''
    #: ``created`` when the column really is insert-only; ``recorded`` when a
    #: later save may rewrite it (a resubmission, an upsert).
    created_action: str = 'created'
    #: The last write.
    updated: str = ''
    #: The archive / soft-delete stamp.
    deleted: str = ''
    reason: str = ''
    via_parent: str = ''
    #: Who created the row, as the row records it.
    creator: str = ''
    #: Who wrote the row last, as the row records it.
    last_writer: str = ''
    archiver: str = ''
    #: Further events the row stamps: ``(column, action, actor_column)``.
    extra: tuple = ()
    title: tuple | None = None
    title_join: str | None = None
    title_fallback: tuple | None = None
    context: tuple | None = None
    #: Where this record type lives, when the registration does not say.
    href: str = ''
    #: Which connection alias the application writes this table through.
    using: str = 'default'


def _source(entity, table, **options):
    return DerivedSource(entity=entity, table=table, **options)


# The curriculum's six, exactly as the trail has always read them: the same
# tables, keys, names and links. The rest of the curriculum's audited tables
# are small enough to add; quiz questions (~88k) and answers (~355k) are not --
# they are written in bulk with their quiz, every import would put thousands of
# rows in the feed, and the quiz's own row already says when it moved.
_CURRICULUM_ARCHIVE = {'deleted': 'deleted_at', 'reason': 'deleted_by', 'via_parent': 'deleted_via_parent'}
_STAMPED = {'created': 'created_at', 'updated': 'updated_at'}

CURRICULUM_SOURCES = (
    _source('module', 'modules', key=('module_catalogue_id',), title=('title',), context=('programme_name',),
            href='/curriculum/module-builder', **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('week', 'weeks', key=('id',), title=('title',), context=('module_catalogue_id',),
            href='/curriculum/week-builder', **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('component', 'components', key=('id',), title=('title',), context=('module_catalogue_id',),
            href='/curriculum/module-builder', **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('cohort', 'cohorts', key=('cohort_id',), title=('cohort_name',), context=('programme_name',),
            href='/curriculum/cohorts', **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('group', 'groups', key=('group_id',), title=('group_name',), context=('programme_name',),
            href='/curriculum/groups', **_STAMPED, **_CURRICULUM_ARCHIVE),
    # The key column differs by deployment; ``programme_key`` resolves it.
    _source('programme', 'programmes', key=(), title=('name',), context=('standard',),
            href='/curriculum/programmes', creator='created_by', **_STAMPED, **_CURRICULUM_ARCHIVE),
    # The rest name themselves the way the revision log names them, and link
    # where `quality.ENTITY_LABELS` says their records live.
    _source('module_details', 'module_details', key=('module_catalogue_id',), title=('module_catalogue_id',),
            **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('module_completion', 'module_completion_criteria', key=('module_catalogue_id',),
            title=('module_catalogue_id',), **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('ksb_mapping', 'ksb_mappings', key=('id',), title=('ksb_code',), context=('module_catalogue_id',),
            **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('week_template', 'week_templates', key=('id',), title=('title',), **_STAMPED, **_CURRICULUM_ARCHIVE),
    _source('week_template_component', 'week_template_components', key=('id',), title=('title',), **_STAMPED),
    _source('holiday', 'holidays', key=('id',), title=('name',), **_STAMPED),
    _source('quiz', 'quizzes', key=('id',), title=('title',), **_STAMPED),
)

# Everything else. Each line was checked against the live catalogue: the stamp
# columns exist, are set by a default or by the write path, and -- for the ones
# called ``created`` -- are not rewritten by any later save in the code.
_ENROLMENT_STAMPED = {'created': 'Created_at', 'updated': 'Updated_at', 'using': 'enrolment'}

LMS_SOURCES = (
    # Administration -- the staff directory.
    _source('staff_record', 'Staff_users', schema='enrolment', **_ENROLMENT_STAMPED),

    # Employers.
    _source('organisation', 'Organisations', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('employer_contact', 'Employers', schema='enrolment', **_ENROLMENT_STAMPED),

    # Enrolment. ``Created_users`` (the learner record) is absent on purpose:
    # it has no creation or update stamp at all, only a signature time.
    _source('learner_profile', 'learners', schema='Learner', using='enrolment', **_STAMPED),
    _source('apprenticeship_agreement', 'Apprenticeship_Agreements', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('eligibility_review', 'Review_Eligibility', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('enrolment_review', 'Enrolment_Reviews', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('extended_ilr', 'Extended_ILR', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('health_safety_review', 'Review_Health_Safety', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('ilr_document', 'ILR_Documents', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('rpl_review', 'Review_RPL', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('training_plan_document', 'Training_Plan_Documents', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('written_agreement', 'Written_Agreements', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('wizard_cv_job', 'Wizard_Cv_Job', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('wizard_ksb_assessment', 'Wizard_Ksb_Assessments', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('wizard_personal_details', 'Wizard_Personal_Details', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('wizard_plr', 'Wizard_Plr', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('wizard_plr_record', 'Wizard_Plr_Records', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('wizard_policy_ack', 'Wizard_Policy_Acks', schema='enrolment', **_ENROLMENT_STAMPED),
    _source('wizard_skills_radar', 'Wizard_Skills_Radar', schema='enrolment', **_ENROLMENT_STAMPED),
    # Only a last-write stamp: a regenerated document moves it, so it can say
    # when the document was last there and nothing about when it began.
    _source('enrolment_document', 'Enrolment_Documents', schema='enrolment', updated='Updated_at', using='enrolment'),

    # Coach. The review tables sit in the curriculum schema but belong to the
    # coach's workspace, which is where the revision log files them too.
    _source('coach_meeting', 'coach_calendar_event', schema='Coach', **_STAMPED),
    _source('absence_report', 'coach_absence_report', schema='Coach', **_STAMPED),
    _source('review_instance', 'review_instances', creator='created_by', last_writer='updated_by', **_STAMPED),
    _source('review_answer', 'review_instance_answers', last_writer='answered_by', **_STAMPED),
    _source('review_signature', 'review_instance_signatures', last_writer='signed_by', **_STAMPED),
    _source('learner_review_addition', 'learner_review_additions', creator='created_by', last_writer='updated_by',
            deleted='deleted_at', archiver='deleted_by', **_STAMPED),
    # One row per reopen / override, inserted at the moment it happened.
    _source('review_reopen', 'review_instance_reopens', created='changed_at', creator='changed_by'),
    _source('review_manual_override', 'review_instance_manual_overrides', created='changed_at', creator='changed_by'),
    _source('progress_review_run', 'progress_review_runs', schema='Learner', last_writer='generated_by',
            using='enrolment', **_STAMPED),
    # A resubmission can move ``submitted_at``, so it cannot prove a creation.
    # Marking is its own event, by whoever the row says marked it.
    _source('assignment_submission', 'learning_reflection_submissions', schema='Learner', created='submitted_at',
            created_action='recorded', extra=(('reviewed_at', 'updated', 'reviewed_by'),), using='enrolment'),

    # Learner.
    _source('evidence_file', 'evidence_files', schema='Learner', created='uploaded_at', creator='uploaded_by',
            using='enrolment'),
    _source('monthly_report', 'learner_monthly_reports', schema='Learner', created='submitted_at',
            created_action='recorded', updated='updated_at', using='enrolment'),

    # Engagement.
    _source('engagement_event', 'events', schema='Engagement', **_STAMPED),
    _source('flash_card_deck', 'flash_card_decks', schema='Engagement', **_STAMPED),
    _source('flash_card', 'flash_cards', schema='Engagement', **_STAMPED),
    _source('points_rule', 'points_rules', schema='Engagement', **_STAMPED),
    _source('reward', 'rewards', schema='Engagement', **_STAMPED),
    _source('points_grant', 'points_grants', schema='Engagement', created='awarded_at', creator='awarded_by'),
    _source('recognition', 'recognitions', schema='Engagement', created='awarded_at', creator='awarded_by'),
    _source('club_membership', 'club_memberships', schema='Engagement', created='assigned_at', creator='assigned_by'),
    _source('event_booking', 'event_bookings', schema='Engagement', created='booked_at',
            extra=(('cancelled_at', 'updated', ''),)),
    _source('voucher_claim', 'voucher_claims', schema='Engagement', created='requested_at',
            extra=(('reviewed_at', 'updated', 'reviewed_by'),)),
    _source('attendance_intervention', 'attendance_interventions', schema='Engagement', created='created_at',
            creator='created_by', extra=(('resolved_at', 'updated', ''),)),
    # Re-marking moves ``marked_at``: the last marking, not the first.
    _source('event_attendance', 'event_attendance', schema='Engagement', updated='marked_at',
            last_writer='marked_by'),
    _source('club_meeting_attendance', 'club_meeting_attendance', schema='Engagement', updated='marked_at',
            last_writer='marked_by'),

    # Audit. Two families write here -- Learner Log Pro's "Audit" schema and the
    # manual audit's "Manual_audit" -- and both are read, because both are
    # where an auditor's corrections land.
    _source('manual_signoff', 'monthly_audit_signoffs', schema='Audit', title=('signer_role', 'signer_name'),
            last_writer='signer_name', using='audit', **_STAMPED),
    _source('evidence_override', 'learner_evidence_overrides', schema='Audit', creator='uploaded_by',
            deleted='archived_at', archiver='archived_by', extra=(('deleted_at', 'deleted', ''),), using='audit',
            **_STAMPED),
    _source('evidence_override', 'learner_evidence_overrides', schema='Manual_audit', creator='uploaded_by',
            deleted='archived_at', archiver='archived_by', extra=(('deleted_at', 'deleted', ''),), using='audit',
            **_STAMPED),
    _source('activity_override', 'activity_overrides', schema='Audit', key=('aptem_id', 'activity_id'),
            last_writer='updated_by', using='audit', **_STAMPED),
    _source('activity_override', 'activity_overrides', schema='Manual_audit', key=('aptem_id', 'activity_id'),
            last_writer='updated_by', using='audit', **_STAMPED),
    # Upserts with only a last-write stamp.
    _source('profile_override', 'learner_profile_overrides', schema='Audit', key=('learner_id',), title=('learner_id',),
            updated='updated_at', last_writer='updated_by', using='audit'),
    _source('activity_annotation', 'activity_annotations', schema='Audit', key=('component_id',),
            updated='updated_at', last_writer='updated_by', using='audit'),
    _source('activity_annotation', 'activity_annotations', schema='Manual_audit', key=('component_id',),
            updated='updated_at', last_writer='updated_by', using='audit'),
    _source('manual_hours_override', 'learner_hours_overrides', schema='Manual_audit', key=('aptem_id', 'period'),
            updated='updated_at', last_writer='updated_by', using='audit'),
    _source('manual_date_override', 'learner_profile_date_overrides', schema='Manual_audit', key=('aptem_id',),
            updated='updated_at', last_writer='updated_by', using='audit'),
    # An append-only log: one row per change, stamped when it was made.
    _source('manual_plan_event', 'plan_events', schema='Manual_audit', created='at', creator='actor', using='audit'),

    # Platform -- who opened a conversation with whom. Messages are left out:
    # a row per message is a read of private correspondence, and the revision
    # log already records what an audit needs from them.
    _source('chat_conversation', 'conversations', schema='chat', title=('coach_id', 'learner_id'), title_join=' › ',
            **_STAMPED),
)

DERIVED_AUDIT_SOURCES = CURRICULUM_SOURCES + LMS_SOURCES

#: Record types the revision log knows that this reading deliberately does not
#: read, and why -- so the gap is stated rather than left for somebody to find.
NOT_DERIVABLE = {
    'learner_record': 'enrolment."Created_users" keeps no creation or update stamp.',
    'quiz_attempt': 'Not a table: an attempt is stored inside the learner\'s progress record.',
    'quiz_question': '~88k rows written in bulk with their quiz; the quiz row already dates the change.',
    'quiz_answer': '~355k rows written in bulk with their question; the quiz row already dates the change.',
    # Read-only access would be safe; it is left out so this reading never
    # depends on Teams scheduling tables. Its saves are in the revision log.
    'live_session': 'Teams-linked series; kept out of the timestamp reading by scope, not by evidence.',
    'club': 'No timestamp columns.',
    'club_meeting': 'No timestamp columns.',
    'chat_message': 'Private correspondence; recorded by the revision log only.',
    'chat_message_deletion': 'Private correspondence; recorded by the revision log only.',
}


# ------------------------------------------------------------------ registry

def _registry():
    from curriculum_api import versioning
    from system_audit import writes
    return versioning, writes


def workspace_of(source):
    _, writes = _registry()
    return writes.workspace_for_entity(source.entity)


def _registered(entity):
    """The revision registration for one record type: key and naming."""
    versioning, _ = _registry()
    key = ''
    for config in versioning.VERSIONED_TABLES.values():
        if config.get('entity_type') == entity:
            key = config.get('key') or ''
            break
    facts = versioning.ENTITY_FACT_FIELDS.get(entity) or {}
    return {
        'key': (key,) if key else (),
        'title': tuple(facts.get('title') or ()),
        'title_join': facts.get('title_join') or ' ',
        'title_fallback': tuple(facts.get('title_fallback') or ()),
        'context': tuple(versioning.ENTITY_CONTEXT_FIELDS.get(entity) or ()),
    }


def sources_for(workspace='', entity=''):
    """The sources one request should read -- before anything is queried.

    Narrowed here rather than filtered afterwards, so a Coach-only feed does not
    pay for reading the curriculum's components.
    """
    chosen = []
    for source in DERIVED_AUDIT_SOURCES:
        if workspace and workspace != 'all' and workspace_of(source) != workspace:
            continue
        if entity and entity != 'all' and source.entity != entity:
            continue
        chosen.append(source)
    return chosen


# ------------------------------------------------------------------ catalogue

_COLUMNS_CACHE = {}
_BOUNDARY_CACHE = {}


def reset_catalogue():
    """Forget what was learnt about the tables. Tests create and drop them."""
    _COLUMNS_CACHE.clear()
    _BOUNDARY_CACHE.clear()


def _cache_key(source):
    return (connection.vendor, source.schema.lower(), source.table.lower())


def _sqlite_columns(source):
    schema = '' if source.schema == CURRICULUM_SCHEMA else f'{quote_ident(source.schema)}.'
    try:
        with connection.cursor() as cursor:
            cursor.execute(f'pragma {schema}table_info({quote_ident(source.table)})')
            return [row[1] for row in cursor.fetchall()]
    except Exception:
        # An unattached schema is a table that is not there.
        return []


def table_columns(sources):
    """``{source: {lowercase name: real name}}`` for every source that exists.

    One catalogue query for all of them on PostgreSQL -- a request reading fifty
    tables must not make fifty round trips to ask whether they are there. A table
    that exists is remembered; one that does not is asked about again next time,
    so a table created after start-up is picked up without a restart.
    """
    found = {}
    missing = []
    for source in sources:
        cached = _COLUMNS_CACHE.get(_cache_key(source))
        if cached:
            found[source] = cached
        else:
            missing.append(source)
    if not missing:
        return found

    if connection.vendor == 'postgresql':
        pairs = sorted({(source.schema, source.table) for source in missing})
        placeholders = ', '.join(['(%s, %s)'] * len(pairs))
        params = [part for pair in pairs for part in pair]
        rows = {}
        with connection.cursor() as cursor:
            cursor.execute(
                'select table_schema, table_name, column_name from information_schema.columns '
                f'where (table_schema, table_name) in ({placeholders})',
                params,
            )
            for schema, table, column in cursor.fetchall():
                rows.setdefault((schema, table), []).append(column)
        for source in missing:
            columns = rows.get((source.schema, source.table)) or []
            if columns:
                mapping = {column.lower(): column for column in columns}
                _COLUMNS_CACHE[_cache_key(source)] = mapping
                found[source] = mapping
        return found

    for source in missing:
        columns = _sqlite_columns(source)
        if columns:
            found[source] = {column.lower(): column for column in columns}
    return found


def _same_database(alias):
    """Whether an alias is the connection this reading queries.

    In every deployment so far the enrolment and audit aliases are the same
    database as ``default``, which is what lets one statement read all of them.
    A deployment that split one off would otherwise be read through the wrong
    connection -- so such a source is reported unreadable instead.
    """
    if alias == 'default':
        return True
    databases = settings.DATABASES
    if alias not in databases:
        return False
    mine, theirs = databases['default'], databases[alias]
    if (theirs.get('TEST') or {}).get('MIRROR') == 'default':
        return True
    def where(config):
        # An unset port is the engine's default one; production's aliases spell
        # the same port both ways.
        port = str(config.get('PORT') or '')
        if not port and 'postgresql' in str(config.get('ENGINE') or ''):
            port = '5432'
        return (str(config.get('ENGINE') or ''), str(config.get('HOST') or ''), port, str(config.get('NAME') or ''))

    return where(mine) == where(theirs)


# ------------------------------------------------------------------ SQL

def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def _literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def table_ref(source):
    if source.schema == CURRICULUM_SCHEMA and connection.vendor != 'postgresql':
        return quote_ident(source.table)
    return f'{quote_ident(source.schema)}.{quote_ident(source.table)}'


class _Resolved:
    """A source whose column names have been matched to the real table."""

    def __init__(self, source, columns):
        self.source = source
        self.columns = columns
        registered = _registered(source.entity)
        self.key = [self.col(name) for name in (source.key or self._key_default(registered))]
        self.title = [self.col(name) for name in (source.title if source.title is not None else registered['title'])]
        self.title_join = source.title_join if source.title_join is not None else registered['title_join']
        self.fallback = [self.col(name) for name in (
            source.title_fallback if source.title_fallback is not None else registered['title_fallback'])]
        self.context = [self.col(name) for name in (source.context if source.context is not None else registered['context'])]

    def _key_default(self, registered):
        if self.source.entity == 'programme':
            from curriculum_api import views as curriculum_views
            return (curriculum_views.programme_config_key_column(),)
        return registered['key']

    def col(self, name):
        """The real column, or '' when the table does not have it."""
        return self.columns.get(str(name or '').lower(), '') if name else ''

    @property
    def names_a_person(self):
        source = self.source
        columns = [source.creator, source.last_writer, source.archiver] + [actor for _, _, actor in source.extra]
        return any(self.col(column) for column in columns)

    @property
    def usable(self):
        stamps = [self.col(self.source.created), self.col(self.source.updated), self.col(self.source.deleted)]
        stamps += [self.col(column) for column, _, _ in self.source.extra]
        return bool(self.key) and all(self.key) and any(stamps)


def _text(column):
    return f"coalesce(cast({quote_ident(column)} as text), '')" if column else "''"


def _joined(columns):
    present = [column for column in columns if column]
    if not present:
        return "''"
    return f' || {_literal(UNIT)} || '.join(_text(column) for column in present)


def _branches(resolved, since, until=None):
    """One SELECT per kind of event this table's stamps can prove.

    ``until`` is the record type's revision boundary: every event is read from
    strictly before it, whatever stamp it comes from.
    """
    source = resolved.source
    created = resolved.col(source.created)
    updated = resolved.col(source.updated)
    deleted = resolved.col(source.deleted)
    creator = resolved.col(source.creator)
    last_writer = resolved.col(source.last_writer)
    archiver = resolved.col(source.archiver)
    q = quote_ident

    key = ' || \':\' || '.join(f'cast({q(column)} as text)' for column in resolved.key)
    common = (
        f'{_literal(source.entity)} as entity, {_literal(source.schema + "." + source.table)} as origin, '
        f'{key} as entity_id, {_joined(resolved.title)} as title, {_joined(resolved.fallback)} as title_fallback, '
        f'{_joined(resolved.context)} as context, '
        f'{_text(resolved.col(source.reason))} as reason, {_text(resolved.col(source.via_parent))} as via_parent'
    )
    ref = table_ref(source)
    not_the_archive = f' and ({q(deleted)} is null or {q(updated)} <> {q(deleted)})' if deleted and updated else ''
    branches = []

    def branch(action, stamp, actor, where):
        actor_sql = f'cast({actor} as text)' if actor else 'cast(null as text)'
        before = f' and {q(stamp)} < %s' if until is not None else ''
        branches.append((
            f'select {common}, {_literal(action)} as action, {q(stamp)} as at, {actor_sql} as actor '
            f'from {ref} where {q(stamp)} >= %s{before}{where}',
            [since, _sql_moment(until)] if until is not None else [since],
        ))

    if created:
        # The creator, where the row names one. Otherwise its last writer --
        # but only when there has been no later write, because then the last
        # writer IS whoever created it.
        if creator:
            actor = q(creator)
        elif last_writer and updated:
            actor = f'case when {q(updated)} is null or {q(updated)} = {q(created)} then {q(last_writer)} end'
        else:
            actor = q(last_writer) if last_writer else ''
        branch(source.created_action, created, actor, '')
    if updated and created:
        # A second, later write -- not the insert itself, and not the archive.
        branch('updated', updated, q(last_writer) if last_writer else '',
               f' and {q(created)} is not null and {q(updated)} <> {q(created)}{not_the_archive}')
    if updated:
        # A last write with nothing to compare it with: present, origin unknown.
        branch('recorded', updated, q(last_writer) if last_writer else '',
               (f' and {q(created)} is null' if created else '') + not_the_archive)
    if deleted:
        branch('archived', deleted, q(archiver) if archiver else '', '')
    for column, action, actor_column in source.extra:
        stamp = resolved.col(column)
        if stamp:
            actor = resolved.col(actor_column)
            branch(action, stamp, q(actor) if actor else '', '')
    return branches


def build_union(resolved_sources, since, boundaries=None):
    """Every source's events in the window, as one statement.

    With ``boundaries`` each source stops ``BOUNDARY_GUARD`` before its record
    type's first revision, and a source whose revisions begin before the window opens is not read at
    all -- the log already covers every moment the request asks about.
    """
    parts, params = [], []
    for resolved in resolved_sources:
        until = (boundaries or {}).get(resolved.source.entity)
        if until is not None:
            until = until - BOUNDARY_GUARD
            if until <= _as_moment(since):
                continue
        for sql, branch_params in _branches(resolved, since, until):
            parts.append(sql)
            params.extend(branch_params)
    return ' union all '.join(parts), params


#: How far before a record type's first revision the recovered reading stops.
#: A save's own stamp can be written a moment before the revision that logs it
#: -- a stamp taken when the request began, a revision written as it ended --
#: so the very first logged save could otherwise also be recovered from its
#: timestamp just before the line. Losing these minutes of pre-log history,
#: once per record type, is the price of never showing one save twice.
BOUNDARY_GUARD = timedelta(minutes=5)


def revision_boundaries(entities):
    """``{entity: first revision's moment, or None}`` for each record type.

    The boundary between the two readings, decided per record type from the log
    itself rather than from a date written down here: types started being
    recorded on different days, and some have not been recorded yet.

    The earliest revision is the safe line. Before it the log holds nothing of
    that type, so a recovered event there cannot be one the log also shows.
    After it a save the log missed is lost rather than shown twice -- the log
    is the authority, and a timestamp is never allowed to talk over it.

    One statement, one index probe per type on ``(entity_type, created_at)``. A
    found boundary is remembered: it can only move later if revisions are
    deleted, and a remembered earlier one then still recovers nothing the log
    holds. A type with no revision yet is asked about again on the next read.
    """
    from curriculum_api import versioning
    entities = sorted({entity for entity in entities if entity})
    found = {entity: _BOUNDARY_CACHE[entity] for entity in entities if entity in _BOUNDARY_CACHE}
    missing = [entity for entity in entities if entity not in found]
    if missing:
        table = versioning.qualified(versioning.REVISIONS_TABLE)
        sql = ' union all '.join(
            [f'select %s as entity, (select min(created_at) from {table} where entity_type = %s) as boundary']
            * len(missing)
        )
        with connection.cursor() as cursor:
            cursor.execute(sql, [part for entity in missing for part in (entity, entity)])
            for entity, boundary in cursor.fetchall():
                boundary = _as_moment(boundary)
                if boundary is not None:
                    _BOUNDARY_CACHE[entity] = boundary
                found[entity] = boundary
    return found


def _sql_moment(value):
    """A boundary as a query parameter: aware for Postgres, naive UTC for sqlite,
    which stores its stamps as naive text and would compare an offset as text."""
    from datetime import timezone
    if connection.vendor == 'postgresql':
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _as_moment(value):
    """A moment as an aware UTC datetime, whatever the driver handed back.

    sqlite returns text and Postgres an aware datetime; the window's ``since``
    is a naive UTC one. Compared, all three have to mean the same instant.
    """
    from datetime import datetime, timezone
    if value is None or value == '':
        return None
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except ValueError:
            return None
    if isinstance(value, datetime) and value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value


def outer_filters(action='', search='', actor=''):
    """Applied over the whole window before anything is counted or paged."""
    where, params = [], []
    if action and action != 'all':
        where.append('action = %s')
        params.append(action)
    if actor:
        where.append("lower(coalesce(actor, '')) = %s")
        params.append(actor.lower())
    if search:
        needle = f'%{search.lower()}%'
        where.append(
            '(lower(title) like %s or lower(title_fallback) like %s or lower(context) like %s '
            "or lower(entity_id) like %s or lower(coalesce(actor, '')) like %s)"
        )
        params.extend([needle] * 5)
    return (' where ' + ' and '.join(where)) if where else '', params


def resolve(workspace='', entity=''):
    """The sources one request reads, matched to their real tables.

    Returns ``(resolved, unreadable)``: the usable ones, and the record types
    whose table lives behind a connection this statement cannot reach.
    """
    chosen = sources_for(workspace, entity)
    unreadable = []
    columns = table_columns(chosen)
    resolved = []
    for source in chosen:
        if source not in columns:
            continue
        if not _same_database(source.using):
            unreadable.append(source.entity)
            continue
        candidate = _Resolved(source, columns[source])
        if candidate.usable:
            resolved.append(candidate)
    return resolved, unreadable


def read(*, since, workspace='', entity='', action='', search='', actor='', limit=50, page=1):
    """The derived feed for one request, paged in SQL.

    Returns the page's rows, the window's totals, and the coverage that backs
    them: which workspaces were actually read, which sources could not be.
    """
    resolved, unreadable = resolve(workspace, entity)

    empty = {
        'rows': [], 'total': 0, 'page': 1, 'pages': 1, 'action_counts': {}, 'entity_counts': {},
        'actors': [], 'read': [], 'unreadable': unreadable,
    }
    if not resolved:
        return empty

    union, params = build_union(resolved, since)
    where, filter_params = outer_filters(action, search, actor)
    from curriculum_api import views as curriculum_views

    grouped = curriculum_views.fetch_all(
        f'select action, entity, count(*) as total from ({union}) e{where} group by action, entity',
        params + filter_params,
    )
    action_counts, entity_counts, total = {}, {}, 0
    for row in grouped:
        count = int(row.get('total') or 0)
        total += count
        action_counts[row['action']] = action_counts.get(row['action'], 0) + count
        entity_counts[row['entity']] = entity_counts.get(row['entity'], 0) + count

    pages = max(1, -(-total // limit))
    page = min(max(1, page), pages)
    offset = (page - 1) * limit
    rows = curriculum_views.fetch_all(
        f'select * from ({union}) e{where} '
        f'order by at desc, entity, origin, entity_id, action limit {int(limit)} offset {int(offset)}',
        params + filter_params,
    )
    actors = curriculum_views.fetch_all(
        f'select lower(actor) as email, max(actor) as name, count(*) as changes from ({union}) e '
        "where actor like '%%@%%' group by lower(actor) order by count(*) desc limit 100",
        params,
    )
    return {
        'rows': rows,
        'total': total,
        'page': page,
        'pages': pages,
        'action_counts': action_counts,
        'entity_counts': entity_counts,
        'actors': actors,
        'read': [item.source for item in resolved],
        'unreadable': unreadable,
    }


PROVENANCE_REVISION = 'revision'
PROVENANCE_TIMESTAMPS = 'timestamps'


def read_hybrid(*, since, revision_table, revision_where, revision_params, revision_columns=('id',),
                recover=True, workspace='', entity='', action='', search='', actor='', limit=50, page=1):
    """The revision log and the history before it, as one feed.

    ``revision_where`` is the revision trail's own filter, already narrowed by
    window, workspace, record type, action, author and search. The recovered
    half is narrowed by the same request, and each of its sources stops at its
    record type's first revision. Both are then one UNION, and everything a
    reader sees -- the total, the counts, the order and the page -- is taken
    from that one set, so page 40 is page 40 of the whole feed, not of either
    half.

    A revision row carries into the UNION only what sorting, filtering and
    counting need. The page's revisions are joined back in full by id inside
    the same statement, their ``revision_columns`` prefixed ``rev_`` -- one
    round trip, not one per page and another for the rows.

    ``recover=False`` reads the log alone: for a filter the timestamps cannot
    answer (a module's scope, an automated source), where adding them would
    show events the filter was asked to exclude.

    Ordering is ``at`` newest first, revisions before recovered events at the
    same instant, then fixed keys -- so a page never reshuffles between reads.
    """
    from curriculum_api import views as curriculum_views

    resolved, unreadable = resolve(workspace, entity) if recover else ([], [])
    boundaries = revision_boundaries({item.source.entity for item in resolved}) if resolved else {}
    recovered_union, recovered_params = build_union(resolved, since, boundaries) if resolved else ('', [])

    revision_sql = (
        f'select {_literal(PROVENANCE_REVISION)} as provenance, id as revision_id, entity_type as entity, '
        "cast('' as text) as origin, entity_id, cast('' as text) as title, cast('' as text) as title_fallback, "
        "cast('' as text) as context, cast('' as text) as reason, cast('' as text) as via_parent, "
        f'action, created_at as at, actor_email as actor from {revision_table} where {revision_where}'
    )
    parts, params = [revision_sql], list(revision_params)
    recovered_sql, recovered_all_params = '', []
    if recovered_union:
        where, filter_params = outer_filters(action, search, actor)
        recovered_sql = (
            f'select {_literal(PROVENANCE_TIMESTAMPS)} as provenance, cast(0 as bigint) as revision_id, entity, '
            'origin, entity_id, title, title_fallback, context, reason, via_parent, action, at, actor '
            f'from ({recovered_union}) d{where}'
        )
        recovered_all_params = recovered_params + filter_params
        parts.append(recovered_sql)
        params += recovered_all_params
    combined = ' union all '.join(parts)

    grouped = curriculum_views.fetch_all(
        f'select provenance, action, entity, count(*) as total from ({combined}) e '
        'group by provenance, action, entity',
        params,
    )
    action_counts, entity_counts, provenance_counts, total = {}, {}, {}, 0
    for row in grouped:
        count = int(row.get('total') or 0)
        total += count
        action_counts[row['action']] = action_counts.get(row['action'], 0) + count
        entity_counts[row['entity']] = entity_counts.get(row['entity'], 0) + count
        provenance_counts[row['provenance']] = provenance_counts.get(row['provenance'], 0) + count

    pages = max(1, -(-total // limit))
    page = min(max(1, page), pages)
    offset = (page - 1) * limit
    order = 'at desc, provenance, revision_id desc, entity, origin, entity_id, action'
    # Page N of the whole feed can only hold rows from the newest
    # ``offset + limit`` of each half, so each half is cut there first, in its
    # own order, and the page is taken from what is left. Exactly the same page
    # as sorting everything -- the totals above are untouched -- but the log's
    # half walks its ``created_at`` index instead of sorting a million rows to
    # return fifty.
    reach = int(offset) + int(limit)
    halves = [f'select * from ({revision_sql} order by at desc, revision_id desc limit {reach}) rh']
    page_params = list(revision_params)
    if recovered_sql:
        halves.append(
            f'select * from ({recovered_sql} order by at desc, entity, origin, entity_id, action limit {reach}) th')
        page_params += recovered_all_params
    paged = ' union all '.join(halves)
    full = ', '.join(f'r.{quote_ident(column)} as {quote_ident("rev_" + column)}' for column in revision_columns)
    rows = curriculum_views.fetch_all(
        f'select p.*, {full} from ('
        f'select * from ({paged}) e order by {order} limit {int(limit)} offset {int(offset)}'
        f') p left join {revision_table} r on p.provenance = {_literal(PROVENANCE_REVISION)} '
        f'and r.id = p.revision_id order by {", ".join("p." + key for key in order.split(", "))}',
        page_params,
    ) if total else []

    # Only the tables that record a person at all can add one to the list.
    named = [item for item in resolved if item.names_a_person]
    actor_union, actor_params = build_union(named, since, boundaries) if named else ('', [])
    actors = curriculum_views.fetch_all(
        f'select lower(actor) as email, max(actor) as name, count(*) as changes from ({actor_union}) e '
        "where actor like '%%@%%' group by lower(actor) order by count(*) desc limit 100",
        actor_params,
    ) if actor_union else []
    return {
        'rows': rows,
        'total': total,
        'page': page,
        'pages': pages,
        'action_counts': action_counts,
        'entity_counts': entity_counts,
        'provenance_counts': provenance_counts,
        'recovered_actors': actors,
        'boundaries': boundaries,
        'read': [item.source for item in resolved],
        'unreadable': unreadable,
    }


def coverage():
    """Which workspaces this reading can speak for in this database.

    Decided from the catalogue: a workspace counts only when one of its tables
    is present with the columns this reading needs. Asked of every source, not
    only the ones a filtered request reads, so choosing "Coach" does not make
    the page claim the curriculum is uncovered.
    """
    columns = table_columns(DERIVED_AUDIT_SOURCES)
    covered = set()
    for source in DERIVED_AUDIT_SOURCES:
        if source in columns and _same_database(source.using) and _Resolved(source, columns[source]).usable:
            workspace = workspace_of(source)
            if workspace:
                covered.add(workspace)
    return sorted(covered)


def split(value):
    """A joined title or context back into its non-empty parts."""
    return [part.strip() for part in str(value or '').split(UNIT) if part.strip()]
