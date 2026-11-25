"""Assigned module SQL for tutor workspace; exact existing joins, OTJH expression and ordering."""


def tutor_workspace_module_rows(
    module_ids, *, connection, module_expected_otjh_sql, authoring_table_name,
    AUTHORING_MODULES_TABLE, COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE, rows_as_dicts,
    authoring_fetch_all,
):
    placeholders = ', '.join(['%s'] * len(module_ids))
    if connection.vendor == 'postgresql':
        # Compute expected OTJH from active components; the stored
        # total_otjh column is being removed (see drop_module_total_otjh.sql).
        with connection.cursor() as cursor:
            cursor.execute(
                f'SELECT m.module_catalogue_id,m.title,m.description,'
                f"coalesce(p.name,'') AS programme_name,coalesce(c.cohort_name,'') AS cohort_name,"
                f"coalesce(g.group_name,'') AS group_name,m.color,m.sessions_number,"
                f'm.start_date,m.end_date,m.session_week_day,m.session_start_time,m.session_end_time,'
                f'{module_expected_otjh_sql("m")} AS total_otjh'
                f' FROM {authoring_table_name(AUTHORING_MODULES_TABLE)} m'
                f' LEFT JOIN {authoring_table_name("programmes")} p ON p.programme_id = m.programme_id'
                f' LEFT JOIN {authoring_table_name(COHORT_AUTHORING_DETAILS_TABLE)} c ON c.cohort_id = m.cohort_id'
                f' LEFT JOIN {authoring_table_name(GROUPS_TABLE)} g ON g.group_id = m.group_id'
                f' WHERE m.module_catalogue_id IN ({placeholders})'
                f' ORDER BY m.start_date,m.title',
                module_ids,
            )
            module_rows = rows_as_dicts(cursor)
    else:
        module_rows = authoring_fetch_all(
            AUTHORING_MODULES_TABLE,
            f'module_catalogue_id in ({placeholders})',
            module_ids,
            'start_date, title',
        )
    return module_rows
