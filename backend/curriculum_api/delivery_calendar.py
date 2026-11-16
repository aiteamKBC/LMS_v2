"""Opt-in delivery policies around, rather than replacing, the England path."""
from .calendar_policy import apply_holiday_choices, merge_policy, read_policy
from .country_calendars import holidays_for_period


def policy_holidays(policy, start, end, legacy_rows):
    if policy is None:
        return list(legacy_rows or [])
    if policy['country'] == 'GB':
        rows = legacy_rows
    elif policy['observePublicHolidays']:
        rows = holidays_for_period(policy['country'], start, end)
    else:
        rows = []
    return apply_holiday_choices(policy, rows)


def module_policy(module):
    from . import views as v
    own = read_policy(module)
    if own is not None:
        return own
    cohort_id = (module or {}).get('cohort_id') or (module or {}).get('cohortId')
    if cohort_id:
        return read_policy(v.fetch_cohort_row(cohort_id) or {})
    return None


def module_holidays(module, inherited):
    from . import views as v
    policy = module_policy(module)
    if policy is None:
        return list(inherited or [])
    own = read_policy(module)
    # A cohort policy's selections already apply to the supplied slice.
    if own is None and inherited is not None:
        return list(inherited)
    start = module.get('start_date') or module.get('startDate')
    end = module.get('end_date') or module.get('endDate') or start
    return policy_holidays(policy, start, end, v.get_holiday_rows_safe())


def policy_write(payload, stored, table):
    from . import views as v
    policy = merge_policy(payload, stored)
    if policy is not None and not v.has_column(table, 'calendar_policy'):
        raise ValueError('Apply curriculum migration 0090 before saving delivery calendars.')
    if 'calendarPolicy' not in payload and 'calendar_policy' not in payload:
        return {}
    if policy is not None and policy['country'] != 'GB' and policy['observePublicHolidays']:
        stored = stored or {}
        start = payload.get('startDate') or payload.get('start_date') or stored.get('start_date')
        end = payload.get('endDate') or payload.get('end_date') or stored.get('end_date')
        if not end and table == v.COHORT_AUTHORING_DETAILS_TABLE:
            end = v.calculate_cohort_end_date(start, v.parse_int(payload.get('durationMonths'), 0))
        holidays_for_period(policy['country'], start, end)
    return {'calendar_policy': v.json_db_value(policy) if policy is not None else None}


def date_non_delivery_reason(value, module):
    from . import views as v
    from .calendar_policy import non_delivery_reason
    policy = module_policy(module)
    if policy is None:
        return v.england_non_delivery_reason(value)
    day = v.parse_date(value)
    if not day:
        return ''
    rows = policy_holidays(policy, module.get('start_date') or day, module.get('end_date') or day, v.get_holiday_rows_safe())
    return non_delivery_reason(day, policy, rows)


def display_cohort_holidays(cohort_ids):
    """Keep a failed country scoped to its own rows in a multi-cohort read."""
    from . import views as v
    from .country_calendars import CalendarUnavailable
    result = {}
    for identifier in dict.fromkeys(cohort_ids):
        try:
            result.update(v.cohort_selected_holidays_by_cohort([identifier]))
        except CalendarUnavailable as exc:
            result[identifier] = [{'_calendarError': str(exc)}]
    return result
