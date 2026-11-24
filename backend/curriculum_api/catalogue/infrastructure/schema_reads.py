"""Infrastructure schema reads. Explicit read capabilities preserve legacy contracts."""

from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable


def learner_schema_table_exists(table, *, _LEARNER_SCHEMA_LOCK, _LEARNER_TABLES_PRESENT, connection):
    if connection.vendor != 'postgresql':
        return False
    if table in _LEARNER_TABLES_PRESENT:
        return True
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                select 1
                from information_schema.tables
                where table_schema = 'Learner' and table_name = %s
                limit 1
                ''',
                [table],
            )
            exists = bool(cursor.fetchone())
    except Exception as exc:
        raise CatalogueReadUnavailable(
            'Learner schema availability could not be verified. Please retry.',
            code='learner_schema_unavailable',
        ) from exc
    if exists:
        with _LEARNER_SCHEMA_LOCK:
            _LEARNER_TABLES_PRESENT.add(table)
    return exists


def learner_relation_exists(table, *, _LEARNER_RELATIONS_PRESENT, _LEARNER_SCHEMA_LOCK, connection):
    """``to_regclass('"Learner"."<table>"') is not null``, remembered once true.

    The same question the learner counts used to ask inline on every call; a
    failed probe raises to the caller exactly as the inline one did.
    """
    if table in _LEARNER_RELATIONS_PRESENT:
        return True
    with connection.cursor() as cursor:
        cursor.execute('select to_regclass(%s)', [f'"Learner"."{table}"'])
        exists = bool(cursor.fetchone()[0])
    if exists:
        with _LEARNER_SCHEMA_LOCK:
            _LEARNER_RELATIONS_PRESENT.add(table)
    return exists


def learner_schema_columns(
    table, *, LEARNER_SCHEMA_COLUMNS_TTL_SECONDS, _LEARNER_SCHEMA_COLUMNS, _LEARNER_SCHEMA_LOCK,
    connection, time,
):
    if connection.vendor != 'postgresql':
        return set()
    cached = _LEARNER_SCHEMA_COLUMNS.get(table)
    if cached and time.monotonic() - cached[0] < LEARNER_SCHEMA_COLUMNS_TTL_SECONDS:
        return set(cached[1])
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                '''
                select column_name
                from information_schema.columns
                where table_schema = 'Learner' and table_name = %s
                ''',
                [table],
            )
            columns = {row[0] for row in cursor.fetchall()}
    except Exception as exc:
        raise CatalogueReadUnavailable(
            'Learner schema columns could not be verified. Please retry.',
            code='learner_schema_unavailable',
        ) from exc
    # An empty answer is a missing table (or no privilege); ask again next time.
    if columns:
        with _LEARNER_SCHEMA_LOCK:
            _LEARNER_SCHEMA_COLUMNS[table] = (time.monotonic(), frozenset(columns))
    return columns


def table_exists(table, *, CURRICULUM_SCHEMA, _TABLE_EXISTS_CACHE, logger, schema_gate):
    # Cached because this runs on hot read paths and the schema does not change
    # under us; invalidate_curriculum_cache() clears it, as does a process restart.
    # A failed probe is deliberately not cached, so a transient error does not
    # pin a table to "missing" for the life of the process.
    cache_key = f'{CURRICULUM_SCHEMA}.{table}'
    if cache_key in _TABLE_EXISTS_CACHE:
        return _TABLE_EXISTS_CACHE[cache_key]
    try:
        # schema_gate owns the probe, so the gate and these read paths share one
        # answer instead of each asking information_schema the same question.
        # The first call there lists the schema once; after it, a table that
        # exists is answered without touching the database at all.
        exists = schema_gate.table_exists(table)
        _TABLE_EXISTS_CACHE[cache_key] = exists
        return exists
    except Exception as exc:
        raise CatalogueReadUnavailable('Curriculum schema availability could not be verified. Please retry.') from exc


def column_names(
    table, *, CURRICULUM_SCHEMA, _TABLE_COLUMNS_CACHE, columns_listed, connection, defaultdict, fetch_all,
    free_course_columns, mark_columns_listed, native_only, quote_ident,
):
    if native_only():
        if table in free_course_columns():
            return {name for name, _ in free_course_columns()[table]}
    cache_key = f'{CURRICULUM_SCHEMA}.{table}'
    if cache_key in _TABLE_COLUMNS_CACHE:
        return _TABLE_COLUMNS_CACHE[cache_key]

    if connection.vendor == 'postgresql':
        if not columns_listed():
            # The first miss in a process lists every curriculum table's columns
            # in one query. A cold process used to ask once per table -- a dozen
            # trips to the remote database (~4 s) before a programme page's first
            # build could start. The answer per table is the same query's: the
            # same view, filtered the same way. Only the first miss lists: a key
            # dropped later (after an ALTER) and a table the listing did not name
            # are asked about on their own below, exactly as before.
            listed = defaultdict(set)
            for row in fetch_all(
                'select table_name, column_name from information_schema.columns where table_schema = %s',
                [CURRICULUM_SCHEMA],
            ):
                listed[row['table_name']].add(row['column_name'])
            for name, names in listed.items():
                _TABLE_COLUMNS_CACHE.setdefault(f'{CURRICULUM_SCHEMA}.{name}', names)
            mark_columns_listed()
            if cache_key in _TABLE_COLUMNS_CACHE:
                return _TABLE_COLUMNS_CACHE[cache_key]
        rows = fetch_all(
            '''
            select column_name
            from information_schema.columns
            where table_schema = %s and table_name = %s
            ''',
            [CURRICULUM_SCHEMA, table],
        )
        names = {row['column_name'] for row in rows}
    else:
        with connection.cursor() as cursor:
            cursor.execute(f'pragma table_info({quote_ident(table)})')
            names = {row[1] for row in cursor.fetchall()}
    _TABLE_COLUMNS_CACHE[cache_key] = names
    return names
