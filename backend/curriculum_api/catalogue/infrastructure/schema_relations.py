"""Concrete SQL relations and schema introspection; no legacy imports."""


def _qualified(table, *, connection):
    if connection.vendor != 'postgresql':
        return f'"{table}"'
    return f'"curriculum"."{table}"'


def _internal(table, *, connection):
    """A table reference adapt_sql never rewrites (``ONLY`` -- these tables have
    no inheritance, so it reads exactly the same rows). Used inside the read
    relation and this module's own queries, so a statement is adapted once."""
    if connection.vendor != 'postgresql':
        return f'"{table}"'
    return f'only "curriculum"."{table}"'


def legacy_read_columns(
    table, columns, *, DERIVED_COLUMNS, RELATION_TABLES, _LINKED_FREE_WEEK_FIELDS, _lifecycle_select,
    _linked_free_week_shape, connection, is_normalised,
):
    """Legacy column names the read relation adds for ``table`` (absent from ``columns``)."""
    columns = set(columns or ())
    if connection.vendor == 'postgresql' and _linked_free_week_shape(table, columns):
        return [name for name in _LINKED_FREE_WEEK_FIELDS if name not in columns]
    if connection.vendor != 'postgresql' or table not in RELATION_TABLES or not is_normalised(table, columns):
        return []
    keep = []
    for expression in _lifecycle_select(table, columns):
        name = expression.rsplit(' as ', 1)[-1].strip('"')
        if name not in columns:
            keep.append(name)
    keep += [key for key in DERIVED_COLUMNS.get(table, ()) if key not in columns and key != 'ksb_mappings']
    return keep


def columns_of(schema, table, *, _COLUMNS_CACHE, connection, read_curriculum_columns):
    """Column names of ``schema.table`` (cached per process; empty off PostgreSQL)."""
    key = (schema, table)
    if key in _COLUMNS_CACHE:
        return _COLUMNS_CACHE[key]
    if connection.vendor != 'postgresql':
        return set()
    if schema == 'curriculum':
        # One answer per table: views.column_names keeps the curriculum cache
        # (cleared with the curriculum caches), so the two never both ask.
        return set(read_curriculum_columns(table))
    with connection.cursor() as cursor:
        cursor.execute(
            'select column_name from information_schema.columns where table_schema = %s and table_name = %s',
            [schema, table],
        )
        names = {row[0] for row in cursor.fetchall()}
    if names:
        _COLUMNS_CACHE[key] = names
    return names


def relation_sql(table, *, _qualified, columns_of, read_relation):
    """FROM-clause text for hand-written curriculum reads: the legacy-shaped
    read relation on the normalised schema, else the plain table. The caller
    adds its own alias: ``f'from {relation_sql("modules")} m'``."""
    relation = read_relation(table, columns_of('curriculum', table), alias=False)
    return relation or _qualified(table)


def read_relation(
    table, columns, alias=True, defer=(), *, DERIVED_COLUMNS, RELATION_TABLES, _LINKED_FREE_WEEK_FIELDS,
    _internal, _lifecycle_select, _linked_free_week_shape, connection, is_normalised,
):
    """``(select ...) as "<table>"`` exposing legacy columns, or None on the legacy shape.

    ``defer`` names legacy columns to leave out (see PYTHON_DERIVED_COLUMNS):
    the caller derives them after the fetch.
    """
    columns = set(columns or ())
    if connection.vendor == 'postgresql' and _linked_free_week_shape(table, columns):
        extra = [f'{expression} as "{name}"' for name, expression in _LINKED_FREE_WEEK_FIELDS.items()
                 if name not in columns and name not in defer]
        selection = ', '.join(['t.*', *extra])
        result = (f'(select {selection} from {_internal(table)} t '
                  f'left join {_internal("free_courses")} fc on fc.id = t.course_id '
                  f'left join {_internal("weeks")} fw on fw.id = t.week_id)')
        return result + (f' as "{table}"' if alias else '')
    if connection.vendor != 'postgresql' or table not in RELATION_TABLES or not is_normalised(table, columns):
        return None
    q = _internal
    t = 't'
    extra = [expr for expr in _lifecycle_select(table, columns, t)
             if expr.rsplit(' as ', 1)[-1].strip('"') not in columns]
    joins = []

    def add(name, expression):
        if name not in columns and name not in defer:
            extra.append(f'{expression} as "{name}"')

    for output, source, key, label in (
        ('programme_name', 'programmes', 'programme_id', 'name'),
        ('cohort_name', 'cohorts', 'cohort_id', 'cohort_name'),
        ('group_name', 'groups', 'group_id', 'group_name'),
    ):
        if output in DERIVED_COLUMNS.get(table, ()) and key in columns:
            add(output, f"coalesce((select placement.{label} from {q(source)} placement "
                        f"where placement.{key} = {t}.{key}), '')::varchar")

    if table == 'ksb_mappings':
        joins.append(f'left join {q("components")} cc on cc.id = {t}.component_id')
        joins.append(f'left join {q("standard_ksbs")} sk on sk.id = {t}.standard_ksb_id')
        add('module_catalogue_id', "coalesce(cc.module_catalogue_id, '')::varchar")
        add('week_id', 'cc.week_id')
        add('ksb_code', "coalesce(sk.ksb_code, '')::varchar")
        add('ksb_description', 'sk.ksb_description')
    elif table in {'weeks', 'components'}:
        if table == 'weeks':
            # Canonical weeks always belong to a normal module. Free Course
            # weeks have their own table and never imply a reusable-library row.
            add('library_state', "''::varchar")
        else:
            add('library_state', "''::varchar")
        add('detached_at', 'null::timestamptz')
        add('origin_module_catalogue_id', "''::varchar")
        add('origin_week_id', "''::varchar")
        add('origin_module_title', "''::text")
        add('origin_week_label', "''::text")
    if not extra:
        return None
    body = f'(select {t}.*, ' + ', '.join(extra) + f' from {q(table)} {t} ' + ' '.join(joins) + ')'
    return f'{body} as "{table}"' if alias else body
