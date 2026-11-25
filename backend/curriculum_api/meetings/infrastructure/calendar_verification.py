"""Concrete meetings / infrastructure / calendar verification capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from collections import Counter
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.calendar_runtime import calendar_clock_to_utc_iso
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.catalogue_sources import england_non_delivery_reason
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows_safe
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_selected_holidays_by_cohort
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.session_calendar_composition import authoring_session_links_by_catalogue
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_session_plan_for_count
from curriculum_api.meetings.domain.instants import parse_graph_datetime
from curriculum_api.meetings.domain.read_contracts import TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES
from curriculum_api.meetings.domain.read_contracts import TEAMS_SYNC_REPORTED_DATE_LIMIT
from curriculum_api.meetings.domain.recurrence_policy import teams_calendar_minute_key
from curriculum_api.meetings.infrastructure.session_runtime import module_live_session_clock
from datetime import datetime
from datetime import timezone
from zoneinfo import ZoneInfo


def teams_non_delivery_reason(targets, time_zone='Europe/London', holiday_rows=None, module_catalogue_id=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.delivery_validation import teams_non_delivery_reason as implementation

    def load_module_policy():
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import module_policy, policy_holidays
        return module_policy, policy_holidays

    def load_non_delivery_reason():
        from curriculum_api.calendar_policy import non_delivery_reason
        return non_delivery_reason,

    return implementation(
        targets, time_zone, holiday_rows, module_catalogue_id, ZoneInfo=ZoneInfo,
        authoring_module_exists=authoring_module_exists, datetime=datetime,
        england_non_delivery_reason=england_non_delivery_reason, get_holiday_rows_safe=get_holiday_rows_safe,
        load_module_policy=load_module_policy, load_non_delivery_reason=load_non_delivery_reason,
        parse_graph_datetime=parse_graph_datetime, parse_int=parse_int, timezone=timezone,
        module_cohort_selected_holidays=module_cohort_selected_holidays,
    )



def module_expected_teams_occurrence_keys(module_row, holidays=None, group_row=None, live_sessions=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.calendar_status import module_expected_teams_occurrence_keys as implementation
    return implementation(
        module_row,
        holidays,
        group_row,
        live_sessions,
        authoring_session_links_by_catalogue=authoring_session_links_by_catalogue,
        calendar_clock_to_utc_iso=calendar_clock_to_utc_iso,
        clean_str=clean_str,
        format_date=format_date,
        module_live_session_clock=module_live_session_clock,
        module_session_plan_for_count=module_session_plan_for_count,
        teams_calendar_minute_key=teams_calendar_minute_key,
    )


def teams_calendar_sync_verdict(module_row, occurrence_rows, holidays=None, group_row=None, occurrences_readable=True, holidays_readable=True, live_sessions=None):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.calendar_status import teams_calendar_sync_verdict as implementation
    return implementation(
        module_row,
        occurrence_rows,
        holidays,
        group_row,
        occurrences_readable,
        holidays_readable,
        live_sessions,
        Counter=Counter,
        TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES=TEAMS_OFF_CALENDAR_OCCURRENCE_STATUSES,
        TEAMS_SYNC_REPORTED_DATE_LIMIT=TEAMS_SYNC_REPORTED_DATE_LIMIT,
        clean_str=clean_str,
        module_expected_teams_occurrence_keys=module_expected_teams_occurrence_keys,
        teams_calendar_minute_key=teams_calendar_minute_key,
    )


def teams_calendar_sync_verdicts(module_catalogue_ids, occurrences_by_module, occurrences_readable=True):
    """Compose the existing runtime capabilities for the meeting boundary."""
    from curriculum_api.meetings.application.calendar_status import teams_calendar_sync_verdicts as implementation
    def calendar_fallback():
        from curriculum_api.catalogue.infrastructure.country_calendar_reads import CalendarUnavailable

        def display_cohort_holidays(cohort_ids):
            from curriculum_api.catalogue.infrastructure.calendar_display import display_cohort_holidays as read_holidays
            return read_holidays(cohort_ids)

        return CalendarUnavailable, display_cohort_holidays
    return implementation(
        module_catalogue_ids,
        occurrences_by_module,
        occurrences_readable,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        authoring_session_links_by_catalogue=authoring_session_links_by_catalogue,
        calendar_fallback=calendar_fallback,
        clean_str=clean_str,
        cohort_selected_holidays_by_cohort=cohort_selected_holidays_by_cohort,
        curriculum_in_clause=curriculum_in_clause,
        logger=logger,
        teams_calendar_sync_verdict=teams_calendar_sync_verdict,
    )

from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import module_cohort_selected_holidays
