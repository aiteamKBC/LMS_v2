"""Concrete catalogue / infrastructure / hierarchy composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import group_coaches
from curriculum_api.catalogue.domain.archive_policy import active_week_rows
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.archive_values import archive_stamp_fields
from curriculum_api.catalogue.domain.delivery_values import module_stored_week_count
from curriculum_api.catalogue.domain.programme_identity import programme_config_identity
from curriculum_api.catalogue.domain.programme_values import is_archived_program_config
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.programme_values import sanitised_programme_id
from curriculum_api.catalogue.domain.read_contracts import WEEK_INDEX_COLUMNS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import COHORT_AUTHORING_DETAILS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import GROUPS_TABLE
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.cache_access import scoped_curriculum_read
from curriculum_api.catalogue.infrastructure.calendar_runtime import holiday_table_name
from curriculum_api.catalogue.infrastructure.catalogue_sources import active_learner_delivery_counts
from curriculum_api.catalogue.infrastructure.catalogue_sources import active_learner_programme_counts
from curriculum_api.catalogue.infrastructure.catalogue_sources import canonical_staff_assignment_name
from curriculum_api.catalogue.infrastructure.catalogue_sources import delivery_learner_count
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_program_config_rows
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_WEEKS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_table_exists
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import curriculum_row_is_archived
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import module_withdrawn_on_its_own
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import surviving_authoring_module_rows
from curriculum_api.catalogue.infrastructure.placement_runtime import fetch_group_row
from curriculum_api.catalogue.infrastructure.placement_runtime import serialize_group_authoring_detail
from curriculum_api.catalogue.infrastructure.placement_runtime import with_group_coaches
from curriculum_api.catalogue.infrastructure.record_identity import record_revision
from curriculum_api.catalogue.infrastructure.row_queries import module_index_rows
from curriculum_api.catalogue.infrastructure.row_queries import programme_config_key_column
from curriculum_api.catalogue.infrastructure.runtime_config import COHORT_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import GROUP_ROWS_ORDER
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.ksb_coverage import float_weight
from django.db import DatabaseError
from django.db import connection
import re


def cohort_applied_holidays(holiday_ids, holiday_rows, period_start, period_end):
    from curriculum_api.catalogue.application.hierarchy_preparation import cohort_applied_holidays as implementation
    return implementation(
        holiday_ids,
        holiday_rows,
        period_start,
        period_end,
        get_holiday_rows=get_holiday_rows,
        holiday_table_name=holiday_table_name,
    )


def persistable_programme_id(value):
    from curriculum_api.catalogue.application.hierarchy_preparation import persistable_programme_id as implementation
    return implementation(
        value, get_program_config_rows=get_program_config_rows, logger=logger,
        programme_config_identity=programme_config_identity,
        sanitised_programme_id=sanitised_programme_id,
    )


def canonical_group_coaches(value):
    from curriculum_api.catalogue.application.hierarchy_preparation import canonical_group_coaches as implementation
    return implementation(
        value, canonical_staff_assignment_name=canonical_staff_assignment_name,
        group_coaches=group_coaches,
    )


@scoped_curriculum_read
def authoring_programme_structure_counts(*, source=None):
    """Compatibility adapter; retain existing read scope and caller contract."""
    from curriculum_api.catalogue.application.programme_structure import authoring_programme_structure_counts as query
    return query(
        source=source,
        programme_deleted_row=programme_deleted_row,
        COHORT_AUTHORING_DETAILS_TABLE=COHORT_AUTHORING_DETAILS_TABLE,
        COHORT_ROWS_ORDER=COHORT_ROWS_ORDER,
        GROUPS_TABLE=GROUPS_TABLE,
        GROUP_ROWS_ORDER=GROUP_ROWS_ORDER,
        authoring_fetch_all=authoring_fetch_all,
        logger=logger,
        active_week_rows=active_week_rows,
        AUTHORING_WEEKS_TABLE=AUTHORING_WEEKS_TABLE,
        WEEK_INDEX_COLUMNS=WEEK_INDEX_COLUMNS,
        module_index_rows=module_index_rows,
        module_stored_week_count=module_stored_week_count,
    )


def programme_structure_counts(programme, by_id=None, by_name=None):
    """Compatibility adapter; retain existing read scope and caller contract."""
    from curriculum_api.catalogue.application.programme_structure import programme_structure_counts as query
    return query(
        programme,
        by_id,
        by_name,
        authoring_programme_structure_counts=authoring_programme_structure_counts,
    )


def canonical_programme_id(value='', programme_name=''):
    from curriculum_api.catalogue.application.hierarchy_preparation import canonical_programme_id as implementation
    return implementation(
        value,
        programme_name,
        get_program_config_rows=get_program_config_rows,
        re=re,
    )


def group_authoring_payload(group, rows=None, module_rows=None, extra=None):
    from curriculum_api.catalogue.application.hierarchy_preparation import group_authoring_payload as implementation
    return implementation(
        group,
        rows,
        module_rows,
        extra,
        canonical_group_coaches=canonical_group_coaches,
        canonical_programme_id=canonical_programme_id,
        fetch_group_row=fetch_group_row,
        get_program_config_rows=get_program_config_rows,
        program_config_by_id=program_config_by_id,
        surviving_authoring_module_rows=surviving_authoring_module_rows,
        with_group_coaches=with_group_coaches,
    )


def programme_config_by_identifier(identifier):
    from curriculum_api.catalogue.application.hierarchy_queries import programme_config_by_identifier as implementation
    return implementation(
        identifier,
        get_program_config_rows=get_program_config_rows,
    )


def programme_archived_for_authoring(programme_id):
    from curriculum_api.catalogue.application.lifecycle_checks import programme_archived_for_authoring as implementation
    return implementation(
        programme_id, clean_str=clean_str, get_program_config_rows=get_program_config_rows,
        is_archived_program_config=is_archived_program_config, logger=logger,
        program_config_by_id=program_config_by_id,
    )


def module_recovered_by_move_to_live(existing_module_row, programme_id):
    from curriculum_api.catalogue.application.lifecycle_checks import module_recovered_by_move_to_live as implementation
    return implementation(
        existing_module_row,
        programme_id,
        module_withdrawn_on_its_own=module_withdrawn_on_its_own,
        programme_archived_for_authoring=programme_archived_for_authoring,
        programme_deleted_row=programme_deleted_row,
    )


def authoring_programme_config_for_save(programme_id, programme_name=''):
    from curriculum_api.catalogue.application.lifecycle_checks import authoring_programme_config_for_save as implementation
    return implementation(
        programme_id, programme_name, clean_str=clean_str,
        get_program_config_rows=get_program_config_rows, logger=logger, normalise=normalise,
        persistable_programme_id=persistable_programme_id,
        programme_config_identity=programme_config_identity,
    )


def programme_record_revision(identifier):
    from curriculum_api.catalogue.application.record_revisions import programme_record_revision as query
    return query(
        identifier,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        programme_config_by_identifier=programme_config_by_identifier,
        programme_config_key_column=programme_config_key_column,
        logger=logger,
        record_revision=record_revision,
        quote_ident=quote_ident,
    )


def programme_conflict_record(identifier):
    from curriculum_api.catalogue.application.conflict_records import programme_conflict_record as query
    return query(
        identifier,
        programme_config_by_identifier=programme_config_by_identifier,
    )


def archived_programme_keys():
    """Compatibility adapter for the catalogue programme read boundary."""
    from curriculum_api.catalogue.application.programme_enrichment import archived_programme_keys as query
    return query(
        get_program_config_rows=get_program_config_rows,
        is_archived_program_config=is_archived_program_config,
        logger=logger,
        normalise=normalise,
    )


def programme_list_needs_module_enrichment(programmes, source, counts, *, include_archived):
    """Bind the existing runtime capabilities to the catalogue query."""
    from curriculum_api.catalogue.application.programme_enrichment import programme_list_needs_module_enrichment as query
    return query(
        programmes,
        source,
        counts,
        include_archived=include_archived,
        is_archived_program_config=is_archived_program_config,
        programme_structure_counts=programme_structure_counts,
    )


def programme_shell_learner_fingerprint():
    from curriculum_api.catalogue.application.hierarchy_queries import programme_shell_learner_fingerprint as implementation
    return implementation(
        active_learner_delivery_counts=active_learner_delivery_counts,
        active_learner_programme_counts=active_learner_programme_counts,
    )


@scoped_curriculum_read
def assigned_learners_for_programme(programme_id, lifecycle_status='', *, strict=False):
    from curriculum_api.directory.application.assigned_reads import assigned_learners_for_programme as implementation
    from curriculum_api.directory.infrastructure.assigned_reads import read_programme_profiles
    def read(programme_id, lifecycle_status, *, strict):
        return read_programme_profiles(
            programme_id, lifecycle_status, strict=strict, connection=connection,
            learner_schema_table_exists=learner_schema_table_exists, clean_str=clean_str,
            rows_as_dicts=rows_as_dicts, DatabaseError=DatabaseError, logger=logger,
        )
    return implementation(programme_id, lifecycle_status, strict=strict,
        read_programme_profiles=read, clean_str=clean_str,
        float_weight=float_weight, normalise=normalise,
    )


def archived_cohort_learners(cohort_row, counts=None):
    from curriculum_api.catalogue.application.archive_queries import archived_cohort_learners as query
    return query(
        cohort_row, counts, active_learner_delivery_counts=active_learner_delivery_counts,
        clean_str=clean_str, delivery_learner_count=delivery_learner_count, normalise=normalise,
    )


def archived_group_learners(group_row, counts=None):
    from curriculum_api.catalogue.application.archive_queries import archived_group_learners as query
    return query(
        group_row, counts, active_learner_delivery_counts=active_learner_delivery_counts,
        clean_str=clean_str, delivery_learner_count=delivery_learner_count, normalise=normalise,
    )


def archived_group_payload(row, cohort_rows_by_id, group_learner_counts):
    from curriculum_api.catalogue.application.archive_queries import archived_group_payload as query
    return query(
        row, cohort_rows_by_id, group_learner_counts, archive_stamp_fields=archive_stamp_fields,
        archived_group_learners=archived_group_learners, clean_str=clean_str,
        curriculum_row_is_archived=curriculum_row_is_archived,
        serialize_group_authoring_detail=serialize_group_authoring_detail,
    )
