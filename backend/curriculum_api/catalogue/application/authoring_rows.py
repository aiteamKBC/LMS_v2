"""Adapt normalized authoring records to existing training/catalogue read contracts."""
from collections import defaultdict

from curriculum_api.catalogue.domain.delivery_pattern import schedule_day_part as _default_schedule_day_part
from curriculum_api.catalogue.domain.delivery_pattern import schedule_time_parts as _default_schedule_time_parts
from curriculum_api.catalogue.domain.hierarchy_values import append_notes_meta as _default_append_notes_meta
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import unique as _default_unique


def authoring_modules_as_training_rows(
    *,
    ensure_tables=True,
    module_rows=None,
    group_rows=None,
    cohort_rows=None,
    COHORT_AUTHORING_DETAILS_TABLE,
    COHORT_ROWS_ORDER,
    GROUPS_TABLE,
    GROUP_ROWS_ORDER,
    TRAINING_MODULE_CATALOGUE_COLUMN,
    append_notes_meta=_default_append_notes_meta,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    logger,
    module_index_rows,
    prefetch_authoring_reads,
    programme_deleted_row,
    schedule_day_part=_default_schedule_day_part,
    schedule_time_parts=_default_schedule_time_parts,
    training_index_reads,
):
    try:
        # The three reads below in one round trip; each still runs as written.
        prefetch_authoring_reads(training_index_reads(
            ensure_tables=ensure_tables, modules=module_rows is None,
            groups=group_rows is None, cohorts=cohort_rows is None,
        ))
        if module_rows is None:
            module_rows = module_index_rows(ensure_tables=ensure_tables)
        if group_rows is None:
            group_rows = authoring_fetch_all(GROUPS_TABLE, order_sql=GROUP_ROWS_ORDER, ensure_tables=ensure_tables)
        if cohort_rows is None:
            cohort_rows = authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE, order_sql=COHORT_ROWS_ORDER, ensure_tables=ensure_tables)
        group_rows = {clean_str(row.get('group_id')): row for row in group_rows}
        cohort_rows = {clean_str(row.get('cohort_id')): row for row in cohort_rows}
    except (Exception, AssertionError):
        logger.debug('Could not build fallback training rows from authoring tables.', exc_info=True)
        return []

    rows = []
    for module in module_rows:
        module_id = clean_str(module.get('module_catalogue_id'))
        group_id = clean_str(module.get('group_id'))
        cohort_id = clean_str(module.get('cohort_id'))
        if not group_id or not cohort_id:
            continue
        group = group_rows.get(group_id) or {}
        cohort = cohort_rows.get(cohort_id) or {}
        is_programme_deleted = programme_deleted_row(module) or programme_deleted_row(group)
        programme_id = clean_str(group.get('programme_id') or cohort.get('programme_id') or module.get('programme_id'))
        programme_name = clean_str(group.get('programme_name') or cohort.get('programme_name') or module.get('programme_name') or 'Unassigned programme')
        cohort_name = clean_str(group.get('cohort_name') or cohort.get('cohort_name') or module.get('cohort_name') or 'Unassigned cohort')
        group_name = clean_str(group.get('group_name') or module.get('group_name') or 'Unassigned group')
        meta = {
            'program_id': programme_id,
            'cohort_id': cohort_id,
            'group_id': group_id,
            'group_name': group_name,
            TRAINING_MODULE_CATALOGUE_COLUMN: module_id,
        }
        if is_programme_deleted:
            meta['is_programme_deleted'] = 'true'
        rows.append({
            'id': module_id,
            'Program': programme_name,
            'Cohort_name': cohort_name,
            'group_name': group_name,
            'module_name': module.get('title') or f'Module {module_id}',
            'status': clean_str(module.get('status') or 'draft').lower(),
            'sessions_number': module.get('sessions_number') or 0,
            'Tutor_name': module.get('tutor_name') or '',
            'coach_name': group.get('coach_name') or '',
            'Starting_date_lable': cohort.get('start_date') or module.get('start_date'),
            'start_date': module.get('start_date') or cohort.get('start_date'),
            'end_date': module.get('end_date') or cohort.get('end_date'),
            'session_week_day': group.get('session_week_day') or schedule_day_part(group.get('schedule')),
            'session_start_time': group.get('session_start_time') or schedule_time_parts(group.get('schedule'))[0],
            'session_end_time': group.get('session_end_time') or schedule_time_parts(group.get('schedule'))[1],
            'session_ksb_json': '[]',
            'notes': append_notes_meta(module.get('description') or '', meta),
            'isProgrammeDeleted': is_programme_deleted,
            TRAINING_MODULE_CATALOGUE_COLUMN: module_id,
            'programme_display_order': None,
            'cohort_display_order': None,
            '_meta': meta,
        })
    return rows


def authoring_modules_as_catalogue_rows(
    *,
    module_rows=None,
    week_rows=None,
    AUTHORING_WEEKS_TABLE,
    WEEK_INDEX_COLUMNS,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    json_db_value,
    logger,
    module_index_rows,
    parse_int=_default_parse_int,
    programme_deleted_row,
    unique=_default_unique,
):
    try:
        if module_rows is None:
            # The index projection, shared with the training-row read: nothing
            # below reads ksb_remap_report, and select * shipped it on every
            # shared-rows build.
            module_rows = module_index_rows()
        if week_rows is None:
            week_rows = authoring_fetch_all(AUTHORING_WEEKS_TABLE, columns=WEEK_INDEX_COLUMNS)
    except (Exception, AssertionError):
        logger.debug('Could not build fallback module catalogue rows from authoring tables.', exc_info=True)
        return []

    week_names_by_module = defaultdict(list)
    ordered_weeks = sorted(
        week_rows,
        key=lambda item: (
            clean_str(item.get('module_catalogue_id')),
            parse_int(item.get('display_order'), 0),
            parse_int(item.get('week_number'), 0),
        ),
    )
    for week in ordered_weeks:
        title = week.get('title') or f'Week {week.get("week_number") or ""}'.strip()
        week_names_by_module[clean_str(week.get('module_catalogue_id'))].append(title)

    rows = []
    for module in module_rows:
        module_id = clean_str(module.get('module_catalogue_id'))
        session_names = unique(week_names_by_module.get(module_id) or [])
        rows.append({
            'Module ID': module_id,
            'Module_name': module.get('title') or f'Module {module_id}',
            'Number of sessions': module.get('sessions_number') or len(session_names),
            'start_date': module.get('start_date'),
            'end_date': module.get('end_date'),
            'Module_colour': module.get('color') or '#6941c6',
            'Notes': module.get('description') or '',
            'session_names_json': json_db_value(session_names),
            'session_ksb_json': '[]',
            'isProgrammeDeleted': programme_deleted_row(module),
        })
    return rows
