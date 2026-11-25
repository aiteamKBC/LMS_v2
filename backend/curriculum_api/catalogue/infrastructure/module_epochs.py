"""Request-local module counters, committed bumps and bounded epoch polling."""
import logging
import re
import threading
import time
from django.db import connection, transaction
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all, AUTHORING_MODULES_TABLE, AUTHORING_WEEKS_TABLE, AUTHORING_COMPONENTS_TABLE, AUTHORING_KSB_MAPPINGS_TABLE, AUTHORING_COMPLETION_TABLE, AUTHORING_ADVANCED_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE, MODULE_TEAMS_SHARES_TABLE
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
logger = logging.getLogger('curriculum_api.module_live')

WATCH_MEMO_SECONDS = 1.0

_SCOPE_NAME = re.compile(r'^(module|group):[A-Za-z0-9_.:-]{1,120}$')

_PENDING = threading.local()

_MEMO = {}

_MEMO_LOCK = threading.Lock()

_REFRESH_LOCK = threading.Lock()

def _module_tables():
    return {
        AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE,
        AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_COMPLETION_TABLE,
        AUTHORING_ADVANCED_TABLE,
        MODULE_TEAMS_SHARES_TABLE,
        LIVE_SESSIONS_TABLE,
    }

def scopes_for_rows(table, rows):
    """The ``module:``/``group:`` scopes a write to these rows can change."""
    names = set()
    bare = str(table or '').split('.')[-1].strip('"')
    try:
        module_tables = _module_tables()
        groups_table = GROUPS_TABLE
    except Exception:
        return names
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if bare in module_tables:
            module_id = str(row.get('module_catalogue_id') or '').strip()
            if module_id:
                names.add(f'module:{module_id}')
            if bare == AUTHORING_MODULES_TABLE:
                group_id = str(row.get('group_id') or '').strip()
                if group_id:
                    names.add(f'group:{group_id}')
        elif bare == groups_table:
            group_id = str(row.get('group_id') or '').strip()
            if group_id:
                names.add(f'group:{group_id}')
    return names

def begin_request():
    _PENDING.names = set()
    _PENDING.active = True

def end_request():
    names = getattr(_PENDING, 'names', None) or set()
    _PENDING.names = set()
    _PENDING.active = False
    if names:
        bump_scopes(names)

def note_rows(table, rows):
    """Record that these rows were written. Never fails the write."""
    try:
        names = scopes_for_rows(table, rows)
        if not names:
            return
        if getattr(_PENDING, 'active', False):
            _PENDING.names.update(names)
            return
        # Outside a request (a management command, a worker thread): there is
        # no end-of-request flush, so move the counters once the data commits.
        transaction.on_commit(lambda: bump_scopes(names))
    except Exception:
        logger.debug('Unable to note a module write for live sync.', exc_info=True)

def bump_scopes(names):
    """Move each named counter by one. Never the programme rows or ``#bumps``."""
    names = sorted({name for name in names if _SCOPE_NAME.match(name)})
    if not names or connection.vendor != 'postgresql':
        return
    from .scoped_epochs import scope_table_available, _scoped_table
    if not scope_table_available():
        return
    try:
        with transaction.atomic():
            rows = fetch_all(
                f'insert into {_scoped_table()} as t (scope, epoch) '
                f'select unnest(%s::text[]), 1 '
                f'on conflict (scope) do update set epoch = t.epoch + 1 '
                f'returning scope, epoch',
                [names],
            )
    except Exception:
        logger.warning('Unable to bump module live-sync counters.', exc_info=True)
        return
    now = time.monotonic()
    with _MEMO_LOCK:
        for row in rows or []:
            _MEMO[str(row['scope'])] = (int(row['epoch'] or 0), now)

def watched_epochs(names):
    """``{scope: epoch}`` for the named scopes; 0 for a scope never written."""
    now = time.monotonic()
    with _MEMO_LOCK:
        fresh = {name: _MEMO[name][0] for name in names if name in _MEMO and now - _MEMO[name][1] < WATCH_MEMO_SECONDS}
    stale = [name for name in names if name not in fresh]
    if not stale:
        return fresh
    with _REFRESH_LOCK:
        with _MEMO_LOCK:
            for name in list(stale):
                entry = _MEMO.get(name)
                if entry and time.monotonic() - entry[1] < WATCH_MEMO_SECONDS:
                    fresh[name] = entry[0]
                    stale.remove(name)
        if stale:
            from .scoped_epochs import _scoped_table
            needs_savepoint = connection.in_atomic_block or not connection.get_autocommit()
            guard = transaction.atomic() if needs_savepoint else _Null()
            with guard:
                rows = fetch_all(
                    f'select scope, epoch from {_scoped_table()} where scope = any(%s)', [stale],
                )
            read = {str(row['scope']): int(row['epoch'] or 0) for row in rows}
            stamp = time.monotonic()
            with _MEMO_LOCK:
                for name in stale:
                    value = read.get(name, 0)
                    _MEMO[name] = (value, stamp)
                    fresh[name] = value
    return fresh

class _Null:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

def reset_state():
    """For tests."""
    with _MEMO_LOCK:
        _MEMO.clear()
    _PENDING.names = set()
    _PENDING.active = False
