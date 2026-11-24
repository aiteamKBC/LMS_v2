"""Staff directory SQL reads; identity sources remain distinct."""
from ..application.staff_profiles import StaffDirectoryUnavailable

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def read_assignment_source(*, module_index_rows, authoring_fetch_all,
                           get_program_config_rows, groups_table, groups_order,
                           cohorts_table, cohorts_order):
    """Required assignment rows: no schema provisioning or failure-to-empty reads."""
    try:
        return {
            'modules': module_index_rows(ensure_tables=False),
            'groups': authoring_fetch_all(groups_table, order_sql=groups_order, ensure_tables=False),
            'cohorts': authoring_fetch_all(cohorts_table, order_sql=cohorts_order, ensure_tables=False),
            'programmes': get_program_config_rows(),
        }
    except Exception as exc:
        raise StaffDirectoryUnavailable('Staff assignments unavailable.') from exc


def read_staff_profile_rows(role, include_archived=False, *, enrolment_available,
                            fetch_staff_users_by_access, staff_user_profile_source,
                            staff_profile_is_archived):
    """A failed/missing directory is unavailable, never an empty successful read."""
    if not enrolment_available:
        raise StaffDirectoryUnavailable('Staff directory unavailable.')
    try:
        rows = fetch_staff_users_by_access(role)
    except Exception as exc:
        raise StaffDirectoryUnavailable('Staff directory unavailable.') from exc
    profiles = [staff_user_profile_source(row, role) for row in rows]
    if not include_archived:
        profiles = [row for row in profiles if not staff_profile_is_archived(row)]
    return profiles


def read_curriculum_tutor_rows(*, connection, table_exists, table_name, fetch_all,
                               required=False):
    """Read the existing Module Builder identity source, without directory fallback."""
    try:
        if connection.vendor != 'postgresql' or not table_exists('tutors'):
            if required:
                raise StaffDirectoryUnavailable('Tutor catalogue unavailable.')
            return []
        return fetch_all(
            f'''select id, name, email, phone, status
            from {table_name('tutors')}
            order by lower(trim(coalesce(name, ''))), id'''
        )
    except Exception as exc:
        if not required:
            raise
        raise StaffDirectoryUnavailable('Tutor catalogue unavailable.') from exc


def staff_users_table_reference(connection_alias='enrolment', *, connections, quote_ident):
    db = connections[connection_alias]
    if db.vendor != 'postgresql':
        return quote_ident('Staff_users')
    return 'enrolment."Staff_users"'


def fetch_staff_users_by_access(
    access,
    *,
    STAFF_ACCESS_ROLES,
    STAFF_USER_ACCESS_COLUMNS,
    clean_str=_default_clean_str,
    connections,
    quote_ident,
    rows_as_dicts,
    staff_users_table_reference,
):
    access = clean_str(access).lower()
    if access not in STAFF_ACCESS_ROLES:
        raise ValueError('Unsupported staff access role.')
    if 'enrolment' not in connections:
        return []
    table = staff_users_table_reference('enrolment')
    columns_sql = ', '.join(quote_ident(column) for column in STAFF_USER_ACCESS_COLUMNS)
    query = f'''
        select {columns_sql}
        from {table}
        where lower(trim(coalesce("Access", ''))) = %s
        order by lower(trim(coalesce("Username", ''))), id
    '''
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(query, [access])
        return rows_as_dicts(cursor)
