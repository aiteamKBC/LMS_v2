"""Concrete catalogue infrastructure operations; dependencies supplied by outer adapters."""
import json

# Shared bounded source projections; no detail content is loaded here.
_MODULE_FIELDS = (
    'module_catalogue_id', 'title', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
    'group_id', 'group_name', 'sessions_number', 'weeks_number', 'status', 'tutor_name',
    'start_date', 'end_date', 'weekly_schedule', 'weeklySchedule', 'deliveryMetadata', 'session_week_day', 'weekDays',
)
_GROUP_FIELDS = (
    'group_id', 'group_name', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
    'coach_name', 'status',
)
_COHORT_FIELDS = (
    'cohort_id', 'cohort_name', 'programme_id', 'programme_name', 'status', 'start_date', 'end_date',
)
_WEEK_FIELDS = ('module_catalogue_id', 'status')
_HOME_MODULE_FIELDS = (
    'module_catalogue_id', 'title', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
    'group_id', 'group_name', 'sessions_number', 'status', 'tutor_id', 'tutor_name', 'start_date', 'end_date',
    'source_id', 'source_type', 'updated_at',
)
_HOME_GROUP_FIELDS = (
    'group_id', 'group_name', 'programme_id', 'programme_name', 'cohort_id', 'cohort_name',
    'coach_name', 'status',
)
_HOME_COHORT_FIELDS = (
    'cohort_id', 'cohort_name', 'programme_id', 'programme_name', 'status', 'start_date', 'end_date',
)
_HOME_WEEK_FIELDS = ('module_catalogue_id', 'display_order', 'week_number', 'title')


def home_relationship_rows(
    *,
    include_weeks=False,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    _HOME_COHORT_FIELDS,
    _HOME_GROUP_FIELDS,
    _HOME_MODULE_FIELDS,
    _HOME_WEEK_FIELDS,
    authoring_fetch_all,
    authoring_table_name,
    connection,
    ensure_module_authoring_tables,
    fetch_all,
    get_ksb_profile_rows,
    get_program_config_rows,
    ksb_counts_selection,
    quote_ident
):
    sources = [
        ('modules', AUTHORING_MODULES_TABLE, _HOME_MODULE_FIELDS, ''),
        ('groups', GROUPS_TABLE, _HOME_GROUP_FIELDS, ''),
        ('cohorts', COHORT_AUTHORING_DETAILS_TABLE, _HOME_COHORT_FIELDS, ''),
    ]
    if include_weeks:
        sources.append(('weeks', AUTHORING_WEEKS_TABLE, _HOME_WEEK_FIELDS, ''))
    if connection.vendor != 'postgresql':
        # Test databases only. They carry no KSB mapping read view, so no
        # module counts as mapped there.
        return {
            **{name: authoring_fetch_all(table, columns=fields) for name, table, fields, _ in sources},
            'program_configs': get_program_config_rows(), 'ksb_profiles': get_ksb_profile_rows(),
            'ksb_counts': {},
        }
    ensure_module_authoring_tables()
    # Preserve the exact programme/profile order used by the ordinary readers.
    sources.append(('program_configs', 'programmes', None,
                    "coalesce((to_jsonb(source_row)->>'display_order')::numeric, 0), name"))
    # KSB profiles were retired; Home reads standard-backed KSB counts only.
    # Do not probe the removed table on every cold request.
    # One database round trip, and one consistent statement snapshot. Selecting
    # keys from JSON handles optional legacy columns without three schema probes.
    # Table names and aliases are server constants; keys are bound parameters.
    selections = []
    params = []
    for name, table, fields, ordering in sources:
        expression = 'to_jsonb(source_row)'
        if fields is not None:
            expression = '(select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(source_row)) where key = any(%s))'
            params.append(list(fields))
        order_sql = f' order by {ordering}' if ordering else ''
        selections.append(
            f'(select coalesce(jsonb_agg({expression}{order_sql}), \'[]\'::jsonb) '
            f'from {authoring_table_name(table)} source_row) as {quote_ident(name)}'
        )
    # Distinct live KSB codes per module, in the same round trip. The delivery
    # rows Home is built from carry no mappings of their own.
    ksb_sql, ksb_params = ksb_counts_selection()
    selections.append(f'{ksb_sql} as "ksb_counts"')
    params.extend(ksb_params)
    result = fetch_all('select ' + ', '.join(selections), params)[0]
    # Django's PostgreSQL backend can return raw JSON strings for computed
    # columns, while standalone psycopg configurations may decode them already.
    decoded = {name: json.loads(value) if isinstance(value, str) else value for name, value in result.items()}
    decoded['ksb_profiles'] = []
    return decoded


def programme_list_sources(
    *,
    AUTHORING_MODULES_TABLE,
    AUTHORING_WEEKS_TABLE,
    COHORT_AUTHORING_DETAILS_TABLE,
    GROUPS_TABLE,
    _COHORT_FIELDS,
    _GROUP_FIELDS,
    _MODULE_FIELDS,
    _WEEK_FIELDS,
    authoring_fetch_all,
    authoring_table_name,
    connection,
    ensure_module_authoring_tables,
    fetch_all,
    get_program_config_rows,
    quote_ident
):
    sources = [
        ('modules', AUTHORING_MODULES_TABLE, _MODULE_FIELDS, ''),
        ('groups', GROUPS_TABLE, _GROUP_FIELDS, ''),
        ('cohorts', COHORT_AUTHORING_DETAILS_TABLE, _COHORT_FIELDS, ''),
        ('weeks', AUTHORING_WEEKS_TABLE, _WEEK_FIELDS, ''),
    ]
    if connection.vendor != 'postgresql':
        return {
            **{name: authoring_fetch_all(table, columns=fields) for name, table, fields, _ in sources},
            'program_configs': get_program_config_rows(),
        }
    ensure_module_authoring_tables()
    sources.append(('program_configs', 'programmes', None,
                    "coalesce((to_jsonb(source_row)->>'display_order')::numeric, 0), name"))
    selections, params = [], []
    for name, table, fields, ordering in sources:
        expression = 'to_jsonb(source_row)'
        if fields is not None:
            expression = '(select jsonb_object_agg(key, value) from jsonb_each(to_jsonb(source_row)) where key = any(%s))'
            params.append(list(fields))
        order_sql = f' order by {ordering}' if ordering else ''
        selections.append(
            f'(select coalesce(jsonb_agg({expression}{order_sql}), \'[]\'::jsonb) '
            f'from {authoring_table_name(table)} source_row) as {quote_ident(name)}'
        )
    selections.append('to_regclass(\'"Learner"."learners"\') is not null as "has_learner_table"')
    # One round trip and statement snapshot; names are server constants, keys
    # are parameters. JSON key selection tolerates optional legacy columns.
    row = fetch_all('select ' + ', '.join(selections), params)[0]
    result = {name: json.loads(value) if isinstance(value, str) else value for name, value in row.items()}
    return result
