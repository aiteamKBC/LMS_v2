"""Cohort/Group lookup orchestration and drawer record projections.

Existing date, delivery and identity helpers are explicit capabilities.
No HTTP, database startup, writes or provider imports belong here."""

from curriculum_api.catalogue.domain.delivery_pattern import schedule_day_part as _default_schedule_day_part
from curriculum_api.catalogue.domain.delivery_pattern import schedule_time_parts as _default_schedule_time_parts
from curriculum_api.catalogue.domain.hierarchy_dates import cohort_epa_dates as _default_cohort_epa_dates
from curriculum_api.catalogue.domain.hierarchy_dates import parse_epa_months as _default_parse_epa_months
from curriculum_api.catalogue.domain.hierarchy_values import matches_curriculum_identifier as _default_matches_curriculum_identifier
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value


def resolve_cohort_row(
    identifier,
    *,
    clean_str=_default_clean_str,
    fetch_cohort_row,
    authoring_fetch_all,
    COHORT_AUTHORING_DETAILS_TABLE,
    matches_curriculum_identifier=_default_matches_curriculum_identifier,
    normalise=_default_normalise,
    curriculum_row_effectively_deleted,
):
    """Look up a cohort row by canonical id first, then fall back to name match.

    Name matching is used only for validation/lookup tolerance (e.g. legacy
    clients passing a name); the returned row always carries its stored
    canonical ``cohort_id``, which is what callers use for updates.
    """
    ident = clean_str(identifier)
    if not ident:
        return None
    row = fetch_cohort_row(ident)
    if row:
        return row
    for candidate in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE):
        if matches_curriculum_identifier(candidate.get('cohort_id'), ident):
            return candidate
    # A name can now be shared by a live cohort and an archived namesake, so
    # the live one wins; the tombstone is only returned when nothing else holds
    # the name.
    name_matches = [
        candidate for candidate in authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE)
        if normalise(candidate.get('cohort_name')) == normalise(ident)
    ]
    surviving = [row for row in name_matches if not curriculum_row_effectively_deleted(row)]
    for candidate in surviving or name_matches:
        return candidate
    return None


def resolve_group_row(
    identifier,
    *,
    clean_str=_default_clean_str,
    fetch_group_row,
    authoring_fetch_all,
    GROUPS_TABLE,
    matches_curriculum_identifier=_default_matches_curriculum_identifier,
    normalise=_default_normalise,
    curriculum_row_effectively_deleted,
    logger,
):
    """Look up a group row by canonical id first, then fall back to name match."""
    ident = clean_str(identifier)
    if not ident:
        return None
    row = fetch_group_row(ident)
    if row:
        return row
    for candidate in authoring_fetch_all(GROUPS_TABLE):
        if matches_curriculum_identifier(candidate.get('group_id'), ident):
            return candidate
    # Group names are only unique within a cohort, so a bare-name lookup can be
    # ambiguous. Returning an arbitrary match writes modules into whichever row
    # the scan happened to reach first; refuse instead and let the caller supply
    # a canonical id (or a cohort-scoped lookup).
    # Archived namesakes do not make a name ambiguous: recreating a group under
    # an archived group's name is legal, and the live row is unmistakably the
    # one meant. Only fall back to the archived rows when no live row holds the
    # name at all.
    name_matches = [
        candidate for candidate in authoring_fetch_all(GROUPS_TABLE)
        if normalise(candidate.get('group_name')) == normalise(ident)
    ]
    surviving = [row for row in name_matches if not curriculum_row_effectively_deleted(row)]
    name_matches = surviving or name_matches
    if len(name_matches) == 1:
        return name_matches[0]
    if len(name_matches) > 1:
        logger.warning(
            'Ambiguous group name %r matches %d rows (%s); refusing to guess.',
            ident,
            len(name_matches),
            ', '.join(clean_str(row.get('group_id')) for row in name_matches),
        )
    return None


def curriculum_cohort_from_authoring_detail(
    detail,
    *,
    parse_epa_months=_default_parse_epa_months,
    format_date=_default_format_date,
    cohort_epa_dates=_default_cohort_epa_dates,
    parse_json_value=_default_parse_json_value,
):
    detail = detail or {}
    epa_months = parse_epa_months(
        detail.get('epaMonths') if detail.get('epaMonths') is not None else detail.get('epa_months')
    )
    override = format_date(
        detail.get('apprenticeshipEndOverride')
        if detail.get('apprenticeshipEndOverride') is not None
        else detail.get('apprenticeship_end_override')
    )
    practical_end_date, apprenticeship_end_date = cohort_epa_dates(
        detail.get('endDate') or detail.get('end_date') or detail.get('practicalEndDate') or '',
        epa_months,
        override,
    )
    return {
        'id': detail.get('cohortId') or detail.get('id') or detail.get('cohort_id'),
        'name': detail.get('cohortName') or detail.get('name') or detail.get('cohort_name') or '',
        'programmeId': detail.get('programmeId') or detail.get('programme_id') or '',
        'programme': detail.get('programmeName') or detail.get('programme') or detail.get('programme_name') or '',
        'startDate': detail.get('startDate') or detail.get('start_date') or '',
        'endDate': practical_end_date,
        'practicalEndDate': practical_end_date,
        'epaMonths': epa_months,
        'apprenticeshipEndDate': apprenticeship_end_date,
        'apprenticeshipEndOverride': override,
        'durationMonths': detail.get('durationMonths') or detail.get('duration_months') or 0,
        'color': detail.get('color') or '',
        'holidayIds': detail.get('holidayIds') or detail.get('holiday_ids') or [],
        'excludedHolidayIds': detail.get('excludedHolidayIds') or detail.get('excluded_holiday_ids') or [],
        'calendarPolicy': parse_json_value(detail.get('calendarPolicy') if 'calendarPolicy' in detail else detail.get('calendar_policy'), None),
        'status': detail.get('status') or 'planned',
        'createdAt': detail.get('createdAt') or detail.get('created_at') or '',
        'updatedAt': detail.get('updatedAt') or detail.get('updated_at') or '',
    }


def curriculum_group_from_authoring_detail(
    detail,
    *,
    split_coach_names,
    schedule_day_part=_default_schedule_day_part,
    schedule_time_parts=_default_schedule_time_parts,
):
    detail = detail or {}
    return {
        'id': detail.get('id') or detail.get('groupId') or detail.get('group_id'),
        'name': detail.get('name') or detail.get('groupName') or detail.get('group_name') or '',
        'cohortId': detail.get('cohortId') or detail.get('cohort_id') or '',
        'cohort': detail.get('cohort') or detail.get('cohortName') or detail.get('cohort_name') or '',
        'programmeId': detail.get('programmeId') or detail.get('programme_id') or '',
        'programme': detail.get('programme') or detail.get('programmeName') or detail.get('programme_name') or '',
        'coach': detail.get('coach') or detail.get('coach_name') or '',
        # Every coach of the group; `coach` above is the same names joined.
        'coaches': split_coach_names(
            detail.get('coaches') or detail.get('coach_names') or detail.get('coach') or detail.get('coach_name')
        ),
        'tutor': detail.get('tutor') or '',
        'startDate': detail.get('startDate') or detail.get('start_date') or '',
        'endDate': detail.get('endDate') or detail.get('end_date') or '',
        # The delivery slot in its own fields, not only folded into `schedule`.
        # The group form edits these three directly, so a create response that
        # carried the schedule sentence alone came back to the form as no
        # delivery days and the default 09:00-11:00 -- losing what was just
        # saved. Parsed back out of `schedule` when a caller only has that.
        'weekDays': (
            detail.get('weekDays') or detail.get('week_days') or detail.get('session_week_day')
            or schedule_day_part(detail.get('schedule')) or ''
        ),
        'startTime': (
            detail.get('startTime') or detail.get('start_time') or detail.get('session_start_time')
            or schedule_time_parts(detail.get('schedule'))[0]
        ),
        'endTime': (
            detail.get('endTime') or detail.get('end_time') or detail.get('session_end_time')
            or schedule_time_parts(detail.get('schedule'))[1]
        ),
        'schedule': detail.get('schedule') or '',
        'color': detail.get('color') or '',
        'mode': detail.get('mode') or 'Live',
        'status': detail.get('status') or 'planned',
        'modules': detail.get('modules') or detail.get('module_names') or [],
        'moduleIds': detail.get('moduleIds') or detail.get('module_ids') or [],
        'createdAt': detail.get('createdAt') or detail.get('created_at') or '',
        'updatedAt': detail.get('updatedAt') or detail.get('updated_at') or '',
    }
