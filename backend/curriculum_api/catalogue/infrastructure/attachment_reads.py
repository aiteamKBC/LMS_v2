"""Existing component aggregate SQL with explicit legacy setup and transport dependencies."""


from collections import Counter

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def authoring_component_counts_by_catalogue(
    *,
    AUTHORING_COMPONENTS_TABLE,
    RETIRED_COMPONENT_TYPES,
    clean_str=_default_clean_str,
    deleted_sql_condition,
    ensure_module_authoring_tables,
    fetch_all,
    learning_read_table,
    logger,
    parse_int=_default_parse_int,
    quote_ident,
):
    """How many live components each module has, counted in the database.

    This used to read every column of every component row - 39 MB and ~175 s
    against the remote database - and then throw all of it away except the
    module id. The predicate below is the SQL form of ``active_component_rows``:
    not soft-deleted, not detached into the library, and not a retired type.
    """
    counts = Counter()
    try:
        ensure_module_authoring_tables()
        clauses = [f"coalesce({quote_ident('module_catalogue_id')}, '') <> ''"]
        params = []
        deleted = deleted_sql_condition(AUTHORING_COMPONENTS_TABLE)
        if deleted != 'false':
            clauses.append(f'not ({deleted})')
        retired = sorted(RETIRED_COMPONENT_TYPES)
        if retired:
            placeholders = ', '.join(['%s'] * len(retired))
            clauses.append(f'type not in ({placeholders})')
            params.extend(retired)
        rows = fetch_all(
            f'select {quote_ident("module_catalogue_id")} as catalogue_id, count(*) as total '
            f'from {learning_read_table(AUTHORING_COMPONENTS_TABLE)} '
            f'where {" and ".join(clauses)} '
            f'group by {quote_ident("module_catalogue_id")}',
            params,
        )
        for row in rows:
            catalogue_id = clean_str(row.get('catalogue_id'))
            if catalogue_id:
                counts[catalogue_id] = parse_int(row.get('total'), 0)
    except Exception:
        logger.debug('Unable to count authoring components by module.', exc_info=True)
    return counts
