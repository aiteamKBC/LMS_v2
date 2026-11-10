"""Shared, per-module cache of the master curriculum reads behind learner pages.

Every learner page rebuilds its module -> week -> component tree live from the
authoring tables (learner_api.learner_detail._resolve_from_master), and the
coach and learner OTJH readers look up ``expected_otjh`` by component id. The
rows they read depend only on the modules and the SQL projection, never on the
learner, yet each request read them again: about 1,900 component rows per page.

This keeps those rows in the shared Django cache (Valkey on AWS):

* ``cmc:v1:<epoch>:<part>:<sql>:<module>`` holds one module's rows for one
  statement. ``<sql>`` is a digest of the exact statement text, so a different
  projection, or a code change to it, is a different key by construction.
* ``cmc:v1:<epoch>:otjh`` holds ``{component id: expected_otjh}`` for every
  component, as the unfiltered by-id lookups read it.

Freshness: ``<epoch>`` is the shared curriculum epoch. Every curriculum write
calls ``invalidate_curriculum_cache()``, which moves it, so all keys of the old
generation stop being read at once. Another process notices within
``SHARED_EPOCH_POLL_SECONDS`` (3 s), as every curriculum cache already does. Old
generations expire after ``CONTENT_CACHE_TTL_SECONDS``.

Writers that bypass ``invalidate_curriculum_cache()`` -- the one-off scripts in
``backend/scripts/`` -- leave learner pages up to ``CONTENT_CACHE_TTL_SECONDS``
(600 s) stale after they run. Call ``invalidate_curriculum_cache()`` at the end
of such a script, or wait out the TTL.

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

KEY_PREFIX = 'cmc:v1'
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
_otjh_local = {'epoch': None, 'expires': 0.0, 'value': None}
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


def _epoch():
    from .views import shared_curriculum_epoch
    return shared_curriculum_epoch()


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


def module_rows(cursor, part, sql, module_ids, module_index):
    """``{module id: [rows]}`` for ``sql`` run with ``[module_ids]``.

    ``sql`` must take exactly one parameter, the module id array, and return
    ``module_index`` as each row's module id. Each module's rows keep the
    statement's own order. Returns None when the cache cannot be used, so the
    caller runs its original statement.
    """
    module_ids = list(dict.fromkeys(str(mid) for mid in module_ids if mid))
    if not module_ids or not enabled() or not collation_ok(cursor):
        return None
    epoch = _epoch()
    statement = _digest(sql)
    keys = {mid: f'{KEY_PREFIX}:{epoch}:{part}:{statement}:{_id_part(mid)}' for mid in module_ids}
    found = _get_many(list(keys.values()))
    missing = [mid for mid in module_ids if keys[mid] not in found]
    if missing:
        found.update(_build(cursor, sql, missing, module_index, keys, epoch, statement))
    return {mid: found[keys[mid]] for mid in module_ids}


def _build(cursor, sql, missing, module_index, keys, epoch, statement):
    name = f'{KEY_PREFIX}:{epoch}:build:{statement}:{_digest(",".join(sorted(missing)))}'
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


def expected_otjh_map(cursor):
    """``{component id: expected_otjh}`` for every component, or None.

    The same rows ``SELECT id, expected_otjh FROM curriculum.components WHERE
    id = ANY(...)`` returns, before any filtering, for all ids at once. A per-
    process copy saves the Valkey read for the rest of the generation.
    """
    if not enabled():
        return None
    epoch = _epoch()
    now = time.monotonic()
    with _otjh_lock:
        if _otjh_local['epoch'] == epoch and _otjh_local['expires'] > now:
            return _otjh_local['value']
    key = f'{KEY_PREFIX}:{epoch}:otjh'
    sql = 'SELECT id, expected_otjh FROM curriculum.components'
    found = _get_many([key])
    if key in found:
        value = found[key]
    else:
        with _local_lock(key):
            found = _get_many([key])
            if key in found:
                value = found[key]
            else:
                acquired, token = shared_build.try_acquire(cache, key)
                value = None
                try:
                    if not acquired:
                        deadline = time.monotonic() + WAIT_SECONDS
                        while value is None and time.monotonic() < deadline:
                            time.sleep(POLL_SECONDS)
                            value = _get_many([key]).get(key)
                    if value is None:
                        cursor.execute(sql)
                        value = dict(cursor.fetchall())
                        _set_many({key: value})
                finally:
                    shared_build.release(cache, key, token)
    with _otjh_lock:
        _otjh_local.update(epoch=epoch, expires=time.monotonic() + CONTENT_CACHE_TTL_SECONDS, value=value)
    return value


def reset_for_tests():
    with _state_lock:
        _state['collation_ok'] = None
        _build_locks.clear()
    with _otjh_lock:
        _otjh_local.update(epoch=None, expires=0.0, value=None)
