"""Concrete reporting / infrastructure / progress runtime capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.read_contracts import ACHIEVEMENT_INPUTS_MAX_AGE_SECONDS
from curriculum_api.catalogue.domain.read_contracts import PROGRESS_LINEAGE_COLUMN_BY_SCOPE
from curriculum_api.catalogue.domain.read_contracts import _ACHIEVEMENT_LEARNER_IDS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import normalise
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.content_runtime import component_source_inputs_fingerprint
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_columns
from curriculum_api.catalogue.infrastructure.database_reads import learner_schema_table_exists
from curriculum_api.catalogue.infrastructure.database_reads import quote_ident
from curriculum_api.catalogue.infrastructure.database_reads import rows_as_dicts
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.ksb_coverage import float_weight
from curriculum_api.ksb_coverage import ksb_sort_key
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.domain.hours_values import learner_authored_plan
from curriculum_api.reporting.domain.hours_values import learner_plan_group_key
from curriculum_api.reporting.domain.hours_values import learner_plans_for_scope
from curriculum_api.reporting.domain.hours_values import otjh_number
from curriculum_api.reporting.domain.source_values import merge_ksb_totals
from curriculum_api.reporting.domain.source_values import parse_ksb_weights
from django.db import DatabaseError
from django.db import connection
from learner_api.ksb_exclusions import and_not_excluded
from learner_api.progress_rules import progress_achievement_status
from learner_api.progress_rules import progress_counts_as_achieved


def progress_scope_predicate(component_ids, lineage_column='', scope_ref=''):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.infrastructure.progress import progress_scope_predicate as read
    return read(
        component_ids, lineage_column, scope_ref,
        PROGRESS_LINEAGE_COLUMN_BY_SCOPE=PROGRESS_LINEAGE_COLUMN_BY_SCOPE, quote_ident=quote_ident,
    )


def out_of_scope_progress_count(learner_ids, predicate, predicate_params):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.infrastructure.progress import out_of_scope_progress_count as read
    return read(
        learner_ids, predicate, predicate_params,
        and_not_excluded=and_not_excluded, connection=connection,
    )


def achieved_outcome_predicate(cursor, learner_ids):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.infrastructure.progress import achieved_outcome_predicate as read
    return read(
        cursor, learner_ids,
        progress_counts_as_achieved=progress_counts_as_achieved,
    )


def progress_consumption_rows(learner_ids, codes=None, scope_predicate=None, achieved_only=False):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.infrastructure.progress import progress_consumption_rows as read
    return read(
        learner_ids, codes, scope_predicate, achieved_only,
        achieved_outcome_predicate=achieved_outcome_predicate, and_not_excluded=and_not_excluded, connection=connection,
        rows_as_dicts=rows_as_dicts,
    )


def learner_progress_ksb_consumption(learner_ids, programme_ksb_codes, component_ids=(), include_unattributed=True, restrict_to_components=False, scope='', scope_identifier='', codes_only=False, in_scope_only=False, achievement_rows_only=False):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.application.consumption import learner_progress_ksb_consumption as read
    from functools import partial
    from curriculum_api.reporting.infrastructure.progress import progress_source_available

    progress_source_available = partial(progress_source_available, connection=connection, learner_schema_table_exists=learner_schema_table_exists)
    return read(
        learner_ids, programme_ksb_codes, component_ids, include_unattributed, restrict_to_components, scope, scope_identifier, codes_only, in_scope_only, achievement_rows_only,
        PROGRESS_LINEAGE_COLUMN_BY_SCOPE=PROGRESS_LINEAGE_COLUMN_BY_SCOPE, clean_str=clean_str, coverage_normalise_code=coverage_normalise_code,
        float_weight=float_weight, otjh_number=otjh_number, progress_achievement_status=progress_achievement_status,
        progress_consumption_rows=progress_consumption_rows, progress_counts_as_achieved=progress_counts_as_achieved, progress_scope_predicate=progress_scope_predicate,
        progress_source_available=progress_source_available,
    )


def reflection_submission_ksb_consumption(learners, programme_ksb_codes, component_ids=(), restrict_to_components=False, include_unattributed=True):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.application.consumption import reflection_submission_ksb_consumption as read
    from functools import partial
    from curriculum_api.reporting.infrastructure.reflections import reflection_columns
    from curriculum_api.reporting.infrastructure.reflections import reflection_rows

    reflection_columns = partial(reflection_columns, connection=connection, learner_schema_columns=learner_schema_columns, learner_schema_table_exists=learner_schema_table_exists)
    reflection_rows = partial(reflection_rows, connection=connection, logger=logger, quote_ident=quote_ident, rows_as_dicts=rows_as_dicts)
    return read(
        learners, programme_ksb_codes, component_ids, restrict_to_components, include_unattributed,
        clean_str=clean_str, coverage_normalise_code=coverage_normalise_code, float_weight=float_weight,
        ksb_sort_key=ksb_sort_key, otjh_number=otjh_number, parse_ksb_weights=parse_ksb_weights,
        progress_achievement_status=progress_achievement_status, progress_counts_as_achieved=progress_counts_as_achieved, reflection_columns=reflection_columns,
        reflection_rows=reflection_rows, unique=unique,
    )


def progress_evidence_index(progress_ids):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.supplementary import progress_evidence_index as read
    from functools import partial
    from curriculum_api.reporting.infrastructure.supplementary import evidence_rows
    return read(
        progress_ids,
        clean_str=clean_str,
        evidence_rows=partial(evidence_rows, connection=connection, learner_schema_columns=learner_schema_columns, learner_schema_table_exists=learner_schema_table_exists, logger=logger, quote_ident=quote_ident, rows_as_dicts=rows_as_dicts),
        unique=unique,
    )


def learner_activity_trace(progress_rows, excluded_progress_rows, reflection_rows, excluded_reflection_rows, evidence_by_progress):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.application.activity import learner_activity_trace as read
    return read(
        progress_rows, excluded_progress_rows, reflection_rows, excluded_reflection_rows, evidence_by_progress,
        coverage_normalise_code=coverage_normalise_code, float_weight=float_weight, ksb_sort_key=ksb_sort_key,
    )


def learner_activity_plan(learners, component_rows, module_rows, week_rows, activities, plan, learner_plans=None):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.application.activity import learner_activity_plan as read
    return read(
        learners, component_rows, module_rows, week_rows, activities, plan, learner_plans,
        clean_str=clean_str, frontend_component_type=frontend_component_type, learner_authored_plan=learner_authored_plan,
        learner_plan_group_key=learner_plan_group_key, learner_plans_for_scope=learner_plans_for_scope, normalise=normalise,
        otjh_number=otjh_number, parse_int=parse_int,
    )


def learner_consumption_payload(learners, coverage_items, progress_totals, reflection_declared_totals, expected_by_learner=None):
    """Compatibility entry point for the curriculum reporting read boundary."""
    from curriculum_api.reporting.application.activity import learner_consumption_payload as read
    return read(
        learners, coverage_items, progress_totals, reflection_declared_totals, expected_by_learner,
        coverage_normalise_code=coverage_normalise_code, float_weight=float_weight, ksb_sort_key=ksb_sort_key,
        merge_ksb_totals=merge_ksb_totals,
    )


def _achievement_query(request, name, *aliases):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.application.achievement import _achievement_query as read
    return read(
        request.GET,
        name,
        *aliases,
        clean_str=clean_str,
    )


def achievement_inputs_fingerprint(programme_id, cache_key):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.infrastructure.achievement_cache import achievement_inputs_fingerprint as read
    return read(
        programme_id,
        cache_key,
        ACHIEVEMENT_INPUTS_MAX_AGE_SECONDS=ACHIEVEMENT_INPUTS_MAX_AGE_SECONDS,
        DatabaseError=DatabaseError,
        _ACHIEVEMENT_LEARNER_IDS=_ACHIEVEMENT_LEARNER_IDS,
        component_source_inputs_fingerprint=component_source_inputs_fingerprint,
        connection=connection,
        logger=logger,
    )
