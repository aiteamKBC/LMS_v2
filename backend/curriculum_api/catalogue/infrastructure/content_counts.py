"""Concrete grouped lesson/KSB counts with normalized mapping projection."""
from collections import Counter, defaultdict

from curriculum_api.catalogue.domain.component_types import is_retired_component_type as _default_is_retired_component_type
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def authoring_module_content_counts(
    *, learning_read_table,
    clean_str=_default_clean_str,
    is_retired_component_type=_default_is_retired_component_type,
    parse_int=_default_parse_int,
):
    """``(lesson_counts, ksb_counts)`` per module catalogue id, without row reads.

    The same two figures authoring_catalogue_summaries() derives from every
    component and mapping row, grouped by the database instead: the live
    components of each module (retired types and detached rows excluded, as
    active_component_rows() excludes them) and the distinct KSB codes on its live
    mappings. A few hundred grouped rows cross the network instead of ~90k.
    """
    from . import database_reads, ksb_read_store as ksb_mapping_placement
    from .authoring_sql import live_authoring_rows_sql

    lesson_counts = Counter()
    where_sql, params = live_authoring_rows_sql(database_reads.AUTHORING_COMPONENTS_TABLE)
    group_columns = [
        database_reads.quote_ident(column)
        for column in ('module_catalogue_id', 'type')
        if database_reads.has_column(database_reads.AUTHORING_COMPONENTS_TABLE, column)
    ]
    query = (
        f'select {", ".join(group_columns)}, count(*) as {database_reads.quote_ident("row_count")} '
        f'from {learning_read_table(database_reads.AUTHORING_COMPONENTS_TABLE)}'
        + (f' where {where_sql}' if where_sql else '')
        + f' group by {", ".join(group_columns)}'
    )
    for row in database_reads.fetch_all(query, params):
        if is_retired_component_type(row.get('type')):
            continue
        lesson_counts[str(row.get('module_catalogue_id'))] += parse_int(row.get('row_count'), 0)

    ksb_codes = defaultdict(set)
    where_sql, params = live_authoring_rows_sql(database_reads.AUTHORING_KSB_MAPPINGS_TABLE)
    query = (
        f'select {database_reads.quote_ident("module_catalogue_id")}, {database_reads.quote_ident("ksb_code")} '
        f'from {ksb_mapping_placement.relation(include_description=False)}'
        + (f' where {where_sql}' if where_sql else '')
        + f' group by {database_reads.quote_ident("module_catalogue_id")}, {database_reads.quote_ident("ksb_code")}'
    )
    for row in database_reads.fetch_all(query, params):
        code = clean_str(row.get('ksb_code'))
        if code:
            ksb_codes[str(row.get('module_catalogue_id'))].add(code)
    return dict(lesson_counts), {catalogue_id: len(codes) for catalogue_id, codes in ksb_codes.items()}
