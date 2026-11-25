"""Shared epoch verification, polling and coordinated bumps.

Existing effects are supplied explicitly by the outer entry point.
"""
import contextlib
import time

from . import runtime_state as cache_state


def ensure_curriculum_epoch_table(*, CURRICULUM_EPOCH_TABLE, CURRICULUM_SCHEMA, connection, logger, quote_ident, reconciliation_command, schema_gate, table_name, transaction):
    """Provision the one-row counter table, once per process.

    Created here rather than in a migration for the same reason the other
    ``ensure_*`` helpers do it: this app owns externally managed tables in the
    ``curriculum`` schema and provisions them on first use. Returns False when
    the table cannot be reached at all, which is the signal to fall back to the
    process-local counter rather than fail a read.
    """

    if reconciliation_command():
        return False

    if cache_state._CURRICULUM_EPOCH_TABLE_READY:
        return True
    if not schema_gate.runtime_bootstrap_allowed():
        # Schema is migration-owned here (production, the normalised database):
        # verify the table, never create it. This runs on GET paths, so it must
        # not issue CREATE SCHEMA / CREATE TABLE / INSERT. A missing table is
        # the same "cannot be reached" signal as before: the local counter.
        try:
            with transaction.atomic():
                present = schema_gate.table_exists(CURRICULUM_EPOCH_TABLE)
        except Exception:
            logger.warning('Unable to verify the shared curriculum epoch table.', exc_info=True)
            return False
        if not present:
            logger.warning('%s.%s is missing; using the process-local curriculum epoch.',
                           CURRICULUM_SCHEMA, CURRICULUM_EPOCH_TABLE)
            return False
        cache_state._CURRICULUM_EPOCH_TABLE_READY = True
        return True
    try:
        # Under a savepoint: this runs on a read path that a write request may
        # already have inside an atomic block, and in PostgreSQL a failed
        # statement poisons the whole transaction unless it can be rolled back
        # to one. The same guard is on every other statement below.
        with transaction.atomic(), connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists %s' % quote_ident(CURRICULUM_SCHEMA))
            cursor.execute(
                'create table if not exists %s ('
                ' id integer primary key,'
                ' epoch bigint not null default 0'
                ')' % table_name(CURRICULUM_EPOCH_TABLE)
            )
            cursor.execute(
                'insert into %s (id, epoch) values (1, 0) on conflict (id) do nothing'
                % table_name(CURRICULUM_EPOCH_TABLE)
            )
    except Exception:
        logger.warning('Unable to provision the shared curriculum epoch table.', exc_info=True)
        return False
    cache_state._CURRICULUM_EPOCH_TABLE_READY = True
    return True


def local_shared_curriculum_epoch(*, _CURRICULUM_SHARED_EPOCH_KEY, cache, logger):
    """The pre-database behaviour: the counter in Django's own cache.

    Correct when a Redis ``CACHE_URL`` is configured and harmless when it is
    not, so it stays as the fallback for a database that cannot answer.
    """
    try:
        cache.add(_CURRICULUM_SHARED_EPOCH_KEY, 0, timeout=None)
        return int(cache.get(_CURRICULUM_SHARED_EPOCH_KEY) or 0)
    except Exception:
        # A cache backend must never turn a cacheable read into an outage.
        logger.warning('Unable to read shared curriculum cache epoch.', exc_info=True)
        return 0


def remember_shared_curriculum_epoch(value):
    with cache_state._SHARED_EPOCH_LOCK:
        cache_state._SHARED_EPOCH_STATE['value'] = int(value)
        cache_state._SHARED_EPOCH_STATE['checked_at'] = time.monotonic()


def note_read_shared_curriculum_epoch(value):
    """A reading of the epoch row taken by another query (cache_scope's poll).

    Taken as this worker's poll when it is not older than what is held. The
    scope poll reads the epoch in the same statement, so this spares the
    separate read -- and keeps the two polls from disagreeing: a scope
    generation newer than the global one let a build pair post-write scope
    keys with rows the rows cache still held from before the write.
    """
    with cache_state._SHARED_EPOCH_LOCK:
        current = cache_state._SHARED_EPOCH_STATE['value']
        if current is None or int(value) >= current:
            cache_state._SHARED_EPOCH_STATE['value'] = int(value)
            cache_state._SHARED_EPOCH_STATE['checked_at'] = time.monotonic()


def refresh_curriculum_generations(*, forget_epochs):
    """Make this worker's next generation lookup read the database.

    For a read straight after this client's own save, which may have been
    taken by another worker less than a poll interval ago. Costs the one
    epoch read; cached entries of the current generation still serve.
    """
    with cache_state._SHARED_EPOCH_LOCK:
        cache_state._SHARED_EPOCH_STATE['checked_at'] = 0.0

    forget_epochs()


def read_shared_curriculum_epoch_row(*, CURRICULUM_EPOCH_TABLE, fetch_all, quote_ident, table_name):
    rows = fetch_all(
        'select %s from %s where %s = 1'
        % (quote_ident('epoch'), table_name(CURRICULUM_EPOCH_TABLE), quote_ident('id'))
    )
    return int((rows[0] if rows else {}).get('epoch') or 0)


def shared_curriculum_epoch(*, SHARED_EPOCH_POLL_SECONDS, connection, ensure_curriculum_epoch_table, local_shared_curriculum_epoch, logger, read_shared_curriculum_epoch_row, reconciliation_command, transaction):
    """The generation every worker's cache entries are keyed on.

    Read from the database at most once per ``SHARED_EPOCH_POLL_SECONDS``; in
    between, this process answers from what it last saw. A bump made *here*
    writes straight through to that memory, so the change-log middleware still
    sees the epoch move across its own request.
    """

    if reconciliation_command():
        return 0
    now = time.monotonic()
    with cache_state._SHARED_EPOCH_LOCK:
        value = cache_state._SHARED_EPOCH_STATE['value']
        checked_at = cache_state._SHARED_EPOCH_STATE['checked_at']
    if value is not None and now - checked_at < SHARED_EPOCH_POLL_SECONDS:
        return value
    # Concurrent page requests share one refresh. The short state lock stays
    # free while SQL runs, so writes can still publish their new generation.
    with cache_state._SHARED_EPOCH_REFRESH_LOCK:
        with cache_state._SHARED_EPOCH_LOCK:
            value = cache_state._SHARED_EPOCH_STATE['value']
            checked_at = cache_state._SHARED_EPOCH_STATE['checked_at']
        if value is not None and time.monotonic() - checked_at < SHARED_EPOCH_POLL_SECONDS:
            return value
        if not ensure_curriculum_epoch_table():
            return local_shared_curriculum_epoch()
        try:
            # A standalone SELECT needs no BEGIN/COMMIT round trips. Inside a
            # caller's transaction retain the savepoint: a failed SELECT must
            # not poison that caller's transaction.
            needs_savepoint = connection.in_atomic_block or not connection.get_autocommit()
            guard = transaction.atomic() if needs_savepoint else contextlib.nullcontext()
            with guard:
                epoch = read_shared_curriculum_epoch_row()
        except Exception:
            logger.warning('Unable to read the shared curriculum epoch.', exc_info=True)
            with cache_state._SHARED_EPOCH_LOCK:
                latest = cache_state._SHARED_EPOCH_STATE['value']
            return latest if latest is not None else local_shared_curriculum_epoch()
        with cache_state._SHARED_EPOCH_LOCK:
            # A local write may have published a newer epoch during the read.
            if cache_state._SHARED_EPOCH_STATE['checked_at'] != checked_at:
                return cache_state._SHARED_EPOCH_STATE['value']
            cache_state._SHARED_EPOCH_STATE['value'] = epoch
            cache_state._SHARED_EPOCH_STATE['checked_at'] = time.monotonic()
        return epoch


def write_shared_curriculum_epoch_bump(scopes=None, *, CURRICULUM_EPOCH_TABLE, _CURRICULUM_SHARED_EPOCH_KEY, bump_scopes, cache, connection, drop_scoped_curriculum_entries, ensure_curriculum_epoch_table, fetch_all, logger, quote_ident, read_shared_curriculum_epoch_row, remember_scope_epochs, remember_shared_curriculum_epoch, table_name, transaction):
    """Move the counter by one and record where it landed.

    ``scopes`` is the set of programmes the write was attributed to. Without
    one the unscoped counter moves, which retires every programme's payloads
    exactly as the global epoch always has.
    """

    if not ensure_curriculum_epoch_table():
        # No database counter, so nothing retires this process's scoped
        # entries either; drop them here, as before scoping.
        drop_scoped_curriculum_entries()
        try:
            cache.add(_CURRICULUM_SHARED_EPOCH_KEY, 0, timeout=None)
            cache.incr(_CURRICULUM_SHARED_EPOCH_KEY)
        except Exception:
            logger.warning('Unable to invalidate shared curriculum cache.', exc_info=True)
        return
    scope_rows = None
    try:
        with transaction.atomic():
            if connection.vendor == 'postgresql':
                rows = fetch_all(
                    'update %s set %s = %s + 1 where %s = 1 returning %s'
                    % (
                        table_name(CURRICULUM_EPOCH_TABLE),
                        quote_ident('epoch'),
                        quote_ident('epoch'),
                        quote_ident('id'),
                        quote_ident('epoch'),
                    )
                )
                epoch = int((rows[0] if rows else {}).get('epoch') or 0)
                # Same transaction as the global bump, so a reader's snapshot
                # sees both moves or neither. See cache_scope for why.
                scope_rows = bump_scopes(scopes)
            else:
                with connection.cursor() as cursor:
                    cursor.execute(
                        'update %s set %s = %s + 1 where %s = 1'
                        % (
                            table_name(CURRICULUM_EPOCH_TABLE),
                            quote_ident('epoch'),
                            quote_ident('epoch'),
                            quote_ident('id'),
                        )
                    )
                epoch = read_shared_curriculum_epoch_row()
    except Exception:
        # Nothing committed: no worker will be told about this write. Other
        # workers serve their copies until the TTL, as they always have when
        # this counter could not move; this one, at least, must not keep
        # serving the programme pages it just changed.
        logger.error(
            'Unable to bump the shared curriculum epoch; other workers keep '
            'their cached curriculum payloads until they expire.',
            exc_info=True,
        )
        drop_scoped_curriculum_entries()
        return
    remember_shared_curriculum_epoch(epoch)
    if connection.vendor == 'postgresql':
        remember_scope_epochs(scope_rows, epoch)
