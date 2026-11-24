"""Concrete catalogue / infrastructure / cohort persistence composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.hierarchy_dates import cohort_practical_end_date
from curriculum_api.catalogue.domain.hierarchy_dates import payload_apprenticeship_end_override
from curriculum_api.catalogue.domain.hierarchy_dates import payload_epa_months
from curriculum_api.catalogue.domain.hierarchy_values import parse_notes_id_list
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.calendar_runtime import holiday_table_name
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import serialize_cohort_authoring_detail
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import unique_cohort_id
from curriculum_api.catalogue.infrastructure.hierarchy_composition import canonical_programme_id
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.placement_runtime import curriculum_cohort_from_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_cohort_row
from curriculum_api.catalogue.infrastructure.placement_runtime import title_case_status
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.runtime_config import logger


def cohort_authoring_payload(cohort, rows=None, groups=None, holiday_rows=None, extra=None):
    from curriculum_api.catalogue.application.hierarchy_preparation import cohort_authoring_payload as implementation

    def policy_write(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_write as capability
        return capability(*args, **kwargs)

    def read_policy(*args, **kwargs):
        from curriculum_api.calendar_policy import read_policy as capability
        return capability(*args, **kwargs)

    def policy_holidays(*args, **kwargs):
        from curriculum_api.catalogue.infrastructure.delivery_calendar_runtime import policy_holidays as capability
        return capability(*args, **kwargs)
    return implementation(
        cohort,
        rows,
        groups,
        holiday_rows,
        extra,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        canonical_programme_id=canonical_programme_id,
        fetch_cohort_row=fetch_cohort_row,
        get_program_config_rows=get_program_config_rows,
        json_db_value=json_db_value,
        policy_holidays=policy_holidays,
        policy_write=policy_write,
        program_config_by_id=program_config_by_id,
        read_policy=read_policy,
    )


def persist_cohort_authoring_detail(cohort, rows=None, groups=None, holiday_rows=None, extra=None, *, raise_on_error=False):
    from curriculum_api.catalogue.infrastructure.hierarchy_writes import persist_cohort_authoring_detail as implementation
    return implementation(
        cohort, rows, groups, holiday_rows, extra, raise_on_error=raise_on_error,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        authoring_upsert=authoring_upsert,
        cohort_authoring_payload=cohort_authoring_payload,
        logger=logger,
    )


def save_tree_cohort(cohort, programme_id, programme_name, preserve_missing_groups=False):
    from curriculum_api.catalogue.application.hierarchy_commands import save_tree_cohort as implementation
    return implementation(
        cohort, programme_id, programme_name, preserve_missing_groups,
        clean_str=clean_str,
        cohort_practical_end_date=cohort_practical_end_date,
        curriculum_cohort_from_authoring_detail=curriculum_cohort_from_authoring_detail,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        fetch_cohort_row=fetch_cohort_row,
        format_date=format_date,
        get_holiday_rows=get_holiday_rows,
        holiday_table_name=holiday_table_name,
        logger=logger,
        parse_int=parse_int,
        parse_json_value=parse_json_value,
        parse_notes_id_list=parse_notes_id_list,
        payload_apprenticeship_end_override=payload_apprenticeship_end_override,
        payload_epa_months=payload_epa_months,
        persist_cohort_authoring_detail=persist_cohort_authoring_detail,
        serialize_cohort_authoring_detail=serialize_cohort_authoring_detail,
        title_case_status=title_case_status,
        unique=unique,
        unique_cohort_id=unique_cohort_id,
    )
