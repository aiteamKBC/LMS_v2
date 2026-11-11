"""Version keys for caches whose invalidation must reach every process at once.

Used by the login session cache (login.session_cache) and the learner subject
cache (learner_api.subject_cache). A cached entry records the version of the
record it describes; a write sets a new version; a reader uses an entry only
when the version it records is the current one.

Rules, each closing a way stale data could be served:

* **A missing version is a miss.** Never compared against a default: after a
  Valkey restart, failover or eviction the key is simply gone, and nothing
  cached before that may be trusted.
* **Versions never repeat.** A new version is a unique value (``time_ns`` plus
  a random suffix) written with SET, never INCR: an INCR from a missing key
  starts again at 1 and could match an entry built under an old 1. Version keys
  have no TTL.
* **A namespace generation** sits above the per-record versions, so a whole
  namespace can be retired at once (used when invalidations were lost).
* **Bumps run after commit** (``transaction.on_commit``), so a reader that sees
  the new version also sees the committed row.
* **Strict reads and writes**: these keys go to the shared server or nowhere.
  ``ResilientRedisCache``'s process-local fallback would let one process keep
  an entry another process invalidated, so when the server cannot answer the
  caller reads its source of truth instead.
* **A failed bump is retried** before this process uses the cache again, and
  until it succeeds this process bypasses the cache. More than
  ``MAX_PENDING`` failed bumps retire the namespace's generation instead.

Residual risk, accepted: if one process cannot reach Valkey while the others
can, an invalidation made by that process does not reach the others until it
reconnects. Their cached entries carry a TTL (60 s for sessions, 120 s for
subjects), which bounds that window.
"""
from __future__ import annotations

import logging
import os
import secrets
import threading
import time

from django.conf import settings
from django.core.cache import caches
from django.db import transaction

from config.cache_backends import ResilientRedisCache, SharedCacheUnavailable

logger = logging.getLogger(__name__)

MAX_PENDING = 1000
_pending = []          # [(namespace, record id or None for the generation)]
_pending_lock = threading.Lock()


class Unavailable(Exception):
    """The shared cache cannot be used right now; read the database."""


def shared_cache_available() -> bool:
    """Whether the configured cache is one every process shares."""
    if getattr(settings, 'SHARED_VERSION_CACHE_ALLOW_LOCAL', False):
        return True  # tests: one process, one LocMem cache
    from django.core.cache.backends.redis import RedisCache
    return isinstance(caches['default'], RedisCache)


def strict(name, *args, **kwargs):
    if not shared_cache_available():
        raise Unavailable('the cache is not shared between processes')
    cache = caches['default']
    try:
        if isinstance(cache, ResilientRedisCache):
            return cache.strict(name, *args, **kwargs)
        return getattr(cache, name)(*args, **kwargs)
    except SharedCacheUnavailable as exc:
        raise Unavailable(str(exc)) from exc
    except Exception as exc:  # any cache error: the database answers
        raise Unavailable(str(exc)) from exc


def new_version() -> str:
    return f'{time.time_ns():x}{secrets.token_hex(4)}'


def version_key(namespace, record_id) -> str:
    return f'cv:v1:{namespace}:{record_id}'


def generation_key(namespace) -> str:
    return f'cv:v1:{namespace}:gen'


def read(namespace, record_ids):
    """``{record id: version}`` plus ``'gen'``; missing keys are absent."""
    keys = {version_key(namespace, rid): rid for rid in record_ids}
    gen = generation_key(namespace)
    found = strict('get_many', [*keys, gen])
    out = {keys[key]: value for key, value in found.items() if key in keys}
    if gen in found:
        out['gen'] = found[gen]
    return out


def current(namespace, record_id):
    """``(version, generation)`` for building an entry, creating missing keys.

    ``add`` (SET NX) so concurrent creators agree on one value; read back so a
    creator that lost the race uses the winner's.
    """
    flush_pending()
    key, gen = version_key(namespace, record_id), generation_key(namespace)
    found = strict('get_many', [key, gen])
    missing = [k for k in (key, gen) if k not in found]
    if missing:
        for k in missing:
            strict('add', k, new_version(), timeout=None)
        found = strict('get_many', [key, gen])
    if key not in found or gen not in found:
        raise Unavailable('version keys could not be read back')
    return found[key], found[gen]


def bump(namespace, record_ids, using=None):
    """Give each record a new version once the current transaction commits."""
    ids = sorted({str(rid) for rid in record_ids if rid not in (None, '')})
    if not ids:
        return

    def apply():
        _set_versions(namespace, ids)
    try:
        transaction.on_commit(apply, using=using)
    except Exception:
        apply()


def bump_generation(namespace):
    try:
        strict('set', generation_key(namespace), new_version(), timeout=None)
    except Unavailable:
        _remember_failure([(namespace, None)])


def _set_versions(namespace, ids):
    if not shared_cache_available():
        return  # nothing shared to invalidate; the cache is not in use
    try:
        strict('set_many', {version_key(namespace, rid): new_version() for rid in ids}, timeout=None)
    except Unavailable:
        logger.warning('Could not invalidate %s cache entries; retrying before the next use.', namespace)
        _remember_failure([(namespace, rid) for rid in ids])


def _remember_failure(items):
    with _pending_lock:
        _pending.extend(items)
        if len(_pending) > MAX_PENDING:
            namespaces = {ns for ns, _ in _pending}
            _pending[:] = [(ns, None) for ns in sorted(namespaces)]


def flush_pending():
    """Retry failed bumps; raise Unavailable while any remain."""
    with _pending_lock:
        items = list(_pending)
    if not items:
        return
    by_namespace = {}
    for namespace, rid in items:
        by_namespace.setdefault(namespace, set()).add(rid)
    values = {}
    for namespace, rids in by_namespace.items():
        if None in rids:
            values[generation_key(namespace)] = new_version()
        values.update({version_key(namespace, rid): new_version() for rid in rids if rid is not None})
    strict('set_many', values, timeout=None)  # raises Unavailable: stay pending
    with _pending_lock:
        del _pending[:len(items)]


def pending_count():
    with _pending_lock:
        return len(_pending)


def reset_for_tests():
    with _pending_lock:
        _pending.clear()


class VersionBumpQuerySetMixin:
    """Bulk writes bump the cache versions of the records they touch.

    ``update()``, ``delete()``, ``bulk_create()`` and ``bulk_update()`` send no
    ``post_save``. The model names what to bump through
    ``cache_version_targets(model, rows)``, a classmethod returning
    ``{namespace: [ids]}`` for model instances or ``values()`` dicts.
    ``with_cache_targets`` lets a caller that already knows the targets skip the
    extra read before an update.
    """

    _cache_targets_known = None

    def _clone(self):
        clone = super()._clone()
        clone._cache_targets_known = self._cache_targets_known
        return clone

    def with_cache_targets(self, targets):
        clone = self._clone()
        clone._cache_targets_known = targets
        return clone

    def _cache_targets(self, fields=None):
        if self._cache_targets_known is not None:
            return self._cache_targets_known
        if not hasattr(self.model, 'cache_version_targets'):
            return {}
        names = self.model.cache_version_fields()
        rows = list(self.values(*names))
        return self.model.cache_version_targets(rows, fields=fields)

    def _bump(self, targets):
        for namespace, ids in (targets or {}).items():
            bump(namespace, ids, using=self.db)

    def update(self, **fields):
        targets = self._cache_targets(fields)
        result = super().update(**fields)
        self._bump(targets)
        return result
    update.alters_data = True

    def delete(self):
        targets = self._cache_targets()
        result = super().delete()
        self._bump(targets)
        return result
    delete.alters_data = True

    def bulk_create(self, objs, *args, **kwargs):
        created = super().bulk_create(objs, *args, **kwargs)
        if hasattr(self.model, 'cache_version_targets'):
            self._bump(self.model.cache_version_targets(created))
        return created
    bulk_create.alters_data = True

    def bulk_update(self, objs, fields, *args, **kwargs):
        result = super().bulk_update(objs, fields, *args, **kwargs)
        if hasattr(self.model, 'cache_version_targets'):
            self._bump(self.model.cache_version_targets(objs))
        return result
    bulk_update.alters_data = True


def in_transaction() -> bool:
    """Whether this thread has an open transaction on a database alias.

    Bumps run after commit, so inside a transaction a caller could read the
    entry its own uncommitted write is about to retire. These caches are
    therefore read and written only outside transactions; inside one, the
    database answers.
    """
    from django.db import connections
    for alias in connections:
        try:
            if connections[alias].in_atomic_block:
                return True
        except Exception:
            continue
    return False


def enabled(flag) -> bool:
    return os.environ.get(flag, 'true').strip().lower() not in {'0', 'false', 'no', 'off'}
