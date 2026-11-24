"""Concrete catalogue / infrastructure / cache composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import schema_gate
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_CHANGE_LOG_KEY
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_CHANGE_LOG_SIZE
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.runtime_config import CURRICULUM_WRITE_TRACE
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.runtime_config import write_logger
from curriculum_api.catalogue.infrastructure.runtime_state import CURRICULUM_EPOCH_TABLE
from curriculum_api.catalogue.infrastructure.runtime_state import SHARED_EPOCH_POLL_SECONDS
from curriculum_api.catalogue.infrastructure.runtime_state import _CURRICULUM_SHARED_EPOCH_KEY
from django.core.cache import cache
from django.db import connection
from django.db import transaction
import hashlib
import logging


def _write_log_fields(fields):
    """Keep only the allowlisted, non-empty fields, stringified for the log."""
    allowed = (
        'entity_type', 'entity_id', 'parent_id', 'action',
        'outcome', 'table', 'row_count', 'matched_id', 'reason',
    )
    return {
        key: (value if isinstance(value, int) else clean_str(value))
        for key, value in fields.items()
        if key in allowed and value not in (None, '')
    }


def log_curriculum_decision(action, **fields):
    """Record what a curriculum write handler decided, and on which row.

    ``action`` is a dotted event name (``group.create``, ``cohort.archive``).
    ``outcome`` is the branch taken, and is the field worth alerting on: an
    ``outcome`` that is not what the caller expected is the whole point of this
    log existing.
    """
    safe = _write_log_fields({'action': action, **fields})
    summary = ' '.join(f'{key}={value}' for key, value in sorted(safe.items()) if key != 'action')
    write_logger.info('%s %s', action, summary, extra={'event': f'curriculum.{action}', **safe})


def log_curriculum_storage(action, table, *, rows=None, **fields):
    """Record one write reaching a curriculum table. DEBUG; see the note above.

    ``rows`` may be the returned row list or an int; anything else is ignored
    rather than guessed at, because this must never be the reason a write fails.
    """
    if not (CURRICULUM_WRITE_TRACE or write_logger.isEnabledFor(logging.DEBUG)):
        return
    try:
        if isinstance(rows, int):
            row_count = rows
        elif rows is None:
            row_count = None
        else:
            row_count = len(rows)
        safe = _write_log_fields({'action': action, 'table': table, 'row_count': row_count, **fields})
        summary = ' '.join(f'{key}={value}' for key, value in sorted(safe.items()) if key != 'action')
        write_logger.debug('storage.%s %s', action, summary, extra={'event': f'curriculum.storage.{action}', **safe})
    except Exception:
        # A trace that can break a write is worse than no trace.
        logger.debug('Curriculum write trace failed.', exc_info=True)


def ensure_curriculum_epoch_table():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_epochs import ensure_curriculum_epoch_table as query

    def reconciliation_command():
        from config.management_safety import reconciliation_command
        return reconciliation_command()

    return query(
        CURRICULUM_EPOCH_TABLE=CURRICULUM_EPOCH_TABLE, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, connection=connection,
        logger=logger, quote_ident=quote_ident, reconciliation_command=reconciliation_command,
        schema_gate=schema_gate, table_name=table_name, transaction=transaction,
    )


def local_shared_curriculum_epoch():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_epochs import local_shared_curriculum_epoch as query

    return query(
        _CURRICULUM_SHARED_EPOCH_KEY=_CURRICULUM_SHARED_EPOCH_KEY, cache=cache, logger=logger,
    )


def read_shared_curriculum_epoch_row():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_epochs import read_shared_curriculum_epoch_row as query

    return query(
        CURRICULUM_EPOCH_TABLE=CURRICULUM_EPOCH_TABLE, fetch_all=fetch_all, quote_ident=quote_ident,
        table_name=table_name,
    )


def shared_curriculum_epoch():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_epochs import shared_curriculum_epoch as query

    def reconciliation_command():
        from config.management_safety import reconciliation_command
        return reconciliation_command()

    return query(
        SHARED_EPOCH_POLL_SECONDS=SHARED_EPOCH_POLL_SECONDS, connection=connection, ensure_curriculum_epoch_table=ensure_curriculum_epoch_table,
        local_shared_curriculum_epoch=local_shared_curriculum_epoch, logger=logger, read_shared_curriculum_epoch_row=read_shared_curriculum_epoch_row,
        reconciliation_command=reconciliation_command, transaction=transaction,
    )


def record_curriculum_change(path, low, high):
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_runtime import record_curriculum_change as query

    return query(
        path, low, high,
        CURRICULUM_CHANGE_LOG_KEY=CURRICULUM_CHANGE_LOG_KEY, CURRICULUM_CHANGE_LOG_SIZE=CURRICULUM_CHANGE_LOG_SIZE, cache=cache,
        logger=logger,
    )


def recent_curriculum_changes():
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_runtime import recent_curriculum_changes as query

    return query(
        CURRICULUM_CHANGE_LOG_KEY=CURRICULUM_CHANGE_LOG_KEY, cache=cache, logger=logger,
    )


def structure_payloads_cache_key(module_catalogue_ids, **options):
    from curriculum_api.catalogue.infrastructure.payload_cache import structure_payloads_cache_key as query
    return query(
        module_catalogue_ids,
        options,
        hashlib=hashlib,
    )
