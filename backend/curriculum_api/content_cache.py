"""Shared, per-module cache of the master curriculum reads behind learner pages.

Every learner page rebuilds its module -> week -> component tree live from the
authoring tables (learner_api.learner_detail._resolve_from_master), and the
coach and learner OTJH readers look up ``expected_otjh`` by component id. The
rows they read depend only on the modules and the SQL projection, never on the
learner, yet each request read them again: about 1,900 component rows per page.

This keeps those rows in the shared Django cache (Valkey on AWS):

* ``cmc:v2:<part>:<sql>:<module>:<version>:<generation>`` holds one module's
  rows for one statement. ``<sql>`` is a digest of the exact statement text, so
  a different projection, or a code change to it, is a different key.
* ``expected_otjh`` uses the same per-module entries (part ``otjh``) and a
  ``{component id: module id}`` index kept per generation.

Freshness is PER MODULE (config.cache_versions, namespace ``cmod``). Every
write helper in views.py reports the rows it wrote (note_live_rows ->
note_rows); a write to a module, week, component or KSB mapping row moves
that module's version once the request or command commits, so authoring one
module never retires the other modules' entries. An update or upsert that
could move a row to another module reads the old module first, so both move.
A raw-SQL writer that no helper sees calls ``invalidate_curriculum_cache(
content_scope='all')``, which moves the namespace generation and retires every
module at once. A missing version is a miss. The global curriculum epoch,
which every curriculum write moves, is deliberately not part of these keys.

Writers that bypass both -- the one-off scripts in ``backend/scripts/`` --
leave learner pages up to ``CONTENT_CACHE_TTL_SECONDS`` (600 s) stale. Call
``invalidate_curriculum_cache(content_scope='all')`` at the end of such a script.

Nothing learner-specific is stored: no progress, plan, assignment or snapshot.
Quiz links, quiz metadata and live-session rows are not cached here (they are
written by paths that do not bump the epoch) and stay live.

Exactness: a response built from cached rows must equal one built from the
database. Rows are the database's own tuples, and a multi-module result is put
back in the statement's ORDER BY order in Python. That is only exact under a
code-point collation, so the cache turns itself off for a database whose
curriculum columns collate any other way.

The cache is an accelerator only. A miss, a Valkey error or a disabled cache
falls through to the same statement against the database; nothing here can
fail a request.
"""
from __future__ import annotations

import hashlib
import logging
import os
import pickle
import re
import threading
import time
import zlib

from django.core.cache import cache

from . import shared_build

logger = logging.getLogger(__name__)

KEY_PREFIX = 'cmc:v2'
NAMESPACE = 'cmod'
CONTENT_CACHE_TTL_SECONDS = int(os.environ.get('CURRICULUM_CONTENT_CACHE_TTL', '600'))
#: How long a request waits for another worker's build of the same rows before
#: reading them itself. Short: a learner request holds a worker thread.
WAIT_SECONDS = 5.0
POLL_SECONDS = 0.05
_SAFE_ID = re.compile(r'^[A-Za-z0-9._:-]{1,120}$')
_C_COLLATIONS = {'c', 'posix', 'c.utf-8', 'c.utf8', 'ucs_basic', 'pg_c_utf8'}
_COLLATION_TABLES = ('modules', 'weeks', 'components', 'ksb_mappings')

_state = {'collation_ok': None}
_state_lock = threading.Lock()
_build_locks = {}
_otjh_local = {'generation': None, 'expires': 0.0, 'index': None}
_otjh_lock = threading.Lock()


def enabled() -> bool:
    if os.environ.get('CURRICULUM_CONTENT_CACHE', 'true').strip().lower() in {'0', 'false', 'no', 'off'}:
        return False
    from config.management_safety import reconciliation_command
    return not reconciliation_command()


def collation_ok(cursor) -> bool:
    """Whether a Python code-point sort reproduces ORDER BY on these columns."""
    with _state_lock:
        known = _state['collation_ok']
    if known is not None:
        return known
    db = getattr(cursor, 'db', None)
    if db is None:
        # Not a Django cursor (a test double): nothing to verify, read live.
        return False
    if getattr(db, 'vendor', '') != 'postgresql':
        # Only PostgreSQL's ordering is reproduced; anything else reads live.
        with _state_lock:
            _state['collation_ok'] = False
        return False
    from django.db import transaction
    try:
        # A savepoint, so a failure here cannot poison the caller's transaction.
        with transaction.atomic(using=cursor.db.alias):
            ok = _read_collation_ok(cursor)
    except Exception:
        # Not remembered: a transient failure must not turn the cache off for
        # the life of the process.
        logger.warning('Curriculum content cache skipped: unable to read the collation.', exc_info=True)
        return False
    if not ok:
        logger.warning('Curriculum content cache disabled: the curriculum columns do not use a '
                       'code-point collation, so cached rows could not be ordered exactly.')
    with _state_lock:
        _state['collation_ok'] = ok
    return ok


def _read_collation_ok(cursor):
    cursor.execute(
        "SELECT datcollate, datlocprovider::text FROM pg_database WHERE datname = current_database()"
    )
    row = cursor.fetchone()
    database_collation = str((row or [''])[0] or '').lower()
    provider = str((row or ['', ''])[1] or '').lower()
    cursor.execute(
        "SELECT DISTINCT lower(collation_name) FROM information_schema.columns "
        "WHERE table_schema = 'curriculum' AND table_name = ANY(%s) AND collation_name IS NOT NULL",
        [list(_COLLATION_TABLES)],
    )
    column_collations = {str(r[0] or '') for r in cursor.fetchall()}
    return (database_collation in _C_COLLATIONS and provider in {'c', 'b', ''}
            and column_collations <= _C_COLLATIONS)


def _digest(text) -> str:
    return hashlib.sha1(str(text).encode()).hexdigest()[:16]


def _id_part(value) -> str:
    value = str(value)
    return value if _SAFE_ID.match(value) else 'h' + _digest(value)


def _pack(value) -> bytes:
    return zlib.compress(pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL), 1)


def _unpack(blob):
    return pickle.loads(zlib.decompress(blob))


def _local_lock(name):
    with _state_lock:
        lock = _build_locks.get(name)
        if lock is None:
            if len(_build_locks) > 2048:
                _build_locks.clear()
            lock = threading.Lock()
            _build_locks[name] = lock
        return lock


def _get_many(keys):
    try:
        found = cache.get_many(keys)
    except Exception:
        logger.warning('Unable to read the curriculum content cache.', exc_info=True)
        return {}
    out = {}
    for key, blob in found.items():
        try:
            out[key] = _unpack(blob)
        except Exception:
            logger.warning('Discarding an unreadable curriculum content cache entry.', exc_info=True)
    return out


def _set_many(values):
    try:
        cache.set_many({key: _pack(value) for key, value in values.items()}, timeout=CONTENT_CACHE_TTL_SECONDS)
    except Exception:
        logger.warning('Unable to populate the curriculum content cache.', exc_info=True)


def _module_versions(module_ids):
    """``{module id: version}`` and the generation, creating missing keys.

    A missing key is a miss, never a match: a new unique value is SET (no
    INCR), so a key lost to a restart or eviction cannot collide with an
    entry built before it.
    """
    from config import cache_versions
    found = cache_versions.read(NAMESPACE, module_ids)
    missing = [mid for mid in module_ids if mid not in found]
    if missing or 'gen' not in found:
        for mid in missing:
            cache_versions.strict('add', cache_versions.version_key(NAMESPACE, mid),
                                  cache_versions.new_version(), timeout=None)
        if 'gen' not in found:
            cache_versions.strict('add', cache_versions.generation_key(NAMESPACE),
                                  cache_versions.new_version(), timeout=None)
        found = cache_versions.read(NAMESPACE, module_ids)
    if 'gen' not in found or any(mid not in found for mid in module_ids):
        raise cache_versions.Unavailable('module content versions could not be read back')
    return {mid: found[mid] for mid in module_ids}, found['gen']


def module_rows(cursor, part, sql, module_ids, module_index):
    """``{module id: [rows]}`` for ``sql`` run with ``[module_ids]``.

    ``sql`` must take exactly one parameter, the module id array, and return
    ``module_index`` as each row's module id. Each module's rows keep the
    statement's own order. Returns None when the cache cannot be used, so the
    caller runs its original statement.
    """
    from config import cache_versions
    module_ids = list(dict.fromkeys(str(mid) for mid in module_ids if mid))
    if not module_ids or not enabled() or not collation_ok(cursor):
        return None
    try:
        # Read before the database, so rows read after a write committed are
        # never stored under a version older than that write.
        versions, generation = _module_versions(module_ids)
    except cache_versions.Unavailable:
        return None
    statement = _digest(sql)
    keys = {mid: f'{KEY_PREFIX}:{part}:{statement}:{_id_part(mid)}:{_digest(versions[mid])}:{_digest(generation)}'
            for mid in module_ids}
    found = _get_many(list(keys.values()))
    missing = [mid for mid in module_ids if keys[mid] not in found]
    if missing:
        found.update(_build(cursor, sql, missing, module_index, keys, statement))
    return {mid: found[keys[mid]] for mid in module_ids}


def _build(cursor, sql, missing, module_index, keys, statement):
    name = f'{KEY_PREFIX}:build:{statement}:{_digest(",".join(keys[mid] for mid in sorted(missing)))}'
    with _local_lock(name):
        # Another thread here may have just built these.
        found = _get_many([keys[mid] for mid in missing])
        still = [mid for mid in missing if keys[mid] not in found]
        if not still:
            return found
        acquired, token = shared_build.try_acquire(cache, name)
        if not acquired:
            deadline = time.monotonic() + WAIT_SECONDS
            while time.monotonic() < deadline:
                time.sleep(POLL_SECONDS)
                found.update(_get_many([keys[mid] for mid in still]))
                still = [mid for mid in still if keys[mid] not in found]
                if not still:
                    return found
            # The other build is slow or gone: read the rest here.
        try:
            cursor.execute(sql, [still])
            grouped = {mid: [] for mid in still}
            for row in cursor.fetchall():
                rows = grouped.get(str(row[module_index]))
                if rows is not None:
                    rows.append(row)
            built = {keys[mid]: rows for mid, rows in grouped.items()}
            _set_many(built)
            found.update(built)
            return found
        finally:
            shared_build.release(cache, name, token)


def null_last(value):
    """Sort key part matching PostgreSQL's ascending ``NULLS LAST``."""
    return (value is None, '' if value is None else value)


OTJH_SQL = 'SELECT id, expected_otjh, module_catalogue_id FROM curriculum.components WHERE module_catalogue_id = ANY(%s)'
INDEX_SQL = 'SELECT id, module_catalogue_id FROM curriculum.components'


def _component_index(cursor):
    """``{component id: module id}`` for every component, per generation.

    Only a generation change (a write no module can be named for) rebuilds it.
    A component added or moved since is either absent or points at a module
    whose own version has moved, and its per-module entry then lacks it --
    both read the database for that id, so the index can be stale but never
    wrong.
    """
    from config import cache_versions
    _none, generation = _module_versions([])  # creates the generation key if missing
    now = time.monotonic()
    with _otjh_lock:
        if _otjh_local['generation'] == generation and _otjh_local['expires'] > now:
            return _otjh_local['index']
    key = f'{KEY_PREFIX}:cidx:{_digest(generation)}'
    index = _get_many([key]).get(key)
    if index is None:
        with _local_lock(key):
            index = _get_many([key]).get(key)
            if index is None:
                cursor.execute(INDEX_SQL)
                index = {cid: str(mid) for cid, mid in cursor.fetchall()}
                _set_many({key: index})
    with _otjh_lock:
        _otjh_local.update(generation=generation, expires=time.monotonic() + CONTENT_CACHE_TTL_SECONDS, index=index)
    return index


def expected_otjh(cursor, component_ids):
    """``{component id: expected_otjh}`` for these ids, or None (read live).

    The same pairs ``SELECT id, expected_otjh FROM curriculum.components WHERE
    id = ANY(ids)`` returns: unknown ids absent, NULL kept. Each module's values
    are cached under that module's content version; ids the index or a module
    entry does not account for are read by id from the database.
    """
    from config import cache_versions
    ids = list(dict.fromkeys(component_ids))
    if not ids or not enabled() or not collation_ok(cursor):
        return None
    try:
        index = _component_index(cursor)
    except cache_versions.Unavailable:
        return None
    modules = sorted({index[cid] for cid in ids if cid in index})
    per_module = module_rows(cursor, 'otjh', OTJH_SQL, modules, 2) if modules else {}
    if per_module is None:
        return None
    values = {}
    for rows in per_module.values():
        for cid, otjh, _module in rows:
            values[cid] = otjh
    result = {cid: values[cid] for cid in ids if cid in values}
    unaccounted = [cid for cid in ids if cid not in values]
    if unaccounted:
        cursor.execute('SELECT id, expected_otjh FROM curriculum.components WHERE id = ANY(%s)', [unaccounted])
        result.update(dict(cursor.fetchall()))
    return result


# --- write side ---------------------------------------------------------------

#: The tables whose rows module_rows caches. Writes to anything else never
#: retire a module's content entries.
CONTENT_TABLES = frozenset({'modules', 'weeks', 'components', 'ksb_mappings'})
_pending = threading.local()


def _bare(table):
    return str(table or '').split('.')[-1].strip('"')


def begin_write_scope():
    _pending.modules = set()
    _pending.active = True


def end_write_scope():
    modules = getattr(_pending, 'modules', None) or set()
    _pending.modules = set()
    _pending.active = False
    if modules:
        _bump_modules(modules)


def note_rows(table, rows):
    """Retire the content entries of every module these written rows belong to."""
    try:
        if _bare(table) not in CONTENT_TABLES:
            return
        modules = {str(row.get('module_catalogue_id') or '').strip() for row in rows or [] if isinstance(row, dict)}
        modules.discard('')
        note_modules(modules)
    except Exception:
        logger.warning('Unable to note a curriculum content write; retiring all content.', exc_info=True)
        retire_all()


def note_modules(modules):
    modules = {str(mid) for mid in modules if mid}
    if not modules:
        return
    if getattr(_pending, 'active', False):
        _pending.modules.update(modules)
        return
    _bump_modules(modules)


def _bump_modules(modules):
    from config import cache_versions
    # After commit (cache_versions.bump), so a reader that sees the new
    # version also sees the committed rows.
    cache_versions.bump(NAMESPACE, sorted(modules))


def retire_all():
    """Retire every module's content entries: for a write no module can be named for."""
    from config import cache_versions
    from django.db import transaction
    try:
        transaction.on_commit(lambda: cache_versions.bump_generation(NAMESPACE))
    except Exception:
        cache_versions.bump_generation(NAMESPACE)


def reset_for_tests():
    with _state_lock:
        _state['collation_ok'] = None
        _build_locks.clear()
    with _otjh_lock:
        _otjh_local.update(generation=None, expires=0.0, index=None)
    _pending.modules = set()
    _pending.active = False
