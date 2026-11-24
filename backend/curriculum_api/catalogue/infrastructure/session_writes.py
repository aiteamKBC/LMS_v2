"""Authored session rows and required staffing reads on the caller storage adapters."""
from ..application.staff_assignment_writes import StaffingSourceUnavailable


def read_session_plan_rows(
    catalogue_id, *, AUTHORING_COMPONENTS_TABLE, AUTHORING_WEEKS_TABLE, active_component_rows,
    active_week_rows, authoring_fetch_all,
):
    week_rows = active_week_rows(authoring_fetch_all(
        AUTHORING_WEEKS_TABLE, 'module_catalogue_id = %s', [catalogue_id],
        'display_order, week_number, id',
    ))
    component_rows = active_component_rows(authoring_fetch_all(
        AUTHORING_COMPONENTS_TABLE, 'module_catalogue_id = %s', [catalogue_id],
        'display_order, id',
    ))
    return week_rows, component_rows


def write_session_settings(
    component_id, planned_settings, now, *, AUTHORING_COMPONENTS_TABLE, json_db_value,
    update_authoring_rows,
):
    update_authoring_rows(
        AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id],
        {'settings_json': json_db_value(planned_settings), 'updated_at': now},
    )


def read_staffing_module_ids(group_id, *, AUTHORING_MODULES_TABLE, authoring_fetch_all, clean_str):
    try:
        rows = authoring_fetch_all(AUTHORING_MODULES_TABLE)
    except Exception as exc:
        raise StaffingSourceUnavailable('Module assignments unavailable.') from exc
    return [
        clean_str(row.get('module_catalogue_id'))
        for row in rows
        if clean_str(row.get('group_id')) == group_id and row.get('module_catalogue_id')
    ]
