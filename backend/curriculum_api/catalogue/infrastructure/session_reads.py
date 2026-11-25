"""Bounded authored-session input reads through the existing read adapter."""


def module_rows(ids, *, authoring_fetch_all, modules_table):
    placeholders = ','.join(['%s'] * len(ids))
    return authoring_fetch_all(modules_table, f'module_catalogue_id in ({placeholders})', ids)


def group_rows(ids, *, authoring_fetch_all, groups_table):
    placeholders = ','.join(['%s'] * len(ids))
    return authoring_fetch_all(groups_table, f'group_id in ({placeholders})', ids)


def week_rows(ids, *, authoring_fetch_all, weeks_table):
    placeholders = ','.join(['%s'] * len(ids))
    return authoring_fetch_all(
        weeks_table, f'module_catalogue_id in ({placeholders})', ids,
        'module_catalogue_id, display_order, week_number, id',
    )


def component_rows(ids, *, authoring_fetch_all, components_table, live_session_type_sql):
    placeholders = ','.join(['%s'] * len(ids))
    return authoring_fetch_all(
        components_table, f'module_catalogue_id in ({placeholders}) and {live_session_type_sql}',
        ids, 'module_catalogue_id, week_id, display_order, id',
        exclude_columns=('ksb_mappings',),
    )
