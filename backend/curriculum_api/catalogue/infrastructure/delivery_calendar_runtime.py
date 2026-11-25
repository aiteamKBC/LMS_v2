"""Bind calendar policy to concrete curriculum reads and payload encoding.

Policy inheritance, holiday exclusions and validation order are unchanged.
"""
from curriculum_api.calendar_policy import apply_holiday_choices, merge_policy, read_policy
from .country_calendar_reads import holidays_for_period
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.domain.hierarchy_dates import calculate_cohort_end_date
from curriculum_api.catalogue.infrastructure.catalogue_sources import england_non_delivery_reason
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_cohort_row
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows_safe
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.values import parse_int


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
    own = read_policy(module)
    if own is not None:
        return own
    cohort_id = (module or {}).get('cohort_id') or (module or {}).get('cohortId')
    if cohort_id:
        return read_policy(fetch_cohort_row(cohort_id) or {})
    return None


def module_holidays(module, inherited):
    policy = module_policy(module)
    if policy is None:
        return list(inherited or [])
    own = read_policy(module)
    # A cohort policy's selections already apply to the supplied slice.
    if own is None and inherited is not None:
        return list(inherited)
    start = module.get('start_date') or module.get('startDate')
    end = module.get('end_date') or module.get('endDate') or start
    return policy_holidays(policy, start, end, get_holiday_rows_safe())


def policy_write(payload, stored, table):
    policy = merge_policy(payload, stored)
    if policy is not None and not has_column(table, 'calendar_policy'):
        raise ValueError('Apply curriculum migration 0090 before saving delivery calendars.')
    if 'calendarPolicy' not in payload and 'calendar_policy' not in payload:
        return {}
    if policy is not None and policy['country'] != 'GB' and policy['observePublicHolidays']:
        stored = stored or {}
        start = payload.get('startDate') or payload.get('start_date') or stored.get('start_date')
        end = payload.get('endDate') or payload.get('end_date') or stored.get('end_date')
        if not end and table == COHORT_AUTHORING_DETAILS_TABLE:
            end = calculate_cohort_end_date(start, parse_int(payload.get('durationMonths'), 0))
        holidays_for_period(policy['country'], start, end)
    return {'calendar_policy': json_db_value(policy) if policy is not None else None}


def date_non_delivery_reason(value, module):
    from curriculum_api.calendar_policy import non_delivery_reason
    policy = module_policy(module)
    if policy is None:
        return england_non_delivery_reason(value)
    day = parse_date(value)
    if not day:
        return ''
    rows = policy_holidays(policy, module.get('start_date') or day, module.get('end_date') or day, get_holiday_rows_safe())
    return non_delivery_reason(day, policy, rows)
