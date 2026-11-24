"""Concrete catalogue / infrastructure / session plan persistence capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from collections import defaultdict
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.delivery_values import module_session_clock
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.calendar_runtime import calendar_clock_to_utc_iso
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_selected_holidays_by_cohort
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_week_delivery_slots
from curriculum_api.meetings.infrastructure.session_runtime import module_live_session_clock
from datetime import datetime
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_delivery_row
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_session_plan_for_weeks


def apply_module_session_plan_to_weeks(module, group_row, weeks, *, holidays=None):
    from curriculum_api.catalogue.application.session_plan_updates import apply_module_session_plan_to_weeks as implementation
    def is_calendar_unavailable(exc):
        from curriculum_api.catalogue.infrastructure.country_calendar_reads import CalendarUnavailable
        return isinstance(exc, CalendarUnavailable)
    return implementation(
        module, group_row, weeks, holidays=holidays,
        calendar_clock_to_utc_iso=calendar_clock_to_utc_iso, clean_str=clean_str,
        format_date=format_date, is_calendar_unavailable=is_calendar_unavailable,
        module_live_session_clock=module_live_session_clock,
        module_session_clock=module_session_clock,
        module_week_delivery_slots=module_week_delivery_slots, parse_int=parse_int,
        module_delivery_row=module_delivery_row,
        module_session_plan_for_weeks=module_session_plan_for_weeks,
    )


def persist_group_module_session_dates(module_rows, group_row):
    from curriculum_api.catalogue.application.session_plan_updates import persist_group_module_session_dates as implementation
    def read_session_plan_rows(*args):
        from curriculum_api.catalogue.infrastructure.session_writes import read_session_plan_rows as operation
        return operation(*args, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE, AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE, active_component_rows=active_component_rows, active_week_rows=active_week_rows, authoring_fetch_all=authoring_fetch_all)
    def write_session_settings(*args):
        from curriculum_api.catalogue.infrastructure.session_writes import write_session_settings as operation
        return operation(*args, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE, json_db_value=json_db_value, update_authoring_rows=update_authoring_rows)
    return implementation(
        module_rows, group_row,
        apply_module_session_plan_to_weeks=apply_module_session_plan_to_weeks,
        as_json_value=as_json_value, clean_str=clean_str,
        cohort_selected_holidays_by_cohort=cohort_selected_holidays_by_cohort, datetime=datetime,
        defaultdict=defaultdict, frontend_component_type=frontend_component_type,
        parse_int=parse_int, read_session_plan_rows=read_session_plan_rows,
        write_session_settings=write_session_settings,
    )
