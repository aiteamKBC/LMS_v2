"""Bounded library SQL reads and parent lookup; no global Django connection."""

# Matches Python str.strip(), including non-ASCII whitespace.
_PYTHON_STRIP_CHARACTERS = '\t\n\x0b\x0c\r\x1c\x1d\x1e\x1f \x85\xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000'

from curriculum_api.catalogue.domain.component_types import normalise_component_type as _default_normalise_component_type
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def library_component_where(
    *,
    search='',
    types=None,
    origins=None,
    ids=None,
    AUTHORING_COMPONENTS_TABLE,
    LIBRARY_ORIGINS,
    LIBRARY_ORIGIN_ACTIVE,
    LIBRARY_ORIGIN_ARCHIVED,
    LIBRARY_ORIGIN_LIBRARY,
    RETIRED_COMPONENT_TYPES,
    clean_str=_default_clean_str,
    deleted_sql_condition,
    normalise_component_type=_default_normalise_component_type,
):
    """The SQL predicate for a library search. Everything filters in the database.

    Origin is expressed in SQL rather than in Python so that the LIMIT applies
    to the rows the caller actually asked for. The archive state separates
    active from archived; the detached ``library`` bucket is always empty.
    """
    clauses = []
    params = []
    wanted_ids = sorted({clean_str(value) for value in (ids or []) if clean_str(value)})
    if wanted_ids:
        placeholders = ', '.join(['%s'] * len(wanted_ids))
        clauses.append(f'id in ({placeholders})')
        params.extend(wanted_ids)
    search = clean_str(search).lower()
    if search:
        # lower(...) like ... rather than ilike, so the same SQL runs on the
        # SQLite test database as on Postgres.
        clauses.append(
            "(lower(coalesce(title, '')) like %s or lower(coalesce(description, '')) like %s)"
        )
        params.extend([f'%{search}%'] * 2)
    wanted_types = sorted({normalise_component_type(value) for value in (types or []) if clean_str(value)})
    if wanted_types:
        placeholders = ', '.join(['%s'] * len(wanted_types))
        clauses.append(f'type in ({placeholders})')
        params.extend(wanted_types)
    retired = sorted(RETIRED_COMPONENT_TYPES)
    if retired:
        # Retired types cannot be authored any more, so reusing one is a dead end.
        placeholders = ', '.join(['%s'] * len(retired))
        clauses.append(f'type not in ({placeholders})')
        params.extend(retired)

    wanted_origins = {clean_str(value).lower() for value in (origins or []) if clean_str(value)}
    wanted_origins = wanted_origins & set(LIBRARY_ORIGINS) if wanted_origins else set(LIBRARY_ORIGINS)
    if wanted_origins != set(LIBRARY_ORIGINS):
        # Nothing is ever detached, so the 'library' bucket matches no row.
        archived = deleted_sql_condition(AUTHORING_COMPONENTS_TABLE)
        origin_sql = {
            LIBRARY_ORIGIN_LIBRARY: '(1 = 0)',
            LIBRARY_ORIGIN_ARCHIVED: f'({archived})',
            LIBRARY_ORIGIN_ACTIVE: f'(not ({archived}))',
        }
        # No placeholders here on purpose: every fragment is built from module
        # constants, so there is nothing to bind and nothing to get out of order
        # with the clauses appended above.
        clauses.append('(' + (' or '.join(
            origin_sql[origin] for origin in sorted(wanted_origins) if origin in origin_sql
        ) or '1 = 0') + ')')
    return ' and '.join(clauses), params


def rows_for_ids(
    table,
    column,
    values,
    *,
    attach_curriculum_names,
    read_source,
    clean_str=_default_clean_str,
    fetch_all,
    quote_ident,
):
    """Fetch just the rows these ids name. No ids means no query at all."""
    wanted = sorted({clean_str(value) for value in (values or []) if clean_str(value)})
    if not wanted:
        return []
    placeholders = ', '.join(['%s'] * len(wanted))
    # Module rows carry their programme / cohort / group names, as on every read.
    return attach_curriculum_names(table, fetch_all(
        f'select * from {read_source(table)} where {quote_ident(column)} in ({placeholders})',
        wanted,
    ))


def read_library_component_page(*, search, types, programme_ids, origins, ids, page, page_size, detail,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_MODULES_TABLE,
    LIBRARY_LIST_COLUMNS,
    LIBRARY_PAGE_SIZE_DEFAULT,
    LIBRARY_PAGE_SIZE_MAX,
    authoring_table_name,
    clean_str,
    ensure_module_authoring_tables,
    database_vendor,
    fetch_all,
    has_column,
    learning_read_table,
    library_component_where,
    parse_int,
    quote_ident,
):
    ensure_module_authoring_tables()
    where_sql, params = library_component_where(search=search, types=types, origins=origins, ids=ids)
    wanted_programmes = sorted({clean_str(value) for value in (programme_ids or []) if clean_str(value)})
    if wanted_programmes:
        programme_placeholders = ', '.join(['%s'] * len(wanted_programmes))
        trim_function = 'btrim' if database_vendor() == 'postgresql' else 'trim'
        programme_predicate = (
            f'module_catalogue_id in (select module_catalogue_id from {authoring_table_name(AUTHORING_MODULES_TABLE)}'
            f" where {trim_function}(coalesce(programme_id, ''), %s) in ({programme_placeholders}))"
        )
        where_sql = f'({where_sql}) and ({programme_predicate})' if where_sql else programme_predicate
        params = [*params, _PYTHON_STRIP_CHARACTERS, *wanted_programmes]
    page = max(1, parse_int(page, 1))
    page_size = min(LIBRARY_PAGE_SIZE_MAX, max(1, parse_int(page_size, LIBRARY_PAGE_SIZE_DEFAULT)))

    if detail:
        columns = '*'
    else:
        columns = ', '.join(
            quote_ident(column) for column in LIBRARY_LIST_COLUMNS
            if has_column(AUTHORING_COMPONENTS_TABLE, column)
        )
    query = f'select {columns} from {learning_read_table(AUTHORING_COMPONENTS_TABLE)}'
    if where_sql:
        query += f' where {where_sql}'
    query += ' order by updated_at desc, display_order, id limit %s offset %s'
    return fetch_all(query, [*params, page_size, (page - 1) * page_size])
