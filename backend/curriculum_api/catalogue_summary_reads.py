"""Lossless grouped inputs for the compact module catalogue only."""
from . import ksb_mapping_placement, views


def grouped_catalogue_content_rows():
    """Return repeated component facts once, and duplicate mapping facts once.

    Hours remain unrounded input values: the caller applies the same per-item
    rounding before multiplying by row_count. Keep live titles and week ids so
    repeated titles, missing weeks and multiple sessions per week remain exact.
    The archive state (status) stays available to the Python predicates.
    """
    table = views.AUTHORING_COMPONENTS_TABLE
    where, params = views.live_authoring_rows_sql(table)
    fields = [field for field in ('module_catalogue_id', 'week_id', 'type', 'expected_otjh', 'status')
              if views.has_column(table, field)]
    selections = [views.quote_ident(field) for field in fields]
    # normalise_component_type only changes '-' to '_'; no case/space folding.
    title = "case when type in ('live_session', 'live-session') then title else null end"
    query = (
        f'select {", ".join(selections)}, {title} as title, count(*) as row_count '
        f'from {views.authoring_table_name(table)}'
        + (f' where {where}' if where else '')
        + f' group by {", ".join(selections)}, {title}'
    )
    components = views.active_component_rows(views.fetch_all(query, params))

    table = views.AUTHORING_KSB_MAPPINGS_TABLE
    # A mapping's module and code come through the mapping relation (its
    # component's module, its standard KSB's code), and 'status' is its archive
    # state -- the same read ksb_stats_reads makes.
    candidates = ('module_catalogue_id', 'ksb_code', 'status')
    fields = [field for field in candidates if ksb_mapping_placement.can_select(table, field)]
    # Distinct raw keys first; the existing trim/archive logic still runs in Python.
    mappings = views.active_mapping_rows(views.fetch_all(
        f'select distinct {", ".join(views.quote_ident(field) for field in fields)} '
        f'from {ksb_mapping_placement.read_source(table)}',
    ))
    return components, mappings
