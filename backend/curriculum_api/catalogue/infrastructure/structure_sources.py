"""The six scoped row reads shared by structure payloads and their revisions.

Storage routing and compact transport are supplied by the existing adapter.
"""


def module_structure_source_rows(
    module_catalogue_id,
    *,
    compact_authoring_rows,
    AUTHORING_WEEKS_TABLE,
    AUTHORING_COMPONENTS_TABLE,
    AUTHORING_KSB_MAPPINGS_TABLE,
    STRUCTURE_REVISION_SOURCES,
):
    """Every row one module's structure is built from, one read per table.

    The rows a structure payload and its revision are both computed from, so
    the two describe the same moment. The structure GET, the changes feed and
    the item-merging save all read through this.
    """
    orders = {
        AUTHORING_WEEKS_TABLE: 'display_order, week_number, id',
        AUTHORING_COMPONENTS_TABLE: 'display_order, id',
        AUTHORING_KSB_MAPPINGS_TABLE: 'created_at, id',
    }
    return {
        table: compact_authoring_rows(
            table, 'module_catalogue_id = %s', [module_catalogue_id], orders.get(table, sort_column),
            reuse_unchanged=table in (AUTHORING_COMPONENTS_TABLE, AUTHORING_KSB_MAPPINGS_TABLE),
        ) for _label, table, _keep, sort_column in STRUCTURE_REVISION_SOURCES
    }
