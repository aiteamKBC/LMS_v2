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

import json
import logging
import threading
from datetime import date, datetime
from decimal import Decimal

from django.db import DatabaseError, connection, transaction

from . import schema_gate

logger = logging.getLogger(__name__)

REVISIONS_TABLE = 'record_revisions'
VERSIONS_TABLE = 'record_versions'

# The authoring tables that carry material. Keyed by table name, because that is
# what the write helpers know about themselves.
VERSIONED_TABLES = {
    'modules': {'entity_type': 'module', 'key': 'module_catalogue_id', 'title': 'title'},
    'weeks': {'entity_type': 'week', 'key': 'id', 'title': 'title'},
    'components': {'entity_type': 'component', 'key': 'id', 'title': 'title'},
}

ENTITY_TYPES = {config['entity_type'] for config in VERSIONED_TABLES.values()}

# The columns a snapshot holds, per entity. Declaring them rather than taking
# whatever the caller happened to pass is what makes two write paths comparable:
# `authoring_upsert` hands over a full database row, while the programme-tree
# save hands over the payload it built, and those are not the same shape. A
# column absent from the source is stored as None, so alternating between the
# two paths cannot read as "field removed, field added" on every save.
#
# It also keeps the snapshot to the content that matters. `created_at` and
# `updated_at` move on every save and would defeat the only-real-changes rule;
# `library_state`, `is_programme_deleted` and the `origin_*` columns are
# bookkeeping, not material.
SNAPSHOT_COLUMNS = {
    'module': (
        'module_catalogue_id', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
        'group_id', 'group_name', 'title', 'description', 'total_otjh', 'quality_score',
        'status', 'deleted_at', 'deleted_by',
    ),
    'week': (
        'id', 'module_catalogue_id', 'week_number', 'title', 'summary', 'learning_outcomes',
        'display_order', 'deleted_at', 'deleted_by',
    ),
    'component': (
        'id', 'module_catalogue_id', 'week_id', 'type', 'title', 'description',
        'expected_otjh', 'points', 'ksb_mappings', 'reflection_required',
        'Reflection_Question', 'workplace_evidence_required', 'tutor_validation_required',
        'coach_validation_required', 'display_order', 'settings_json', 'live_sessions_link',
        'deleted_at', 'deleted_by',
    ),
}

# Parsed rather than stored as text, so the diff can reach inside them. A
# component's material lives in settings_json, and "settings_json changed" would
# be the least useful thing this feature could say. They also arrive as a JSON
# string from one write path and as a parsed value from the other.
JSON_SNAPSHOT_COLUMNS = {'settings_json', 'ksb_mappings', 'learning_outcomes'}

# Settings keys that behave the same way inside settings_json.
IGNORED_SETTING_KEYS = {'updatedAt', 'lastEdited'}

# A diff is read by a person, so long values are cut. The full value is always
# in the snapshot; the diff only has to say *that* it changed and roughly how.
DIFF_VALUE_LIMIT = 200

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
        account = getattr(request, 'login_account', None)
        set_actor(account)
        try:
            return self.get_response(request)
        finally:
            set_actor(None)


def set_actor(account):
    if account is None:
        _local.actor = None
        return
    _local.actor = {
        'email': clean(getattr(account, 'email', '')),
        'name': clean(getattr(account, 'display_name', '')) or clean(getattr(account, 'email', '')),
    }


def current_actor():
    return getattr(_local, 'actor', None) or {'email': '', 'name': ''}


# ------------------------------------------------------------------ helpers

def clean(value):
    return str(value or '').strip()


def qualified(table):
    if connection.vendor != 'postgresql':
        return f'"{table}"'
    return f'"curriculum"."{table}"'


_AVAILABLE = {}


def history_available():
    """True when both history tables exist. Cached; a miss is not cached.

    Probed with ``to_regclass``, which answers NULL for a missing relation
    instead of raising. Selecting from a table that is not there would raise,
    and in Postgres a raised statement aborts the whole surrounding transaction
    -- so the cheapest possible check would have been able to fail the very save
    it was asked to record.

    Not caching the negative matters: these tables are created by hand against
    Neon, and a process started before that SQL ran must begin recording once it
    has, without a restart.
    """
    if _AVAILABLE.get('ready'):
        return True
    try:
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute(
                    'select to_regclass(%s) is not null and to_regclass(%s) is not null',
                    [f'curriculum.{REVISIONS_TABLE}', f'curriculum.{VERSIONS_TABLE}'],
                )
            else:
                cursor.execute(
                    "select count(*) = 2 from sqlite_master "
                    "where type = 'table' and name in (%s, %s)",
                    [REVISIONS_TABLE, VERSIONS_TABLE],
                )
            row = cursor.fetchone()
    except Exception:
        return False
    if not (row and row[0]):
        return False
    _AVAILABLE['ready'] = True
    return True


def reset_availability():
    _AVAILABLE.pop('ready', None)


def as_list(value):
    """A json column as a list, whether the driver parsed it or handed back text."""
    if isinstance(value, list):
        return value
    text = clean(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def as_dict(value):
    """A jsonb column as a dict, whatever the driver handed back."""
    if isinstance(value, dict):
        return value
    text = clean(value)
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def jsonable(value):
    """A column value in a form ``json.dumps`` accepts, without losing meaning.

    Decimal becomes float on purpose. The driver returns ``Decimal('2.00')`` for
    an OTJH column while the tree save passes ``2.0``; as text those differ, and
    every alternate save would report a change to a field nobody touched.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    # UUID and anything else the driver invents: text is lossless enough for a
    # snapshot and always comparable.
    return str(value)


def parse_json_column(value):
    """A JSON column as its parsed value, whether it arrived parsed or as text."""
    if isinstance(value, (dict, list)):
        return value
    text = clean(value)
    if not text:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


def build_snapshot(entity_type, row):
    """The saved record as history will hold it, in a shape both write paths share.

    Always carries exactly the columns ``SNAPSHOT_COLUMNS`` declares for the
    entity — see the note there for why the source's own key set is not used.
    """
    row = row or {}
    snapshot = {}
    for column in SNAPSHOT_COLUMNS.get(entity_type, ()):
        value = row.get(column)
        if column in JSON_SNAPSHOT_COLUMNS:
            parsed = parse_json_column(value)
            snapshot[column] = jsonable(parsed) if parsed is not None else None
            continue
        snapshot[column] = jsonable(value)
    return snapshot


def short(value):
    """A diff-sized rendering of a value, and whether it had to be cut."""
    if value is None:
        return '', False
    if isinstance(value, (dict, list)):
        text = json.dumps(value, sort_keys=True, ensure_ascii=False)
    else:
        text = str(value)
    if len(text) <= DIFF_VALUE_LIMIT:
        return text, False
    return f'{text[:DIFF_VALUE_LIMIT]}…', True


def diff_snapshots(previous, current):
    """Field-level changes between two snapshots, newest value last.

    ``settings_json`` is compared one level in, so an edit reads as
    ``settings.contentHtml`` rather than as the whole settings blob changing.
    """
    changes = []
    previous = previous or {}
    current = current or {}
    for key in sorted(set(previous) | set(current)):
        before = previous.get(key)
        after = current.get(key)
        if before == after:
            continue
        if key == 'settings_json' and (isinstance(before, dict) or isinstance(after, dict)):
            changes.extend(diff_settings(
                before if isinstance(before, dict) else {},
                after if isinstance(after, dict) else {},
            ))
            continue
        from_text, from_cut = short(before)
        to_text, to_cut = short(after)
        changes.append({'field': key, 'from': from_text, 'to': to_text, 'truncated': from_cut or to_cut})
    return changes


def diff_settings(previous, current):
    changes = []
    for key in sorted(set(previous) | set(current)):
        if key in IGNORED_SETTING_KEYS:
            continue
        before = previous.get(key)
        after = current.get(key)
        if before == after:
            continue
        from_text, from_cut = short(before)
        to_text, to_cut = short(after)
        changes.append({'field': f'settings.{key}', 'from': from_text, 'to': to_text, 'truncated': from_cut or to_cut})
    return changes


def entity_facts(entity_type, snapshot):
    """The columns the history table denormalises out of a snapshot."""
    settings = as_dict(snapshot.get('settings_json'))
    if entity_type == 'component':
        return {
            'module_catalogue_id': clean(snapshot.get('module_catalogue_id')),
            'parent_id': clean(snapshot.get('week_id')),
            'title': clean(snapshot.get('title'))[:500],
            'version_label': clean(settings.get('version')),
            'content_status': clean(settings.get('contentStatus')),
        }
    if entity_type == 'week':
        return {
            'module_catalogue_id': clean(snapshot.get('module_catalogue_id')),
            'parent_id': clean(snapshot.get('module_catalogue_id')),
            'title': clean(snapshot.get('title'))[:500],
            'version_label': '',
            'content_status': '',
        }
    return {
        'module_catalogue_id': clean(snapshot.get('module_catalogue_id')),
        'parent_id': clean(snapshot.get('programme_id')),
        'title': clean(snapshot.get('title'))[:500],
        'version_label': '',
        'content_status': clean(snapshot.get('status')),
    }


def resolve_action(snapshot, previous_row):
    """created / updated / archived / restored, from the row itself."""
    archived = bool(snapshot.get('deleted_at'))
    if previous_row is None:
        return 'archived' if archived else 'created'
    was_archived = bool((previous_row.get('snapshot') or {}).get('deleted_at'))
    if archived and not was_archived:
        return 'archived'
    if was_archived and not archived:
        return 'restored'
    return 'updated'


# ------------------------------------------------------------------- writes

def latest_revisions(entity_type, entity_ids):
    """The newest revision per entity, in one read.

    ``distinct on`` keeps this a single index scan over
    ``record_revisions_entity_idx`` however many ids are asked for, which is
    what makes the bulk path viable — the tree save hands over every component
    in a module at once.
    """
    ids = [clean(value) for value in entity_ids if clean(value)]
    if not ids:
        return {}
    placeholders = ', '.join(['%s'] * len(ids))
    columns_sql = 'entity_id, id, revision_no, snapshot, version_label, content_status'
    if connection.vendor == 'postgresql':
        query = (
            f'select distinct on (entity_id) {columns_sql} '
            f'from {qualified(REVISIONS_TABLE)} '
            f'where entity_type = %s and entity_id in ({placeholders}) '
            f'order by entity_id, revision_no desc'
        )
    else:
        # sqlite has no `distinct on`, and the correlated-subquery form cannot
        # alias a schema-qualified name. The row count here is bounded by the
        # revisions of the entities being saved, so the newest is picked below.
        query = (
            f'select {columns_sql} from {qualified(REVISIONS_TABLE)} '
            f'where entity_type = %s and entity_id in ({placeholders}) '
            f'order by entity_id, revision_no'
        )
    with connection.cursor() as cursor:
        cursor.execute(query, [entity_type, *ids])
        columns = [column[0] for column in cursor.description]
        rows = [dict(zip(columns, values)) for values in cursor.fetchall()]
    result = {}
    for row in rows:
        key = clean(row.get('entity_id'))
        existing = result.get(key)
        if existing and int(existing.get('revision_no') or 0) >= int(row.get('revision_no') or 0):
            continue
        row['snapshot'] = as_dict(row.get('snapshot'))
        result[key] = row
    return result


def record_rows(table, rows, *, reason=''):
    """Record a revision for each row that actually changed. Never raises.

    Callers pass the rows their write returned, so this costs no extra read of
    the record itself — only the one lookup of the previous revisions.
    """
    config = VERSIONED_TABLES.get(table)
    if not config or not rows:
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
            _record_rows(config, [row for row in rows if row], reason=reason)
    except Exception:
        # Deliberately broad: history is worth less than the content it records.
        logger.warning('Could not record curriculum revisions for %s.', table, exc_info=True)


def _record_rows(config, rows, *, reason=''):
    entity_type = config['entity_type']
    key_column = config['key']
    actor = current_actor()

    snapshots = []
    for row in rows:
        entity_id = clean(row.get(key_column))
        if not entity_id:
            continue
        snapshots.append((entity_id, build_snapshot(entity_type, row)))
    if not snapshots:
        return

    previous_by_id = latest_revisions(entity_type, [entity_id for entity_id, _ in snapshots])

    pending = []
    for entity_id, snapshot in snapshots:
        previous = previous_by_id.get(entity_id)
        if previous is not None and previous.get('snapshot') == snapshot:
            continue  # nothing actually changed
        facts = entity_facts(entity_type, snapshot)
        pending.append({
            'entity_type': entity_type,
            'entity_id': entity_id,
            'revision_no': int(previous.get('revision_no') or 0) + 1 if previous else 1,
            'action': resolve_action(snapshot, previous),
            'snapshot': snapshot,
            'changed_fields': diff_snapshots(previous.get('snapshot') if previous else {}, snapshot),
            'actor_email': actor['email'],
            'actor_name': actor['name'],
            'reason': clean(reason or snapshot.get('deleted_by'))[:255],
            'previous': previous,
            **facts,
        })
    if not pending:
        return

    inserted = insert_revisions(pending)
    pin_versions(entity_type, pending, inserted, actor)


REVISION_COLUMNS = (
    'entity_type', 'entity_id', 'revision_no', 'action', 'module_catalogue_id', 'parent_id',
    'title', 'version_label', 'content_status', 'snapshot', 'changed_fields',
    'actor_email', 'actor_name', 'reason',
)


def insert_revisions(pending):
    """Insert the revisions and return their ids, keyed by entity id.

    ``on conflict do nothing`` covers the one race this has: two requests saving
    the same record at once compute the same ``revision_no``. The loser drops
    its revision rather than failing, which is the right trade — the winner's
    row already records that the content changed.
    """
    placeholder = f'({", ".join(["%s"] * len(REVISION_COLUMNS))})'
    values = []
    for item in pending:
        for column in REVISION_COLUMNS:
            value = item[column]
            values.append(json.dumps(value, ensure_ascii=False) if column in {'snapshot', 'changed_fields'} else value)
    query = (
        f'insert into {qualified(REVISIONS_TABLE)} ({", ".join(REVISION_COLUMNS)}) values '
        f'{", ".join([placeholder] * len(pending))} '
        f'on conflict (entity_type, entity_id, revision_no) do nothing '
        f'returning id, entity_id'
    )
    with connection.cursor() as cursor:
        cursor.execute(query, values)
        return {clean(entity_id): revision_id for revision_id, entity_id in cursor.fetchall()}


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
        revision_id = inserted.get(item['entity_id'])
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
    with connection.cursor() as cursor:
        cursor.execute(
            f'select count(*) from {qualified(VERSIONS_TABLE)} where entity_type = %s and entity_id = %s',
            ['module', entity_id],
        )
        row = cursor.fetchone()
    return int(row[0]) if row else 0


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
                    title varchar(500) not null default '',
                    version_label varchar(32) not null default '',
                    content_status varchar(64) not null default '',
                    snapshot {json_type} not null,
                    changed_fields {json_type} not null default '[]',
                    actor_email varchar(255) not null default '',
                    actor_name varchar(255) not null default '',
                    reason varchar(255) not null default '',
                    created_at {stamp},
                    unique (entity_type, entity_id, revision_no)
                )
            ''')
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
            cursor.execute(
                f'create index if not exists record_versions_entity_idx on {qualified(VERSIONS_TABLE)} '
                f'(entity_type, entity_id, created_at desc)'
            )
    except DatabaseError:
        logger.warning('Could not provision curriculum history tables.', exc_info=True)
        return False
    reset_availability()
    return True
