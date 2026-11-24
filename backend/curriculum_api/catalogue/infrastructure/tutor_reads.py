"""Required facts for availability previews; failed reads never mean empty data."""
from ..application.tutor_availability import TutorAvailabilityUnavailable


def read_module_rows(*, authoring_fetch_all, table):
    try:
        return authoring_fetch_all(table, ensure_tables=False)
    except Exception as exc:
        raise TutorAvailabilityUnavailable('Module schedules unavailable.') from exc


def read_group_rows(*, authoring_fetch_all, table, order_sql, clean_str):
    try:
        rows = authoring_fetch_all(table, order_sql=order_sql, ensure_tables=False)
    except Exception as exc:
        raise TutorAvailabilityUnavailable('Group schedules unavailable.') from exc
    return {
        clean_str(row.get('group_id')): row
        for row in rows or []
        if clean_str(row.get('group_id'))
    }


def read_tutor_rows(
    *, fetch_staff_users_by_access, staff_user_profile_source,
    staff_profile_is_archived, enrolment_available,
):
    if not enrolment_available:
        raise TutorAvailabilityUnavailable('Staff directory unavailable.')
    try:
        rows = fetch_staff_users_by_access('tutor')
    except Exception as exc:
        raise TutorAvailabilityUnavailable('Staff directory unavailable.') from exc
    profiles = [staff_user_profile_source(row, 'tutor') for row in rows]
    return [row for row in profiles if not staff_profile_is_archived(row)]
