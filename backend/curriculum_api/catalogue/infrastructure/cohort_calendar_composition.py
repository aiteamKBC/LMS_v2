"""Concrete catalogue / infrastructure / cohort calendar composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.archive_values import archive_stamp_fields
from curriculum_api.catalogue.domain.holiday_selection import cohort_holiday_period_end
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure import placement_reads
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.catalogue_enrichment import home_relationship_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import active_learner_delivery_counts
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows_safe
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_training_rows
from curriculum_api.catalogue.infrastructure.hierarchy_composition import archived_cohort_learners
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_cohort_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import group_authoring_detail_rows
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import resolve_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.row_queries import authoring_rows_by_id
from curriculum_api.catalogue.infrastructure.row_queries import safe_module_index_rows
from curriculum_api.catalogue.infrastructure.runtime_config import COHORT_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_catalogue_rows
from curriculum_api.catalogue.infrastructure.structure_runtime import authoring_modules_as_training_rows


def module_parent_cohort(cohort_id, group_id=''):
    from curriculum_api.catalogue.application.hierarchy_preparation import module_parent_cohort as implementation
    return implementation(
        cohort_id,
        group_id,
        curriculum_cohort_from_authoring_detail=curriculum_cohort_from_authoring_detail,
        resolve_cohort_row=resolve_cohort_row,
        resolve_group_row=resolve_group_row,
        serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
    )


def unique_cohort_id(value=''):
    def existing():
        return [detail.get('cohortId') for detail in cohort_authoring_detail_rows() if detail.get('cohortId')]

    return unique_prefixed_id('COHORT', value, existing)


def build_cohorts_and_groups(training_rows=None, program_configs=None, include_archived=False, *, include_learner_counts=True, source=None):
    from curriculum_api.catalogue.application.delivery_reads import build_cohorts_and_groups as query
    return query(
        training_rows,
        program_configs,
        include_archived,
        include_learner_counts=include_learner_counts,
        source=source,
        active_learner_delivery_counts=active_learner_delivery_counts,
        cohort_authoring_detail_rows=cohort_authoring_detail_rows,
        group_authoring_detail_rows=group_authoring_detail_rows,
        programme_deleted_row=programme_deleted_row,
        safe_module_index_rows=safe_module_index_rows,
    )


def cohort_selected_holidays_by_id(cohorts, holiday_rows):

    def read_overview_calendar(cohort, holiday_rows):
        from curriculum_api.calendar_policy import read_policy
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_holidays
        from curriculum_api.catalogue.infrastructure.country_calendar_reads import CalendarUnavailable
        try:
            return (policy_holidays(read_policy(cohort), cohort.get('startDate') or cohort.get('start_date'), cohort.get('endDate') or cohort.get('end_date'), holiday_rows), None)
        except CalendarUnavailable as exc:
            return ([], str(exc))
    from curriculum_api.catalogue.application.inherited_calendar import cohort_selected_holidays_by_id as query
    return query(
        cohorts,
        holiday_rows,
        read_overview_calendar=read_overview_calendar,
    )


def cohort_selected_holidays_by_cohort(cohort_ids):

    def read_cohort_calendar(cohort, holiday_rows):
        from curriculum_api.calendar_policy import read_policy
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_holidays
        return policy_holidays(read_policy(cohort), cohort.get('start_date'), cohort_holiday_period_end(cohort), holiday_rows)
    from curriculum_api.catalogue.application.inherited_calendar import cohort_selected_holidays_by_cohort as query
    return query(
        cohort_ids,
        authoring_rows_by_id=authoring_rows_by_id,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        COHORT_ROWS_ORDER=COHORT_ROWS_ORDER,
        logger=logger,
        get_holiday_rows=get_holiday_rows,
        read_cohort_calendar=read_cohort_calendar,
    )


def module_cohort_selected_holidays(module_row):
    from curriculum_api.catalogue.application.inherited_calendar import module_cohort_selected_holidays as query
    return query(
        module_row,
        cohort_selected_holidays_by_cohort=cohort_selected_holidays_by_cohort,
    )


def serialize_cohort_authoring_detail(row, holiday_rows=None):

    def read_policy_calendar(row, calendar_rows):
        from curriculum_api.calendar_policy import read_policy
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_holidays
        from curriculum_api.catalogue.infrastructure.country_calendar_reads import CalendarUnavailable
        try:
            return (policy_holidays(read_policy(row), row.get('start_date'), cohort_holiday_period_end(row), calendar_rows), '')
        except CalendarUnavailable as exc:
            return ([], str(exc))
    from curriculum_api.catalogue.application.cohort_calendar import serialize_cohort_authoring_detail as query
    return query(
        row,
        holiday_rows,
        get_holiday_rows_safe=get_holiday_rows_safe,
        read_policy_calendar=read_policy_calendar,
        programme_deleted_row=programme_deleted_row,
    )


def cohort_authoring_detail_rows():
    # One holiday read for the whole page: every cohort resolves its own
    # holidays from its own dates, but they all resolve them against the same
    # calendar.
    from curriculum_api.catalogue.application.delivery_reads import cohort_authoring_detail_rows as query
    return query(
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        COHORT_ROWS_ORDER=COHORT_ROWS_ORDER,
        authoring_fetch_all=authoring_fetch_all,
        get_holiday_rows_safe=get_holiday_rows_safe,
        logger=logger,
        serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
    )


def find_training_rows_by_cohort(cohort_id):
    from curriculum_api.catalogue.application.hierarchy_queries import find_training_rows_by_cohort as implementation
    return implementation(
        cohort_id,
        build_cohorts_and_groups=build_cohorts_and_groups,
        get_program_config_rows=get_program_config_rows,
        get_training_rows=get_training_rows,
        program_config_by_id=program_config_by_id,
    )


def find_group_with_parent(group_id):
    from curriculum_api.catalogue.application.hierarchy_queries import find_group_with_parent as implementation
    return implementation(
        group_id,
        build_cohorts_and_groups=build_cohorts_and_groups,
        get_program_config_rows=get_program_config_rows,
        get_training_rows=get_training_rows,
        program_config_by_id=program_config_by_id,
    )


def home_source_rows(visibility):
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api import curriculum_names
    from curriculum_api.module_authoring_facts import decode_counts
    from curriculum_api.catalogue.infrastructure.programme_reads import home_source_rows as query
    return query(
        visibility,
        authoring_modules_as_catalogue_rows=authoring_modules_as_catalogue_rows,
        authoring_modules_as_training_rows=authoring_modules_as_training_rows,
        curriculum_names=placement_reads,
        decode_counts=decode_counts,
        home_relationship_rows=home_relationship_rows,
        serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
        serialize_group_authoring_detail=serialize_group_authoring_detail,
    )


def archived_cohort_payload(row, archived_group_rows, cohort_learner_counts, holiday_rows=None):
    from curriculum_api.catalogue.application.archive_queries import archived_cohort_payload as query
    return query(
        row, archived_group_rows, cohort_learner_counts, holiday_rows,
        archive_stamp_fields=archive_stamp_fields, archived_cohort_learners=archived_cohort_learners,
        clean_str=clean_str, serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
    )
