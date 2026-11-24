"""Cache invalidation and request write-scope lifecycle.

Existing effects are supplied explicitly by the outer entry point.
"""

from . import runtime_state as cache_state


def invalidate_curriculum_cache(content_scope=None, *, _TABLE_EXISTS_CACHE, bump_shared_curriculum_epoch, enqueue_all_curriculum_home_refreshes, logger, retire_all_content, schedule_curriculum_warm, schema_compat, transaction):
    """Retire curriculum caches after a write.

    ``content_scope='all'`` is for a writer that changed modules, weeks,
    components or KSB mappings by raw SQL, which no write helper reported: it
    also retires every module's learner content entries (content_cache). Writes
    made through the helpers below retire only their own modules' entries, by
    themselves, so the default leaves learner content alone.
    """

    schema_compat.invalidate()
    if content_scope == 'all':

        retire_all_content()
    with cache_state._CURRICULUM_CACHE_LOCK:
        # Programme-scoped entries stay: their generation is checked on every
        # read, and the bump this write owes retires exactly the ones it touched.
        for key in [key for key, entry in cache_state._CURRICULUM_CACHE.items() if not entry.get('scoped')]:
            cache_state._CURRICULUM_CACHE.pop(key, None)
        # Bumping the epoch discards results from any factory that is mid-flight
        # right now. Without it, a build that started before this write completes
        # afterwards and repopulates the cache with pre-write rows, which would
        # then serve stale authoring data for the rest of the TTL.
        cache_state._CURRICULUM_CACHE_EPOCH += 1
    # Generation-based invalidation: every worker keys its cache entries on the
    # counter, so moving it retires all of them at once without needing a
    # backend-specific delete-pattern API. Old generations expire naturally
    # after the normal TTL.
    bump_shared_curriculum_epoch()
    # One outbox pair per write request, recorded while the caller's database
    # transaction is still active. A tree save can invalidate once per row, so
    # the request-scoped marker prevents that from becoming thousands of
    # duplicate outbox inserts; the worker still coalesces concurrent requests.
    if not getattr(cache_state._CURRICULUM_EPOCH_BUMP, 'read_model_queued', False):
        try:

            enqueue_all_curriculum_home_refreshes(reason='curriculum-change')
        except Exception:
            logger.warning('Unable to enqueue Curriculum Home refresh.', exc_info=True)
        if getattr(cache_state._CURRICULUM_EPOCH_BUMP, 'scoped', False):
            cache_state._CURRICULUM_EPOCH_BUMP.read_model_queued = True
    # Only the negative answers are dropped. Whether a table exists changes on
    # DDL, never on a curriculum write, and the ensure_* helpers only ever add
    # tables -- so a cached True is still true, while a cached False may have
    # been provisioned since and has to be asked again. Clearing the lot cost
    # ~8 information_schema round trips on the rebuild straight after every
    # write (~1-2s against a remote database) to re-learn a schema that had not
    # moved. Tests that roll the schema away call reset_schema_ready_flags(),
    # which still clears this outright.
    for key in [key for key, exists in _TABLE_EXISTS_CACHE.items() if not exists]:
        _TABLE_EXISTS_CACHE.pop(key, None)
    # Rebuild what was just dropped, off the request path. Scheduling rather
    # than building keeps this call as cheap as it was -- it is made from inside
    # write handlers, sometimes once per written row -- and the delay in the
    # warm loop collapses a burst of these into one rebuild.
    #
    # on_commit, because several handlers invalidate from inside their atomic
    # block: a warm that started before the commit would read the pre-write
    # rows and cache them for the full TTL, with no later invalidation to
    # correct it. Outside an atomic block this runs straight away, and a
    # rollback correctly warms nothing.
    try:
        transaction.on_commit(schedule_curriculum_warm)
    except Exception:
        logger.warning('Unable to schedule curriculum cache warm.', exc_info=True)


def drop_scoped_curriculum_entries(*, forget_epochs):
    """Forget this process's programme-scoped payloads and in-flight builds.

    invalidate_curriculum_cache() keeps scoped entries because the database
    bump is what retires them. When that bump cannot be made, this restores
    the pre-scoping behaviour for the writing worker: everything it cached is
    dropped, and a build already running cannot publish (the local epoch moves).
    """

    with cache_state._CURRICULUM_CACHE_LOCK:
        for key in [key for key, entry in cache_state._CURRICULUM_CACHE.items() if entry.get('scoped')]:
            cache_state._CURRICULUM_CACHE.pop(key, None)
        cache_state._CURRICULUM_CACHE_EPOCH += 1
    forget_epochs()


def bump_shared_curriculum_epoch(*, write_shared_curriculum_epoch_bump):
    """Retire every worker's cached payload, once per request that writes.

    Inside a request the bump is owed rather than made: the change-log
    middleware flushes it after the view, so one save costs one UPDATE however
    many rows it wrote, and the new generation becomes visible to other workers
    only once the data it describes has committed. Outside a request (a
    management command, the warm loop) there is nobody to flush it, so it is
    made straight away.
    """
    if getattr(cache_state._CURRICULUM_EPOCH_BUMP, 'scoped', False):
        cache_state._CURRICULUM_EPOCH_BUMP.pending = True
        return
    write_shared_curriculum_epoch_bump()


def begin_curriculum_write_scope(*, begin_content_write_scope, begin_request):
    cache_state._CURRICULUM_EPOCH_BUMP.scoped = True
    cache_state._CURRICULUM_EPOCH_BUMP.pending = False
    cache_state._CURRICULUM_EPOCH_BUMP.read_model_queued = False

    begin_request()

    begin_content_write_scope()


def end_curriculum_write_scope(scopes=None, *, end_content_write_scope, end_request, write_shared_curriculum_epoch_bump):
    """Make the request's one bump, if anything in it invalidated."""

    # The modules this request wrote: one version move each, after the view.
    end_content_write_scope()
    pending = getattr(cache_state._CURRICULUM_EPOCH_BUMP, 'pending', False)
    cache_state._CURRICULUM_EPOCH_BUMP.scoped = False
    cache_state._CURRICULUM_EPOCH_BUMP.pending = False
    cache_state._CURRICULUM_EPOCH_BUMP.read_model_queued = False
    try:
        if pending:
            write_shared_curriculum_epoch_bump(scopes)
    finally:
        # The per-module counters the Module Builder watches. Moved after the
        # global bump and in their own statement, so a reader that sees a
        # module counter move also finds the data it describes committed.

        end_request()


def curriculum_write_pending():
    """Whether this request has invalidated and still owes its bump."""
    return bool(getattr(cache_state._CURRICULUM_EPOCH_BUMP, 'pending', False))
