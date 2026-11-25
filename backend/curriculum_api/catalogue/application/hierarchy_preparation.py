"""Build cohort/group authoring data through explicit read and calendar capabilities.

Persistence and transaction ownership remain with the existing callers."""

from curriculum_api.catalogue.application.cohort_calendar import cohort_holiday_details as _default_cohort_holiday_details
from curriculum_api.catalogue.application.cohort_calendar import holidays_within_period as _default_holidays_within_period
from curriculum_api.catalogue.domain.delivery_pattern import schedule_day_part as _default_schedule_day_part
from curriculum_api.catalogue.domain.delivery_pattern import schedule_time_parts as _default_schedule_time_parts
from curriculum_api.catalogue.domain.hierarchy_dates import apprenticeship_end_override_sent as _default_apprenticeship_end_override_sent
from curriculum_api.catalogue.domain.hierarchy_dates import calculate_cohort_end_date as _default_calculate_cohort_end_date
from curriculum_api.catalogue.domain.hierarchy_dates import cohort_epa_dates as _default_cohort_epa_dates
from curriculum_api.catalogue.domain.hierarchy_dates import infer_duration_months as _default_infer_duration_months
from curriculum_api.catalogue.domain.hierarchy_dates import parse_epa_months as _default_parse_epa_months
from curriculum_api.catalogue.domain.hierarchy_dates import payload_apprenticeship_end_override as _default_payload_apprenticeship_end_override
from curriculum_api.catalogue.domain.hierarchy_dates import payload_epa_months as _default_payload_epa_months
from curriculum_api.catalogue.domain.hierarchy_values import extract_notes_meta as _default_extract_notes_meta
from curriculum_api.catalogue.domain.hierarchy_values import module_row_belongs_to_group as _default_module_row_belongs_to_group
from curriculum_api.catalogue.domain.hierarchy_values import programme_config_id as _default_programme_config_id
from curriculum_api.catalogue.domain.programme_identity import programme_identity as _default_programme_identity
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import normalise as _default_normalise
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value
from curriculum_api.catalogue.domain.values import slugify as _default_slugify
from curriculum_api.catalogue.domain.values import unique as _default_unique


def cohort_authoring_payload(
    cohort,
    rows=None,
    groups=None,
    holiday_rows=None,
    extra=None,
    *,
    COHORT_AUTHORING_DETAILS_TABLE,
    apprenticeship_end_override_sent=_default_apprenticeship_end_override_sent,
    calculate_cohort_end_date=_default_calculate_cohort_end_date,
    canonical_programme_id,
    clean_str=_default_clean_str,
    cohort_epa_dates=_default_cohort_epa_dates,
    cohort_holiday_details=_default_cohort_holiday_details,
    extract_notes_meta=_default_extract_notes_meta,
    fetch_cohort_row,
    format_date=_default_format_date,
    get_program_config_rows,
    infer_duration_months=_default_infer_duration_months,
    json_db_value,
    parse_epa_months=_default_parse_epa_months,
    parse_json_value=_default_parse_json_value,
    payload_apprenticeship_end_override=_default_payload_apprenticeship_end_override,
    payload_epa_months=_default_payload_epa_months,
    policy_holidays,
    policy_write,
    program_config_by_id,
    programme_identity=_default_programme_identity,
    read_policy,
):
    cohort = cohort or {}
    calendar_update = {}
    if 'calendarPolicy' in cohort or 'calendar_policy' in cohort:
        calendar_update = policy_write(cohort, None, COHORT_AUTHORING_DETAILS_TABLE)
    rows = rows or []
    groups = groups or []
    meta = {}
    for row in rows:
        meta.update(row.get('_meta') or extract_notes_meta(row.get('notes')))
    start_date = format_date(cohort.get('startDate') or next((row.get('Starting_date_lable') or row.get('start_date') for row in rows if row), ''))
    end_date = format_date(cohort.get('endDate') or cohort.get('practicalEndDate') or meta.get('cohort_end_date') or next((row.get('end_date') for row in rows if row), ''))
    # The EPA period is only written when the caller actually carries one, so
    # the sync/repair paths that rebuild a cohort from training-plan rows cannot
    # blank an authored period by simply not knowing about it. The authored
    # apprenticeship end date is guarded the same way, for the same reason.
    epa_sent = 'epaMonths' in cohort or 'epa_months' in cohort or 'epa_months' in meta
    epa_months = payload_epa_months(cohort, {'epa_months': meta.get('epa_months')}) if epa_sent else None
    override_sent = apprenticeship_end_override_sent(cohort, meta)
    apprenticeship_end_override = format_date(payload_apprenticeship_end_override(
        cohort,
        {'apprenticeship_end_override': meta.get('apprenticeship_end_override')},
    )) if override_sent else ''
    # apprenticeship_end_date caches whichever of the two inputs applies, so it
    # has to be recomputed from *both* even when only one was sent — a write that
    # clears the override has to hand the cache back to the stored EPA period,
    # and one that only sets the period must not lose an authored date.
    stored_cohort = {}
    if epa_sent != override_sent:
        stored_cohort = fetch_cohort_row(clean_str(cohort.get('id') or meta.get('cohort_id'))) or {}
    cached_epa_months = epa_months if epa_sent else parse_epa_months(stored_cohort.get('epa_months'))
    cached_override = apprenticeship_end_override if override_sent else format_date(stored_cohort.get('apprenticeship_end_override'))
    _, apprenticeship_end_date = cohort_epa_dates(end_date, cached_epa_months, cached_override)
    # Holidays are overlapped against the cohort's contracted period -- start
    # date plus duration. They do not move the cohort end date; the selection is
    # stored so module session planning can skip clashing dates.
    holiday_period_months = infer_duration_months(
        start_date,
        end_date,
        cohort.get('durationMonths') or cohort.get('duration_months') or meta.get('duration_months'),
    )
    holiday_period_end = format_date(
        calculate_cohort_end_date(start_date, holiday_period_months) or end_date
    )
    # excludedHolidayIds is the one holiday input that IS honoured -- it is a
    # human's own choice in the cohort drawer, not derived data. Unsent keeps
    # whatever is already stored, the same guard as epa_months/override above:
    # a sync/repair rebuild from training-plan rows carries no opinion on which
    # holidays were unticked, and must not silently restore them all.
    excluded_holiday_ids_sent = (
        'excludedHolidayIds' in cohort or 'excluded_holiday_ids' in cohort or 'excluded_holiday_ids' in meta
    )
    if excluded_holiday_ids_sent:
        excluded_holiday_ids = (
            cohort.get('excludedHolidayIds') if 'excludedHolidayIds' in cohort
            else cohort.get('excluded_holiday_ids') if 'excluded_holiday_ids' in cohort
            else meta.get('excluded_holiday_ids')
        )
    else:
        if not stored_cohort:
            stored_cohort = fetch_cohort_row(clean_str(cohort.get('id') or meta.get('cohort_id'))) or {}
        excluded_holiday_ids = parse_json_value(stored_cohort.get('excluded_holiday_ids'), [])
    calendar_rows = holiday_rows or []
    calendar_value = calendar_update.get('calendar_policy')
    if not calendar_update:
        stored_cohort = stored_cohort or fetch_cohort_row(clean_str(cohort.get('id') or meta.get('cohort_id'))) or {}
        calendar_value = stored_cohort.get('calendar_policy')
    if calendar_value:
        calendar_rows = policy_holidays(read_policy({'calendar_policy': calendar_value}), start_date, holiday_period_end, calendar_rows)
    holiday_info = cohort_holiday_details(
        calendar_rows,
        excluded_holiday_ids,
        start_date,
        holiday_period_end,
    )
    training_plan_ids = [clean_str(row.get('id')) for row in rows if row.get('id') not in (None, '')]
    programme_name = clean_str(cohort.get('programme') or next((row.get('Program') for row in rows if row), ''))
    programme_source_id = canonical_programme_id(meta.get('program_id') or meta.get('programme_id') or cohort.get('programmeId'), programme_name)
    if (not programme_source_id or programme_source_id.lower().startswith('program-')) and rows:
        try:
            programme_source_id = canonical_programme_id(programme_identity(rows[0], program_config_by_id(get_program_config_rows())).get('sourceId'), programme_name)
        except (Exception, AssertionError):
            pass
    payload = {
        'cohort_id': clean_str(cohort.get('id') or meta.get('cohort_id')),
        'cohort_name': clean_str(cohort.get('name') or next((row.get('Cohort_name') for row in rows if row), '')),
        'programme_id': programme_source_id or clean_str(cohort.get('programmeId')),
        'start_date': start_date or None,
        'end_date': end_date or None,
        'duration_months': holiday_period_months,
        'color': cohort.get('color') or meta.get('cohort_color') or '',
        'status': cohort.get('status') or 'planned',
        # A cohort's holiday choices are stored in cohort_calendar_holidays
        # (calendar_holidays.store_cohort_choices).
        'holiday_ids': json_db_value(holiday_info['holidayIds']),
        'excluded_holiday_ids': json_db_value(holiday_info['excludedHolidayIds']),
        'notes': next((clean_str(row.get('notes')) for row in rows if clean_str(row.get('notes'))), ''),
        'source_type': 'curriculum_authoring',
        'source_id': training_plan_ids[0] if training_plan_ids else '',
    }
    if epa_sent:
        payload['epa_months'] = epa_months
    if override_sent:
        payload['apprenticeship_end_override'] = apprenticeship_end_override or None
    if epa_sent or override_sent:
        payload['apprenticeship_end_date'] = apprenticeship_end_date or None
    payload.update(calendar_update)
    payload.update(extra or {})
    return payload


def group_authoring_payload(
    group,
    rows=None,
    module_rows=None,
    extra=None,
    *,
    canonical_group_coaches,
    canonical_programme_id,
    clean_str=_default_clean_str,
    extract_notes_meta=_default_extract_notes_meta,
    fetch_group_row,
    get_program_config_rows,
    module_row_belongs_to_group=_default_module_row_belongs_to_group,
    program_config_by_id,
    programme_identity=_default_programme_identity,
    schedule_day_part=_default_schedule_day_part,
    schedule_time_parts=_default_schedule_time_parts,
    surviving_authoring_module_rows,
    unique=_default_unique,
    with_group_coaches,
):
    group = with_group_coaches(group)
    rows = rows or []
    module_rows = [
        row for row in surviving_authoring_module_rows(module_rows or [])
        if module_row_belongs_to_group(row, group)
    ]
    first_row = rows[0] if rows else {}
    meta = extract_notes_meta(first_row.get('notes')) if first_row else {}
    group_id = clean_str(group.get('id') or group.get('groupId') or group.get('group_id') or meta.get('group_id'))
    if not group_id:
        return {}
    existing_group = fetch_group_row(group_id) or {}
    group_name = clean_str(group.get('name') or group.get('groupName') or group.get('group_name') or meta.get('group_name') or group_id)
    cohort_id = clean_str(group.get('cohortId') or group.get('cohort_id') or meta.get('cohort_id'))
    programme_name = clean_str(group.get('programme') or group.get('programmeName') or group.get('programme_name') or first_row.get('Program'))
    programme_id = canonical_programme_id(
        meta.get('program_id') or meta.get('programme_id') or group.get('programmeId') or group.get('programme_id'),
        programme_name,
    )
    if (not programme_id or programme_id.lower().startswith('program-')) and rows:
        try:
            programme_id = canonical_programme_id(programme_identity(rows[0], program_config_by_id(get_program_config_rows())).get('sourceId'), programme_name)
        except (Exception, AssertionError):
            pass
    source_ids = unique([
        *[row.get('id') for row in rows if row.get('id') not in (None, '')],
        *[row.get('source_id') for row in module_rows if row.get('source_id')],
    ])
    payload = {
        'group_id': group_id,
        'group_name': group_name,
        'cohort_id': cohort_id,
        'programme_id': programme_id or clean_str(group.get('programmeId') or group.get('programme_id')),
        'coach_name': canonical_group_coaches(group.get('coach') or group.get('coachName') or first_row.get('coach_name') or existing_group.get('coach_name')),
        'session_week_day': clean_str(group.get('weekDays') or group.get('deliveryDays') or group.get('sessionWeekDay') or group.get('session_week_day') or schedule_day_part(group.get('schedule')) or existing_group.get('session_week_day') or schedule_day_part(existing_group.get('schedule'))),
        'session_start_time': clean_str(group.get('startTime') or group.get('start_time') or group.get('sessionStartTime') or group.get('session_start_time') or existing_group.get('session_start_time') or schedule_time_parts(group.get('schedule') or existing_group.get('schedule'))[0]),
        'session_end_time': clean_str(group.get('endTime') or group.get('end_time') or group.get('sessionEndTime') or group.get('session_end_time') or existing_group.get('session_end_time') or schedule_time_parts(group.get('schedule') or existing_group.get('schedule'))[1]),
        'color': clean_str(group.get('color') or existing_group.get('color')),
        'status': clean_str(group.get('status') or existing_group.get('status')) or 'planned',
        'notes': clean_str(first_row.get('notes') or group.get('notes')),
        'source_type': 'curriculum_authoring',
        'source_id': source_ids[0] if source_ids else '',
    }
    payload.update(extra or {})
    return payload


def canonical_group_coaches(
    value, *, canonical_staff_assignment_name, group_coaches,
):
    """A group's coaches as the one ``coach_name`` string: each name canonical.

    A group may have several coaches (``curriculum.group_coaches``). They travel
    as a list (``coaches``) or joined in one string (``coach``); each is matched
    against the staff directory the way a single coach always was.
    """
    names = group_coaches.split_names(value)
    return group_coaches.join_names([canonical_staff_assignment_name('coach', name) for name in names])


def canonical_programme_id(
    value='',
    programme_name='',
    *,
    clean_str=_default_clean_str,
    get_program_config_rows,
    normalise=_default_normalise,
    programme_config_id=_default_programme_config_id,
    re,
    slugify=_default_slugify,
):
    candidate = clean_str(value)
    if candidate.lower().startswith('program-prog-'):
        return candidate[len('program-'):].upper()
    if re.match(r'^PROG-[A-Z0-9][A-Z0-9_-]*$', candidate, re.I):
        return candidate.upper()
    try:
        configs = get_program_config_rows()
    except (Exception, AssertionError):
        configs = []
    candidate_keys = {candidate, slugify(candidate)}
    if candidate:
        candidate_keys.add(f'program-{slugify(candidate)}')
    programme_key = normalise(programme_name)
    for config in configs:
        config_id = programme_config_id(config)
        if not config_id:
            continue
        config_candidates = {
            config_id,
            slugify(config_id),
            f'program-{slugify(config_id)}',
        }
        if candidate and candidate_keys.intersection(config_candidates):
            return config_id
        if programme_key and programme_key in {normalise(config.get('name')), normalise(config.get('sub'))}:
            return config_id
    return candidate


def persistable_programme_id(
    value, *, get_program_config_rows, logger, programme_config_identity, sanitised_programme_id,
):
    """A programme id that exists in programmes, or '' when it does not.

    programme_id is a foreign key (modules_programme_id_fkey and its siblings),
    so a programme *name*, a placeholder or an id whose row has since gone must
    be stored as NULL. Writing it verbatim made the database reject the insert.
    """
    identifier = sanitised_programme_id(value)
    if not identifier:
        return ''
    try:
        configs = get_program_config_rows()
    except Exception:
        logger.debug('Unable to verify programme %s against programmes.', identifier, exc_info=True)
        return identifier
    return identifier if any(
        programme_config_identity(config) == identifier for config in configs
    ) else ''


def cohort_applied_holidays(
    holiday_ids,
    holiday_rows,
    period_start,
    period_end,
    *,
    get_holiday_rows,
    holiday_table_name,
    holidays_within_period=_default_holidays_within_period,
):
    """The holidays that apply to a cohort over its base period.

    Every bank holiday that falls inside ``period_start``..``period_end``, and
    nothing else. A cohort's holidays are its dates: picking the start and end
    date picks the holidays, so there is no ticking and no cohort that runs
    through Christmas Day because nobody remembered to tick it.

    ``holiday_ids`` is ignored and kept only so the stored ids on older cohort
    rows -- numeric keys into the authored table that is no longer read -- cannot
    change the answer. ``holiday_rows`` may be omitted, in which case the bank
    holidays are read.
    """
    if holiday_rows is None:
        try:
            holiday_rows = [] if not holiday_table_name() else get_holiday_rows()
        except (Exception, AssertionError):
            holiday_rows = []

    return holidays_within_period(holiday_rows, period_start, period_end)


def module_parent_cohort(
    cohort_id,
    group_id='',
    *,
    clean_str=_default_clean_str,
    curriculum_cohort_from_authoring_detail,
    resolve_cohort_row,
    resolve_group_row,
    serialize_cohort_authoring_detail,
):
    """The cohort a module is placed in, read from the normalized tables.

    A module carries its own cohort id, but a placement that only names the
    group still has a parent cohort -- the group's own.
    """
    row = resolve_cohort_row(cohort_id) if clean_str(cohort_id) else None
    if not row and clean_str(group_id):
        group_row = resolve_group_row(group_id)
        if group_row:
            row = resolve_cohort_row(group_row.get('cohort_id'))
    if not row:
        return None
    return curriculum_cohort_from_authoring_detail(serialize_cohort_authoring_detail(row))
