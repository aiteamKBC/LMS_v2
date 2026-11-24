"""Concrete state binding for payload caching and reentrant read scopes.

Existing effects are supplied explicitly by the outer entry point.
"""
import contextlib
import functools
import hashlib
import inspect
import threading
import time

from . import runtime_state as cache_state


@contextlib.contextmanager
def curriculum_read_scope(targeted_child_reads=False):
    from .read_scope import curriculum_read_scope as query
    with query(
        targeted_child_reads, read_scope_state=lambda: cache_state._CURRICULUM_READ_SCOPE,
    ):
        yield


def _scope_memo_key(value):
    from .read_scope import _scope_memo_key as query
    return query(
        value,
    )


def scoped_curriculum_read(fn, *, _scope_memo_key, native_only):
    from .read_scope import scoped_curriculum_read as query
    return query(
        fn, _scope_memo_key=_scope_memo_key, functools=functools, inspect=inspect,
        native_only=lambda: native_only(), read_scope_state=lambda: cache_state._CURRICULUM_READ_SCOPE,
    )


def curriculum_build_lock(key):
    from .payload_cache import curriculum_build_lock as query
    return query(
        key, _CURRICULUM_BUILD_LOCKS=cache_state._CURRICULUM_BUILD_LOCKS,
        _CURRICULUM_CACHE_LOCK=cache_state._CURRICULUM_CACHE_LOCK, threading=threading,
    )


def cached_curriculum_value(key, factory, force=False, ttl=None, shared=True, scope=None, fingerprint=None, compress=False, *, CURRICULUM_CACHE_TTL_SECONDS, CURRICULUM_SHARED_TTL_SECONDS, _pack_shared, _unpack_shared, cache, connection, curriculum_build_lock, datetime, logger, programme_cache_generation, shared_build, shared_curriculum_cache_key, shared_curriculum_epoch):
    from .payload_cache import cached_curriculum_value as query
    return query(
        key, factory, force, ttl, shared, scope, fingerprint, compress,
        CURRICULUM_CACHE_TTL_SECONDS=CURRICULUM_CACHE_TTL_SECONDS,
        CURRICULUM_SHARED_TTL_SECONDS=CURRICULUM_SHARED_TTL_SECONDS, _CURRICULUM_CACHE=cache_state._CURRICULUM_CACHE,
        _CURRICULUM_CACHE_LOCK=cache_state._CURRICULUM_CACHE_LOCK, _CURRICULUM_EPOCH_BUMP=cache_state._CURRICULUM_EPOCH_BUMP,
        _pack_shared=_pack_shared, _unpack_shared=_unpack_shared, cache=cache, connection=connection,
        curriculum_build_lock=curriculum_build_lock, datetime=datetime, logger=logger,
        programme_cache_generation=programme_cache_generation, shared_build=shared_build,
        shared_curriculum_cache_key=shared_curriculum_cache_key,
        shared_curriculum_epoch=shared_curriculum_epoch, time=time,
        read_local_epoch=lambda: cache_state._CURRICULUM_CACHE_EPOCH,
    )


def _pack_shared(value):
    from .payload_cache import _pack_shared as query
    return query(
        value,
    )


def _unpack_shared(blob):
    from .payload_cache import _unpack_shared as query
    return query(
        blob,
    )


def shared_curriculum_cache_key(key, epoch):
    digest = hashlib.sha256(str(key).encode()).hexdigest()
    return f'curriculum:v{epoch}:{digest}'


def record_curriculum_change(path, low, high, *, CURRICULUM_CHANGE_LOG_KEY, CURRICULUM_CHANGE_LOG_SIZE, cache, logger):
    """Note that the epochs in ``(low, high]`` were moved by a write to ``path``.

    The counter on its own says only that something changed, which leaves every
    open tab in the estate to throw away its whole cache and read the ~13s
    overview back. This log is what turns that into "re-read the programmes".

    Deliberately best-effort. The read-modify-write below is not atomic, so two
    workers finishing at once can lose an entry -- and that is safe, because a
    client only trusts the log when it covers every epoch it missed and drops
    back to the blunt refresh when it does not. A lost entry costs one wasted
    reload; a lost entry mistaken for "nothing relevant changed" would cost a
    stale screen, which is why coverage is checked rather than assumed.
    """
    if high <= low:
        return
    try:
        entries = list(cache.get(CURRICULUM_CHANGE_LOG_KEY) or [])
        entries.append({'path': path, 'lo': int(low), 'hi': int(high)})
        cache.set(
            CURRICULUM_CHANGE_LOG_KEY,
            entries[-CURRICULUM_CHANGE_LOG_SIZE:],
            timeout=None,
        )
    except Exception:
        logger.warning('Unable to record curriculum change for %s.', path, exc_info=True)


def recent_curriculum_changes(*, CURRICULUM_CHANGE_LOG_KEY, cache, logger):
    try:
        return list(cache.get(CURRICULUM_CHANGE_LOG_KEY) or [])
    except Exception:
        logger.warning('Unable to read the curriculum change log.', exc_info=True)
        return []
