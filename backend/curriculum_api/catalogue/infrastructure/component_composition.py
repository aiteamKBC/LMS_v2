"""Concrete catalogue / infrastructure / component composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import archive_state
from curriculum_api.catalogue.domain.archive_policy import active_mapping_rows
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_CONTENT_SETTING_KEYS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_DB_OMITTED_KEYS_COLUMN
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_DERIVED_SETTING_KEYS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_FULL_READ_PAGE_ROWS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_SETTINGS_OMITTED_FLAG
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_PAGE_SETTING_KEYS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_VIEW_EXCLUDED_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import SUPPORTED_KSB_WEIGHT_CLASSES
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.cache_access import scoped_curriculum_read
from curriculum_api.catalogue.infrastructure.content_runtime import component_builder_response
from curriculum_api.catalogue.infrastructure.content_runtime import ensure_authoring_mapping_unique
from curriculum_api.catalogue.infrastructure.content_runtime import live_component_rows_without_content
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.record_identity import canonical_authoring_id
from curriculum_api.ksb_coverage import SUPPORTED_CLASSIFICATIONS
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.domain.read_contracts import SUPPORTED_KSB_SOURCE_TYPES
from curriculum_api.reporting.domain.source_values import source_payload_from_mapping
from curriculum_api.reporting.domain.source_values import source_type_label
from curriculum_api.reporting.domain.source_values import source_type_mismatch_message
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import infer_mapping_source_for_code
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import infer_mapping_source_from_module
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import ksb_exists_in_source
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import mappings_with_inferred_sources
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import source_record_exists
from curriculum_api.reporting.infrastructure.source_runtime import component_ksb_mapping_json_item
from curriculum_api.reporting.infrastructure.source_runtime import legacy_weight_class_from_classification
from curriculum_api.reporting.infrastructure.source_runtime import normalise_ksb_classification
from django.db import connection


def validate_ksb_mapping_payload(mapping, path='ksbMappings', source_cache=None):
    from curriculum_api.catalogue.application.content_validation import validate_ksb_mapping_payload as implementation
    return implementation(
        mapping,
        path,
        source_cache,
        SUPPORTED_CLASSIFICATIONS=SUPPORTED_CLASSIFICATIONS,
        SUPPORTED_KSB_SOURCE_TYPES=SUPPORTED_KSB_SOURCE_TYPES,
        SUPPORTED_KSB_WEIGHT_CLASSES=SUPPORTED_KSB_WEIGHT_CLASSES,
        coverage_normalise_code=coverage_normalise_code,
        ksb_exists_in_source=ksb_exists_in_source,
        source_payload_from_mapping=source_payload_from_mapping,
        source_record_exists=source_record_exists,
        source_type_label=source_type_label,
        source_type_mismatch_message=source_type_mismatch_message,
    )


def component_builder_rows(module_catalogue_ids=None, omit_content=False, programme_view=False):
    from curriculum_api.catalogue.application.component_catalogue import component_builder_rows as read
    return read(
        module_catalogue_ids,
        omit_content,
        programme_view,
        COMPONENT_CONTENT_SETTING_KEYS=COMPONENT_CONTENT_SETTING_KEYS,
        COMPONENT_DB_OMITTED_KEYS_COLUMN=COMPONENT_DB_OMITTED_KEYS_COLUMN,
        COMPONENT_DERIVED_SETTING_KEYS=COMPONENT_DERIVED_SETTING_KEYS,
        COMPONENT_SETTINGS_OMITTED_FLAG=COMPONENT_SETTINGS_OMITTED_FLAG,
        PROGRAMME_PAGE_SETTING_KEYS=PROGRAMME_PAGE_SETTING_KEYS,
        PROGRAMME_VIEW_EXCLUDED_COLUMNS=PROGRAMME_VIEW_EXCLUDED_COLUMNS,
        PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS=PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS,
        _component_builder_rows=_component_builder_rows,
        live_component_rows_without_content=live_component_rows_without_content,
    )


def _component_builder_rows(catalogue_ids, component_rows=None, mapping_exclude_columns=None):
    from curriculum_api.catalogue.application.component_catalogue import _component_builder_rows as read
    return read(
        catalogue_ids,
        component_rows,
        mapping_exclude_columns,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        active_component_rows=active_component_rows,
        active_mapping_rows=active_mapping_rows,
        active_week_rows=active_week_rows,
        authoring_fetch_all=authoring_fetch_all,
        component_builder_response=component_builder_response,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        live_component_rows_paged=live_component_rows_paged,
        mappings_with_inferred_sources=mappings_with_inferred_sources,
    )


def live_component_rows_paged(module_ids=None, order_sql='display_order, id'):
    from curriculum_api.catalogue.infrastructure.component_reads import live_component_rows_paged as read
    return read(
        module_ids,
        order_sql,
        _live_component_rows_paged=_live_component_rows_paged,
    )


@scoped_curriculum_read
def _live_component_rows_paged(module_ids, order_sql):
    from curriculum_api.catalogue.infrastructure.component_reads import _live_component_rows_paged as read
    return read(
        module_ids,
        order_sql,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        COMPONENT_FULL_READ_PAGE_ROWS=COMPONENT_FULL_READ_PAGE_ROWS,
        archive_live_sql=lambda *args, **kwargs: archive_state.live_sql(*args, **kwargs),
        authoring_fetch_all=authoring_fetch_all,
        database_vendor=lambda: connection.vendor,
    )


def authoring_mapping_payload(module_catalogue_id, mapping, week_id=None, component_id=None, module_row=None, source_cache=None, enforce_unique=True):
    from curriculum_api.catalogue.application.content_preparation import authoring_mapping_payload as implementation
    return implementation(
        module_catalogue_id,
        mapping,
        week_id,
        component_id,
        module_row,
        source_cache,
        enforce_unique,
        archive_state=archive_state,
        canonical_authoring_id=canonical_authoring_id,
        coverage_normalise_code=coverage_normalise_code,
        ensure_authoring_mapping_unique=ensure_authoring_mapping_unique,
        infer_mapping_source_for_code=infer_mapping_source_for_code,
        infer_mapping_source_from_module=infer_mapping_source_from_module,
        legacy_weight_class_from_classification=legacy_weight_class_from_classification,
        normalise_ksb_classification=normalise_ksb_classification,
        source_payload_from_mapping=source_payload_from_mapping,
    )


def normalise_component_ksb_mappings(module_catalogue_id, mappings, week_id=None, component_id=None, module_row=None, source_cache=None, enforce_unique=False):
    from curriculum_api.catalogue.application.content_preparation import normalise_component_ksb_mappings as implementation
    return implementation(
        module_catalogue_id,
        mappings,
        week_id,
        component_id,
        module_row,
        source_cache,
        enforce_unique,
        authoring_mapping_payload=authoring_mapping_payload,
        component_ksb_mapping_json_item=component_ksb_mapping_json_item,
        coverage_normalise_code=coverage_normalise_code,
    )
