"""Existing component aggregate SQL with explicit legacy setup and transport dependencies."""


from collections import Counter

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from .component_count_sql import component_count_source


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
    """Count visible components using their owning store's archive columns.

    A failed read must not become zero counts used to rank module candidates.
    Existing callers own error handling and the surrounding transaction.
    """
    counts = Counter()
    ensure_module_authoring_tables()
    clauses = [f"coalesce({quote_ident('module_catalogue_id')}, '') <> ''"]
    params = []
    deleted = deleted_sql_condition(AUTHORING_COMPONENTS_TABLE)
    source, visible = component_count_source(
        learning_read_table(AUTHORING_COMPONENTS_TABLE),
        f'not ({deleted})' if deleted != 'false' else '',
    )
    if visible:
        clauses.append(visible)
    retired = sorted(RETIRED_COMPONENT_TYPES)
    if retired:
        placeholders = ', '.join(['%s'] * len(retired))
        clauses.append(f'type not in ({placeholders})')
        params.extend(retired)
    rows = fetch_all(
        f'select {quote_ident("module_catalogue_id")} as catalogue_id, count(*) as total '
        f'from {source} '
        f'where {" and ".join(clauses)} '
        f'group by {quote_ident("module_catalogue_id")}',
        params,
    )
    for row in rows:
        catalogue_id = clean_str(row.get('catalogue_id'))
        if catalogue_id:
            counts[catalogue_id] = parse_int(row.get('total'), 0)
    return counts
