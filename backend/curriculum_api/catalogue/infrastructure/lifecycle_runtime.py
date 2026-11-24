"""Concrete catalogue / infrastructure / lifecycle runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from collections import defaultdict
from curriculum_api import archive_state
from curriculum_api import schema_compat
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.archive_policy import row_has_deleted_at
from curriculum_api.catalogue.domain.hierarchy_dates import format_created_at
from curriculum_api.catalogue.domain.hierarchy_values import append_notes_meta
from curriculum_api.catalogue.domain.hierarchy_values import programme_identifier_candidates
from curriculum_api.catalogue.domain.hierarchy_values import remove_notes_meta
from curriculum_api.catalogue.domain.hierarchy_values import stamp_datetime
from curriculum_api.catalogue.domain.read_contracts import FREE_PROGRAMME_COMPONENTS_TABLE
from curriculum_api.catalogue.domain.read_contracts import LIFECYCLE_KEY_COLUMNS
from curriculum_api.catalogue.domain.read_contracts import MODULE_ARCHIVE_EVENT_WINDOW
from curriculum_api.catalogue.domain.read_contracts import PERMANENT_DELETE_REFERENCES
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_PERMANENT_DELETE_LEARNER_LINKS
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATES_TABLE
from curriculum_api.catalogue.domain.row_values import authoring_row_is_active
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import column_names
from curriculum_api.catalogue.infrastructure.database_reads import curriculum_in_clause
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.record_identity import now_iso
from curriculum_api.catalogue.infrastructure.row_queries import programme_config_key_column
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from datetime import datetime
from django.db import connection
from django.db import transaction


def soft_delete_payload(table, *, via_parent='', deleted_by='system', extra=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import soft_delete_payload as implementation
    return implementation(
        table, via_parent=via_parent, deleted_by=deleted_by, extra=extra,
        archive_state=archive_state,
        clean_str=clean_str,
        datetime=datetime,
    )


def restore_soft_delete_payload(table):
    from curriculum_api.catalogue.infrastructure.lifecycle_writes import restore_soft_delete_payload as implementation
    return implementation(
        table,
        archive_state=archive_state,
        datetime=datetime,
        has_column=has_column,
    )


def deleted_sql_condition(table, alias=''):
    prefix = f'{alias}.' if alias else ''
    checks = []
    if archive_state.uses_status(table):
        checks.append(archive_state.inactive_sql(alias))
    if has_column(table, 'deleted_at'):
        checks.append(f'{prefix}{quote_ident("deleted_at")} is not null')
    if has_column(table, 'is_archived'):
        checks.append(f'coalesce({prefix}{quote_ident("is_archived")}, false) = true')
    if not checks:
        return 'false'
    return '(' + ' or '.join(checks) + ')'


def archive_payload(table, existing_notes=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import archive_payload as implementation
    return implementation(
        table, existing_notes, append_notes_meta=append_notes_meta, archive_state=archive_state,
        has_column=has_column, now_iso=now_iso,
    )


def restore_payload(table, existing_notes=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import restore_payload as implementation
    return implementation(
        table, existing_notes, has_column=has_column, remove_notes_meta=remove_notes_meta,
    )


def curriculum_row_effectively_deleted(row):
    from curriculum_api.catalogue.domain.hierarchy_values import curriculum_row_effectively_deleted as implementation
    return implementation(
        row, programme_deleted_row=programme_deleted_row,
    )


def programme_dependency_counts(identifier, config=None):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import programme_dependency_counts as implementation
    return implementation(
        identifier,
        config,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        FREE_PROGRAMME_COMPONENTS_TABLE=FREE_PROGRAMME_COMPONENTS_TABLE,
        GROUPS_TABLE=GROUPS_TABLE,
        connection=connection,
        fetch_all=fetch_all,
        has_column=has_column,
        logger=logger,
        quote_ident=quote_ident,
        schema_compat=schema_compat,
        table_exists=table_exists,
        table_name=table_name,
    )


def archived_rows_under(table, parent_id):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import archived_rows_under as implementation
    return implementation(
        table, parent_id, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, LIFECYCLE_KEY_COLUMNS=LIFECYCLE_KEY_COLUMNS,
        archive_state=archive_state, authoring_table_name=authoring_table_name,
        column_names=column_names, fetch_all=fetch_all, quote_ident=quote_ident,
    )


def curriculum_where_any(clauses):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import curriculum_where_any as implementation
    return implementation(
        clauses,
    )


def curriculum_ids_matching(table, column, clauses):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import curriculum_ids_matching as implementation
    return implementation(
        table,
        column,
        clauses,
        curriculum_where_any=curriculum_where_any,
        fetch_all=fetch_all,
        quote_ident=quote_ident,
        table_exists=table_exists,
        table_name=table_name,
    )


def orphan_programme_name_clause(table, programme_name):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import orphan_programme_name_clause as implementation
    return implementation(
        table,
        programme_name,
        has_column=has_column,
    )


def programme_permanent_delete_blockers(child_ids):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import programme_permanent_delete_blockers as implementation
    return implementation(
        child_ids, PROGRAMME_PERMANENT_DELETE_LEARNER_LINKS=PROGRAMME_PERMANENT_DELETE_LEARNER_LINKS,
        clean_str=clean_str, connection=connection, logger=logger, quote_ident=quote_ident,
    )


def programme_permanent_delete_plan(identifier, programme=None, config=None):
    from curriculum_api.catalogue.application.lifecycle_checks import programme_permanent_delete_plan as implementation
    return implementation(
        identifier, programme, config, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE, GROUPS_TABLE=GROUPS_TABLE,
        WEEK_TEMPLATES_TABLE=WEEK_TEMPLATES_TABLE, clean_str=clean_str,
        curriculum_ids_matching=curriculum_ids_matching, curriculum_in_clause=curriculum_in_clause,
        orphan_programme_name_clause=orphan_programme_name_clause, parse_int=parse_int,
        programme_dependency_counts=programme_dependency_counts,
        programme_identifier_candidates=programme_identifier_candidates,
        programme_permanent_delete_blockers=programme_permanent_delete_blockers,
    )


def programme_config_rows_remaining(candidates):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import programme_config_rows_remaining as implementation
    return implementation(
        candidates, curriculum_in_clause=curriculum_in_clause, fetch_all=fetch_all,
        programme_config_key_column=programme_config_key_column, table_exists=table_exists,
        table_name=table_name,
    )


def request_wants_permanent_programme_delete(request):
    """A permanent delete is opt-in per request; the default DELETE still archives.

    Cohorts and groups read the same flag off the same query string, so the rule
    itself lives in ``request_wants_permanent_delete``; this name stays because
    the programme handlers read better for it.
    """
    return request_wants_permanent_delete(request)


def request_wants_forced_programme_delete(request):
    """Opt into deleting authored weeks/components as well as delivery rows."""
    return request_wants_permanent_programme_delete(request) and truthy(
        request.GET.get('force') or request.GET.get('cascade')
    )


def surviving_authoring_module_rows(module_rows=None):
    from curriculum_api.catalogue.application.lifecycle_checks import surviving_authoring_module_rows as implementation
    return implementation(
        module_rows, curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        safe_authoring_module_rows=safe_authoring_module_rows,
    )


def archived_authoring_ids(table, id_column):
    from curriculum_api.catalogue.application.lifecycle_checks import archived_authoring_ids as implementation
    return implementation(
        table, id_column, authoring_fetch_all=authoring_fetch_all, clean_str=clean_str,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted, logger=logger,
    )


def module_withdrawn_on_its_own(row):
    from curriculum_api.catalogue.application.lifecycle_checks import module_withdrawn_on_its_own as implementation
    return implementation(
        row,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        archive_state=archive_state,
        row_has_deleted_at=row_has_deleted_at,
    )


def module_archive_event_bounds(module_row):
    from curriculum_api.catalogue.application.lifecycle_checks import module_archive_event_bounds as implementation
    return implementation(
        module_row, AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        MODULE_ARCHIVE_EVENT_WINDOW=MODULE_ARCHIVE_EVENT_WINDOW, archive_state=archive_state,
        stamp_datetime=stamp_datetime,
    )


def row_in_module_archive(row, markers, bounds=None):
    from curriculum_api.catalogue.domain.hierarchy_values import row_in_module_archive as implementation
    return implementation(
        row, markers, bounds, clean_str=clean_str,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        stamp_datetime=stamp_datetime,
    )


def module_authoring_row_is_archived(row):
    """Whether an authoring module row is unavailable to operational lists."""
    row = row or {}
    return (
        clean_str(row.get('status')).lower() == 'archived'
        or curriculum_row_effectively_deleted(row)
    )


def is_archived_module_summary(module):
    from curriculum_api.catalogue.domain.hierarchy_values import is_archived_module_summary as implementation
    return implementation(
        module, clean_str=clean_str, programme_deleted_row=programme_deleted_row, truthy=truthy,
    )


def soft_deleted_structure_ids(candidates):
    from curriculum_api.catalogue.application.lifecycle_checks import soft_deleted_structure_ids as implementation
    return implementation(
        candidates, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE, authoring_fetch_all=authoring_fetch_all,
        authoring_row_is_active=authoring_row_is_active, clean_str=clean_str,
    )


def request_wants_permanent_delete(request):
    """A permanent delete is opt-in per request; the default DELETE still archives."""
    return (
        truthy(request.GET.get('permanent'))
        or truthy(request.GET.get('hard'))
        or clean_str(request.GET.get('mode')).lower() in {'permanent', 'hard'}
    )


def curriculum_row_is_archived(row):
    from curriculum_api.catalogue.domain.archive_visibility import curriculum_row_is_archived as query
    return query(
        row, clean_str=clean_str, curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
    )


def archived_authoring_rows(table):
    from curriculum_api.catalogue.infrastructure.archive_reads import archived_authoring_rows as query
    return query(
        table, LIFECYCLE_KEY_COLUMNS=LIFECYCLE_KEY_COLUMNS, archive_state=archive_state,
        authoring_fetch_all=authoring_fetch_all, curriculum_row_is_archived=curriculum_row_is_archived,
        format_created_at=format_created_at,
    )


def permanent_delete_reference_blockers(kind, identifier):
    from curriculum_api.catalogue.infrastructure.lifecycle_reads import permanent_delete_reference_blockers as implementation
    return implementation(
        kind, identifier, PERMANENT_DELETE_REFERENCES=PERMANENT_DELETE_REFERENCES, clean_str=clean_str,
        connection=connection, logger=logger, quote_ident=quote_ident, schema_compat=schema_compat,
        transaction=transaction,
    )


def archived_module_rows():
    from curriculum_api.catalogue.infrastructure.archive_reads import archived_module_rows as query
    return query(
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE, archive_state=archive_state,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        format_created_at=format_created_at, safe_authoring_module_rows=safe_authoring_module_rows,
    )


def archived_module_component_counts(module_catalogue_ids=None):
    from curriculum_api.catalogue.infrastructure.archive_reads import archived_module_component_counts as query
    return query(
        module_catalogue_ids, AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        authoring_fetch_all=authoring_fetch_all, authoring_table_name=authoring_table_name,
        clean_str=clean_str, connection=connection, defaultdict=defaultdict,
        ensure_module_authoring_tables=ensure_module_authoring_tables, logger=logger,
    )
