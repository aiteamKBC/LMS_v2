"""Infrastructure payload cache. Explicit read capabilities preserve legacy contracts."""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import unique as _default_unique


def curriculum_build_lock(key, *, _CURRICULUM_BUILD_LOCKS, _CURRICULUM_CACHE_LOCK, threading):
    """The lock that serialises rebuilds of one cache key.

    Kept in its own map rather than reusing ``_CURRICULUM_CACHE_LOCK`` so a build
    holds only its own key: reads of other keys, and cache hits on this one, stay
    lock-free. The map is bounded by the number of payload keys (visibility x
    compact), so nothing is ever evicted from it.
    """
    with _CURRICULUM_CACHE_LOCK:
        lock = _CURRICULUM_BUILD_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _CURRICULUM_BUILD_LOCKS[key] = lock
        return lock


def cached_curriculum_value(
    key, factory, force=False, ttl=None, shared=True, scope=None, fingerprint=None, compress=False, *,
    CURRICULUM_CACHE_TTL_SECONDS, CURRICULUM_SHARED_TTL_SECONDS, _CURRICULUM_CACHE,
    _CURRICULUM_CACHE_LOCK, _CURRICULUM_EPOCH_BUMP, _pack_shared, _unpack_shared, cache, connection,
    curriculum_build_lock, datetime, logger, programme_cache_generation, shared_build,
    shared_curriculum_cache_key, shared_curriculum_epoch, time, read_local_epoch,
):
    """The cached payload for ``key``, rebuilding it when it is not there.

    ``force`` bypasses both cache layers, subject to the existing rule that a
    caller without pending writes may reuse a forced build started after its
    request. The rebuilt value is published only if both the local epoch and
    the supplied shared/programme generation still match. The composition root
    supplies the database-backed generation reader; Django's payload cache is
    not the authority for that generation.

    ``shared=False`` keeps a value in this process only. The shared epoch is
    still honoured, so a write elsewhere still invalidates it.

    ``compress`` stores the shared copy zlib-compressed (the process copy stays
    as built), for a large value such as the raw curriculum rows.

    ``scope`` is a programme id for a payload about that programme alone. Its
    generation is then the programme's own counter plus the unscoped one (see
    cache_scope), so a save to another programme leaves it cached. Without the
    scope table, or for an identifier that is not exactly a programme id, the
    global epoch applies as before.

    ``fingerprint`` is for a payload whose short ``ttl`` stands in for data no
    epoch covers (learner counts, say). It is a callable returning a value that
    changes whenever that data does; it is called in the caller's read scope
    just before the factory, so the stored entry is exactly the data its
    fingerprint describes. An entry past its ``ttl`` whose generation still
    matches is then checked rather than rebuilt: the fingerprint is taken again
    and, if equal, the entry is served for another ``ttl``. A rebuild costs the
    whole payload; the check costs only what the fingerprint reads. Entries
    taken from the shared cache carry no fingerprint and expire as before.
    """
    ttl = CURRICULUM_CACHE_TTL_SECONDS if ttl is None else ttl
    # When this call began. A force caller may take a value whose build started
    # later than this: every read that build made came after anything the
    # caller had committed before asking (see the build-lock re-check below).
    requested_at = time.monotonic()
    # Not for a caller that has written in this request: its writes may still
    # be uncommitted, invisible to a build on another thread.
    shares_forced_builds = (
        not getattr(_CURRICULUM_EPOCH_BUMP, 'pending', False)
        and not connection.in_atomic_block
    )
    scoped = scope is not None and programme_cache_generation(scope) is not None
    if scoped and getattr(_CURRICULUM_EPOCH_BUMP, 'pending', False):
        # This request has written and its bump is still owed: read its own
        # writes rather than a scoped entry that bump has yet to retire.
        force = True

    def generation():
        if scoped:
            value = programme_cache_generation(scope)
            if value is not None:
                return value
        return shared_curriculum_epoch()

    now = datetime.now().timestamp()
    shared_epoch = generation()
    with _CURRICULUM_CACHE_LOCK:
        entry = _CURRICULUM_CACHE.get(key)
        if not force and entry and entry['expires_at'] > now and entry.get('shared_epoch') == shared_epoch:
            return entry['value']
    if (
        not force and fingerprint is not None and entry
        and entry.get('shared_epoch') == shared_epoch and 'fingerprint' in entry
    ):
        # Past its ttl but of the current generation: ask whether the data the
        # ttl stands in for has moved before paying for a rebuild.
        current = fingerprint()
        if current == entry['fingerprint']:
            with _CURRICULUM_CACHE_LOCK:
                if _CURRICULUM_CACHE.get(key) is entry:
                    entry['expires_at'] = datetime.now().timestamp() + ttl
            return entry['value']

    shared_key = shared_curriculum_cache_key(key, shared_epoch)
    try:
        shared_value = None if (force or not shared) else cache.get(shared_key)
        if shared_value is not None and compress:
            shared_value = _unpack_shared(shared_value)
    except Exception:
        logger.warning('Unable to read shared curriculum payload cache.', exc_info=True)
        shared_value = None
    if shared_value is not None:
        with _CURRICULUM_CACHE_LOCK:
            _CURRICULUM_CACHE[key] = {
                'expires_at': now + ttl,
                'shared_epoch': shared_epoch,
                'value': shared_value,
                'scoped': scoped,
            }
        return shared_value

    # One build per key at a time. Several endpoints read the same payload —
    # programmes/ and ksb-sets/ both key overview:<visibility>:compact — and a page
    # that mounts them together used to hit a cold cache in parallel, so each
    # request ran the whole multi-table rebuild while the others waited on the same
    # Neon connections. The lock is per key, not the cache lock, so a build still
    # never blocks a cached read or a different key.
    with curriculum_build_lock(key):
        now = datetime.now().timestamp()
        shared_epoch = generation()
        # Whoever held this lock has just published its result, so the requests
        # queued behind it cost a cache read rather than another rebuild. A force
        # caller has written and is asking for its own state back, so it skips the
        # re-check: the value waiting here may predate that write.
        with _CURRICULUM_CACHE_LOCK:
            entry = _CURRICULUM_CACHE.get(key)
            if entry and entry['expires_at'] > now and entry.get('shared_epoch') == shared_epoch and (
                not force
                # Several forced reads queued on one key -- a save's reload
                # and a Refresh, two tabs -- take the first build that began
                # after they asked instead of each paying for its own.
                or (shares_forced_builds and entry.get('build_started', float('-inf')) >= requested_at)
            ):
                return entry['value']

        # The lock above covers this process only. When the shared cache is
        # really shared (Redis), another worker may already be running this
        # exact build; wait for its result rather than run a second copy
        # against the database. See shared_build for every way this falls back
        # to building here. A force caller has just written and wants its own
        # state back, so it never waits on a build that may predate the write.
        shared_key = shared_curriculum_cache_key(key, shared_epoch)
        build_token = None
        if shared and not force:
            for _attempt in range(2):
                acquired, build_token = shared_build.try_acquire(cache, shared_key)
                if acquired:
                    break
                waited, holder_gone = shared_build.wait_for_value(cache, shared_key)
                if waited is not None and compress:
                    try:
                        waited = _unpack_shared(waited)
                    except Exception:
                        logger.warning('Discarding an unreadable shared curriculum payload.', exc_info=True)
                        waited, holder_gone = None, True
                if waited is not None:
                    with _CURRICULUM_CACHE_LOCK:
                        _CURRICULUM_CACHE[key] = {
                            'expires_at': datetime.now().timestamp() + ttl,
                            'shared_epoch': shared_epoch,
                            'value': waited,
                            'scoped': scoped,
                        }
                    return waited
                if not holder_gone:
                    # Waited the full window: build here, without the lock.
                    break

        try:
            with _CURRICULUM_CACHE_LOCK:
                epoch = read_local_epoch()
            build_started = time.monotonic()

            # Taken before the factory and in the same read scope, so the
            # factory's own reads of that data are the ones fingerprinted.
            built_fingerprint = fingerprint() if fingerprint is not None else None
            # An exception propagates without storing anything, so failures are never
            # cached.
            value = factory()

            # Network I/O must not hold the global cache lock: a slow epoch
            # read or shared-cache write would stall hits for unrelated keys.
            current_shared_epoch = generation()
            with _CURRICULUM_CACHE_LOCK:
                # Only publish if no write invalidated the cache while we were building.
                publish = epoch == read_local_epoch() and shared_epoch == current_shared_epoch
                if publish:
                    _CURRICULUM_CACHE[key] = {
                        'expires_at': datetime.now().timestamp() + ttl,
                        'shared_epoch': shared_epoch,
                        'value': value,
                        'scoped': scoped,
                        'build_started': build_started,
                        **({'fingerprint': built_fingerprint} if fingerprint is not None else {}),
                    }
            if publish and shared:
                # This key includes the generation: a concurrent invalidation
                # retires it even if this network write finishes afterwards.
                try:
                    cache.set(shared_key, _pack_shared(value) if compress else value,
                              timeout=min(ttl, CURRICULUM_SHARED_TTL_SECONDS))
                except Exception:
                    logger.warning('Unable to populate shared curriculum payload cache.', exc_info=True)
        finally:
            # After publishing, so a waiter that sees the lock gone finds the
            # value already there.
            shared_build.release(cache, shared_key, build_token)
    return value


def _pack_shared(value):
    import pickle
    import zlib
    return zlib.compress(pickle.dumps(value, protocol=pickle.HIGHEST_PROTOCOL), 1)


def _unpack_shared(blob):
    import pickle
    import zlib
    return pickle.loads(zlib.decompress(blob))


def structure_payloads_cache_key(
    module_catalogue_ids,
    options,
    *,
    clean_str=_default_clean_str,
    hashlib,
    unique=_default_unique,
):
    """Cache key covering every input that can change get_authoring_structure_payloads().

    The identifier list is cleaned and sorted first, so two requests naming the same
    modules in a different order (or with duplicates, or with surrounding whitespace)
    share one entry — the function's own result is keyed by catalogue id, so order in
    never affects the mapping out.

    Every shaping option is rendered into the key from its actual value rather than
    being summarised by a hand-written label. A caller that adds an option, or flips
    one, gets a different key automatically; there is no constant left to forget to
    update, which is what makes two semantically different requests unable to collide.
    """
    catalogue_ids = sorted(unique([clean_str(value) for value in (module_catalogue_ids or []) if clean_str(value)]))
    flags = ','.join(f'{name}={bool(value)}' for name, value in sorted(options.items()))
    # Hash the identifier list: a resolve request can name hundreds of modules, and an
    # unbounded key would sit in the process cache dict for the whole TTL. The joiner is
    # a separator that cannot occur in a cleaned identifier, so [MOD-A, B] and [MOD-AB]
    # cannot hash alike.
    ids_digest = hashlib.sha256(''.join(catalogue_ids).encode()).hexdigest()[:32]
    return f'module-structure-payloads:{flags}:{len(catalogue_ids)}:{ids_digest}'
