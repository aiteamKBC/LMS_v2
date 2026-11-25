"""Concrete catalogue / api / module assembly composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payload
from curriculum_api.catalogue.api.structure_composition import get_authoring_structure_payloads
from curriculum_api.catalogue.domain.delivery_values import attachment_week_count
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_MODULE_IDENTITY_FIELDS
from curriculum_api.catalogue.infrastructure.authoring_columns import CATALOGUE_SUMMARY_COMPONENT_COLUMNS
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_module_exists
from curriculum_api.catalogue.infrastructure.content_runtime import authoring_component_counts_by_catalogue
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.row_queries import module_index_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.session_plan_composition import module_delivery_session_plan
from curriculum_api.catalogue.infrastructure.structure_runtime import programme_authoring_module_rows
from curriculum_api.reporting.domain.source_values import normalise_ksb_profile_source_value
from curriculum_api.weekly_schedule import first_weekly_session_day
from curriculum_api.weekly_schedule import merged_week_starts_on
from curriculum_api.weekly_schedule import merged_weekly_schedule
from curriculum_api.weekly_schedule import module_week_starts_on
from curriculum_api.weekly_schedule import module_weekly_schedule
from curriculum_api.catalogue.domain.authoring_errors import ModuleAuthoringValidationError
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import cohort_selected_holidays_by_cohort


def programme_authoring_modules(programme, config=None, *, module_rows=None, child_rows=None, payloads_by_id=None):
    from curriculum_api.catalogue.application.module_assembly import programme_authoring_modules as query
    return query(
        programme,
        config,
        module_rows=module_rows,
        child_rows=child_rows,
        payloads_by_id=payloads_by_id,
        CATALOGUE_SUMMARY_COMPONENT_COLUMNS=CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
        get_authoring_structure_payloads=get_authoring_structure_payloads,
        programme_authoring_module_rows=programme_authoring_module_rows,
    )


def programme_config_modules(config):
    from curriculum_api.catalogue.application.module_assembly import programme_config_modules as query
    return query(
        config,
        get_authoring_structure_payloads=get_authoring_structure_payloads,
    )


def enrich_curriculum_modules_with_authoring_details(modules, *, child_rows=None, authoring_payloads=None):
    from curriculum_api.catalogue.application.module_assembly import enrich_curriculum_modules_with_authoring_details as query
    return query(
        modules,
        child_rows=child_rows,
        authoring_payloads=authoring_payloads,
        CATALOGUE_SUMMARY_COMPONENT_COLUMNS=CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
        get_authoring_structure_payloads=get_authoring_structure_payloads,
    )


def programme_workspace_module_candidates(modules, programme, config):
    """Compatibility entry point for the shared programme module query."""
    return programme_module_candidates(modules, programme, config, workspace_view=True)


def programme_module_candidates(modules, programme, config, *, workspace_view=False, module_rows=None, known_programme_ids=()):
    from curriculum_api.programme_workspace_reads import component_text_cancels, programme_structure_child_rows
    from curriculum_api.catalogue.application.programme_modules import programme_module_candidates as query
    return query(
        modules,
        programme,
        config,
        workspace_view=workspace_view,
        module_rows=module_rows,
        known_programme_ids=known_programme_ids,
        PROGRAMME_MODULE_IDENTITY_FIELDS=PROGRAMME_MODULE_IDENTITY_FIELDS,
        CATALOGUE_SUMMARY_COMPONENT_COLUMNS=CATALOGUE_SUMMARY_COMPONENT_COLUMNS,
        component_text_cancels=component_text_cancels,
        enrich_curriculum_modules_with_authoring_details=enrich_curriculum_modules_with_authoring_details,
        get_authoring_structure_payloads=get_authoring_structure_payloads,
        module_index_rows=lambda: module_index_rows(ensure_tables=False),
        programme_authoring_module_rows=programme_authoring_module_rows,
        programme_authoring_modules=programme_authoring_modules,
        programme_structure_child_rows=programme_structure_child_rows,
    )


def module_attachment_authoring_payload(item, group, cohort, catalogue_id, module_name, session_count, start_date, end_date, current_structure=None, source_type='module_authoring', source_id=''):
    from curriculum_api.catalogue.application.attachment_preparation import module_attachment_authoring_payload as implementation
    return implementation(
        item,
        group,
        cohort,
        catalogue_id,
        module_name,
        session_count,
        start_date,
        end_date,
        current_structure,
        source_type,
        source_id,
        attachment_week_count=attachment_week_count,
        attachment_week_structure=attachment_week_structure,
        first_weekly_session_day=first_weekly_session_day,
        merged_week_starts_on=merged_week_starts_on,
        merged_weekly_schedule=merged_weekly_schedule,
        normalise_ksb_profile_source_value=normalise_ksb_profile_source_value,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        cohort_selected_holidays_by_cohort=cohort_selected_holidays_by_cohort,
    )


def attachment_week_structure(item, current_structure=None, week_count=None, session_count=0, schedule=''):
    from curriculum_api.catalogue.application.attachment_preparation import attachment_week_structure as implementation
    return implementation(
        item,
        current_structure,
        week_count,
        session_count,
        schedule,
        attachment_week_count=attachment_week_count,
        first_weekly_session_day=first_weekly_session_day,
        module_delivery_session_plan=module_delivery_session_plan,
        module_week_starts_on=module_week_starts_on,
        module_weekly_schedule=module_weekly_schedule,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
    )


def contentful_catalogue_id_for_attachment(item, group, cohort, module_name, current_catalogue_id=''):
    from curriculum_api.catalogue.application.attachment_preparation import contentful_catalogue_id_for_attachment as implementation
    return implementation(
        item,
        group,
        cohort,
        module_name,
        current_catalogue_id,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_component_counts_by_catalogue=authoring_component_counts_by_catalogue,
        authoring_fetch_all=authoring_fetch_all,
        authoring_module_exists=authoring_module_exists,
        get_authoring_structure_payload=get_authoring_structure_payload,
        logger=logger,
    )
