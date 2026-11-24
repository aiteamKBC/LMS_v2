"""Concrete catalogue programme lifecycle composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import archive_state
from curriculum_api import calendar_holidays
from curriculum_api import group_coaches
from curriculum_api.catalogue.api.adapters import permanent_delete_reference_refusal
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.authoring_errors import ProgrammeContentRetained
from curriculum_api.catalogue.domain.hierarchy_values import programme_identifier_candidates
from curriculum_api.catalogue.domain.hierarchy_values import programme_status_is_archived
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.read_contracts import RESTORE_NULLABLE_COLUMNS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_guards import refuse_if_programme_owns_content
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_decision
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_storage
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_config_by_identifier
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import unhook_programme_reusables
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import ensure_program_config_archive_columns
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import restore_rows_via_parent
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_where_any
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import orphan_programme_name_clause
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import programme_config_rows_remaining
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import programme_permanent_delete_plan
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import restore_payload
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import restore_soft_delete_payload
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import soft_delete_payload
from curriculum_api.catalogue.infrastructure.row_queries import programme_config_key_column
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.write_composition import delete_rows
from curriculum_api.meetings.domain.read_contracts import LIVE_SESSIONS_TABLE
from django.db import DatabaseError
from django.db import IntegrityError
from django.db import transaction
from django.http import JsonResponse


def soft_delete_programme_authoring_structure(identifier, programme=None, config=None):
    from curriculum_api.catalogue.application.programme_lifecycle import soft_delete_programme_authoring_structure as implementation
    return implementation(
        identifier, programme, config,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        archive_state=archive_state,
        authoring_soft_delete=authoring_soft_delete,
        authoring_table_name=authoring_table_name,
        clean_str=clean_str,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        logger=logger,
        orphan_programme_name_clause=orphan_programme_name_clause,
        programme_config_by_identifier=programme_config_by_identifier,
        programme_config_identity=programme_config_identity,
        programme_config_key_column=programme_config_key_column,
        programme_identifier_candidates=programme_identifier_candidates,
        quote_ident=quote_ident,
        soft_delete_payload=soft_delete_payload,
        update_rows=update_rows,
    )


def restore_programme_authoring_structure(identifier, programme=None, config=None):
    from curriculum_api.catalogue.application.programme_lifecycle import restore_programme_authoring_structure as implementation
    return implementation(
        identifier, programme, config,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        RESTORE_NULLABLE_COLUMNS=RESTORE_NULLABLE_COLUMNS,
        clean_str=clean_str,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        logger=logger,
        programme_config_by_identifier=programme_config_by_identifier,
        programme_config_identity=programme_config_identity,
        programme_config_key_column=programme_config_key_column,
        quote_ident=quote_ident,
        restore_payload=restore_payload,
        restore_rows_via_parent=restore_rows_via_parent,
        restore_soft_delete_payload=restore_soft_delete_payload,
        update_rows=update_rows,
    )


def permanently_delete_programme_structure(plan, force_content=False):
    from curriculum_api.catalogue.application.programme_deletion import permanently_delete_programme_structure as implementation
    return implementation(
        plan, force_content,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        LIVE_SESSIONS_TABLE=LIVE_SESSIONS_TABLE,
        calendar_holidays=calendar_holidays,
        curriculum_in_clause=curriculum_in_clause,
        curriculum_where_any=curriculum_where_any,
        delete_rows=delete_rows,
        group_coaches=group_coaches,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        log_curriculum_storage=log_curriculum_storage,
        programme_config_key_column=programme_config_key_column,
        refuse_if_programme_owns_content=refuse_if_programme_owns_content,
        table_exists=table_exists,
        unhook_programme_reusables=unhook_programme_reusables,
    )


def permanent_programme_delete_response(identifier, programme=None, config=None, force_content=False):
    from curriculum_api.catalogue.api.lifecycle_commands import permanent_programme_delete_response as implementation
    return implementation(
        identifier, programme, config, force_content,
        DatabaseError=DatabaseError,
        IntegrityError=IntegrityError,
        JsonResponse=JsonResponse,
        ProgrammeContentRetained=ProgrammeContentRetained,
        clean_str=clean_str,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        is_archived_program_config=is_archived_program_config,
        json_error=json_error,
        log_curriculum_decision=log_curriculum_decision,
        logger=logger,
        permanent_delete_reference_refusal=permanent_delete_reference_refusal,
        permanently_delete_programme_structure=permanently_delete_programme_structure,
        programme_config_rows_remaining=programme_config_rows_remaining,
        programme_permanent_delete_plan=programme_permanent_delete_plan,
        programme_status_is_archived=programme_status_is_archived,
        transaction=transaction,
    )
