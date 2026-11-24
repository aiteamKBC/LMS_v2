"""Concrete catalogue / infrastructure / calendar runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from config.time_zones import local_clock_to_utc
from curriculum_api import calendar_holidays
from curriculum_api.catalogue.application.session_plans import holiday_details_by_date
from curriculum_api.catalogue.domain.delivery_pattern import parse_clock_minutes
from curriculum_api.catalogue.domain.delivery_values import delivery_days_per_week
from curriculum_api.catalogue.domain.delivery_values import module_stored_session_count
from curriculum_api.catalogue.domain.read_contracts import AUTHORED_HOLIDAYS_TABLE
from curriculum_api.catalogue.domain.read_contracts import ENGLAND_HOLIDAYS_TABLE
from curriculum_api.catalogue.domain.read_contracts import WEEKDAY_INDEX
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.placement_runtime import safe_group_delivery_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.infrastructure.calendar_runtime import graph_timezone_iana
from curriculum_api.session_overrides import session_overrides
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule
from datetime import datetime
from datetime import timedelta


def build_module_session_plan(start_value, number_of_sessions, delivery_days, holidays=None, week_count=0, week_starts_on=None):
    from curriculum_api.catalogue.domain.session_plan import build_module_session_plan as query
    return query(
        start_value,
        number_of_sessions,
        delivery_days,
        holidays,
        week_count,
        week_starts_on,
        holiday_details_by_date=holiday_details_by_date,
        WEEKDAY_INDEX=WEEKDAY_INDEX,
    )


def holiday_table_name():
    from curriculum_api.catalogue.infrastructure.holiday_reads import holiday_table_name as implementation
    return implementation(
        ENGLAND_HOLIDAYS_TABLE=ENGLAND_HOLIDAYS_TABLE, calendar_holidays=calendar_holidays,
        table_exists=table_exists,
    )


def authored_holiday_table_name():
    from curriculum_api.catalogue.infrastructure.holiday_reads import authored_holiday_table_name as implementation
    return implementation(
        AUTHORED_HOLIDAYS_TABLE=AUTHORED_HOLIDAYS_TABLE, table_exists=table_exists,
    )


def module_delivery_row(module_row, group_row=None):
    from curriculum_api.catalogue.domain.delivery_pattern import module_delivery_row as query
    return query(
        module_row,
        group_row,
        module_weekly_schedule=module_weekly_schedule,
    )


def module_week_delivery_days(module_row, week_count=0):
    """How many planned dates one authored week consumes.

    The stored delivery day is the authority -- it is what the plan generator
    itself steps through -- but a module whose row never got one still knows the
    ratio, because it stores both counts: 20 sessions across 10 weeks runs two a
    week whatever the day column says. Taking the larger of the two is what keeps
    this identical to the frontend's `moduleDeliveryDaysPerWeek`, which has only
    the counts to read.
    """
    weeks = max(0, parse_int(week_count, 0))
    from_counts = 1
    if weeks:
        from_counts = max(1, round(module_stored_session_count(module_row, weeks) / weeks))
    return max(1, delivery_days_per_week(module_row), from_counts)


def calendar_clock_to_utc_iso(date_value, time_value, time_zone=None):
    """A calendar-zone wall clock as the instant it names.

    Session dates and times are stored as the local clock the timetable is read
    in; anything that reaches a browser has to name its offset instead, or the
    reader's own zone silently reinterprets it (see ``utc_iso_value``).
    """
    day = parse_date(date_value)
    minutes = parse_clock_minutes(time_value)
    if not day or minutes is None:
        return ''
    naive = datetime(day.year, day.month, day.day) + timedelta(minutes=minutes)
    try:
        return local_clock_to_utc(naive, time_zone or graph_timezone_iana({})).isoformat()
    except ValueError:
        logger.warning('Calendar clock cannot name a unique instant in its saved time zone.')
        return ''


def module_schedule_view(module, tutor_name=None):
    from curriculum_api.catalogue.application.delivery_schedules import module_schedule_view as query
    return query(
        module,
        tutor_name,
        module_weekly_schedule=module_weekly_schedule,
        module_week_starts_on=module_week_starts_on,
        session_overrides=session_overrides,
    )


def module_delivery_day_gap(schedule, groups=None):
    from curriculum_api.catalogue.application.delivery_schedules import module_delivery_day_gap as query
    return query(
        schedule,
        groups,
        safe_group_delivery_rows=safe_group_delivery_rows,
    )


def england_holiday_exists(identifier):
    from curriculum_api.catalogue.infrastructure.holiday_reads import england_holiday_exists as implementation
    return implementation(
        identifier,
        ENGLAND_HOLIDAYS_TABLE=ENGLAND_HOLIDAYS_TABLE,
        calendar_holidays=calendar_holidays,
        fetch_all=fetch_all,
        table_exists=table_exists,
        table_name=table_name,
    )
