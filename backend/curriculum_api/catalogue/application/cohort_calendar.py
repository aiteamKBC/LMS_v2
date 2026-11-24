"""Cohort detail and holiday read projections using explicit read capabilities."""

from curriculum_api.catalogue.domain.hierarchy_dates import calculate_cohort_end_date as _default_calculate_cohort_end_date
from curriculum_api.catalogue.domain.hierarchy_dates import cohort_epa_dates as _default_cohort_epa_dates
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at as _default_format_created_at
from curriculum_api.catalogue.domain.hierarchy_dates import parse_epa_months as _default_parse_epa_months
from curriculum_api.catalogue.domain.holiday_selection import cohort_holiday_period_end as _default_cohort_holiday_period_end
from curriculum_api.catalogue.domain.holiday_selection import date_ranges_overlap as _default_date_ranges_overlap
from curriculum_api.catalogue.domain.holiday_selection import holiday_row_source as _default_holiday_row_source
from curriculum_api.catalogue.domain.read_contracts import AUTHORED_HOLIDAY_COLOR as _default_AUTHORED_HOLIDAY_COLOR
from curriculum_api.catalogue.domain.read_contracts import BANK_HOLIDAY_COLOR as _default_BANK_HOLIDAY_COLOR
from curriculum_api.catalogue.domain.read_contracts import BANK_HOLIDAY_TYPE as _default_BANK_HOLIDAY_TYPE
from curriculum_api.catalogue.domain.read_contracts import HOLIDAY_SOURCE_GOVUK as _default_HOLIDAY_SOURCE_GOVUK
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import format_date as _default_format_date
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int
from curriculum_api.catalogue.domain.values import parse_json_value as _default_parse_json_value


def holiday_row_sort_key(row, *, format_date=_default_format_date, clean_str=_default_clean_str):
    row = row or {}
    return (
        format_date(row.get('holiday_date') or row.get('start_date')) or '',
        clean_str(row.get('title') or row.get('label')),
    )


def serialize_holiday_row(
    row,
    *,
    holiday_row_source=_default_holiday_row_source,
    format_date=_default_format_date,
    clean_str=_default_clean_str,
    HOLIDAY_SOURCE_GOVUK=_default_HOLIDAY_SOURCE_GOVUK,
    BANK_HOLIDAY_TYPE=_default_BANK_HOLIDAY_TYPE,
    BANK_HOLIDAY_COLOR=_default_BANK_HOLIDAY_COLOR,
    AUTHORED_HOLIDAY_COLOR=_default_AUTHORED_HOLIDAY_COLOR,
):
    """One holiday in the shape the whole curriculum reads.

    Two tables arrive here. ``curriculum.england_holidays`` gives a single dated
    bank holiday with a ``title``; ``curriculum.holidays`` gives an authored
    closure period with a ``label`` and its own start and end date. Both come out
    as a ``label`` plus a ``startDate``/``endDate`` pair -- a bank holiday simply
    has the two dates equal -- so ``holiday_date_set``, ``date_ranges_overlap``
    and the day arithmetic treat a one-day national holiday and a fortnight's
    closure the same way, which is the only way they should be treated.

    Rows that already arrived serialized are passed straight back through. A
    caller previewing an unsaved cohort sends holidays as JSON, and it sends
    them in this shape, not the database one.
    """
    row = row or {}
    source = holiday_row_source(row)
    holiday_date = format_date(
        row.get('holiday_date') or row.get('date')
        or row.get('start_date') or row.get('startDate')
    )
    end_date = format_date(row.get('end_date') or row.get('endDate')) or holiday_date
    label = clean_str(row.get('title') or row.get('label') or row.get('name'))
    bank_holiday = source == HOLIDAY_SOURCE_GOVUK
    item = {
        'id': row.get('id'),
        'label': label,
        'startDate': holiday_date,
        'endDate': end_date,
        # A bank holiday's type is not stored -- being in the GOV.UK mirror is
        # what makes it one -- while an authored holiday's type is whatever was
        # typed on it, including nothing at all.
        'type': clean_str(row.get('type')) or (BANK_HOLIDAY_TYPE if bank_holiday else ''),
        'color': clean_str(row.get('color')) or (BANK_HOLIDAY_COLOR if bank_holiday else AUTHORED_HOLIDAY_COLOR),
        'source': source,
    }
    if row.get('country'):
        item['country'] = row['country']
    if bank_holiday:
        # Only GOV.UK rows carry these, and only 'Substitute day' ever appears in
        # notes. Passed through so a picker can say why Boxing Day moved. An
        # authored row's notes column is internal bookkeeping (see
        # append_notes_meta) and is deliberately not published.
        notes = clean_str(row.get('notes'))
        if notes:
            item['notes'] = notes
        if row.get('bunting') is not None:
            item['bunting'] = bool(row.get('bunting'))
    return item


def serialize_england_holiday_row(
    row,
    *,
    clean_str=_default_clean_str,
    format_date=_default_format_date,
    format_created_at=_default_format_created_at,
):
    return {
        'id': row.get('id'),
        'division': clean_str(row.get('division')),
        'title': clean_str(row.get('title')),
        'date': format_date(row.get('holiday_date')),
        # Only ever 'Substitute day' -- the holiday was moved because the real
        # date fell on a weekend.
        'notes': clean_str(row.get('notes')),
        'bunting': bool(row.get('bunting')),
        'fetchedAt': format_created_at(row.get('fetched_at')),
    }


def sorted_holidays(items, *, clean_str=_default_clean_str):
    """Holidays in date order, ties broken by name so the order is total."""
    return sorted(items, key=lambda item: (clean_str(item.get('startDate')), clean_str(item.get('label'))))


def holidays_within_period(
    holiday_rows,
    period_start,
    period_end,
    *,
    serialize_holiday_row=serialize_holiday_row,
    date_ranges_overlap=_default_date_ranges_overlap,
    sorted_holidays=sorted_holidays,
):
    """The bank holidays landing inside a period, in date order.

    The "which holidays does this cohort have" question: what the cohort drawer
    lists and what the cohort row records. Inclusive at both ends, and an
    unknown end of the period means nothing is in it rather than everything --
    a cohort half way through being typed has no period yet.

    This is *not* the set a session plan skips. A plan is free to run past the
    cohort's practical end date -- that is what a holiday does to it -- so
    scheduling asks ``scheduling_holidays_from`` instead.
    """
    serialized = [serialize_holiday_row(row) for row in (holiday_rows or [])]
    in_period = [
        item for item in serialized
        if date_ranges_overlap(period_start, period_end, item.get('startDate'), item.get('endDate'))
    ]
    return sorted_holidays(in_period)


def cohort_holiday_details(
    holiday_rows,
    excluded_ids,
    start_date,
    end_date,
    *,
    serialize_holiday_row=serialize_holiday_row,
    holidays_within_period=holidays_within_period,
    clean_str=_default_clean_str,
):
    """What one cohort's holidays are, given its dates and what it has unticked.

    Every bank holiday inside ``start_date``..``end_date`` applies by default --
    that in-range list is ``holidaysInRange``, the full set of options the
    cohort drawer offers a checkbox for. ``excluded_ids`` is a deny-list: the
    ids a human unticked, subtracted from that set to get ``selectedHolidays``
    and the ``holidayIds`` module session planning skips. It is not the
    selection itself, so an id that matches nothing in range -- a stale id from
    the authored table this no longer reads, or a holiday that has since moved
    out of the period -- simply has nothing to remove.

    An empty or omitted ``excluded_ids`` means nothing is excluded: every
    holiday in the period applies, which is both the default for a cohort
    nobody has touched and the previous, all-or-nothing behaviour this
    replaces.
    """
    serialized = [serialize_holiday_row(row) for row in (holiday_rows or [])]
    in_range = holidays_within_period(holiday_rows, start_date, end_date)
    excluded_set = {clean_str(value) for value in (excluded_ids or []) if clean_str(value)}
    selected = [item for item in in_range if clean_str(item.get('id')) not in excluded_set]
    selected_ids = [clean_str(item.get('id')) for item in selected if clean_str(item.get('id'))]
    excluded_in_range = [
        clean_str(item.get('id')) for item in in_range
        if clean_str(item.get('id')) in excluded_set
    ]
    return {
        'holidayIds': selected_ids,
        'selectedHolidays': selected,
        'holidaysInRange': in_range,
        'excludedHolidayIds': excluded_in_range,
        'summary': {
            'global': len(serialized),
            'inRange': len(in_range),
            'selected': len(selected),
        },
    }


def serialize_cohort_authoring_detail(
    row,
    holiday_rows=None,
    *,
    parse_epa_months=_default_parse_epa_months,
    format_date=_default_format_date,
    cohort_epa_dates=_default_cohort_epa_dates,
    get_holiday_rows_safe,
    read_policy_calendar,
    cohort_holiday_period_end=_default_cohort_holiday_period_end,
    cohort_holiday_details=cohort_holiday_details,
    parse_json_value=_default_parse_json_value,
    parse_int=_default_parse_int,
    calculate_cohort_end_date=_default_calculate_cohort_end_date,
    programme_deleted_row,
    as_json_value=_default_as_json_value,
    format_created_at=_default_format_created_at,
):
    epa_months = parse_epa_months(row.get('epa_months'))
    apprenticeship_end_override = format_date(row.get('apprenticeship_end_override'))
    practical_end_date, apprenticeship_end_date = cohort_epa_dates(
        row.get('end_date'),
        epa_months,
        apprenticeship_end_override,
    )
    # The holidayIds/selectedHolidays/holidaysInRange columns on the row are a
    # record of what the dates (and the exclusions below) resolved to when it
    # was last written, not an input in their own right. They are recomputed
    # here instead of read back: a row written before holidays became England's
    # bank holidays still carries ids into the authored table nobody reads any
    # more, and a row whose dates were changed elsewhere would otherwise answer
    # for the old period. excluded_holiday_ids is the one column that IS read
    # back -- it is the human's own choice, not a derived cache, so there is
    # nothing to recompute it from.
    calendar_rows = get_holiday_rows_safe() if holiday_rows is None else holiday_rows
    calendar_error = ''
    if row.get('calendar_policy'):
        calendar_rows, calendar_error = read_policy_calendar(row, calendar_rows)
    holiday_info = cohort_holiday_details(
        calendar_rows,
        parse_json_value(row.get('excluded_holiday_ids'), []),
        format_date(row.get('start_date')),
        cohort_holiday_period_end(row),
    )
    return {
        'cohortId': row.get('cohort_id'),
        'cohortName': row.get('cohort_name'),
        'programmeId': row.get('programme_id'),
        'programmeName': row.get('programme_name'),
        'startDate': format_date(row.get('start_date')),
        # endDate stays the practical period end so every existing reader keeps
        # its meaning; practicalEndDate is the same value under the name the
        # apprenticeship model uses, and apprenticeshipEndDate adds the EPA
        # period on top of it.
        'endDate': practical_end_date,
        'practicalEndDate': practical_end_date,
        'epaMonths': epa_months,
        'apprenticeshipEndDate': apprenticeship_end_date,
        # Blank unless a human authored the date, so readers can tell an edited
        # apprenticeship end date from one the EPA period produced.
        'apprenticeshipEndOverride': apprenticeship_end_override,
        'durationMonths': parse_int(row.get('duration_months'), 0),
        # The contracted duration rule on its own. Holidays do not move this
        # date; module schedules use selected holidays to skip clashing sessions.
        'baseEndDate': format_date(calculate_cohort_end_date(
            row.get('start_date'),
            parse_int(row.get('duration_months'), 0),
        )),
        'color': row.get('color') or '',
        'status': row.get('status') or 'planned',
        'isProgrammeDeleted': programme_deleted_row(row),
        'trainingPlanIds': as_json_value(row.get('training_plan_ids'), []),
        'groupIds': as_json_value(row.get('group_ids'), []),
        'moduleNames': as_json_value(row.get('module_names'), []),
        'holidayIds': holiday_info['holidayIds'],
        'selectedHolidays': holiday_info['selectedHolidays'],
        'holidaysInRange': holiday_info['holidaysInRange'],
        'excludedHolidayIds': holiday_info['excludedHolidayIds'],
        'calendarPolicy': parse_json_value(row.get('calendar_policy'), None),
        'calendarError': calendar_error,
        'holidaySummary': holiday_info['summary'],
        'notes': row.get('notes') or '',
        'sourceType': row.get('source_type') or 'curriculum_authoring',
        'sourceId': row.get('source_id') or '',
        'updatedAt': format_date(row.get('updated_at')),
        'createdAt': format_created_at(row.get('created_at')),
    }


def attach_cohort_choices(rows, requested=None, excluded=None, *, CHOICE_FIELDS, in_use, lookups):
    """Put each cohort's ``holiday_ids`` / ``excluded_holiday_ids`` on its row."""
    fields = [field for field in CHOICE_FIELDS
              if (requested is None or field in requested) and field not in (excluded or ())]
    wanted = [row for row in rows or [] if row is not None and any(field not in row for field in fields)]
    if not wanted or not fields or not in_use():
        return rows
    # Read with the names, in the request's one lookup round trip.
    choices = lookups().get('cohort_holidays', {})
    for row in wanted:
        entry = choices.get(str(row.get('cohort_id') or ''), {})
        values = {'holiday_ids': list(entry.get('selected', [])),
                  'excluded_holiday_ids': list(entry.get('excluded', []))}
        for field in fields:
            row.setdefault(field, values[field])
    return rows


def cohort_end_preview(
    payload, *, calculate_cohort_end_date, cohort_apprenticeship_end_date, format_date,
    infer_duration_months, parse_date, parse_int, payload_apprenticeship_end_override,
    payload_epa_months,
):
    """Build the existing preview values; holidays do not move cohort contract dates."""
    start_date = parse_date(payload.get('startDate') or payload.get('start_date'))
    calculated_end_date = calculate_cohort_end_date(payload.get('startDate') or payload.get('start_date'), payload.get('durationMonths') or payload.get('duration_months'))
    # An authored practical end date wins over the duration calculation. Editors
    # let the delivery team nudge that date a day either way, and the EPA window
    # has to be counted from the date they actually set, not from the rule.
    authored_end_date = parse_date(
        payload.get('practicalEndDate')
        or payload.get('practical_end_date')
        or payload.get('endDate')
        or payload.get('end_date')
    )
    # Selected holidays belong to module scheduling, not cohort contract dates.
    # A holiday clash skips a generated module session and extends that module's
    # plan; the cohort practical/apprenticeship end dates remain fixed.
    holiday_days = 0
    holiday_breakdown = []
    authored_months = parse_int(payload.get('durationMonths') or payload.get('duration_months'), 0)

    # An authored date still wins outright: a human who typed a contracted date
    # has already accounted for whatever they meant to account for.
    end_date = authored_end_date or calculated_end_date
    # Measured from the end date that actually applies, so an authored date is
    # reported by how long it really runs rather than by the duration rule.
    effective_months = infer_duration_months(start_date, end_date, 0) if start_date and end_date else 0
    epa_months = payload_epa_months(payload)
    override = payload_apprenticeship_end_override(payload)
    apprenticeship_end_date = cohort_apprenticeship_end_date(end_date, epa_months, override)
    warnings = []
    if not end_date:
        warnings.append('Set cohort start date and duration months to calculate the end date.')
    if end_date and not apprenticeship_end_date:
        warnings.append('Set an EPA period in months to calculate the apprenticeship end date.')
    if authored_end_date and start_date and authored_end_date < start_date:
        warnings.append('The practical end date is before the cohort start date.')
    if override and end_date and override < parse_date(end_date):
        warnings.append('The apprenticeship end date is before the practical end date.')
    return {
        'endDate': format_date(end_date),
        'practicalEndDate': format_date(end_date),
        # The date the duration rule gives, kept alongside the authored one so an
        # editor can offer "reset to the calculated date" without a second call.
        'calculatedEndDate': format_date(calculated_end_date),
        # The duration rule on its own. The picker uses this window to show
        # relevant holidays, but those holidays do not move the cohort dates.
        'baseEndDate': format_date(calculated_end_date),
        'holidayExtensionDays': holiday_days,
        'holidayExtensions': holiday_breakdown,
        'durationMonths': authored_months,
        'effectiveDurationMonths': effective_months,
        'practicalEndIsManual': bool(authored_end_date and authored_end_date != calculated_end_date),
        'epaMonths': epa_months,
        'apprenticeshipEndDate': format_date(apprenticeship_end_date),
        'apprenticeshipEndOverride': format_date(override),
        'autoCalculated': bool(end_date),
        'rule': 'add duration months minus one day; holidays extend clashing module schedules, not cohort dates',
        'epaRule': 'add the EPA period in months to the practical end date',
        'apprenticeshipRule': 'the authored apprenticeship end date when set, otherwise the EPA rule',
        'warnings': warnings,
    }
