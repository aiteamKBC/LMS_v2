"""Shared, ordered facts for the programme workspace's two module builders."""


def programme_structure_child_rows(module_ids):
    from . import views
    from .authoring_read_transport import compact_authoring_rows

    ids = sorted({views.clean_str(value) for value in module_ids if views.clean_str(value)})
    if not ids:
        return {'components': [], 'mappings': []}
    scope = f'module_catalogue_id in ({", ".join(["%s"] * len(ids))})'

    def read(table, order, columns=None):
        # These SQL filters exclude only rows the existing active_* predicates
        # already reject. Keep those Python predicates in the builders as well.
        live, params = views.live_authoring_rows_sql(table, ('deleted_at', 'is_programme_deleted'))
        where = f'({scope}) and ({live})' if live else scope
        return compact_authoring_rows(table, where, [*ids, *params], order, columns=columns, reuse_unchanged=True)

    return {
        'components': read(views.AUTHORING_COMPONENTS_TABLE, 'display_order, id', views.CATALOGUE_SUMMARY_COMPONENT_COLUMNS),
        'mappings': read(views.AUTHORING_KSB_MAPPINGS_TABLE, 'created_at, id'),
    }
