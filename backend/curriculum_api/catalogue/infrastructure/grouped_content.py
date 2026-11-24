"""Grouped component and normalized KSB mapping SQL for compact catalogue reads."""
from ..domain.content_values import active_component_rows
from ..domain.archive_policy import active_mapping_rows
from . import database_reads
from .authoring_sql import live_authoring_rows_sql
from .ksb_read_store import can_select as mapping_can_select, read_source as mapping_read_source


def grouped_catalogue_content_rows():
    """Return repeated component facts once, and duplicate mapping facts once.

    Hours remain unrounded input values: the caller applies the same per-item
    rounding before multiplying by row_count. Keep live titles and week ids so
    repeated titles, missing weeks and multiple sessions per week remain exact.
    The archive state (status) stays available to the Python predicates.
    """
    table = database_reads.AUTHORING_COMPONENTS_TABLE
    where, params = live_authoring_rows_sql(table)
    fields = [field for field in ('module_catalogue_id', 'week_id', 'type', 'expected_otjh', 'status')
              if database_reads.has_column(table, field)]
    selections = [database_reads.quote_ident(field) for field in fields]
    # normalise_component_type only changes '-' to '_'; no case/space folding.
    title = "case when type in ('live_session', 'live-session') then title else null end"
    query = (
        f'select {", ".join(selections)}, {title} as title, count(*) as row_count '
        f'from {database_reads.authoring_table_name(table)}'
        + (f' where {where}' if where else '')
        + f' group by {", ".join(selections)}, {title}'
    )
    components = active_component_rows(database_reads.fetch_all(query, params))

    table = database_reads.AUTHORING_KSB_MAPPINGS_TABLE
    # A mapping's module and code come through the mapping relation (its
    # component's module, its standard KSB's code), and 'status' is its archive
    # state -- the same read ksb_stats_reads makes.
    candidates = ('module_catalogue_id', 'ksb_code', 'status')
    fields = [field for field in candidates if mapping_can_select(table, field)]
    # Distinct raw keys first; the existing trim/archive logic still runs in Python.
    mappings = active_mapping_rows(database_reads.fetch_all(
        f'select distinct {", ".join(database_reads.quote_ident(field) for field in fields)} '
        f'from {mapping_read_source(table)}',
    ))
    return components, mappings
