"""Concrete catalogue / infrastructure / placement runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import group_coaches
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.programme_values import preferred_program_config_by_name
from curriculum_api.catalogue.domain.read_contracts import COMPACT_MODULE_LIST_FIELDS
from curriculum_api.catalogue.domain.read_contracts import STAFF_ACCESS_ROLES
from curriculum_api.catalogue.domain.read_contracts import STAFF_USER_ACCESS_COLUMNS
from curriculum_api.catalogue.domain.row_values import iso_or_blank
from curriculum_api.catalogue.domain.staff_identity import clean_assignment_ids
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key
from curriculum_api.catalogue.domain.staff_identity import staff_profile_email
from curriculum_api.catalogue.domain.staff_identity import staff_profile_name
from curriculum_api.catalogue.domain.values import as_json_value
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_effectively_deleted
from curriculum_api.catalogue.infrastructure.record_identity import record_revision
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.row_queries import safe_module_index_rows
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.meetings.infrastructure.calendar_runtime import utc_iso_or_blank
from datetime import date
from django.db import connections


def unique_group_id(value=''):
    def existing():
        return [detail.get('id') for detail in group_authoring_detail_rows() if detail.get('id')]

    return unique_prefixed_id('GROUP', value, existing)


def title_case_status(is_archived, start_value, end_value):
    from curriculum_api.catalogue.domain.hierarchy_values import title_case_status as implementation
    return implementation(
        is_archived,
        start_value,
        end_value,
        date=date,
    )


def unique_program_configs_for_display(program_configs):
    """Compatibility entry point for programme identity policy."""
    from curriculum_api.catalogue.domain.programme_identity import unique_program_configs_for_display as policy
    return policy(
        program_configs,
        is_archived_program_config=is_archived_program_config,
    )


def programme_config_for_programme(program_configs, programme):
    from curriculum_api.catalogue.domain.hierarchy_values import programme_config_for_programme as implementation
    return implementation(
        program_configs,
        programme,
        preferred_program_config_by_name=preferred_program_config_by_name,
    )


def staff_users_table_reference(connection_alias='enrolment'):
    from curriculum_api.catalogue.infrastructure.staff_directory import staff_users_table_reference as query
    return query(connection_alias, connections=connections, quote_ident=quote_ident)


def fetch_staff_users_by_access(access):
    from curriculum_api.catalogue.infrastructure.staff_directory import fetch_staff_users_by_access as query
    return query(
        access,
        STAFF_ACCESS_ROLES=STAFF_ACCESS_ROLES,
        STAFF_USER_ACCESS_COLUMNS=STAFF_USER_ACCESS_COLUMNS,
        connections=connections,
        quote_ident=quote_ident,
        rows_as_dicts=rows_as_dicts,
        staff_users_table_reference=staff_users_table_reference,
    )


def get_tutor_module_rows():
    if not table_exists('Tutors_Modules'):
        return []
    return fetch_all(f'''
        select *
        from "{CURRICULUM_SCHEMA}"."Tutors_Modules"
        order by "Tutor_name", id
    ''')


def with_group_coaches(payload):
    """``payload`` with a ``coaches`` list folded into ``coach`` (the key the group
    writers read). A payload without ``coaches`` is returned unchanged."""
    if not isinstance(payload, dict) or 'coaches' not in payload:
        return payload
    value = payload.get('coaches')
    return {**payload, 'coach': group_coaches.join_names(value if isinstance(value, (list, tuple)) else [value])}


def module_in_progress(module):
    from curriculum_api.catalogue.application.staff_profiles import module_in_progress as query
    return query(
        module,
    )


def profile_module_summary(module):
    from curriculum_api.catalogue.application.staff_profiles import profile_module_summary as query
    return query(module, module_in_progress=module_in_progress)


def assigned_modules_for_staff(name, role, modules, stored_ids=None, stored_group_ids=None):
    from curriculum_api.catalogue.application.staff_profiles import assigned_modules_for_staff as query
    return query(
        name,
        role,
        modules,
        stored_ids,
        stored_group_ids,
        profile_module_summary=profile_module_summary,
    )


def serialize_staff_profile(row, role, modules=None, groups=None):
    from curriculum_api.catalogue.application.staff_profiles import serialize_staff_profile as query
    return query(
        row,
        role,
        modules,
        groups,
        assigned_modules_for_staff=assigned_modules_for_staff,
        group_coaches=group_coaches,
    )


def safe_group_delivery_rows():
    from curriculum_api.catalogue.application.delivery_schedules import safe_group_delivery_rows as query
    return query(
        authoring_fetch_all=authoring_fetch_all,
        GROUPS_TABLE=GROUPS_TABLE,
        GROUP_ROWS_ORDER=GROUP_ROWS_ORDER,
        logger=logger,
    )


def serialize_group_authoring_detail(row):
    from curriculum_api.catalogue.application.delivery_reads import serialize_group_authoring_detail as query
    return query(
        row,
        group_coaches=group_coaches,
        programme_deleted_row=programme_deleted_row,
    )


def group_authoring_detail_rows():
    from curriculum_api.catalogue.application.delivery_reads import group_authoring_detail_rows as query
    return query(
        GROUPS_TABLE=GROUPS_TABLE,
        GROUP_ROWS_ORDER=GROUP_ROWS_ORDER,
        authoring_fetch_all=authoring_fetch_all,
        logger=logger,
        safe_module_index_rows=safe_module_index_rows,
        serialize_group_authoring_detail=serialize_group_authoring_detail,
    )


def compact_module_list_rows(modules):
    from curriculum_api.catalogue.domain.hierarchy_values import compact_module_list_rows as implementation
    return implementation(
        modules, COMPACT_MODULE_LIST_FIELDS=COMPACT_MODULE_LIST_FIELDS,
    )


def fetch_cohort_row(cohort_id):
    from curriculum_api.catalogue.infrastructure.placement_records import fetch_cohort_row as query
    return query(
        cohort_id,
        authoring_fetch_all=authoring_fetch_all,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
    )


def fetch_group_row(group_id):
    from curriculum_api.catalogue.infrastructure.placement_records import fetch_group_row as query
    return query(
        group_id,
        authoring_fetch_all=authoring_fetch_all,
        GROUPS_TABLE=GROUPS_TABLE,
    )


def resolve_cohort_row(identifier):
    from curriculum_api.catalogue.application.placement_records import resolve_cohort_row as query
    return query(
        identifier,
        fetch_cohort_row=fetch_cohort_row,
        authoring_fetch_all=authoring_fetch_all,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
    )


def resolve_group_row(identifier):
    from curriculum_api.catalogue.application.placement_records import resolve_group_row as query
    return query(
        identifier,
        fetch_group_row=fetch_group_row,
        authoring_fetch_all=authoring_fetch_all,
        GROUPS_TABLE=GROUPS_TABLE,
        curriculum_row_effectively_deleted=curriculum_row_effectively_deleted,
        logger=logger,
    )


def cohort_record_revision(cohort_id):
    from curriculum_api.catalogue.application.record_revisions import cohort_record_revision as query
    return query(
        cohort_id,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        record_revision=record_revision,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
    )


def group_record_revision(group_id):
    from curriculum_api.catalogue.application.record_revisions import group_record_revision as query
    return query(
        group_id,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        record_revision=record_revision,
        GROUPS_TABLE=GROUPS_TABLE,
    )


def cohort_conflict_record(cohort_id):
    from curriculum_api.catalogue.application.conflict_records import cohort_conflict_record as query
    return query(
        cohort_id,
        fetch_cohort_row=fetch_cohort_row,
        curriculum_cohort_from_authoring_detail=curriculum_cohort_from_authoring_detail,
    )


def group_conflict_record(group_id):
    from curriculum_api.catalogue.application.conflict_records import group_conflict_record as query
    return query(
        group_id,
        fetch_group_row=fetch_group_row,
        curriculum_group_from_authoring_detail=curriculum_group_from_authoring_detail,
    )


def scope_programme_identifier(lineage):
    from curriculum_api.directory.domain.placement import scope_programme_identifier as implementation
    return implementation(lineage, clean_str=clean_str)


def curriculum_cohort_from_authoring_detail(detail):
    from curriculum_api.catalogue.application.placement_records import curriculum_cohort_from_authoring_detail as query
    return query(
        detail,
    )


def curriculum_group_from_authoring_detail(detail):
    from curriculum_api.catalogue.application.placement_records import curriculum_group_from_authoring_detail as query
    return query(
        detail,
        split_coach_names=group_coaches.split_names,
    )


def staff_profile_assignment_ids(role, row):
    from curriculum_api.catalogue.application.staff_profiles import staff_profile_assignment_ids as query
    return query(
        role,
        row,
        as_json_value=as_json_value,
        clean_assignment_ids=clean_assignment_ids,
        clean_str=clean_str,
        normalise=normalise,
        safe_authoring_module_rows=safe_authoring_module_rows,
        staff_assignment_key=staff_assignment_key,
        staff_profile_email=staff_profile_email,
        staff_profile_name=staff_profile_name,
    )


def tutor_workspace_module_payload(row):
    from curriculum_api.catalogue.application.tutor_workspace import tutor_workspace_module_payload as implementation
    return implementation(row, clean_str=clean_str, iso_or_blank=iso_or_blank)


def tutor_workspace_session_payload(row):
    return {
        'liveSessionId': clean_str(row.get('live_session_id')),
        'moduleCatalogueId': clean_str(row.get('module_catalogue_id')),
        'moduleTitle': clean_str(row.get('module_title')),
        'sessionNumber': row.get('session_number'),
        'scheduledStart': utc_iso_or_blank(row.get('scheduled_start')),
        'scheduledEnd': utc_iso_or_blank(row.get('scheduled_end')),
        # The occurrence timestamps are returned as UTC instants. The named
        # meeting timezone remains available for display and audit context.
        'timezone': clean_str(row.get('timezone')),
        'durationMinutes': row.get('duration_minutes'),
        'repeatPattern': clean_str(row.get('repeat_pattern')),
        'repeatOccurrences': row.get('repeat_occurrences'),
        'joinUrl': clean_str(row.get('join_url')),
        'status': clean_str(row.get('occurrence_status')),
    }
