"""Concrete catalogue / infrastructure / cache access capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import shared_build
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_CACHE_TTL_SECONDS
from curriculum_api.catalogue.infrastructure.cache_composition import ensure_curriculum_epoch_table
from curriculum_api.catalogue.infrastructure.cache_composition import read_shared_curriculum_epoch_row
from curriculum_api.catalogue.infrastructure.cache_composition import shared_curriculum_epoch
from curriculum_api.catalogue.infrastructure.cache_epochs import remember_shared_curriculum_epoch
from curriculum_api.catalogue.infrastructure.cache_runtime import _pack_shared
from curriculum_api.catalogue.infrastructure.cache_runtime import _scope_memo_key
from curriculum_api.catalogue.infrastructure.cache_runtime import _unpack_shared
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_build_lock
from curriculum_api.catalogue.infrastructure.cache_runtime import shared_curriculum_cache_key
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.runtime_config import CURRICULUM_SHARED_TTL_SECONDS
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.runtime_state import CURRICULUM_EPOCH_TABLE
from curriculum_api.catalogue.infrastructure.runtime_state import _CURRICULUM_SHARED_EPOCH_KEY
from curriculum_api.catalogue.infrastructure.storage_context import native_only
from datetime import datetime
from django.core.cache import cache
from django.db import connection
from django.db import transaction


def scoped_curriculum_read(fn):
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_runtime import scoped_curriculum_read as query

    return query(
        fn,
        _scope_memo_key=_scope_memo_key, native_only=lambda: native_only(),
    )


def refresh_curriculum_generations():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_epochs import refresh_curriculum_generations as query

    def forget_epochs():
        from curriculum_api.catalogue.infrastructure.scoped_epochs import forget_epochs
        return forget_epochs()

    return query(
        forget_epochs=forget_epochs,
    )


def write_shared_curriculum_epoch_bump(scopes=None):
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_epochs import write_shared_curriculum_epoch_bump as query

    def bump_scopes(scopes):
        from curriculum_api.catalogue.infrastructure.scoped_epochs import bump_scopes
        return bump_scopes(scopes)

    def remember_scope_epochs(rows, epoch):
        from curriculum_api.catalogue.infrastructure.scoped_epochs import remember_scope_epochs
        return remember_scope_epochs(rows, epoch)

    return query(
        scopes,
        CURRICULUM_EPOCH_TABLE=CURRICULUM_EPOCH_TABLE, _CURRICULUM_SHARED_EPOCH_KEY=_CURRICULUM_SHARED_EPOCH_KEY, bump_scopes=bump_scopes,
        cache=cache, connection=connection, drop_scoped_curriculum_entries=drop_scoped_curriculum_entries,
        ensure_curriculum_epoch_table=ensure_curriculum_epoch_table, fetch_all=fetch_all, logger=logger,
        quote_ident=quote_ident, read_shared_curriculum_epoch_row=read_shared_curriculum_epoch_row, remember_scope_epochs=remember_scope_epochs,
        remember_shared_curriculum_epoch=remember_shared_curriculum_epoch, table_name=table_name, transaction=transaction,
    )


def drop_scoped_curriculum_entries():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_invalidation import drop_scoped_curriculum_entries as query

    def forget_epochs():
        from curriculum_api.catalogue.infrastructure.scoped_epochs import forget_epochs
        return forget_epochs()

    return query(
        forget_epochs=forget_epochs,
    )


def bump_shared_curriculum_epoch():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_invalidation import bump_shared_curriculum_epoch as query

    return query(
        write_shared_curriculum_epoch_bump=write_shared_curriculum_epoch_bump,
    )


def begin_curriculum_write_scope():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_invalidation import begin_curriculum_write_scope as query

    def begin_request():
        from curriculum_api.catalogue.infrastructure.module_epochs import begin_request
        return begin_request()

    def begin_content_write_scope():
        from curriculum_api import content_cache
        return content_cache.begin_write_scope()

    return query(
        begin_content_write_scope=begin_content_write_scope, begin_request=begin_request,
    )


def end_curriculum_write_scope(scopes=None):
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_invalidation import end_curriculum_write_scope as query

    def end_content_write_scope():
        from curriculum_api import content_cache
        return content_cache.end_write_scope()

    def end_request():
        from curriculum_api.catalogue.infrastructure.module_epochs import end_request
        return end_request()

    return query(
        scopes,
        end_content_write_scope=end_content_write_scope, end_request=end_request, write_shared_curriculum_epoch_bump=write_shared_curriculum_epoch_bump,
    )


def programme_cache_generation(programme_id):
    from curriculum_api.catalogue.infrastructure.scoped_epochs import programme_generation
    return programme_generation(programme_id)


def cached_curriculum_value(key, factory, force=False, ttl=None, shared=True, scope=None, fingerprint=None, compress=False):
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_runtime import cached_curriculum_value as query

    return query(
        key, factory, force, ttl, shared, scope, fingerprint, compress,
        CURRICULUM_CACHE_TTL_SECONDS=CURRICULUM_CACHE_TTL_SECONDS, CURRICULUM_SHARED_TTL_SECONDS=CURRICULUM_SHARED_TTL_SECONDS, _pack_shared=_pack_shared,
        _unpack_shared=_unpack_shared, cache=cache, connection=connection,
        curriculum_build_lock=curriculum_build_lock, datetime=datetime, logger=logger,
        programme_cache_generation=programme_cache_generation, shared_build=shared_build, shared_curriculum_cache_key=shared_curriculum_cache_key,
        shared_curriculum_epoch=shared_curriculum_epoch,
    )
