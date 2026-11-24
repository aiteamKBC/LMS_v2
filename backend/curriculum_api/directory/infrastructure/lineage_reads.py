"""Narrow catalogue placement reads with existing canonical and derived-name columns."""


def placement_rows(
    scope, identifiers, *, AUTHORING_MODULES_TABLE, COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE,
    column_names, NAME_FIELDS, DatabaseError, authoring_fetch_all,
):
    table, id_column = {
        'module': (AUTHORING_MODULES_TABLE, 'module_catalogue_id'),
        'cohort': (COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id'),
        'group': (GROUPS_TABLE, 'group_id'),
    }[scope]
    columns = [id_column, 'programme_id', 'programme_name', 'cohort_id', 'cohort_name', 'group_id', 'group_name']
    if scope == 'module':
        columns.append('learner_roster_mode')
    # Names are not columns: they come with the read, from the rows the ids name.
    available = set(column_names(table)) | set(NAME_FIELDS.get(table, ()))
    columns = tuple(dict.fromkeys(column for column in columns if column in available))
    if id_column not in columns:
        raise DatabaseError('Curriculum placement is unavailable.')
    rows = authoring_fetch_all(
        table, f'{id_column} in ({", ".join(["%s"] * len(identifiers))})', identifiers,
        columns=columns, ensure_tables=False,
    )
    return id_column, rows
