"""Concrete reporting achievement composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_LEARNER_DATA_TTL_SECONDS
from curriculum_api.catalogue.domain.read_contracts import PROGRESS_LINEAGE_COLUMN_BY_SCOPE
from curriculum_api.catalogue.domain.read_contracts import _ACHIEVEMENT_LEARNER_IDS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.catalogue_resolution import authoring_scope_data
from curriculum_api.catalogue.infrastructure.catalogue_resolution import scope_placement_lineage
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.directory.api.roster_composition import CURRICULUM_LEARNER_SCOPES
from curriculum_api.directory.api.roster_composition import assigned_learners_for_scope
from curriculum_api.ksb_coverage import build_coverage
from curriculum_api.ksb_coverage import float_weight
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.reporting.api.source_queries import required_ksbs_for_request
from curriculum_api.reporting.domain.hours_values import apply_reflection_otjh_to_learners
from curriculum_api.reporting.domain.hours_values import learner_plans_for_scope
from curriculum_api.reporting.domain.hours_values import scope_authored_plan
from curriculum_api.reporting.domain.hours_values import scope_otjh_summary
from curriculum_api.reporting.domain.source_values import ksb_type_family
from curriculum_api.reporting.domain.source_values import scope_ksb_achievement
from curriculum_api.reporting.domain.source_values import split_ksb_source
from curriculum_api.reporting.infrastructure.progress_runtime import _achievement_query
from curriculum_api.reporting.infrastructure.progress_runtime import achievement_inputs_fingerprint
from curriculum_api.reporting.infrastructure.progress_runtime import learner_activity_plan
from curriculum_api.reporting.infrastructure.progress_runtime import learner_activity_trace
from curriculum_api.reporting.infrastructure.progress_runtime import learner_consumption_payload
from curriculum_api.reporting.infrastructure.progress_runtime import learner_progress_ksb_consumption
from curriculum_api.reporting.infrastructure.progress_runtime import out_of_scope_progress_count
from curriculum_api.reporting.infrastructure.progress_runtime import progress_evidence_index
from curriculum_api.reporting.infrastructure.progress_runtime import progress_scope_predicate
from curriculum_api.reporting.infrastructure.progress_runtime import reflection_submission_ksb_consumption
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import annotate_coverage_sources
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import mappings_with_inferred_sources
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import programme_row_ksb_source
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import source_display_metadata
from curriculum_api.schema_gate import SchemaNotProvisioned
from django.db import DatabaseError
from django.db import connection
from django.http import HttpResponse
from django.http import JsonResponse
from django.views.decorators.http import require_GET


def scope_learner_ksb_impact_payload(request, scope, identifier):
    from curriculum_api.reporting.api.achievement_reads import scope_learner_ksb_impact_payload as implementation
    return implementation(
        request, scope, identifier,
        _scope_learner_ksb_impact_payload=_scope_learner_ksb_impact_payload, curriculum_read_scope=curriculum_read_scope,
    )


def _scope_learner_ksb_impact_payload(request, scope, identifier):
    from curriculum_api.reporting.api.achievement_reads import _scope_learner_ksb_impact_payload as implementation
    return implementation(
        request, scope, identifier,
        PROGRESS_LINEAGE_COLUMN_BY_SCOPE=PROGRESS_LINEAGE_COLUMN_BY_SCOPE, annotate_coverage_sources=annotate_coverage_sources, apply_reflection_otjh_to_learners=apply_reflection_otjh_to_learners,
        assigned_learners_for_scope=assigned_learners_for_scope, authoring_scope_data=authoring_scope_data, build_coverage=build_coverage,
        clean_str=clean_str, connection=connection, json_error=json_error,
        learner_activity_plan=learner_activity_plan, learner_activity_trace=learner_activity_trace, learner_consumption_payload=learner_consumption_payload,
        learner_plans_for_scope=learner_plans_for_scope, learner_progress_ksb_consumption=learner_progress_ksb_consumption, logger=logger,
        mappings_with_inferred_sources=mappings_with_inferred_sources, out_of_scope_progress_count=out_of_scope_progress_count, progress_evidence_index=progress_evidence_index,
        progress_scope_predicate=progress_scope_predicate, reflection_submission_ksb_consumption=reflection_submission_ksb_consumption, required_ksbs_for_request=required_ksbs_for_request,
        scope_authored_plan=scope_authored_plan, scope_ksb_achievement=scope_ksb_achievement, scope_otjh_summary=scope_otjh_summary,
        scope_placement_lineage=scope_placement_lineage,
    )


@require_GET
def curriculum_programme_learner_ksb_impact(request, programme_id):
    from curriculum_api.reporting.api.achievement_reads import curriculum_programme_learner_ksb_impact as implementation
    return implementation(
        request, programme_id,
        JsonResponse=JsonResponse, scope_learner_ksb_impact_payload=scope_learner_ksb_impact_payload,
    )


ACHIEVEMENT_PROGRESS_FIELDS = (
    'code', 'learnerId', 'componentId', 'moduleRef', 'submittedAt', 'progressId',
    'module', 'weekRef', 'week', 'componentTitle', 'componentType', 'weight',
)


ACHIEVEMENT_LEARNER_FIELDS = ('id', 'name', 'cohortId', 'cohort', 'groupId', 'group')


def programme_achievement_inputs(request, programme_id):
    """Compatibility entry point for the reporting query boundary."""
    from curriculum_api.reporting.api.responses import programme_achievement_inputs as read
    return read(
        request,
        programme_id,
        ACHIEVEMENT_LEARNER_FIELDS=ACHIEVEMENT_LEARNER_FIELDS,
        ACHIEVEMENT_PROGRESS_FIELDS=ACHIEVEMENT_PROGRESS_FIELDS,
        CURRICULUM_LEARNER_DATA_TTL_SECONDS=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
        HttpResponse=HttpResponse,
        _ACHIEVEMENT_LEARNER_IDS=_ACHIEVEMENT_LEARNER_IDS,
        achievement_inputs_fingerprint=achievement_inputs_fingerprint,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        programme_achievement_inputs_uncached=programme_achievement_inputs_uncached,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
    )


def programme_achievement_inputs_uncached(request, programme_id):
    from curriculum_api.reporting.api.achievement_reads import programme_achievement_inputs_uncached as implementation
    return implementation(
        request, programme_id,
        assigned_learners_for_scope=assigned_learners_for_scope, authoring_scope_data=authoring_scope_data, clean_str=clean_str,
        curriculum_read_scope=curriculum_read_scope, json_error=json_error, learner_progress_ksb_consumption=learner_progress_ksb_consumption,
        mappings_with_inferred_sources=mappings_with_inferred_sources, required_ksbs_for_request=required_ksbs_for_request, scope_placement_lineage=scope_placement_lineage,
    )


def _achievement_projection(request, programme_id):
    from curriculum_api.reporting.api.achievement_reads import _achievement_projection as implementation
    return implementation(
        request, programme_id,
        _achievement_query=_achievement_query, clean_str=clean_str, coverage_normalise_code=coverage_normalise_code,
        float_weight=float_weight, json_error=json_error, ksb_type_family=ksb_type_family,
        programme_achievement_inputs=programme_achievement_inputs, programme_row_ksb_source=programme_row_ksb_source, source_display_metadata=source_display_metadata,
        split_ksb_source=split_ksb_source,
    )


@require_GET
def curriculum_programme_ksb_achievement(request, programme_id):
    from curriculum_api.reporting.api.achievement_reads import curriculum_programme_ksb_achievement as implementation
    return implementation(
        request, programme_id,
        JsonResponse=JsonResponse, _achievement_projection=_achievement_projection,
    )


@require_GET
def curriculum_programme_ksb_achievement_consumptions(request, programme_id, ksb_definition_id):
    from curriculum_api.reporting.api.achievement_reads import curriculum_programme_ksb_achievement_consumptions as implementation
    return implementation(
        request, programme_id, ksb_definition_id,
        JsonResponse=JsonResponse, _achievement_projection=_achievement_projection,
    )


@require_GET
def curriculum_cohort_learner_ksb_impact(request, cohort_id):
    from curriculum_api.reporting.api.achievement_reads import curriculum_cohort_learner_ksb_impact as implementation
    return implementation(
        request, cohort_id,
        JsonResponse=JsonResponse, scope_learner_ksb_impact_payload=scope_learner_ksb_impact_payload,
    )


@require_GET
def curriculum_group_learner_ksb_impact(request, group_id):
    from curriculum_api.reporting.api.achievement_reads import curriculum_group_learner_ksb_impact as implementation
    return implementation(
        request, group_id,
        JsonResponse=JsonResponse, scope_learner_ksb_impact_payload=scope_learner_ksb_impact_payload,
    )


@require_GET
def curriculum_module_learner_ksb_impact(request, module_catalogue_id):
    from curriculum_api.reporting.api.achievement_reads import curriculum_module_learner_ksb_impact as implementation

    def load_activity_enricher():
        from curriculum_api.learner_activity_status import enrich as read
        return read
    return implementation(
        request, module_catalogue_id,
        DatabaseError=DatabaseError, JsonResponse=JsonResponse, SchemaNotProvisioned=SchemaNotProvisioned,
        json_error=json_error, scope_learner_ksb_impact_payload=scope_learner_ksb_impact_payload, load_activity_enricher=load_activity_enricher,
    )


@require_GET
def curriculum_week_learner_ksb_impact(request, week_id):
    from curriculum_api.reporting.api.achievement_reads import curriculum_week_learner_ksb_impact as implementation
    return implementation(
        request, week_id,
        JsonResponse=JsonResponse, scope_learner_ksb_impact_payload=scope_learner_ksb_impact_payload,
    )


@require_GET
def curriculum_scope_learner_ksb_impact(request):
    from curriculum_api.reporting.api.achievement_reads import curriculum_scope_learner_ksb_impact as implementation
    return implementation(
        request,
        CURRICULUM_LEARNER_SCOPES=CURRICULUM_LEARNER_SCOPES, JsonResponse=JsonResponse, clean_str=clean_str,
        json_error=json_error, scope_learner_ksb_impact_payload=scope_learner_ksb_impact_payload,
    )
