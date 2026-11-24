"""Curriculum version history: capture.

Every save that changes a versioned record writes a revision holding the row as
it was saved plus a field-level diff against the previous one. Where the record
declares a version of its own -- a component's ``settings.version``, a module
reaching ``published`` -- that revision is also pinned as a named version.

Three rules shape everything below.

**A revision must never fail a save.** History is worth less than the content it
describes, so every entry point swallows its own failures and every read of the
history tables is guarded by a probe. Dropping the tables turns history off; it
does not turn saving off. See ``history_available``.

**Only real changes are recorded.** A save that rewrites a row to the values it
already held produces no revision. Without this the programme-tree save -- which
bulk-writes every component in a module on each run -- would bury the handful of
genuine edits under thousands of identical rows, and the diff between two
revisions would usually be empty.

**The actor comes from the request, not the row.** No curriculum table has an
author column. ``ActorMiddleware`` parks the signed-in account on a thread-local
for the life of the request so the write helpers, which never see the request,
can still name who saved.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from urllib.parse import urlsplit

from django.db import DEFAULT_DB_ALIAS, DatabaseError, connection, transaction

from . import schema_gate

logger = logging.getLogger(__name__)

from .reporting.domain.revision_contracts import REVISIONS_TABLE
from .reporting.domain.revision_contracts import VERSIONS_TABLE

# The authoring tables that carry material. Keyed by table name, because that is
# what the write helpers know about themselves.
#
# Every table whose rows a person authors belongs here. The ones a person never
# authors deliberately do not: the GOV.UK holiday mirror (england_holidays) is
# replicated, not edited, and the live-session attendance/artifact/recording
# tables are written by Microsoft Graph polling rather than by an author, so
# recording them would fill the history with machine traffic. `live_sessions`
# itself IS authored -- a person schedules it -- so it is here.
from .reporting.domain.revision_contracts import VERSIONED_TABLES

from .reporting.domain.revision_contracts import ENTITY_TYPES

# The columns a snapshot holds, per entity. Declaring them rather than taking
# whatever the caller happened to pass is what makes two write paths comparable:
# `authoring_upsert` hands over a full database row, while the programme-tree
# save hands over the payload it built, and those are not the same shape. A
# column absent from the source is stored as None, so alternating between the
# two paths cannot read as "field removed, field added" on every save.
#
# It also keeps the snapshot to the content that matters. `created_at` and
# `updated_at` move on every save and would defeat the only-real-changes rule;
# `is_programme_deleted` is bookkeeping, not material.
#
# Columns are named, never taken wholesale, which is also the allowlist that
# keeps credentials out of history: nothing here reaches a password, a token, a
# key or a session cookie, because no curriculum authoring table holds one and
# an unnamed column cannot arrive by accident. `live_session` is the one entity
# whose row touches an integration, so its Graph identifiers are named
# deliberately (they are the meeting's identity, and requirement 1 of the Teams
# invariants is that identity is traceable) while `join_url`, `web_link` and
# `meeting_options_url` are left out: those are the capability to enter a
# meeting, not a fact about it.
from .reporting.domain.revision_contracts import SNAPSHOT_COLUMNS

# The column whose value IS the entity's position among its siblings. A change
# to only this is a reorder, not an edit -- see ``resolve_action``.
from .reporting.domain.revision_contracts import ORDER_COLUMNS

# The column naming an entity's parent. A change to this is a move.
from .reporting.domain.revision_contracts import PARENT_COLUMNS

# Parsed rather than stored as text, so the diff can reach inside them. A
# component's material lives in settings_json, and "settings_json changed" would
# be the least useful thing this feature could say. They also arrive as a JSON
# string from one write path and as a parsed value from the other.
from .reporting.domain.revision_contracts import JSON_SNAPSHOT_COLUMNS

# Settings keys that behave the same way inside settings_json.
from .reporting.domain.revision_contracts import IGNORED_SETTING_KEYS

# A diff is read by a person, so long values are cut. The full value is always
# in the snapshot; the diff only has to say *that* it changed and roughly how.
from .reporting.domain.revision_contracts import DIFF_VALUE_LIMIT

# ------------------------------------------------------ what the log keeps
#
# The log answers "who changed what". It is not a second copy of the records,
# so each rule below removes something that answered nothing.

#: Identifiers and links Teams hands back after a push. The system fills them
#: in and nobody edits them, and a join link is a way into a meeting. The log
#: keeps one fact in their place: whether the component is linked to Teams.
from .reporting.domain.revision_contracts import TEAMS_SYSTEM_SETTING_KEYS
from .reporting.domain.revision_contracts import TEAMS_LINK_KEYS
from .reporting.domain.revision_contracts import TEAMS_LINK_MARKER
from .reporting.domain.revision_contracts import TEAMS_LINKED

#: Microsoft's own identifiers on a stored calendar, left out on the same rule.
from .reporting.domain.revision_contracts import SYSTEM_COLUMNS

#: Invite lists: a count and what moved, not every address on the list.
from .reporting.domain.revision_contracts import PEOPLE_LIST_FIELDS

#: Free text. The log records that it changed, never what it said: the record
#: itself holds the words, and a copy of every draft is what made rows heavy.
from .reporting.domain.revision_contracts import TEXT_COLUMNS
from .reporting.domain.revision_contracts import TEXT_SETTING_PATTERN
from .reporting.domain.revision_contracts import TEXT_CHANGED

#: One person's saves to one record inside this window are one line.
MERGE_WINDOW = timedelta(minutes=10)
MERGEABLE_ACTIONS = frozenset({'updated'})

#: What an older revision keeps once a newer one exists: where it sat, so the
#: trail can still scope and label it. Created, recorded and deleted revisions
#: keep their whole copy (the trail shows it), and so does any revision a named
#: version points at, because comparing and restoring versions reads it. A
#: recorded revision is the only account of what a pre-history record held when
#: history first saw it; slimming it would leave the record with no origin at all.
SLIM_SNAPSHOT_KEYS = ('_context', 'programme_id', 'cohort_id', 'group_id', 'module_catalogue_id', 'week_id')
FULL_SNAPSHOT_ACTIONS = ('created', 'recorded', 'deleted')

_local = threading.local()


# --------------------------------------------------------------- the actor

class ActorMiddleware:
    """Park the signed-in account where the write helpers can reach it.

    Must run after ``login.middleware.LoginSessionMiddleware``, which is what
    sets ``request.login_account``. The clear in ``finally`` is not optional:
    threads are reused between requests, and a leaked actor would attribute one
    person's save to whoever happened to be served before them.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Cleared on the way IN, not on the way out. Anything still buffered from
        # an earlier request on this thread belongs to a transaction that rolled
        # back -- a committed one flushed on commit -- so it is dropped rather
        # than written: a mutation that failed must not leave an audit record
        # saying it succeeded, and one request's buffer must never reach another.
        #
        # Doing it on the way out instead would throw away the buffer of a
        # request whose transaction commits after the middleware returns, which
        # is what happens under ATOMIC_REQUESTS and under the test runner.
        discard_pending()
        # The context is cleared with the buffer and for the same reason: a block
        # whose transaction rolled back may never have reached its `__exit__`,
        # and one request's "this is a recalculation" must not survive into the
        # next request served on this thread.
        discard_context()
        account = getattr(request, 'login_account', None)
        set_actor(account)
        set_source(request_source(request))
        try:
            with audit_context(metadata=request_metadata(request)):
                return self.get_response(request)
        finally:
            set_actor(None)
            discard_context()


def request_source(request):
    """What kind of write this is, from the request rather than from the body.

    The client may *say* a save is an auto-save -- that is metadata, and it is
    read here -- but it can only ever choose between labels for a write the
    backend has already authenticated and is about to perform itself. It cannot
    name the actor, the action or the values.
    """
    declared = clean(request.headers.get('X-Curriculum-Save-Source')).lower()[:32]
    if declared in ALLOWED_SOURCES:
        return declared
    return ''


def request_metadata(request):
    """Request location, never a request body or a URL's query credentials.

    The browser path is descriptive client context, not evidence of permission.
    The actor and the persisted changes still come exclusively from the server.
    """
    from system_audit import pages

    metadata = {'request_path': request.path, 'request_method': request.method}
    path = clean(request.headers.get('X-Audit-Page'))
    origin = 'browser'
    if not path:
        referer = clean(request.headers.get('Referer'))
        try:
            parsed = urlsplit(referer)
            if parsed.netloc == request.get_host():
                path = parsed.path
                origin = 'referer'
        except ValueError:
            pass
    if path.startswith('/') and not path.startswith('//') and '\\' not in path:
        path = pages.clean_path(path)
        if not pages.excluded(path) or path.startswith(('/learner/', '/old-otjh')):
            page = pages.resolve(path)
            metadata.update(page_path=path, page_label=page['pageLabel'],
                            page_workspace=page['workspace'], page_source=origin)
    return safe_metadata(metadata)


# Every source label the system may record. Stable machine-readable
# identifiers, never UI text -- the reader turns them into words.
SOURCES = {
    'manual',        # a person pressed Save
    'auto-save',     # the builder saved on its own behalf; still the person's edit
    'module-builder',
    'tree-save',     # the programme tree writes a whole branch at once
    'import',        # a file or an external catalogue brought this in
    'upload',        # a file was attached to a component
    'duplicate',
    'wizard',
    'recalculation',  # the system worked this out from something else that moved
    'scheduled-job',
    'system',
    'api',
}

# What a browser is allowed to claim about its own save. A narrower set than
# SOURCES on purpose: `recalculation` and `scheduled-job` are assertions only the
# backend can honestly make, so a client naming one is ignored rather than
# believed. Anything unrecognised is dropped, so this column cannot become free
# text from the browser.
ALLOWED_SOURCES = {'auto-save', 'manual', 'module-builder', 'import', 'duplicate', 'wizard'}

# Actor kinds.
#
# `user` is a person who was signed in. `system` is the LMS acting on its own
# account -- a recalculation, a repair, a cascade -- and is never a claim about
# intent, only the honest reading of a write no person directly made. `job` is a
# scheduled or management-command run; `integration` is an external system
# (Microsoft Graph) writing back through us.
ACTOR_USER = 'user'
ACTOR_SYSTEM = 'system'
ACTOR_INTEGRATION = 'integration'
ACTOR_JOB = 'job'
ACTOR_TYPES = {ACTOR_USER, ACTOR_SYSTEM, ACTOR_INTEGRATION, ACTOR_JOB}

# The name a non-person actor is shown under. It has no email, because inventing
# one would put a real mailbox against a change nobody made.
SYSTEM_ACTOR_NAME = 'System'

NO_ACTOR = {'email': '', 'name': ''}


def set_actor(account):
    if account is None:
        _local.actor = None
        return
    _local.actor = account_actor(account)


def account_actor(account):
    """A signed-in account as the two fields history stores."""
    if account is None:
        return dict(NO_ACTOR)
    if isinstance(account, dict):
        email = clean(account.get('email'))
        return {'email': email, 'name': clean(account.get('name')) or email}
    email = clean(getattr(account, 'email', ''))
    return {'email': email, 'name': clean(getattr(account, 'display_name', '')) or email}


def current_actor():
    return getattr(_local, 'actor', None) or dict(NO_ACTOR)


def actor_type():
    """The declared actor kind, or the honest reading of the request.

    Never guessed from the row: a curriculum table has no author column, so with
    nothing declared the only thing that can distinguish a person from a
    scheduled job is whether the request that reached the write helper carried a
    session.
    """
    declared = clean(current_context().get('actor_type'))
    if declared in ACTOR_TYPES:
        return declared
    return ACTOR_USER if current_actor()['email'] else ACTOR_SYSTEM


def attribute(kind, signed_in, declared_trigger=None):
    """Who to record as the actor, and who to record as having triggered them.

    Three shapes, and the difference between them is the whole point of the
    distinction:

    * a person edits something -- the actor is the person, nothing triggered it;
    * the system works something out inside a person's request -- the actor is
      ``System`` and the person is the trigger, so the trail can say a date moved
      *because of* what they did without claiming they typed it;
    * a scheduled run -- the actor is ``System`` and nothing triggered it,
      because there is no person to name and guessing one would be a lie.

    A signed-in account is used as the trigger when none was declared, because
    it is a fact about the request rather than an inference.
    """
    signed_in = signed_in or dict(NO_ACTOR)
    if kind == ACTOR_USER:
        return dict(signed_in), dict(NO_ACTOR)
    trigger = account_actor(declared_trigger) if declared_trigger is not None else dict(signed_in)
    return {'email': '', 'name': SYSTEM_ACTOR_NAME}, trigger


# ------------------------------------------------------------ audit context

# The context is one dictionary on the thread, not a parameter threaded through
# every write helper. Nothing below it needs to know it exists: `record_rows`
# reads it once, at buffer time.
CONTEXT_FIELDS = ('actor_type', 'source', 'action', 'reason')


def current_context():
    return getattr(_local, 'audit_context', None) or {}


def discard_context():
    _local.audit_context = {}


class audit_context(object):
    """Say what kind of write the block inside is, for history to record.

        with audit_context(actor_type='system', triggered_by=request.login_account,
                           source='recalculation',
                           metadata={'reason': 'module_schedule_recalculation'}):
            recalculate_module_dates(...)

    Every field is optional and only the ones named are changed, so nesting is
    safe: an import running inside a request relabels the source without losing
    the person the request belongs to, and leaving the block restores exactly
    what was there before -- including "nothing".

    ``metadata`` merges rather than replaces, so an outer block can state the
    batch and an inner one the row without either erasing the other.

    Never leaks between requests: ``ActorMiddleware`` clears the whole context on
    the way in, and a management command runs on its own thread.
    """

    def __init__(self, *, actor_type='', triggered_by=None, source='', metadata=None, action='', reason=''):
        self.changes = {}
        kind = clean(actor_type)
        if kind:
            # An unrecognised kind is dropped rather than stored: a column of
            # invented actor kinds is worse than one honest default.
            if kind not in ACTOR_TYPES:
                logger.warning('Ignoring unknown audit actor_type %r.', kind)
            else:
                self.changes['actor_type'] = kind
        label = clean(source)
        if label:
            if label not in SOURCES:
                logger.warning('Ignoring unknown audit source %r.', label)
            else:
                self.changes['source'] = label
        if action:
            self.changes['action'] = clean(action)[:16]
        if reason:
            self.changes['reason'] = clean(reason)
        if triggered_by is not None:
            self.changes['triggered_by'] = account_actor(triggered_by)
        self.metadata = safe_metadata(metadata)
        self.previous = None

    def __enter__(self):
        self.previous = current_context()
        merged = dict(self.previous)
        merged.update(self.changes)
        if self.metadata:
            merged['metadata'] = {**(self.previous.get('metadata') or {}), **self.metadata}
        _local.audit_context = merged
        return self

    def __exit__(self, *exc):
        _local.audit_context = self.previous or {}
        return False


def set_source(value):
    """Set the source outside a block. Used by the middleware for the request."""
    label = clean(value)[:32]
    context = dict(current_context())
    if label:
        context['source'] = label
    else:
        context.pop('source', None)
    _local.audit_context = context


def current_source():
    return clean(current_context().get('source'))


class source(audit_context):
    """``audit_context(source=...)`` under the name the write helpers already use."""

    def __init__(self, label):
        super().__init__(source=label)


# ---------------------------------------------------------------- metadata

# Metadata describes the write; it is never a second copy of the record, and it
# is never a channel for anything secret. Only these keys are stored, and the
# values are bounded -- see the note on SNAPSHOT_COLUMNS for the same rule
# applied to the snapshot itself.
from .reporting.domain.revision_contracts import METADATA_KEYS

from .reporting.domain.revision_contracts import METADATA_VALUE_LIMIT
from .reporting.domain.revision_contracts import METADATA_JSON_LIMIT


def safe_metadata(metadata):
    from .reporting.domain.snapshot_values import safe_metadata as implementation
    return implementation(
        metadata, METADATA_JSON_LIMIT=METADATA_JSON_LIMIT, METADATA_KEYS=METADATA_KEYS,
        METADATA_VALUE_LIMIT=METADATA_VALUE_LIMIT, clean=clean, json=json, jsonable=jsonable,
    )


# ------------------------------------------------------------------ helpers

def clean(value):
    from .reporting.domain.snapshot_values import clean as implementation
    return implementation(
        value,
    )


def qualified(table):
    from .reporting.infrastructure.revision_reads import qualified as implementation
    return implementation(
        table, connection=connection,
    )


_AVAILABLE = {}


def history_available():
    from .reporting.infrastructure.revision_reads import history_available as implementation
    return implementation(
        REVISIONS_TABLE=REVISIONS_TABLE, VERSIONS_TABLE=VERSIONS_TABLE, _AVAILABLE=_AVAILABLE,
        connection=connection,
    )


def reset_availability():
    from .reporting.infrastructure.revision_reads import reset_availability as implementation
    return implementation(
        _AVAILABLE=_AVAILABLE,
    )


def as_list(value):
    from .reporting.domain.snapshot_values import as_list as implementation
    return implementation(
        value, clean=clean, json=json,
    )


def as_dict(value):
    from .reporting.domain.snapshot_values import as_dict as implementation
    return implementation(
        value, clean=clean, json=json,
    )


def jsonable(value):
    from .reporting.domain.snapshot_values import jsonable as implementation
    return implementation(
        value, Decimal=Decimal, date=date, datetime=datetime, jsonable=jsonable,
    )


def parse_json_column(value):
    from .reporting.domain.snapshot_values import parse_json_column as implementation
    return implementation(
        value, clean=clean, json=json,
    )


def strip_credentials(value):
    from .reporting.domain.snapshot_values import strip_credentials as implementation
    return implementation(
        value, strip_credentials=strip_credentials,
    )


#: Columns whose value must never reach history, per entity type, registered by
#: ``system_audit.writes``. Curriculum's own tables register none: no authoring
#: table holds a personal detail, and the ``SNAPSHOT_COLUMNS`` allowlist above
#: already keeps out anything not named.
#:
#: A redacted column is not simply dropped. Dropping it would make an edit to it
#: invisible, and "this field changed, by this person, at this time" is exactly
#: what an audit of a sensitive field is for. So the value is replaced by a
#: digest of itself: the same value digests the same way and records no change,
#: a different one records a change, and neither digest can be read back into
#: the value it stands for.
from .reporting.domain.revision_contracts import REDACTED_COLUMNS

from .reporting.domain.revision_contracts import REDACTED_PREFIX


def redacted(value):
    from .reporting.domain.snapshot_values import redacted as implementation
    return implementation(
        value, REDACTED_PREFIX=REDACTED_PREFIX, hashlib=hashlib, json=json, jsonable=jsonable,
    )


def audit_display_value(entity_type, field, value):
    from .reporting.domain.snapshot_values import audit_display_value as implementation
    return implementation(
        entity_type, field, value, REDACTED_COLUMNS=REDACTED_COLUMNS, REDACTED_PREFIX=REDACTED_PREFIX,
        strip_credentials=strip_credentials,
    )


def build_snapshot(entity_type, row):
    from .reporting.domain.snapshot_values import build_snapshot as implementation
    return implementation(
        entity_type, row, JSON_SNAPSHOT_COLUMNS=JSON_SNAPSHOT_COLUMNS,
        REDACTED_COLUMNS=REDACTED_COLUMNS, SNAPSHOT_COLUMNS=SNAPSHOT_COLUMNS,
        SYSTEM_COLUMNS=SYSTEM_COLUMNS, jsonable=jsonable, logged_settings=logged_settings,
        parse_json_column=parse_json_column, redacted=redacted, strip_credentials=strip_credentials,
    )


def logged_settings(settings):
    from .reporting.domain.snapshot_values import logged_settings as implementation
    return implementation(
        settings, TEAMS_LINKED=TEAMS_LINKED, TEAMS_LINK_KEYS=TEAMS_LINK_KEYS,
        TEAMS_LINK_MARKER=TEAMS_LINK_MARKER, TEAMS_SYSTEM_SETTING_KEYS=TEAMS_SYSTEM_SETTING_KEYS,
    )


def logged_view(entity_type, snapshot):
    from .reporting.domain.snapshot_values import logged_view as implementation
    return implementation(
        entity_type, snapshot, SYSTEM_COLUMNS=SYSTEM_COLUMNS, logged_settings=logged_settings,
    )


def short(value):
    from .reporting.domain.snapshot_values import short as implementation
    return implementation(
        value, DIFF_VALUE_LIMIT=DIFF_VALUE_LIMIT, json=json,
    )


def diff_snapshots(previous, current):
    from .reporting.domain.snapshot_changes import diff_snapshots as implementation
    return implementation(
        previous, current, change_entry=change_entry, diff_settings=diff_settings,
    )


def people_in(value):
    from .reporting.domain.snapshot_changes import people_in as implementation
    return implementation(
        value, clean=clean, parse_json_column=parse_json_column,
    )


def is_text_field(field, before, after):
    from .reporting.domain.snapshot_changes import is_text_field as implementation
    return implementation(
        field, before, after, DIFF_VALUE_LIMIT=DIFF_VALUE_LIMIT, TEXT_COLUMNS=TEXT_COLUMNS,
        TEXT_SETTING_PATTERN=TEXT_SETTING_PATTERN,
    )


def change_entry(field, before, after):
    from .reporting.domain.snapshot_changes import change_entry as implementation
    return implementation(
        field, before, after, PEOPLE_LIST_FIELDS=PEOPLE_LIST_FIELDS, TEXT_CHANGED=TEXT_CHANGED,
        is_text_field=is_text_field, people_in=people_in, short=short,
    )


def merge_changes(earlier, later):
    from .reporting.domain.snapshot_changes import merge_changes as implementation
    return implementation(
        earlier, later, clean=clean,
    )


def diff_settings(previous, current):
    from .reporting.domain.snapshot_changes import diff_settings as implementation
    return implementation(
        previous, current, IGNORED_SETTING_KEYS=IGNORED_SETTING_KEYS, change_entry=change_entry,
    )


# Where each entity's own title lives in its snapshot, and which column names
# its parent for the indexed ``parent_id`` column.
from .reporting.domain.revision_contracts import ENTITY_FACT_FIELDS


def snapshot_title(snapshot, columns, join=' '):
    from .reporting.domain.snapshot_context import snapshot_title as implementation
    return implementation(
        snapshot, columns, join, clean=clean,
    )


def entity_facts(entity_type, snapshot):
    from .reporting.domain.snapshot_context import entity_facts as implementation
    return implementation(
        entity_type, snapshot, ENTITY_FACT_FIELDS=ENTITY_FACT_FIELDS, as_dict=as_dict, clean=clean,
        snapshot_title=snapshot_title,
    )


# --------------------------------------------------------- parent context

# Under this key the snapshot carries the entity's ancestry AS IT WAS when the
# action happened -- ids together with the names those ids had at the time, so a
# programme renamed next year does not silently rewrite last year's history.
#
# Underscore-prefixed because the diff skips those keys: ancestry is context, and
# a component must not report "changed" because the programme above it was
# renamed. A move that really does change the entity's own parent still shows,
# because that is a change to the entity's own `week_id` / `programme_id` column.
from .reporting.domain.revision_contracts import CONTEXT_KEY

#: entity_type -> the snapshot columns that place a record, in reading order.
#: Registered by ``system_audit.writes`` for everything outside the curriculum,
#: whose ancestry is not a programme tree: a coaching meeting is placed by whose
#: it is, a learner by their programme, cohort and group.
#:
#: The curriculum's own entities are deliberately absent. Theirs is resolved
#: from the module table below, because a component's programme is not in the
#: component's own row.
from .reporting.domain.revision_contracts import ENTITY_CONTEXT_FIELDS


def context_for(entity_type, snapshot, ancestry):
    from .reporting.domain.snapshot_context import context_for as implementation
    return implementation(
        entity_type, snapshot, ancestry, ENTITY_CONTEXT_FIELDS=ENTITY_CONTEXT_FIELDS, clean=clean,
    )


def resolve_ancestry(module_ids):
    from .reporting.infrastructure.revision_reads import resolve_ancestry as implementation
    return implementation(
        module_ids, clean=clean, connection=connection, logger=logger, qualified=qualified,
    )


# 'recorded' is the first revision of a record that already existed before
# history was switched on: the state it was found in. It is deliberately not
# 'created', because nobody here created it and the log must not invent an
# origin for a record whose real one is unknown.
#
# An action is the business event; `source` is how it arrived. `auto-save` is
# never an action -- the event is still the edit -- and there is no action per
# handler. The file and recalculation entries below are here because each is a
# thing a reader asks about by name ("who replaced that PDF", "why did the end
# date move"), which a generic `updated` cannot answer.
from .reporting.domain.revision_contracts import ACTIONS

# Actions a caller may declare for itself through ``audit_context(action=...)``.
# Archive, restore, move and reorder are deliberately absent: those are read off
# the row's own diff, and a caller that could assert them could assert one that
# did not happen.
from .reporting.domain.revision_contracts import DECLARABLE_ACTIONS

# Where a component records the file attached to it, and the two settings keys
# that describe that file. Nothing here is the file's URL: an upload URL can
# carry a SAS token or a signature in its query string, and an append-only log is
# the last place one should land.
from .reporting.domain.revision_contracts import UPLOAD_NAME_FIELD
from .reporting.domain.revision_contracts import UPLOAD_NAME_KEY
from .reporting.domain.revision_contracts import UPLOAD_TYPE_KEY
from .reporting.domain.revision_contracts import UPLOAD_SIZE_KEY


def resolve_file_action(changes):
    from .reporting.domain.snapshot_changes import resolve_file_action as implementation
    return implementation(
        changes, UPLOAD_NAME_FIELD=UPLOAD_NAME_FIELD, clean=clean,
    )


def file_metadata(action, snapshot, previous_snapshot):
    from .reporting.domain.snapshot_changes import file_metadata as implementation
    return implementation(
        action, snapshot, previous_snapshot, UPLOAD_NAME_KEY=UPLOAD_NAME_KEY,
        UPLOAD_SIZE_KEY=UPLOAD_SIZE_KEY, UPLOAD_TYPE_KEY=UPLOAD_TYPE_KEY, as_dict=as_dict,
        safe_metadata=safe_metadata,
    )


# Entity types whose lifecycle is the normalised ``status`` column alone.
from .reporting.domain.revision_contracts import STATUS_LIFECYCLE_TYPES


def snapshot_archived(snapshot, entity_type=''):
    from .reporting.domain.snapshot_changes import snapshot_archived as implementation
    return implementation(
        snapshot, entity_type, STATUS_LIFECYCLE_TYPES=STATUS_LIFECYCLE_TYPES,
    )


def resolve_action(entity_type, snapshot, previous_row, changes):
    from .reporting.domain.snapshot_changes import resolve_action as implementation
    return implementation(
        entity_type, snapshot, previous_row, changes, ORDER_COLUMNS=ORDER_COLUMNS,
        PARENT_COLUMNS=PARENT_COLUMNS, resolve_file_action=resolve_file_action,
        snapshot_archived=snapshot_archived,
    )




# ------------------------------------------------------------------- writes

def latest_revisions(entity_type, entity_ids):
    from .reporting.infrastructure.revision_reads import latest_revisions as implementation
    return implementation(
        entity_type, entity_ids, REVISIONS_TABLE=REVISIONS_TABLE, as_dict=as_dict, clean=clean,
        connection=connection, metadata_columns_available=metadata_columns_available,
        qualified=qualified,
    )


def record_rows(table, rows, *, reason='', deleted=False, using=None, before_rows=None):
    """Note what a write left behind, to be recorded when it commits. Never raises.

    Callers pass the rows their write returned, so this costs no extra read of
    the record itself.

    Nothing is written here. A single save touches the same row more than once --
    ``save_module_authoring_structure`` withdraws every week and component in the
    module and then writes them all straight back -- and recording each touch
    produced an archived/restored pair per child per save. On the live database
    that was 1.13 million of 1.15 million revisions: 98% of the history was the
    save cycle describing itself, and the 598 real edits were buried in it.

    So each row is buffered under its identity, last state wins, and the whole
    buffer is compared against the stored history once, when the transaction
    commits. A row that ends the save holding what it already held records
    nothing; a row that was withdrawn and put back unchanged records nothing; a
    row someone actually edited records one revision saying what they changed.

    ``deleted`` marks a row the write destroyed. The snapshot is what it held a
    moment before it went, because after the statement there is nothing left to
    read.
    """
    config = VERSIONED_TABLES.get(table)
    if not config or not rows:
        return
    try:
        entity_type = config['entity_type']
        key_column = config['key']
        before_by_id = {
            clean(row.get(key_column)): build_snapshot(entity_type, row)
            for row in (before_rows or [])
        }
        alias = using or config.get('using') or DEFAULT_DB_ALIAS
        buffer = pending_buffer(alias)
        # Taken here, not at flush time. The flush can run after the request has
        # finished -- it waits for the commit -- and by then the thread-locals
        # have been cleared for the next request. Reading them late would credit
        # every deferred save to nobody, and would lose whichever
        # ``audit_context`` block the write actually happened inside.
        context = current_context()
        kind = actor_type()
        signed_in = current_actor()
        actor, triggered_by = attribute(kind, signed_in, context.get('triggered_by'))
        source_label = current_source()
        action_override = clean(context.get('action'))
        context_reason = clean(context.get('reason'))
        metadata = dict(context.get('metadata') or {})
        for row in rows:
            if not row:
                continue
            entity_id = clean(row.get(key_column))
            if not entity_id:
                continue
            prior_buffer = buffer.get((entity_type, entity_id), {})
            buffer[(entity_type, entity_id)] = {
                'entity_type': entity_type,
                'entity_id': entity_id,
                'snapshot': build_snapshot(entity_type, row),
                # Whether the row genuinely came into existence now, or merely
                # reached history for the first time. See ``build_revision``.
                'created_at': row.get('created_at'),
                'updated_at': row.get('updated_at'),
                'deleted': bool(deleted),
                'reason': context_reason or clean(reason),
                'source': source_label,
                'actor': actor,
                'actor_type': kind,
                'triggered_by': triggered_by,
                'metadata': metadata,
                'action_override': action_override,
                # Keep the first actual database state of a multi-write save.
                'before_snapshot': prior_buffer.get('before_snapshot', before_by_id.get(entity_id)),
            }
        arm_flush(alias)
    except Exception:
        # Deliberately broad: history is worth less than the content it records.
        logger.warning('Could not buffer curriculum revisions for %s.', table, exc_info=True)


def record_deleted_rows(table, rows, *, reason='', using=None):
    """Record rows a hard delete destroyed, from the rows the delete returned."""
    record_rows(table, rows, reason=reason or 'hard-delete', deleted=True, using=using)


# ------------------------------------------------------- the pending buffer

def pending_buffers():
    """Every connection's buffer, keyed by database alias."""
    buffers = getattr(_local, 'pending', None)
    if buffers is None:
        buffers = {}
        _local.pending = buffers
    return buffers


def pending_buffer(alias=DEFAULT_DB_ALIAS):
    """The buffer for one connection.

    Kept per alias, not per thread. One request can write through more than one
    connection -- curriculum's tables on `default`, a learner's on `enrolment`
    -- and each becomes durable at its own commit. A single shared buffer would
    let whichever transaction committed first carry the other's rows out with
    it, so a revision could be recorded for a write that then rolled back. That
    is precisely the claim an audit log must never make.
    """
    return pending_buffers().setdefault(alias, {})


def discard_pending(alias=None):
    """Throw the buffer away. What a rolled-back transaction wrote never happened.

    With no alias, every connection's buffer goes -- which is what a test
    tearing down wants. With one, only that connection's.
    """
    if alias is None:
        _local.pending = {}
    else:
        pending_buffers().pop(alias, None)


def arm_flush(alias=DEFAULT_DB_ALIAS):
    """Arrange for the buffer to be recorded when the write becomes durable.

    Inside a transaction that is ``on_commit``: a rollback drops the callback and
    leaves the buffer to be discarded, so a mutation that failed cannot leave an
    audit record claiming it succeeded. Outside one the write is already
    committed, so there is nothing to wait for.

    Registered on every call rather than once behind a flag. A flag would have to
    be cleared by something, and the one thing that never runs after a rollback
    is the code that would clear it -- so a single rolled-back transaction would
    leave the flag set and silently drop every later save's history on that
    thread. ``flush_pending`` empties the buffer as it runs, so the extra
    callbacks cost one dictionary lookup each and do nothing.

    Registered against the connection the write actually went through. It used
    to ask `connection` -- always `default` -- whether a transaction was open,
    which is the right answer only while every audited write uses that one
    connection. A write on another alias inside its own `atomic()` block would
    have been reported as having no transaction at all, so its revision would
    have been written immediately and kept even if that transaction then rolled
    back.
    """
    alias = alias or DEFAULT_DB_ALIAS
    try:
        if transaction.get_connection(alias).in_atomic_block:
            transaction.on_commit(lambda: flush_pending(alias), using=alias)
            return
    except Exception:
        pass
    flush_pending(alias)


def flush_pending(alias=DEFAULT_DB_ALIAS):
    """Write one revision per entity the transaction actually changed. Never raises."""
    buffer = pending_buffers().pop(alias, None)
    if not buffer:
        return
    try:
        if not history_available():
            return
        # A nested atomic block is a SAVEPOINT, so a history write that fails
        # rolls back only itself and leaves the caller's transaction usable.
        # Without it the `except` below would swallow the error and hand back a
        # transaction Postgres has already marked as aborted, failing the save
        # at commit for a reason nothing in the traceback would explain.
        with transaction.atomic():
            _flush(list(buffer.values()))
    except Exception:
        logger.warning('Could not record curriculum revisions.', exc_info=True)


def _flush(items):
    by_type = {}
    for item in items:
        by_type.setdefault(item['entity_type'], []).append(item)

    previous_by_type = {
        entity_type: latest_revisions(entity_type, [item['entity_id'] for item in group])
        for entity_type, group in by_type.items()
    }
    ancestry = resolve_ancestry(
        item['snapshot'].get('module_catalogue_id') for item in items
    )

    pending = []
    for entity_type, group in by_type.items():
        previous_by_id = previous_by_type.get(entity_type) or {}
        for item in group:
            entry = build_revision(entity_type, item, previous_by_id, ancestry)
            if entry is not None:
                pending.append(entry)
    if not pending:
        return

    merged = merge_bursts(pending)
    pending = [item for item in pending if id(item) not in merged]
    if not pending:
        return

    inserted = insert_revisions(pending)
    trim_superseded(pending, inserted)
    for entity_type in by_type:
        rows = [item for item in pending if item['entity_type'] == entity_type]
        if rows:
            pin_versions(entity_type, rows, inserted, rows[0]['actor'])


def build_revision(entity_type, item, previous_by_id, ancestry):
    """One buffered entity as a revision row, or None when nothing changed."""
    actor = item['actor']
    kind = item['actor_type']
    entity_id = item['entity_id']
    snapshot = dict(item['snapshot'])
    previous = previous_by_id.get(entity_id)
    actual_before = item.get('before_snapshot')
    previous_snapshot = logged_view(
        entity_type, actual_before if actual_before is not None else (previous or {}).get('snapshot') or {},
    )
    has_before = actual_before is not None or previous is not None
    context = context_for(entity_type, snapshot, ancestry)
    if context:
        snapshot[CONTEXT_KEY] = context

    if item['deleted']:
        # A destroyed row has no "after". The snapshot is what it held, and the
        # action says the record is gone -- which is the whole point of taking
        # the snapshot before the statement rather than looking for the row
        # afterwards and finding nothing.
        changes = diff_snapshots(previous_snapshot, snapshot) if previous else []
        action = 'deleted'
    else:
        if has_before and strip_context(previous_snapshot) == strip_context(snapshot):
            return None  # nothing actually changed
        # A create has no "before", so it has no changed fields. Diffing the new
        # record against nothing listed every column it happens to hold as having
        # moved from empty, which reads as fourteen edits to a record that was
        # simply made. The snapshot is the whole answer to what was created.
        changes = diff_snapshots(previous_snapshot, snapshot) if has_before else []
        action = resolve_action(entity_type, snapshot, previous or ({'snapshot': previous_snapshot} if has_before else None), changes)
        # A record that existed before history did must not be reported as
        # having been created now. Its first revision says so honestly: this is
        # the state it was found in, not the moment it came into being. The row
        # itself is the only witness -- a record saved once has `updated_at`
        # equal to its `created_at`, which is the same rule the older derived
        # trail uses to tell a create from an edit.
        if action == 'created' and not looks_newly_created(item):
            action = 'recorded'
        # A declared action names the business event the write was part of, and
        # only for events the row cannot show by itself. It never overrides a
        # create, an archive or a restore: those are facts about the row, and a
        # caller that could talk over them could hide a deletion behind "file
        # replaced".
        declared = clean(item.get('action_override'))
        if declared in DECLARABLE_ACTIONS and action == 'updated':
            action = declared
        # Only ignored keys moved (an edit stamp, a Teams id): nothing to say.
        if action == 'updated' and not changes:
            return None

    reason = clean(item['reason'] or snapshot.get('deleted_by'))
    source = clean(item['source'])
    triggered_by = item.get('triggered_by') or dict(NO_ACTOR)
    # Whatever the caller declared, plus what the row itself says about a file
    # it gained or lost. The row wins on the keys it owns: it is evidence, and
    # the declaration is a claim.
    metadata = {**(item.get('metadata') or {}), **file_metadata(action, snapshot, previous_snapshot)}
    if not metadata_columns_available():
        # Before the owner runs the Phase 2 SQL there are no columns for any of
        # this, so it rides in `reason` the way it always did: the handler code
        # with tagged pairs after it. `quality.py` reads the columns first and
        # falls back to parsing this, so both shapes are legible to one reader
        # and no row has to be rewritten when the columns arrive.
        tags = [f'source={source}'] if source else []
        if kind != ACTOR_USER:
            tags.append(f'actor={kind}')
        if triggered_by['email']:
            tags.append(f'by={triggered_by["email"]}')
        if tags:
            reason = '; '.join([reason] + tags) if reason else '; '.join(tags)

    return {
        'entity_type': entity_type,
        'entity_id': entity_id,
        'revision_no': int(previous.get('revision_no') or 0) + 1 if previous else 1,
        'action': action,
        'snapshot': snapshot,
        'changed_fields': changes,
        'actor_email': actor['email'],
        'actor_name': actor['name'],
        'reason': reason[:255],
        'actor_type': kind,
        'triggered_by_email': triggered_by['email'][:255],
        'triggered_by_name': triggered_by['name'][:255],
        'source': source[:64],
        'metadata': metadata,
        'previous': previous,
        'actor': actor,
        **entity_facts(entity_type, snapshot),
    }


def _aware(stamp):
    if not isinstance(stamp, datetime):
        return None
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def burst_target(entry, now):
    """The revision this save extends, when it is the same person editing on."""
    previous = entry.get('previous')
    if not previous or entry.get('action') not in MERGEABLE_ACTIONS:
        return None
    if clean(previous.get('action')) not in MERGEABLE_ACTIONS:
        return None
    email = clean(entry.get('actor_email')).lower()
    if not email or email != clean(previous.get('actor_email')).lower():
        return None
    stamp = _aware(previous.get('created_at'))
    if stamp is None or not timedelta(0) <= now - stamp <= MERGE_WINDOW:
        return None
    # A save that names a new version is a line of its own.
    if version_label_for(entry['entity_type'], entry):
        return None
    return previous


def merge_bursts(pending):
    """Fold saves into the revision they continue. Returns the folded entries' ids.

    Never raises: a save that cannot be folded is simply inserted as its own line.
    """
    now = datetime.now(timezone.utc)
    candidates = [(entry, burst_target(entry, now)) for entry in pending]
    candidates = [(entry, previous) for entry, previous in candidates if previous is not None]
    if not candidates:
        return set()
    folded = set()
    try:
        with transaction.atomic():
            ids = [previous['id'] for _, previous in candidates]
            with connection.cursor() as cursor:
                # A revision a named version points at is frozen.
                cursor.execute(
                    f'select revision_id from {qualified(VERSIONS_TABLE)} '
                    f'where revision_id in ({", ".join(["%s"] * len(ids))})',
                    ids,
                )
                pinned = {row[0] for row in cursor.fetchall()}
                with_metadata = metadata_columns_available()
                for entry, previous in candidates:
                    if previous['id'] in pinned:
                        continue
                    changes = merge_changes(as_list(previous.get('changed_fields')), entry['changed_fields'])
                    sets = ['snapshot = %s', 'changed_fields = %s', 'title = %s', 'content_status = %s']
                    params = [
                        json.dumps(entry['snapshot'], ensure_ascii=False),
                        json.dumps(changes, ensure_ascii=False),
                        entry.get('title'), entry.get('content_status'),
                    ]
                    if with_metadata:
                        earlier = as_dict(previous.get('metadata'))
                        metadata = safe_metadata({
                            **entry.get('metadata', {}), **earlier,
                            'merged_saves': int(earlier.get('merged_saves') or 1) + 1,
                            'last_saved_at': now.isoformat(),
                        })
                        sets.append('metadata = %s')
                        params.append(json.dumps(metadata, ensure_ascii=False))
                    cursor.execute(
                        f'update {qualified(REVISIONS_TABLE)} set {", ".join(sets)} where id = %s',
                        [*params, previous['id']],
                    )
                    if cursor.rowcount:
                        folded.add(id(entry))
    except Exception:
        logger.warning('Could not fold a burst of saves into one revision.', exc_info=True)
        return set()
    return folded


def trim_superseded(pending, inserted):
    """Keep one full copy per record: the newest. Never raises.

    The copy before it is only ever read to work out the next diff, which now
    reads the new row instead. What stays on it is where the record sat.
    """
    if connection.vendor != 'postgresql' or not inserted:
        return
    ids = [
        entry['previous']['id'] for entry in pending
        if entry.get('previous') and (entry['entity_type'], entry['entity_id']) in inserted
    ]
    if not ids:
        return
    try:
        with transaction.atomic(), connection.cursor() as cursor:
            cursor.execute(
                f'update {qualified(REVISIONS_TABLE)} r set snapshot = coalesce(('
                'select jsonb_object_agg(key, value) from jsonb_each(r.snapshot) where key = any(%s)'
                "), '{}'::jsonb) "
                'where r.id = any(%s) and r.action <> all(%s) '
                f'and not exists (select 1 from {qualified(VERSIONS_TABLE)} v where v.revision_id = r.id)',
                [list(SLIM_SNAPSHOT_KEYS), ids, list(FULL_SNAPSHOT_ACTIONS)],
            )
    except Exception:
        logger.warning('Could not trim superseded revision snapshots.', exc_info=True)


def looks_newly_created(item):
    from .reporting.domain.snapshot_changes import looks_newly_created as implementation
    return implementation(
        item, clean=clean, datetime=datetime,
    )


def strip_context(snapshot):
    from .reporting.domain.snapshot_changes import strip_context as implementation
    return implementation(
        snapshot,
    )


from .reporting.domain.revision_contracts import REVISION_COLUMNS

# Added by 2026-09-16_curriculum_record_revisions_audit_metadata.sql. Written
# only once that has run, so a deployment whose database is still on the old
# shape keeps recording rather than failing every save on a missing column.
from .reporting.domain.revision_contracts import METADATA_COLUMNS

from .reporting.domain.revision_contracts import JSON_REVISION_COLUMNS


def metadata_columns_available():
    from .reporting.infrastructure.revision_reads import metadata_columns_available as implementation
    return implementation(
        METADATA_COLUMNS=METADATA_COLUMNS, REVISIONS_TABLE=REVISIONS_TABLE, _AVAILABLE=_AVAILABLE,
        connection=connection,
    )


def insert_revisions(pending):
    """Insert the revisions and return their ids, keyed by (entity type, entity id).

    Keyed by the pair, not by the id alone: a module and its ``module_details``
    row are two entities that share ``module_catalogue_id``, so an id-keyed map
    would hand one of them the other's revision.

    ``on conflict do nothing`` covers the one race this has: two requests saving
    the same record at once compute the same ``revision_no``. The loser drops
    its revision rather than failing, which is the right trade — the winner's
    row already records that the content changed.
    """
    # The single point every application revision passes through. An action
    # outside ACTIONS has no label, no tone and no meaning on the trail -- the
    # 2,599 `create` / `update` rows written straight into this table by one-off
    # scripts render as "Create" beside a real "Created" -- so one is refused
    # here, loudly, rather than stored as history nobody can read.
    canonical = [item for item in pending if item.get('action') in ACTIONS]
    for item in pending:
        if item.get('action') not in ACTIONS:
            logger.error(
                'Refused a %s revision with non-canonical action %r.',
                item.get('entity_type'), item.get('action'),
            )
    pending = canonical
    if not pending:
        return {}
    columns = REVISION_COLUMNS + (METADATA_COLUMNS if metadata_columns_available() else ())
    placeholder = f'({", ".join(["%s"] * len(columns))})'
    values = []
    for item in pending:
        for column in columns:
            value = item[column]
            values.append(json.dumps(value, ensure_ascii=False) if column in JSON_REVISION_COLUMNS else value)
    query = (
        f'insert into {qualified(REVISIONS_TABLE)} ({", ".join(columns)}) values '
        f'{", ".join([placeholder] * len(pending))} '
        f'on conflict (entity_type, entity_id, revision_no) do nothing '
        f'returning id, entity_type, entity_id'
    )
    with connection.cursor() as cursor:
        cursor.execute(query, values)
        return {
            (clean(entity_type), clean(entity_id)): revision_id
            for revision_id, entity_type, entity_id in cursor.fetchall()
        }


def pin_versions(entity_type, pending, inserted, actor):
    """Name the revisions the author declared a version of.

    A component says so by moving ``settings.version``; a module has no label of
    its own, so reaching ``published`` cuts one and it is numbered by how many
    times that has happened. A week declares nothing and is history-only — which
    is the honest answer, not an omission.
    """
    if not inserted:
        return
    rows = []
    for item in pending:
        revision_id = inserted.get((entity_type, item['entity_id']))
        if not revision_id:
            continue
        label = version_label_for(entity_type, item)
        if not label:
            continue
        rows.append((
            entity_type, item['entity_id'], label, revision_id,
            item['content_status'], actor['email'], actor['name'],
        ))
    if not rows:
        return
    placeholder = '(%s, %s, %s, %s, %s, %s, %s)'
    query = (
        f'insert into {qualified(VERSIONS_TABLE)} '
        f'(entity_type, entity_id, version_label, revision_id, content_status, actor_email, actor_name) values '
        f'{", ".join([placeholder] * len(rows))} '
        f'on conflict (entity_type, entity_id, version_label) do nothing'
    )
    with connection.cursor() as cursor:
        cursor.execute(query, [value for row in rows for value in row])


def version_label_for(entity_type, item):
    previous = item.get('previous') or {}
    if entity_type == 'component':
        label = clean(item.get('version_label'))
        # Cut on the label the author typed, and only when it moved. The first
        # revision counts as a move: 0.1 is a version, it just happens to be the
        # first one.
        if label and label != clean(previous.get('version_label')):
            return label[:32]
        return ''
    if entity_type == 'module':
        status = clean(item.get('content_status')).lower()
        was = clean(previous.get('content_status')).lower()
        if status == 'published' and status != was:
            return f'v{module_publish_count(item["entity_id"]) + 1}'[:32]
    return ''


def module_publish_count(entity_id):
    from .reporting.infrastructure.revision_reads import module_publish_count as implementation
    return implementation(
        entity_id, VERSIONS_TABLE=VERSIONS_TABLE, connection=connection, qualified=qualified,
    )


def provision_history_tables():
    """Create the history tables. Local/test only — production runs the SQL file.

    Mirrors ``backend/sql/2026-09-09_curriculum_record_versions.sql``; keep the
    two in step.
    """
    if not schema_gate.runtime_bootstrap_allowed():
        return False
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    serial = 'bigserial primary key' if connection.vendor == 'postgresql' else 'integer primary key autoincrement'
    stamp = 'timestamptz not null default now()' if connection.vendor == 'postgresql' else 'timestamp not null default current_timestamp'
    try:
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists "curriculum"')
            cursor.execute(f'''
                create table if not exists {qualified(REVISIONS_TABLE)} (
                    id {serial},
                    entity_type varchar(32) not null,
                    entity_id varchar(128) not null,
                    revision_no integer not null,
                    action varchar(16) not null,
                    module_catalogue_id varchar(128) not null default '',
                    parent_id varchar(128) not null default '',
                    title text not null default '',
                    version_label varchar(32) not null default '',
                    content_status varchar(64) not null default '',
                    snapshot {json_type} not null,
                    changed_fields {json_type} not null default '[]',
                    actor_email varchar(255) not null default '',
                    actor_name varchar(255) not null default '',
                    reason varchar(255) not null default '',
                    actor_type varchar(32) not null default '',
                    triggered_by_email varchar(255) not null default '',
                    triggered_by_name varchar(255) not null default '',
                    source varchar(64) not null default '',
                    metadata {json_type} not null default '{{}}',
                    created_at {stamp},
                    unique (entity_type, entity_id, revision_no)
                )
            ''')
            # A database provisioned before Phase 2 has the table but not the
            # columns. Existing names are read first rather than relying on a
            # failed ALTER: in Postgres a raised statement aborts the whole
            # transaction, which would take the rest of this provisioning with
            # it. One ALTER at a time, because sqlite adds one column per
            # statement.
            if connection.vendor == 'postgresql':
                cursor.execute(
                    'select column_name from information_schema.columns '
                    'where table_schema = %s and table_name = %s',
                    ['curriculum', REVISIONS_TABLE],
                )
            else:
                cursor.execute(f'pragma table_info("{REVISIONS_TABLE}")')
            rows = cursor.fetchall()
            existing = {row[0] if connection.vendor == 'postgresql' else row[1] for row in rows}
            for column, ddl in (
                ('actor_type', "varchar(32) not null default ''"),
                ('triggered_by_email', "varchar(255) not null default ''"),
                ('triggered_by_name', "varchar(255) not null default ''"),
                ('source', "varchar(64) not null default ''"),
                ('metadata', f"{json_type} not null default '{{}}'"),
            ):
                if column not in existing:
                    cursor.execute(f'alter table {qualified(REVISIONS_TABLE)} add column {column} {ddl}')
            cursor.execute(f'''
                create table if not exists {qualified(VERSIONS_TABLE)} (
                    id {serial},
                    entity_type varchar(32) not null,
                    entity_id varchar(128) not null,
                    version_label varchar(32) not null,
                    revision_id bigint not null,
                    content_status varchar(64) not null default '',
                    note text not null default '',
                    actor_email varchar(255) not null default '',
                    actor_name varchar(255) not null default '',
                    created_at {stamp},
                    unique (entity_type, entity_id, version_label)
                )
            ''')
            cursor.execute(
                f'create index if not exists record_revisions_entity_idx on {qualified(REVISIONS_TABLE)} '
                f'(entity_type, entity_id, revision_no desc)'
            )
            cursor.execute(
                f'create index if not exists record_revisions_module_idx on {qualified(REVISIONS_TABLE)} '
                f'(module_catalogue_id, created_at desc)'
            )
            cursor.execute(
                f'create index if not exists record_revisions_created_idx on {qualified(REVISIONS_TABLE)} (created_at desc)'
            )
            # The three filters the audit trail offers over its date window.
            cursor.execute(
                f'create index if not exists record_revisions_actor_created_idx on {qualified(REVISIONS_TABLE)} '
                f'(actor_email, created_at desc)'
            )
            cursor.execute(
                f'create index if not exists record_revisions_type_created_idx on {qualified(REVISIONS_TABLE)} '
                f'(entity_type, created_at desc)'
            )
            cursor.execute(
                f'create index if not exists record_revisions_source_created_idx on {qualified(REVISIONS_TABLE)} '
                f"(source, created_at desc)"
            )
            cursor.execute(
                f'create index if not exists record_versions_entity_idx on {qualified(VERSIONS_TABLE)} '
                f'(entity_type, entity_id, created_at desc)'
            )
    except DatabaseError:
        logger.warning('Could not provision curriculum history tables.', exc_info=True)
        return False
    reset_availability()
    return True
