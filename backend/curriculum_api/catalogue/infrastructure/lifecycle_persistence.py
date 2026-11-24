"""Concrete catalogue / infrastructure / lifecycle persistence capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from collections import defaultdict
from curriculum_api import archive_state
from curriculum_api import schema_gate
from curriculum_api.catalogue.domain.content_values import authoring_mapping_owner
from curriculum_api.catalogue.domain.content_values import authoring_mapping_signature
from curriculum_api.catalogue.domain.content_values import authoring_row_differs
from curriculum_api.catalogue.domain.hierarchy_values import unique_row_values
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.read_contracts import LIFECYCLE_KEY_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import RESTORE_NULLABLE_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import TRAINING_MODULE_CATALOGUE_COLUMN
from curriculum_api.catalogue.domain.row_values import authoring_row_is_active
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_bulk_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import filtered_payload
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.cache_composition import log_curriculum_storage
from curriculum_api.catalogue.infrastructure.content_runtime import _quiz_reference_id
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_config_by_identifier
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import archived_rows_under
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import restore_soft_delete_payload
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import soft_delete_payload
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import ensure_columns
from datetime import datetime
from django.db import connection


def ensure_program_config_archive_columns():
    from curriculum_api.catalogue.infrastructure.authoring_schema import ensure_program_config_archive_columns as implementation
    return implementation(
        ensure_columns=ensure_columns, has_column=has_column, logger=logger,
        schema_gate=schema_gate, update_rows=update_rows,
    )


def soft_delete_rows(table, where_sql, where_params=None, *, via_parent='', deleted_by='system', extra=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import soft_delete_rows as implementation
    return implementation(
        table, where_sql, where_params, via_parent=via_parent, deleted_by=deleted_by, extra=extra,
        archive_state=archive_state,
        clean_str=clean_str,
        column_names=column_names,
        has_column=has_column,
        log_curriculum_storage=log_curriculum_storage,
        quote_ident=quote_ident,
        soft_delete_payload=soft_delete_payload,
        update_rows=update_rows,
    )


def authoring_soft_delete(table, where_sql, params=None, *, via_parent='', deleted_by='system', extra=None):
    ensure_module_authoring_tables()
    return soft_delete_rows(table, where_sql, params or [], via_parent=via_parent, deleted_by=deleted_by, extra=extra)


def restore_rows_via_parent(table, parent_id, bounds=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import restore_rows_via_parent as implementation
    return implementation(
        table, parent_id, bounds,
        RESTORE_NULLABLE_COLUMNS=RESTORE_NULLABLE_COLUMNS,
        archive_state=archive_state,
        has_column=has_column,
        log_curriculum_storage=log_curriculum_storage,
        quote_ident=quote_ident,
        restore_soft_delete_payload=restore_soft_delete_payload,
        restore_status_rows_via_parent=restore_status_rows_via_parent,
        update_rows=update_rows,
    )


def restore_status_rows_via_parent(table, parent_id, bounds=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import restore_status_rows_via_parent as implementation
    return implementation(
        table, parent_id, bounds,
        LIFECYCLE_KEY_COLUMNS=LIFECYCLE_KEY_COLUMNS,
        archive_state=archive_state,
        archived_rows_under=archived_rows_under,
        clean_str=clean_str,
        log_curriculum_storage=log_curriculum_storage,
        quote_ident=quote_ident,
        update_rows=update_rows,
    )


def soft_delete_authoring_ids(table, ids):
    ids = [value for value in ids if value]
    for start in range(0, len(ids), 500):
        chunk = ids[start:start + 500]
        placeholders = ', '.join(['%s'] * len(chunk))
        authoring_soft_delete(table, f'id in ({placeholders})', chunk, deleted_by='module-save')


def write_changed_authoring_rows(
    module_catalogue_id,
    week_payloads,
    component_payloads,
    mapping_payloads,
    stored_components_by_id,
    *,
    stored_rows=None,
):
    from curriculum_api.catalogue.application.authoring_persistence import write_changed_authoring_rows as implementation
    return implementation(
        module_catalogue_id, week_payloads, component_payloads, mapping_payloads, stored_components_by_id, stored_rows=stored_rows,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        authoring_bulk_upsert=authoring_bulk_upsert,
        authoring_fetch_all=authoring_fetch_all,
        authoring_mapping_owner=authoring_mapping_owner,
        authoring_mapping_signature=authoring_mapping_signature,
        authoring_row_differs=authoring_row_differs,
        authoring_row_is_active=authoring_row_is_active,
        clean_str=clean_str,
        defaultdict=defaultdict,
        soft_delete_authoring_ids=soft_delete_authoring_ids,
    )


def archive_module_child_quizzes(module_catalogue_id, *, include_deleted_children=False, apply=True):
    from curriculum_api.catalogue.infrastructure.quiz_lifecycle import archive_module_child_quizzes as implementation
    return implementation(
        module_catalogue_id, include_deleted_children=include_deleted_children, apply=apply,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        _quiz_reference_id=_quiz_reference_id,
        archive_state=archive_state,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        connection=connection,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        datetime=datetime,
        fetch_all=fetch_all,
        has_column=has_column,
        parse_json_value=parse_json_value,
        table_exists=table_exists,
        table_name=table_name,
        update_rows=update_rows,
    )


def update_authoring_delivery_rows(rows, status):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import update_authoring_delivery_rows as implementation
    return implementation(
        rows, status, TRAINING_MODULE_CATALOGUE_COLUMN=TRAINING_MODULE_CATALOGUE_COLUMN,
        datetime=datetime, filtered_payload=filtered_payload, quote_ident=quote_ident,
        table_exists=table_exists, unique_row_values=unique_row_values, update_rows=update_rows,
    )


def archive_authoring_delivery_rows(rows):
    return update_authoring_delivery_rows(rows, 'archived')


def restore_authoring_delivery_rows(rows):
    return update_authoring_delivery_rows(rows, 'planned')


def archived_parent_programme(programme_id):
    from curriculum_api.catalogue.application.lifecycle_checks import archived_parent_programme as implementation
    return implementation(
        programme_id, clean_str=clean_str,
        ensure_program_config_archive_columns=ensure_program_config_archive_columns,
        is_archived_program_config=is_archived_program_config, logger=logger,
        programme_config_by_identifier=programme_config_by_identifier,
    )
