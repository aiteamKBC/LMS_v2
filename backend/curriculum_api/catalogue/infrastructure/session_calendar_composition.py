"""Concrete catalogue / infrastructure / session calendar composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_selected_holidays_by_id
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_week_delivery_slots
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSION_TYPE_SQL
from curriculum_api.meetings.infrastructure.calendar_runtime import module_has_booked_series
from curriculum_api.meetings.infrastructure.session_runtime import live_session_meeting_scope
from curriculum_api.meetings.infrastructure.session_runtime import module_live_session_clock


def delivery_slots_by_catalogue(weeks_by_catalogue, *, modules_by_catalogue=None, groups_by_id=None, holidays_by_cohort=None, strict=False):
    from functools import partial
    from curriculum_api.catalogue.infrastructure import session_reads
    from curriculum_api.catalogue.application.session_links import delivery_slots_by_catalogue as query
    return query(
        weeks_by_catalogue,
        modules_by_catalogue=modules_by_catalogue,
        groups_by_id=groups_by_id,
        holidays_by_cohort=holidays_by_cohort,
        strict=strict,
        read_module_rows=partial(session_reads.module_rows, authoring_fetch_all=authoring_fetch_all, modules_table=AUTHORING_MODULES_TABLE),
        read_group_rows=partial(session_reads.group_rows, authoring_fetch_all=authoring_fetch_all, groups_table=GROUPS_TABLE),
        logger=logger,
        module_week_delivery_slots=module_week_delivery_slots,
    )


def authoring_session_links_by_catalogue(module_catalogue_ids, *, modules_by_catalogue=None, groups_by_id=None, holidays_by_cohort=None, week_rows=None, component_rows=None, strict=False):
    from functools import partial
    from curriculum_api.catalogue.infrastructure import session_reads
    from curriculum_api.catalogue.application.session_links import authoring_session_links_by_catalogue as query
    return query(
        module_catalogue_ids,
        modules_by_catalogue=modules_by_catalogue,
        groups_by_id=groups_by_id,
        holidays_by_cohort=holidays_by_cohort,
        week_rows=week_rows,
        component_rows=component_rows,
        strict=strict,
        read_week_rows=partial(session_reads.week_rows, authoring_fetch_all=authoring_fetch_all, weeks_table=AUTHORING_WEEKS_TABLE),
        read_component_rows=partial(session_reads.component_rows, authoring_fetch_all=authoring_fetch_all, components_table=AUTHORING_COMPONENTS_TABLE, live_session_type_sql=LIVE_SESSION_TYPE_SQL),
        active_component_rows=active_component_rows,
        active_week_rows=active_week_rows,
        component_builder_settings=component_builder_settings,
        delivery_slots_by_catalogue=delivery_slots_by_catalogue,
        live_session_meeting_scope=live_session_meeting_scope,
        logger=logger,
        module_has_booked_series=module_has_booked_series,
    )


def build_sessions_from_authoring_modules(authoring_module_rows, holidays_by_cohort=None, groups_by_id=None, *, session_links=None):
    from curriculum_api.catalogue.application.session_calendar import build_sessions_from_authoring_modules as query
    return query(
        authoring_module_rows,
        holidays_by_cohort,
        groups_by_id,
        session_links=session_links,
        authoring_session_links_by_catalogue=authoring_session_links_by_catalogue,
        module_live_session_clock=module_live_session_clock,
    )


def curriculum_sessions_from_rows(rows, training_rows, authoring_modules, cohorts, groups, holiday_rows, *, list_only_summaries=False):
    from curriculum_api.catalogue.application.session_calendar import curriculum_sessions_from_rows as query
    return query(
        rows,
        training_rows,
        authoring_modules,
        cohorts,
        groups,
        holiday_rows,
        list_only_summaries=list_only_summaries,
        read_links=authoring_session_links_by_catalogue,
        select_holidays=cohort_selected_holidays_by_id,
        build_authored_sessions=build_sessions_from_authoring_modules,
    )


def authored_calendar_snapshot(authoring_modules, cohorts, groups, holiday_rows, **read_options):
    from curriculum_api.catalogue.application.session_calendar import calendar_snapshot_from_rows
    return calendar_snapshot_from_rows(
        authoring_modules,
        cohorts,
        groups,
        holiday_rows,
        read_links=authoring_session_links_by_catalogue,
        select_holidays=cohort_selected_holidays_by_id,
        build_authored_sessions=build_sessions_from_authoring_modules,
        **read_options,
    )
