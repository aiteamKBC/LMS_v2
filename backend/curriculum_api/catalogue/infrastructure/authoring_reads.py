"""Authoring read execution, completion and request-local batch prefetch.

Concrete SQL and memo capabilities live here; schema routing and name completion
remain explicit ports supplied by the outer adapter.
Batch failures retain the existing individual-read path; no empty-data substitute."""

import inspect
import logging

from . import runtime_state as cache_state

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def _database_reads():
    # Keep explicit-port callers importable without initializing Django.
    from . import database_reads
    return database_reads


def _ksb_reads():
    from . import ksb_read_store
    return ksb_read_store


def authoring_rows_by_id(
    table,
    id_column,
    ids,
    order_sql,
    *,
    ensure_tables=True,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    current_read_memo=lambda: getattr(cache_state._CURRICULUM_READ_SCOPE, 'memo', None),
    curriculum_in_clause=lambda column, values: _database_reads().curriculum_in_clause(column, values),
):
    """``table``'s rows whose ``id_column`` is one of ``ids``, in no promised order.

    Inside a curriculum_read_scope() this filters the whole-table read the
    list readers make (memoised, so it costs nothing once they have run, and
    one round trip when they have not -- the same as the targeted read). Outside
    a scope it is the targeted ``in (...)`` read it has always been, and
    ``ensure_tables`` applies to it; the scoped read is the list readers' own,
    so it provisions as they do (a no-op once any of them has run).
    """
    wanted = {clean_str(value) for value in ids if clean_str(value)}
    if not wanted:
        return []
    if current_read_memo() is not None:
        return [
            row for row in authoring_fetch_all(table, order_sql=order_sql)
            if clean_str(row.get(id_column)) in wanted
        ]
    ordered = sorted(wanted)
    clause, params = curriculum_in_clause(id_column, ordered)
    return authoring_fetch_all(table, clause, params, ensure_tables=ensure_tables)


def authoring_fetch_all(table, where_sql='', params=None, order_sql='', *, ensure_tables=True, columns=None, exclude_columns=None,
    authoring_select_sql,
    complete_authoring_rows,
    open_cursor=lambda: _database_reads().connection.cursor(),
    rows_as_dicts=lambda cursor: _database_reads().rows_as_dicts(cursor),
):
    """Read authoring rows. Pass ``columns`` to avoid ``select *``.

    Narrowing matters on ``curriculum.components``: it holds ~18k rows and
    39 MB, 24 MB of which is ``settings_json``, and the database is remote.
    A caller that only needs titles and counts pays ~90 s for ``select *``
    against well under a second for the columns it actually reads. ``columns``
    is part of the memo key, so a narrow read and a full read never collide.

    ``exclude_columns`` is the inverse and is the safer choice for a caller that
    reads most of the row: it drops only what is named, so a column added later
    still arrives.
    """
    query = authoring_select_sql(
        table, where_sql, order_sql,
        ensure_tables=ensure_tables, columns=columns, exclude_columns=exclude_columns,
    )
    with open_cursor() as cursor:
        cursor.execute(query, params or [])
        rows = rows_as_dicts(cursor)
    return complete_authoring_rows(table, rows, columns, exclude_columns)


def complete_authoring_rows(table, rows, columns=None, exclude_columns=None, *,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    attach_component_ksbs=lambda rows: _ksb_reads().attach_component_items(rows),
    attach_curriculum_names,
    attach_ksb_descriptions=lambda rows: _ksb_reads().attach_descriptions(rows),
):
    """What a read adds after the fetch, the same for a direct and a prefetched read.

    A KSB mapping's description (its standard's text, left out of the
    statement), a component's KSB items, then the programme / cohort / group /
    tutor / coach names, read by id. The archive state is the row's ``status``.
    """
    def wanted(key):
        return bool(rows) and (not columns or key in columns) and key not in (exclude_columns or ())

    if table == AUTHORING_KSB_MAPPINGS_TABLE and wanted('ksb_description'):
        attach_ksb_descriptions(rows)
    if table == AUTHORING_COMPONENTS_TABLE and wanted('ksb_mappings'):
        # A component's KSBs, in the item shape its readers take
        # (component_ksb_mappings_from_row).
        attach_component_ksbs(rows)
    return attach_curriculum_names(table, rows, requested=columns, excluded=exclude_columns)


def prefetch_authoring_reads(calls, *,
    CURRICULUM_BATCHED_READS,
    authoring_fetch_all,
    authoring_select_sql,
    complete_authoring_rows,
    current_read_memo=lambda: getattr(cache_state._CURRICULUM_READ_SCOPE, 'memo', None),
    database_vendor=lambda: _database_reads().connection.vendor,
    in_atomic_block=lambda: _database_reads().connection.in_atomic_block,
    logger=logging.getLogger('curriculum_api.views'),
    open_cursor=lambda: _database_reads().connection.cursor(),
    rows_as_dicts=lambda cursor: _database_reads().rows_as_dicts(cursor),
):
    """Send independent authoring_fetch_all() reads to the database together.

    ``calls`` is ``[(args, kwargs), ...]``, exactly as the caller below will
    make them. Each result goes into the read scope under the key that call is
    memoised with, so the call itself then costs nothing. A builder's reads go
    out one round trip at a time, and from a remote database each round trip,
    not the rows, is most of what a programme build waits on; one
    multi-statement query sends them all and waits once.

    Only ever an optimisation: the SQL is authoring_select_sql()'s own, and a
    call whose key does not match what was prefetched -- arguments spelled
    differently, a batch that failed -- just reads as it always did. Outside
    a read scope, inside an atomic block (a failed statement there would poison
    the caller's transaction) or off PostgreSQL, nothing is sent.
    """
    memo = current_read_memo()
    if (
        memo is None or not CURRICULUM_BATCHED_READS
        or database_vendor() != 'postgresql' or in_atomic_block()
    ):
        return
    try:
        signature = inspect.signature(authoring_fetch_all.__wrapped__)
    except (AttributeError, TypeError, ValueError):
        return
    pending = {}
    for args, kwargs in calls:
        try:
            key = authoring_fetch_all.memo_key(*args, **kwargs)
            if key in memo or key in pending:
                continue
            bound = signature.bind(*args, **kwargs)
            bound.apply_defaults()
            options = bound.arguments
            query = authoring_select_sql(
                options['table'], options['where_sql'], options['order_sql'],
                ensure_tables=options['ensure_tables'], columns=options['columns'],
                exclude_columns=options['exclude_columns'],
            )
        except Exception:
            logger.debug('Skipping a curriculum read prefetch.', exc_info=True)
            continue
        pending[key] = (query, options['params'] or [], options['table'], options['columns'], options['exclude_columns'])
    if len(pending) < 2:
        # One read gains nothing from a batch; let the call make it.
        return
    results = []
    try:
        with open_cursor() as cursor:
            cursor.execute(
                '; '.join(query for query, *_ in pending.values()),
                [value for _query, params, *_ in pending.values() for value in params],
            )
            while True:
                results.append(rows_as_dicts(cursor))
                if not cursor.nextset():
                    break
    except Exception:
        logger.warning('Batched curriculum reads failed; they will be read one by one.', exc_info=True)
        return
    if len(results) != len(pending):
        logger.warning('Batched curriculum reads returned %s results for %s reads; they will be read one by one.',
                       len(results), len(pending))
        return
    for (key, (_query, _params, table, columns, exclude_columns)), rows in zip(pending.items(), results):
        # Same completion authoring_fetch_all() applies, so a prefetched read and
        # a direct one hand callers identical rows.
        memo.setdefault(key, complete_authoring_rows(table, rows, columns, exclude_columns))
