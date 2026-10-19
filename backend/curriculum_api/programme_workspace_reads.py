"""Shared, ordered facts for the programme workspace's two module builders."""


def programme_structure_child_rows(module_ids):
    from . import views
    from .authoring_read_transport import compact_authoring_rows

    ids = sorted({views.clean_str(value) for value in module_ids if views.clean_str(value)})
    if not ids:
        return {'components': [], 'mappings': [], 'modules': [], 'weeks': []}
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
        # Both builders read these too, each for its own overlapping id list:
        # two module reads and two week reads of the same programme. Read once
        # for the union, unfiltered, exactly as get_authoring_structure_payloads
        # reads them; it takes its own ids from here. Weeks are in a total order
        # (id is unique), so each caller's slice is the sequence it read before.
        'modules': views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE, scope, ids),
        'weeks': views.authoring_fetch_all(views.AUTHORING_WEEKS_TABLE, scope, ids, 'display_order, week_number, id'),
    }
