"""Single and batched free-course SQL reads through the existing schema strategy.

The injected legacy setup callback retains its original timing and capabilities."""


def free_programme_fetch_all(
    table, where_sql='', params=None, order_sql='', columns=None, *, connection,
    free_programme_select_sql, rows_as_dicts,
):
    """Free-course rows. `columns` names the ones to read.

    Default is every column, which is what the payload builders want. Callers
    that only need identifiers should name them: free_course_weeks.
    cover_image_url and free_courses.cover_image_url hold base64 `data:` image
    payloads on some rows -- hundreds of kilobytes each -- and a `select *` for
    an id list drags all of them across the wire.
    """
    query = free_programme_select_sql(table, where_sql, order_sql, columns)
    with connection.cursor() as cursor:
        cursor.execute(query, params or [])
        return rows_as_dicts(cursor)


def free_programme_select_sql(
    table, where_sql='', order_sql='', columns=None, *, ensure_free_programme_tables, free_read_table,
    quote_ident,
):
    """The SELECT free_programme_fetch_all() runs for these arguments."""
    ensure_free_programme_tables()
    selection = ', '.join(quote_ident(column) for column in columns) if columns else '*'
    query = f'select {selection} from {free_read_table(table)}'
    if where_sql:
        query += f' where {where_sql}'
    if order_sql:
        query += f' order by {order_sql}'
    return query


def free_programme_fetch_many(
    reads, *, CURRICULUM_BATCHED_READS, DatabaseError, connection, free_programme_fetch_all,
    free_programme_select_sql, rows_as_dicts,
):
    """Several free-course reads in one database round trip.

    ``reads`` is ``[(table, where_sql, params, order_sql, columns), ...]``; the
    result is one row list per read, in order. On PostgreSQL the statements go
    out as one multi-statement query (see CURRICULUM_BATCHED_READS): from a
    remote database the round trips, not the rows, are most of what these
    endpoints wait on. Elsewhere, or with batching off, they run one by one.
    """
    reads = list(reads)
    if len(reads) < 2 or connection.vendor != 'postgresql' or not CURRICULUM_BATCHED_READS:
        return [free_programme_fetch_all(table, where_sql, params, order_sql, columns=columns)
                for table, where_sql, params, order_sql, columns in reads]
    queries = [free_programme_select_sql(table, where_sql, order_sql, columns)
               for table, where_sql, _params, order_sql, columns in reads]
    results = []
    with connection.cursor() as cursor:
        cursor.execute('; '.join(queries), [value for read in reads for value in (read[2] or [])])
        while True:
            results.append(rows_as_dicts(cursor))
            if not cursor.nextset():
                break
    if len(results) != len(reads):
        raise DatabaseError(f'Batched free-course reads returned {len(results)} results for {len(reads)} reads.')
    return results
