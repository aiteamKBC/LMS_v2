"""Bind catalogue overview reads to their existing projections and data readers.

No HTTP handler, writer algorithm or business rule is duplicated here."""
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_ROWS_CACHE_TTL_SECONDS
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.directory.infrastructure.assignment_count_runtime import attach_module_assignment_counts
from curriculum_api.catalogue.infrastructure.session_calendar_composition import authoring_session_links_by_catalogue
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import build_cohorts_and_groups
from curriculum_api.reporting.infrastructure.source_runtime import build_ksb_data
from curriculum_api.catalogue.infrastructure.structure_runtime import build_modules
from curriculum_api.catalogue.infrastructure.programme_builder_runtime import build_programmes
from curriculum_api.catalogue.infrastructure.session_calendar_composition import build_sessions_from_authoring_modules
from curriculum_api.catalogue.api.catalogue_adapters import build_staff_profiles
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_authoring_detail_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_selected_holidays_by_id
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.session_calendar_composition import curriculum_sessions_from_rows
from curriculum_api.catalogue.api.catalogue_adapters import enrich_modules_with_authoring
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_cached_curriculum_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_required_curriculum_rows
from curriculum_api.catalogue.infrastructure.placement_runtime import group_authoring_detail_rows
from curriculum_api.catalogue.domain.hierarchy_values import group_tutor_from_module_names
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import is_archived_module_summary
from curriculum_api.catalogue.domain.delivery_values import is_operational_training_row
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_authoring_row_is_archived
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import serialize_cohort_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key


def build_curriculum_payload(visibility='operational', compact=False, force=False, *, learner_profiles=False):
    from curriculum_api.catalogue.application.cached_reads import build_curriculum_payload as query
    return query(
        visibility, compact, force, learner_profiles=learner_profiles,
        build_curriculum_payload_from_rows=build_curriculum_payload_from_rows,
        curriculum_read_scope=curriculum_read_scope, get_cached_curriculum_rows=get_cached_curriculum_rows,
        logger=logger,
    )


def build_curriculum_overview(visibility='operational', compact=False, force=False, *, learner_profiles=False):
    from curriculum_api.catalogue.application.cached_reads import build_curriculum_overview as implementation
    return implementation(
        visibility, compact, force, learner_profiles=learner_profiles,
        CURRICULUM_ROWS_CACHE_TTL_SECONDS=CURRICULUM_ROWS_CACHE_TTL_SECONDS, build_curriculum_payload_from_rows=build_curriculum_payload_from_rows, cached_curriculum_value=cached_curriculum_value,
        curriculum_read_scope=curriculum_read_scope, get_required_curriculum_rows=get_required_curriculum_rows,
    )


def build_curriculum_payload_from_rows(rows, visibility='operational', compact=False, *, home_summary=False, module_list=False, delivery_source=None, programme_list=False, learner_profiles=False):
    with curriculum_read_scope():
        return _build_curriculum_payload_from_rows(rows, visibility, compact=compact, home_summary=home_summary, module_list=module_list, delivery_source=delivery_source, programme_list=programme_list, learner_profiles=learner_profiles)


def _build_curriculum_payload_from_rows(rows, visibility='operational', compact=False, *, home_summary=False, module_list=False, delivery_source=None, programme_list=False, learner_profiles=False):
    from curriculum_api.catalogue.application.overview_delivery import _build_curriculum_payload_from_rows as implementation
    return implementation(
        rows, visibility, compact, home_summary=home_summary, module_list=module_list, delivery_source=delivery_source, programme_list=programme_list, learner_profiles=learner_profiles,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, attach_module_assignment_counts=attach_module_assignment_counts, authoring_session_links_by_catalogue=authoring_session_links_by_catalogue,
        build_cohorts_and_groups=build_cohorts_and_groups, build_ksb_data=build_ksb_data, build_modules=build_modules,
        build_programmes=build_programmes, build_sessions_from_authoring_modules=build_sessions_from_authoring_modules, build_staff_profiles=build_staff_profiles,
        clean_str=clean_str, cohort_authoring_detail_rows=cohort_authoring_detail_rows, cohort_selected_holidays_by_id=cohort_selected_holidays_by_id,
        curriculum_sessions_from_rows=curriculum_sessions_from_rows, enrich_modules_with_authoring=enrich_modules_with_authoring, format_date=format_date,
        get_holiday_rows=get_holiday_rows, group_authoring_detail_rows=group_authoring_detail_rows, group_tutor_from_module_names=group_tutor_from_module_names,
        is_archived_module_summary=is_archived_module_summary, is_operational_training_row=is_operational_training_row, module_authoring_row_is_archived=module_authoring_row_is_archived,
        parse_date=parse_date, programme_deleted_row=programme_deleted_row, serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
        serialize_group_authoring_detail=serialize_group_authoring_detail, staff_assignment_key=staff_assignment_key,
    )
