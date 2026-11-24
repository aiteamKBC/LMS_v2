"""Concrete catalogue / infrastructure / content runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import archive_state
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.archive_values import archived_at
from curriculum_api.catalogue.domain.component_policy import component_builder_settings
from curriculum_api.catalogue.domain.component_policy import component_mapping_identity
from curriculum_api.catalogue.domain.content_values import active_component_rows
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_CONTENT_SETTING_KEYS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_DB_OMITTED_KEYS_COLUMN
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_FULL_READ_PAGE_ROWS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_SUMMARY_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_SUMMARY_MODULE_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_SUMMARY_WEEK_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import LEGACY_REFLECTION_QUESTION_SETTING
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_ORIGINS
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_ORIGIN_ACTIVE
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_ORIGIN_ARCHIVED
from curriculum_api.catalogue.domain.read_contracts import LIBRARY_ORIGIN_LIBRARY
from curriculum_api.catalogue.domain.read_contracts import RETIRED_COMPONENT_TYPES
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_columns import REFLECTION_QUESTION_COLUMN
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_runtime import learning_read_table
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import deleted_sql_condition
from curriculum_api.catalogue.infrastructure.record_identity import canonical_authoring_id
from curriculum_api.catalogue.infrastructure.record_identity import unique_timestamp_prefixed_id
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.infrastructure.source_runtime import component_ksb_mapping_api_item
from curriculum_api.reporting.infrastructure.source_runtime import component_ksb_mappings_from_row
from django.db import connection
import json


def duplicate_mapping_query(component_id, identities, exclude_id=''):
    identities = [identity for identity in identities if identity[0] and identity[1]]
    if not identities:
        return []
    clauses = []
    params = []
    for _, code, source_type, source_id in identities:
        clauses.append('(component_id = %s and upper(ksb_code) = %s and coalesce(source_type, %s) = %s and coalesce(source_id, %s) = %s)')
        params.extend([component_id, code, '', source_type, '', source_id])
    where = ' or '.join(clauses)
    if exclude_id:
        where = f'id <> %s and ({where})'
        params = [exclude_id, *params]
    return authoring_fetch_all(AUTHORING_KSB_MAPPINGS_TABLE, where, params)


def ensure_authoring_mapping_unique(component_id, mapping, mapping_id=''):
    identity = component_mapping_identity(component_id, mapping)
    if not identity[0] or not identity[1]:
        return
    duplicate = duplicate_mapping_query(component_id, [identity], exclude_id=mapping_id)
    if duplicate:
        raise ValueError('This KSB is already mapped to this component.')


def validate_mapping_duplicates(mappings, path):
    from curriculum_api.catalogue.domain.content_validation import validate_mapping_duplicates as implementation
    return implementation(mappings, path, component_mapping_identity=component_mapping_identity)


def authoring_component_counts_by_catalogue():
    from curriculum_api.catalogue.infrastructure.attachment_reads import authoring_component_counts_by_catalogue as implementation
    return implementation(
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        RETIRED_COMPONENT_TYPES=RETIRED_COMPONENT_TYPES,
        deleted_sql_condition=deleted_sql_condition,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        fetch_all=fetch_all,
        learning_read_table=learning_read_table,
        logger=logger,
        quote_ident=quote_ident,
    )


def component_reflection_question(row, settings=None):
    from curriculum_api.catalogue.domain.content_values import component_reflection_question as implementation
    return implementation(
        row,
        settings,
        LEGACY_REFLECTION_QUESTION_SETTING=LEGACY_REFLECTION_QUESTION_SETTING,
        REFLECTION_QUESTION_COLUMN=REFLECTION_QUESTION_COLUMN,
        component_builder_settings=component_builder_settings,
    )


def component_builder_response(row, module_by_id=None, week_by_id=None, mappings_by_component=None):
    from curriculum_api.catalogue.application.component_projection import component_builder_response as read
    return read(
        row,
        module_by_id,
        week_by_id,
        mappings_by_component,
        archived_at=archived_at,
        component_builder_settings=component_builder_settings,
        component_ksb_mapping_api_item=component_ksb_mapping_api_item,
        component_ksb_mappings_from_row=component_ksb_mappings_from_row,
        component_reflection_question=component_reflection_question,
        programme_deleted_row=programme_deleted_row,
    )


def component_summary_source_rows(catalogue_ids):
    from curriculum_api.catalogue.infrastructure.component_summary_reads import component_summary_source_rows as read
    return read(
        catalogue_ids,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        COMPONENT_SUMMARY_COLUMNS=COMPONENT_SUMMARY_COLUMNS,
        active_component_rows=active_component_rows,
        archive_live_sql=archive_state.live_sql,
        authoring_fetch_all=authoring_fetch_all,
        column_names=column_names,
        component_is_published=component_is_published,
        database_vendor=lambda: connection.vendor,
        fetch_all=fetch_all,
        learning_read_table=learning_read_table,
        quote_ident=quote_ident,
    )


def component_summary_ksb_codes(catalogue_ids):
    from curriculum_api.catalogue.infrastructure.component_summary_reads import component_summary_ksb_codes as read
    return read(
        catalogue_ids,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        active_component_rows=active_component_rows,
        archive_live_sql=archive_state.live_sql,
        authoring_table_name=authoring_table_name,
        coverage_normalise_code=coverage_normalise_code,
        database_vendor=lambda: connection.vendor,
        fetch_all=fetch_all,
        quote_ident=quote_ident,
        table_exists=table_exists,
    )


def component_is_published(row):
    from curriculum_api.catalogue.domain.component_summary import component_is_published as read
    return read(component_builder_settings(row))


def component_summary_rows(module_catalogue_ids):
    from curriculum_api.catalogue.application.component_catalogue import component_summary_rows as read
    return read(
        module_catalogue_ids,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COMPONENT_SUMMARY_MODULE_COLUMNS=COMPONENT_SUMMARY_MODULE_COLUMNS,
        COMPONENT_SUMMARY_WEEK_COLUMNS=COMPONENT_SUMMARY_WEEK_COLUMNS,
        active_week_rows=active_week_rows,
        authoring_fetch_all=authoring_fetch_all,
        component_summary_ksb_codes=component_summary_ksb_codes,
        component_summary_source_rows=component_summary_source_rows,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
    )


def library_component_origin(row):
    """Which bucket of the reuse search this component sits in.

    Every component belongs to a week, so none is ever in the ``library``
    (detached) bucket; the bucket stays in the API so callers can still ask.
    """
    if programme_deleted_row(row):
        return LIBRARY_ORIGIN_ARCHIVED
    return LIBRARY_ORIGIN_ACTIVE


def library_component_where(*, search='', types=None, origins=None, ids=None):
    from curriculum_api.catalogue.infrastructure.library_reads import library_component_where as read
    return read(
        search=search,
        types=types,
        origins=origins,
        ids=ids,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        LIBRARY_ORIGINS=LIBRARY_ORIGINS,
        LIBRARY_ORIGIN_ACTIVE=LIBRARY_ORIGIN_ACTIVE,
        LIBRARY_ORIGIN_ARCHIVED=LIBRARY_ORIGIN_ARCHIVED,
        LIBRARY_ORIGIN_LIBRARY=LIBRARY_ORIGIN_LIBRARY,
        RETIRED_COMPONENT_TYPES=RETIRED_COMPONENT_TYPES,
        deleted_sql_condition=deleted_sql_condition,
    )


def live_component_rows_without_content(module_ids, keep_keys=None, exclude_columns=()):
    from curriculum_api.catalogue.infrastructure.component_reads import live_component_rows_without_content as read
    return read(
        module_ids,
        keep_keys,
        exclude_columns,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        COMPONENT_CONTENT_SETTING_KEYS=COMPONENT_CONTENT_SETTING_KEYS,
        COMPONENT_DB_OMITTED_KEYS_COLUMN=COMPONENT_DB_OMITTED_KEYS_COLUMN,
        COMPONENT_FULL_READ_PAGE_ROWS=COMPONENT_FULL_READ_PAGE_ROWS,
        archive_live_sql=lambda *args, **kwargs: archive_state.live_sql(*args, **kwargs),
        column_names=column_names,
        database_vendor=lambda: connection.vendor,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        learning_read_table=learning_read_table,
        open_cursor=lambda *args, **kwargs: connection.cursor(*args, **kwargs),
        quote_ident=quote_ident,
        rows_as_dicts=rows_as_dicts,
    )


def authoring_module_content_counts():
    """Supply the current learning-storage route to the concrete catalogue reader."""
    from curriculum_api.catalogue.infrastructure.content_counts import authoring_module_content_counts as query
    return query(learning_read_table=learning_read_table)


def free_programme_week_payload(course_id, module, index):
    from curriculum_api.catalogue.application.content_preparation import free_programme_week_payload as implementation
    return implementation(
        course_id,
        module,
        index,
        json_db_value=json_db_value,
        unique_timestamp_prefixed_id=unique_timestamp_prefixed_id,
    )


def free_programme_component_payload(component, index):
    from curriculum_api.catalogue.application.content_preparation import free_programme_component_payload as implementation
    return implementation(
        component,
        index,
        canonical_authoring_id=canonical_authoring_id,
        json_db_value=json_db_value,
    )


def _quiz_reference_id(value):
    """Return a curriculum quiz id without accepting arbitrary component ids."""
    try:
        quiz_id = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return quiz_id if quiz_id > 0 else None


def build_free_course_week_structure(source_rows):
    from curriculum_api.catalogue.application.course_conversion import build_free_course_week_structure as implementation
    return implementation(
        source_rows,
    )


def _scrub_free_course_learner_assignments(course_id):
    from curriculum_api.catalogue.infrastructure.content_source_writes import _scrub_free_course_learner_assignments as implementation
    return implementation(
        course_id,
        clean_str=clean_str,
        connection=connection,
        json=json,
    )


def build_module_free_course_weeks(structure, course_id):
    from curriculum_api.catalogue.application.course_conversion import build_module_free_course_weeks as implementation
    return implementation(
        structure,
        course_id,
    )


def _free_module_response_to_input(module):
    from curriculum_api.catalogue.application.course_conversion import _free_module_response_to_input as implementation
    return implementation(
        module,
    )


def component_source_inputs_fingerprint():
    from curriculum_api.catalogue.infrastructure.content_source_writes import component_source_inputs_fingerprint as implementation
    return implementation(
        authoring_table_name=authoring_table_name,
        column_names=column_names,
        connection=connection,
        quote_ident=quote_ident,
        table_exists=table_exists,
    )
