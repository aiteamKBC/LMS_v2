"""Compatibility exports; scoped epoch state and SQL have one infrastructure owner."""
from .catalogue.infrastructure.scoped_epochs import (
    logging, re, threading, time,
    connection, transaction, logger, SCOPE_TABLE,
    UNSCOPED, BUMPS, GLOBAL, SCOPE_POLL_SECONDS,
    TABLE_RECHECK_SECONDS, _STATE, _STATE_LOCK, _REFRESH_LOCK,
    _INDEX, _INDEX_LOCK, _MODULE_WRITE, _GROUP_WRITE,
    _COHORT_WRITE, _SCOPED_METHODS, _RESERVED_SEGMENTS, scope_table_available,
    _scoped_table, scope_epochs, _forget_table, _null,
    programme_ids, programme_generation, write_seeds, _AFFECTED_SQL,
    MAX_LINKED_MODULES, affected_programmes, bump_scopes, remember_scope_epochs,
    forget_epochs, reset_state,
)
