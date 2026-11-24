"""Assemble normalized cohort/group overview and detail reads.

Existing readers, calendar projection and normalization are supplied explicitly.
No write, schema provisioning or provider implementation is owned here.
"""
from collections import defaultdict
from .read_errors import CatalogueReadUnavailable
from ..domain.delivery_identity import delivery_learner_count, detail_is_archived

from curriculum_api.catalogue.application.delivery_schedules import group_schedule_value as _default_group_schedule_value
from curriculum_api.catalogue.domain.delivery_pattern import schedule_day_part as _default_schedule_day_part
from curriculum_api.catalogue.domain.delivery_pattern import schedule_time_parts as _default_schedule_time_parts
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at as _default_format_created_at
from curriculum_api.catalogue.domain.hierarchy_dates import infer_duration_months as _default_infer_duration_months
from curriculum_api.catalogue.domain.hierarchy_dates import parse_epa_months as _default_parse_epa_months
from curriculum_api.catalogue.domain.hierarchy_values import group_tutor_from_module_names as _default_group_tutor_from_module_names
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key as _default_staff_assignment_key
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import unique as _default_unique


def build_cohorts_and_groups(
    training_rows=None,
    program_configs=None,
    include_archived=False,
    *,
    include_learner_counts=True,
    source=None,
    active_learner_delivery_counts,
    clean_str=_default_clean_str,
    cohort_authoring_detail_rows,
    format_created_at=_default_format_created_at,
    format_date=_default_format_date,
    group_authoring_detail_rows,
    infer_duration_months=_default_infer_duration_months,
    normalise=_default_normalise,
    parse_epa_months=_default_parse_epa_months,
    parse_int=_default_parse_int,
    programme_deleted_row,
    safe_module_index_rows,
    unique=_default_unique,
):
    """Build the cohort/group overview directly from the normalized tables.

    Cohorts come from ``curriculum.cohorts`` and groups from ``curriculum.groups``.
    Module names and session counts are derived from ``curriculum.modules`` keyed
    on the stored canonical group/cohort ids. The ``training_rows`` argument is
    accepted for backwards compatibility with existing callers but is ignored:
    the normalized tables are the only source of truth.
    """
    # The index projection the other module readers share (it leaves out only
    # ksb_remap_report, which nothing here reads), so the read scope serves
    # them all from one read of the table.
    module_rows = safe_module_index_rows() if source is None else source['modules']
    if not include_archived:
        module_rows = [row for row in module_rows if not programme_deleted_row(row)]
    cohort_learner_counts, group_learner_counts = (
        active_learner_delivery_counts() if include_learner_counts else ({}, {})
    )
    modules_by_group = defaultdict(list)
    modules_by_cohort = defaultdict(list)
    for module in module_rows:
        group_key = clean_str(module.get('group_id'))
        cohort_key = clean_str(module.get('cohort_id'))
        if group_key:
            modules_by_group[group_key].append(module)
        if cohort_key:
            modules_by_cohort[cohort_key].append(module)

    def module_ids(rows):
        return [module_id for module_id in unique([clean_str(row.get('module_catalogue_id')) for row in rows]) if module_id]

    def module_names(rows):
        return [name for name in unique([clean_str(row.get('title')) for row in rows]) if name]

    def session_total(rows):
        return sum(parse_int(row.get('sessions_number'), 0) for row in rows)

    cohorts = []
    cohort_details = cohort_authoring_detail_rows() if source is None else source['cohorts']
    for detail in cohort_details:
        if programme_deleted_row(detail):
            continue
        if not include_archived and detail_is_archived(detail, clean_str=clean_str):
            continue
        cohort_id = clean_str(detail.get('cohortId'))
        if not cohort_id:
            continue
        cohort_modules = modules_by_cohort.get(cohort_id, [])
        stored_module_ids = [module_id for module_id in (detail.get('moduleCatalogueIds') or []) if clean_str(module_id)]
        cohorts.append({
            'id': cohort_id,
            'name': clean_str(detail.get('cohortName')),
            'programme': clean_str(detail.get('programmeName')),
            'programmeId': clean_str(detail.get('programmeId')),
            'startDate': format_date(detail.get('startDate')),
            'endDate': format_date(detail.get('endDate')),
            'practicalEndDate': format_date(detail.get('practicalEndDate') or detail.get('endDate')),
            'epaMonths': parse_epa_months(detail.get('epaMonths')),
            'apprenticeshipEndDate': format_date(detail.get('apprenticeshipEndDate')),
            'apprenticeshipEndOverride': format_date(detail.get('apprenticeshipEndOverride')),
            'durationMonths': parse_int(
                detail.get('durationMonths'),
                infer_duration_months(detail.get('startDate'), detail.get('endDate'), 0),
            ),
            'status': detail.get('status') or 'planned',
            'learners': delivery_learner_count(cohort_learner_counts, cohort_id, (
                normalise(detail.get('programmeName')),
                normalise(detail.get('cohortName')),
            ), clean_str=clean_str),
            'groups': [clean_str(value) for value in (detail.get('groupIds') or []) if clean_str(value)],
            'moduleIds': module_ids(cohort_modules) or stored_module_ids,
            'modules': module_names(cohort_modules),
            'sessions': session_total(cohort_modules),
            'color': detail.get('color') or '#6941c6',
            'holidayIds': [clean_str(value) for value in (detail.get('holidayIds') or []) if clean_str(value)],
            'excludedHolidayIds': [clean_str(value) for value in (detail.get('excludedHolidayIds') or []) if clean_str(value)],
            'calendarPolicy': detail.get('calendarPolicy'),
            'calendarError': detail.get('calendarError') or '',
            'createdAt': clean_str(detail.get('createdAt')),
            'updatedAt': clean_str(detail.get('updatedAt')),
            'progress': 0,
            'attendance': 0,
        })

    groups = []
    seen_group_ids = set()
    group_details = group_authoring_detail_rows() if source is None else source['groups']
    for detail in group_details:
        if programme_deleted_row(detail):
            continue
        if not include_archived and detail_is_archived(detail, clean_str=clean_str):
            continue
        group_id = clean_str(detail.get('id'))
        if not group_id:
            continue
        seen_group_ids.add(group_id)
        group_modules = modules_by_group.get(group_id, [])
        stored_module_ids = [module_id for module_id in (detail.get('moduleIds') or []) if clean_str(module_id)]
        stored_module_names = [name for name in (detail.get('modules') or []) if clean_str(name)]
        groups.append({
            'id': group_id,
            'name': clean_str(detail.get('name')),
            'cohortId': clean_str(detail.get('cohortId')),
            'cohort': clean_str(detail.get('cohort')),
            'programmeId': clean_str(detail.get('programmeId')),
            'programme': clean_str(detail.get('programme')),
            'learners': delivery_learner_count(group_learner_counts, group_id, (
                normalise(detail.get('programme')),
                normalise(detail.get('cohort')),
                normalise(detail.get('name')),
            ), clean_str=clean_str),
            'coach': detail.get('coach') or 'Unassigned',
            'tutor': detail.get('tutor') or 'Unassigned',
            'startDate': format_date(detail.get('startDate')),
            'endDate': format_date(detail.get('endDate')),
            'status': detail.get('status') or 'planned',
            # The delivery pattern travels with the group: build_module_session_plan
            # cannot date a single session without a delivery day, so a module
            # editor that only receives `schedule` can never show an end date.
            # serialize_group_authoring_detail already falls back to the day
            # inside the schedule string, which is what older rows carry.
            'weekDays': clean_str(detail.get('weekDays')),
            'startTime': clean_str(detail.get('startTime')),
            'endTime': clean_str(detail.get('endTime')),
            'schedule': detail.get('schedule') or '',
            'color': detail.get('color') or '',
            'mode': detail.get('mode') or 'Live',
            'moduleIds': module_ids(group_modules) or stored_module_ids,
            'modules': module_names(group_modules) or stored_module_names,
            'sessions': session_total(group_modules),
            'createdAt': clean_str(detail.get('createdAt')),
            'updatedAt': clean_str(detail.get('updatedAt')),
            'isProgrammeDeleted': programme_deleted_row(detail),
        })

    for group_id, group_modules in modules_by_group.items():
        if not group_id or group_id in seen_group_ids:
            continue
        first_module = group_modules[0] if group_modules else {}
        groups.append({
            'id': group_id,
            'name': clean_str(first_module.get('group_name')) or group_id,
            'cohortId': clean_str(first_module.get('cohort_id')),
            'cohort': clean_str(first_module.get('cohort_name')),
            'programmeId': clean_str(first_module.get('programme_id')),
            'programme': clean_str(first_module.get('programme_name')),
            'learners': delivery_learner_count(group_learner_counts, group_id, (
                normalise(first_module.get('programme_name')),
                normalise(first_module.get('cohort_name')),
                normalise(first_module.get('group_name')),
            ), clean_str=clean_str),
            'coach': 'Unassigned',
            'tutor': clean_str(first_module.get('tutor_name')) or 'Unassigned',
            'startDate': format_date(first_module.get('start_date')),
            'endDate': format_date(first_module.get('end_date')),
            'status': 'planned' if clean_str(first_module.get('status')).lower() == 'archived' else (clean_str(first_module.get('status')) or 'planned'),
            # Same delivery pattern, read off the module rows this group was
            # reconstructed from.
            'weekDays': clean_str(first_module.get('session_week_day')),
            'startTime': clean_str(first_module.get('session_start_time')),
            'endTime': clean_str(first_module.get('session_end_time')),
            'schedule': '',
            'color': clean_str(first_module.get('color')),
            'mode': 'Live',
            'moduleIds': module_ids(group_modules),
            'modules': module_names(group_modules),
            'sessions': session_total(group_modules),
            # Reconstructed from module rows, so the earliest module's creation is
            # the closest thing this group has to one of its own.
            'createdAt': min([format_created_at(row.get('created_at')) for row in group_modules if row.get('created_at')] or ['']),
            'updatedAt': max([format_created_at(row.get('updated_at')) for row in group_modules if row.get('updated_at')] or ['']),
            'isProgrammeDeleted': programme_deleted_row(first_module),
        })

    # Ensure every cohort exposes the ids of its normalized child groups, even
    # when the stored ``group_ids`` array is stale.
    groups_by_cohort = defaultdict(list)
    for group in groups:
        if group['cohortId']:
            groups_by_cohort[group['cohortId']].append(group['id'])
    for cohort in cohorts:
        derived = groups_by_cohort.get(cohort['id'], [])
        cohort['groups'] = unique([*cohort['groups'], *derived]) if cohort['groups'] else derived

    return cohorts, groups


def cohort_authoring_detail_rows(
    *,
    COHORT_AUTHORING_DETAILS_TABLE,
    COHORT_ROWS_ORDER,
    authoring_fetch_all,
    get_holiday_rows_safe,
    logger,
    serialize_cohort_authoring_detail
):
    holiday_rows = get_holiday_rows_safe()
    try:
        return [
            serialize_cohort_authoring_detail(row, holiday_rows)
            for row in authoring_fetch_all(
                COHORT_AUTHORING_DETAILS_TABLE,
                order_sql=COHORT_ROWS_ORDER,
            )
        ]
    except (Exception, AssertionError) as exc:
        raise CatalogueReadUnavailable('Cohort details are unavailable. Please retry.') from exc


def group_authoring_detail_rows(
    *,
    GROUPS_TABLE,
    GROUP_ROWS_ORDER,
    authoring_fetch_all,
    clean_str=_default_clean_str,
    format_date=_default_format_date,
    group_tutor_from_module_names=_default_group_tutor_from_module_names,
    logger,
    safe_module_index_rows,
    serialize_group_authoring_detail,
    staff_assignment_key=_default_staff_assignment_key,
):
    try:
        return group_details_from_rows(
            authoring_fetch_all(GROUPS_TABLE, order_sql=GROUP_ROWS_ORDER), safe_module_index_rows(),
            serialize_group_authoring_detail=serialize_group_authoring_detail,
            clean_str=clean_str, format_date=format_date,
            group_tutor_from_module_names=group_tutor_from_module_names,
            staff_assignment_key=staff_assignment_key,
        )
    except CatalogueReadUnavailable:
        raise
    except Exception as exc:
        raise CatalogueReadUnavailable('Group details are unavailable. Please retry.') from exc


def serialize_group_authoring_detail(
    row,
    *,
    as_json_value=_default_as_json_value,
    format_created_at=_default_format_created_at,
    format_date=_default_format_date,
    group_coaches,
    group_schedule_value=_default_group_schedule_value,
    programme_deleted_row,
    schedule_day_part=_default_schedule_day_part,
    schedule_time_parts=_default_schedule_time_parts,
):
    return {
        'id': row.get('group_id'),
        'name': row.get('group_name'),
        'cohortId': row.get('cohort_id'),
        'cohort': row.get('cohort_name'),
        'programmeId': row.get('programme_id'),
        'programme': row.get('programme_name'),
        'modules': as_json_value(row.get('module_names'), []),
        'moduleIds': as_json_value(row.get('module_ids'), []),
        'coach': row.get('coach_name') or 'Unassigned',
        'coaches': group_coaches.split_names(row.get('coach_names') or row.get('coach_name')),
        # Overwritten by group_authoring_detail_rows(), which derives the tutor
        # from the group's module rows. Kept as the standalone-call fallback.
        'tutor': 'Unassigned',
        'startDate': '',
        'endDate': '',
        'weekDays': row.get('session_week_day') or schedule_day_part(row.get('schedule')),
        'startTime': row.get('session_start_time') or schedule_time_parts(row.get('schedule'))[0],
        'endTime': row.get('session_end_time') or schedule_time_parts(row.get('schedule'))[1],
        'schedule': group_schedule_value(row),
        'color': row.get('color') or '',
        'status': row.get('status') or 'planned',
        'isProgrammeDeleted': programme_deleted_row(row),
        'notes': row.get('notes') or '',
        'sourceType': row.get('source_type') or 'curriculum_authoring',
        'sourceId': row.get('source_id') or '',
        'updatedAt': format_date(row.get('updated_at')),
        'createdAt': format_created_at(row.get('created_at')),
    }


def group_details_from_rows(rows, module_rows, *, serialize_group_authoring_detail,
                            clean_str, format_date, group_tutor_from_module_names, staff_assignment_key):
    """One projection of normalized group rows and their child-module dates/tutors."""
    details = [serialize_group_authoring_detail(row) for row in rows]
    module_dates_by_group = defaultdict(lambda: {'start': [], 'end': []})
    # curriculum.groups has no tutor_name column: the group tutor is stored on
    # each child module row (see update_staffing_assignment / group PATCH, which
    # fan the chosen tutor out across the group's modules). Recover it here in
    # the same pass that derives the delivery window so the read path reports
    # what the write path actually persisted instead of always 'Unassigned'.
    module_tutors_by_group = defaultdict(list)
    # Group id, dates and tutor only: the index projection the list
    # readers already read, not a second select * of the table.
    for module in module_rows:
        group_id = clean_str(module.get('group_id'))
        if not group_id:
            continue
        start = format_date(module.get('start_date'))
        end = format_date(module.get('end_date'))
        if start:
            module_dates_by_group[group_id]['start'].append(start)
        if end:
            module_dates_by_group[group_id]['end'].append(end)
        tutor_name = clean_str(module.get('tutor_name'))
        if tutor_name and staff_assignment_key(tutor_name) != 'unassigned':
            module_tutors_by_group[group_id].append(tutor_name)
    for detail in details:
        group_id = clean_str(detail.get('id'))
        bounds = module_dates_by_group.get(group_id, {})
        starts = bounds.get('start') or []
        ends = bounds.get('end') or []
        detail['startDate'] = min(starts) if starts else ''
        detail['endDate'] = max(ends) if ends else ''
        detail['tutor'] = group_tutor_from_module_names(module_tutors_by_group.get(group_id))
    return details
