"""Lossless authoring SQL transport and database-verified row reuse.

No framework/legacy imports or schema provisioning. The compatibility adapter
supplies the cursor, source routing and ordinary reader; snapshots are local.
"""
from copy import deepcopy
import hashlib
from . import authoring_row_snapshots as snapshots
from .authoring_row_snapshots import _FINGERPRINT


def compact_authoring_rows(table, where_sql, params, order_sql, *, columns=None, reuse_unchanged=False,
                           available, connection, authoring_fetch_all, read_source, quote_ident,
                           rows_as_dicts, reflection_question_column):
    """Select the existing projection and use verified reuse only when it has IDs."""
    selected = [c for c in columns if c in available] if columns else sorted(available)
    reader = read_verified_rows if reuse_unchanged and 'id' in selected else _compact_rows
    return reader(
        table, where_sql, params, order_sql, selected,
        connection=connection, authoring_fetch_all=authoring_fetch_all, read_source=read_source,
        quote_ident=quote_ident, rows_as_dicts=rows_as_dicts, reflection_question_column=reflection_question_column,
    )


def _compact_rows(table, where_sql, params, order_sql, selected, *, fingerprint_sql=None,
                  connection, authoring_fetch_all, read_source, quote_ident, rows_as_dicts, reflection_question_column):
    shared = [c for c in ('description', reflection_question_column, 'ksb_description', 'settings_json', 'ksb_mappings') if c in selected]
    if not shared and not fingerprint_sql:
        return authoring_fetch_all(table, where_sql, params, order_sql, columns=selected)
    quote = quote_ident
    ranks = {column: f'__text_rank_{index}' for index, column in enumerate(shared)}
    rank_sql = ', '.join(
        f'dense_rank() over (order by to_jsonb({quote(column)})::text collate "C") as {quote(rank)}'
        for column, rank in ranks.items()
    )
    result_fields = ', '.join(
        (f'case when row_number() over (partition by to_jsonb({quote(c)})::text collate "C" '
         f'order by {order_sql}) = 1 then {quote(c)} end as {quote(c)}')
        if c in ranks else quote(c) for c in selected
    )
    # Integer ranks avoid hashing/collisions; bytewise comparison keeps Unicode,
    # whitespace, null and empty values distinct regardless of database collation.
    # Send the native value only on its first occurrence in the result ordering.
    # In particular JSON columns keep the connection's normal JSON decoding.
    extras = [value for value in (rank_sql, fingerprint_sql) if value]
    query = (
        f'select {result_fields}{", " + ", ".join(extras) if extras else ""} '
        f'from {read_source(table)} where {where_sql} order by {order_sql}'
    )
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        rows = rows_as_dicts(cursor)
    if not rows:
        return []
    values = {c: {} for c in shared}
    for row in rows:
        for column in shared:
            rank = row.pop(ranks[column])
            value = values[column].setdefault(rank, row[column])
            row[column] = deepcopy(value) if isinstance(value, (dict, list)) else value
    return rows


def _fingerprint_sql(columns, *, quote_ident):
    # Text preserves even JSON whitespace, decimal scale and native SQL types:
    # the existing structureRevision fingerprints these original decoded rows.
    # Including types prevents a same-text schema conversion reusing old types.
    fields = ', '.join(
        f'row(pg_typeof({quote_ident(c)})::text, {quote_ident(c)}::text)'
        for c in columns
    )
    return f"encode(sha256(convert_to(to_jsonb(row({fields}))::text, 'UTF8')), 'hex')"


def read_verified_rows(table, where, params, order, columns, *,
                       connection, authoring_fetch_all, read_source, quote_ident, rows_as_dicts, reflection_question_column):
    key = snapshots._key(connection, table, where, params, order, columns)
    cached = snapshots._load(key)
    fingerprint = _fingerprint_sql(columns, quote_ident=quote_ident)
    fingerprint_field = f'{fingerprint} as {quote_ident(_FINGERPRINT)}'

    def fetch(scope=where, arguments=params):
        return _compact_rows(
            table, scope, arguments, order, columns, fingerprint_sql=fingerprint_field,
            connection=connection, authoring_fetch_all=authoring_fetch_all, read_source=read_source,
            quote_ident=quote_ident, rows_as_dicts=rows_as_dicts, reflection_question_column=reflection_question_column,
        )

    if cached is None:
        rows = fetch()
    else:
        # Usually no row changed. Compare one ordered set digest first, rather
        # than transferring thousands of (id, digest) pairs on every rebuild.
        # Row digests are fixed-width hex, so their concatenation is unambiguous.
        expected = hashlib.sha256(''.join(row[_FINGERPRINT] for row in cached).encode()).hexdigest()
        with connection.cursor() as cursor:
            cursor.execute(
                "select encode(sha256(convert_to(coalesce("
                f"string_agg({fingerprint}, '' order by {order}), ''), 'UTF8')), 'hex') "
                f'from {read_source(table)} where {where}', params,
            )
            current_digest = cursor.fetchone()[0]
        if current_digest == expected:
            return [{k: v for k, v in row.items() if k != _FINGERPRINT} for row in cached]
        with connection.cursor() as cursor:
            cursor.execute(
                f'select id, {fingerprint_field} from {read_source(table)} '
                f'where {where} order by {order}', params,
            )
            current = rows_as_dicts(cursor)
        by_id = {row['id']: row for row in cached}
        missing = [row['id'] for row in current
                   if by_id.get(row['id'], {}).get(_FINGERPRINT) != row[_FINGERPRINT]]
        if len(missing) > max(1000, len(current) // 2):
            # A wholesale rewrite is cheaper as one fresh snapshot than many
            # batches, and does not need any values from the cached snapshot.
            rows = fetch()
            snapshots._store(key, rows)
            return [{k: v for k, v in row.items() if k != _FINGERPRINT} for row in rows]
        if missing:
            fetched = []
            # Bound parameter count for a programme containing thousands of rows.
            for offset in range(0, len(missing), 1000):
                ids = missing[offset:offset + 1000]
                fetched.extend(fetch(
                    f'({where}) and id in ({", ".join(["%s"] * len(ids))})', [*params, *ids],
                ))
            by_id.update((row['id'], row) for row in fetched)
        # A writer may commit between the fingerprint and content SELECTs. Do
        # not combine different snapshots, or certify them with a revision.
        # A single fresh read is the safe fallback, never an unbounded retry.
        if any(by_id.get(row['id'], {}).get(_FINGERPRINT) != row[_FINGERPRINT] for row in current):
            rows = fetch()
        else:
            rows = [by_id[row['id']] for row in current]
    snapshots._store(key, rows)
    return [{k: v for k, v in row.items() if k != _FINGERPRINT} for row in rows]
