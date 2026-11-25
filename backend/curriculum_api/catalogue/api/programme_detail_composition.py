"""Concrete catalogue / api / programme detail composition capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import canonical_programme_detail_issues
from curriculum_api.catalogue.api.adapters import request_bypasses_curriculum_cache
from curriculum_api.catalogue.api.adapters import request_reads_after_write
from curriculum_api.catalogue.api.calendar_composition import read_programme_sessions
from curriculum_api.catalogue.api.module_assembly_composition import programme_module_candidates
from curriculum_api.catalogue.api.responses import curriculum_visibility
from curriculum_api.catalogue.domain.delivery_values import is_operational_training_row
from curriculum_api.catalogue.domain.programme_values import program_config_by_id
from curriculum_api.catalogue.domain.read_contracts import CURRICULUM_LEARNER_DATA_TTL_SECONDS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_DETAIL_SECTIONS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_MODULE_IDENTITY_FIELDS
from curriculum_api.catalogue.domain.read_contracts import PROGRAMME_SECTION_WARM_WINDOW_SECONDS
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_access import refresh_curriculum_generations
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_cached_curriculum_rows
from curriculum_api.catalogue.infrastructure.cohort_calendar_composition import build_cohorts_and_groups
from curriculum_api.catalogue.infrastructure.component_composition import component_builder_rows
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.hierarchy_composition import programme_shell_learner_fingerprint
from curriculum_api.catalogue.infrastructure.hierarchy_persistence import repair_curriculum_parent_links
from curriculum_api.catalogue.infrastructure.placement_runtime import programme_config_for_programme
from curriculum_api.catalogue.infrastructure.programme_builder_runtime import build_programmes
from curriculum_api.catalogue.infrastructure.runtime_config import _PROGRAMME_SECTION_WARM_LOCK
from curriculum_api.catalogue.infrastructure.runtime_config import _PROGRAMME_SECTION_WARM_TARGETS
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.structure_runtime import build_modules
from curriculum_api.catalogue.infrastructure.structure_runtime import note_programme_section_read
from curriculum_api.catalogue.infrastructure.structure_runtime import programme_modules_workspace_payload
from curriculum_api.http_cache import conditional_json_response
from curriculum_api.http_cache import encode_json_entry
from curriculum_api.http_cache import encode_json_error_entry
from curriculum_api.http_cache import query_flag
from curriculum_api.http_cache import query_list
from django.http import JsonResponse
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET
import time


@require_GET
def curriculum_programme_tree_detail(request, identifier):
    from curriculum_api.catalogue.api.programme_detail import curriculum_programme_tree_detail as query
    return query(
        request,
        identifier,
        CURRICULUM_LEARNER_DATA_TTL_SECONDS=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
        build_curriculum_programme_tree_detail_payload=build_curriculum_programme_tree_detail_payload,
        cached_curriculum_value=cached_curriculum_value,
        canonical_programme_detail_issues=canonical_programme_detail_issues,
        clean_str=clean_str,
        conditional_json_response=conditional_json_response,
        curriculum_visibility=curriculum_visibility,
        encode_json_entry=encode_json_entry,
        encode_json_error_entry=encode_json_error_entry,
        query_flag=query_flag,
        query_list=query_list,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
    )


@gzip_page
@require_GET
def curriculum_programme_detail_section(request, identifier, section):
    from curriculum_api.catalogue.api.programme_detail import curriculum_programme_detail_section as query
    return query(
        request,
        identifier,
        section,
        JsonResponse=JsonResponse,
        PROGRAMME_DETAIL_SECTIONS=PROGRAMME_DETAIL_SECTIONS,
        cached_programme_detail_section=cached_programme_detail_section,
        clean_str=clean_str,
        conditional_json_response=conditional_json_response,
        curriculum_visibility=curriculum_visibility,
        note_programme_section_read=note_programme_section_read,
        refresh_curriculum_generations=refresh_curriculum_generations,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
        request_bypasses_curriculum_cache=request_bypasses_curriculum_cache,
        request_reads_after_write=request_reads_after_write,
    )


def programme_detail_section_entry(identifier, visibility, section, workspace_view):
    from curriculum_api.catalogue.api.programme_detail import programme_detail_section_entry as query
    return query(
        identifier,
        visibility,
        section,
        workspace_view,
        build_curriculum_programme_tree_detail_payload=build_curriculum_programme_tree_detail_payload,
        canonical_programme_detail_issues=canonical_programme_detail_issues,
        encode_json_entry=encode_json_entry,
        encode_json_error_entry=encode_json_error_entry,
        programme_modules_workspace_payload=programme_modules_workspace_payload,
    )


def cached_programme_detail_section(identifier, visibility, section, workspace_view, *, force=False):
    from curriculum_api.catalogue.application.cached_reads import cached_programme_detail_section as query
    return query(
        identifier,
        visibility,
        section,
        workspace_view,
        force=force,
        CURRICULUM_LEARNER_DATA_TTL_SECONDS=CURRICULUM_LEARNER_DATA_TTL_SECONDS,
        cached_curriculum_value=cached_curriculum_value,
        curriculum_read_scope=curriculum_read_scope,
        programme_detail_section_entry=programme_detail_section_entry,
        programme_shell_learner_fingerprint=programme_shell_learner_fingerprint,
    )


def warm_programme_detail_sections():
    """Rebuild the recently read modules sections a write has made stale.

    Through cached_curriculum_value as a reader would, so a section the write
    did not touch costs one generation check, and a build that a later write
    overtakes is discarded rather than published.
    """
    now = time.monotonic()
    with _PROGRAMME_SECTION_WARM_LOCK:
        for target, seen in list(_PROGRAMME_SECTION_WARM_TARGETS.items()):
            if now - seen > PROGRAMME_SECTION_WARM_WINDOW_SECONDS:
                del _PROGRAMME_SECTION_WARM_TARGETS[target]
        targets = list(reversed(_PROGRAMME_SECTION_WARM_TARGETS))
    for identifier, visibility, workspace_view in targets:
        try:
            cached_programme_detail_section(identifier, visibility, 'modules', workspace_view)
        except Exception:
            logger.warning('Programme modules warm failed.', exc_info=True)


def build_curriculum_programme_tree_detail_payload(identifier, visibility, include_stats=True, include_components=True, include_tree=True, include_week_components=True, section=None, *, workspace_view=False):
    # Same reason build_curriculum_payload() opens a read scope: build_programmes()
    # re-reads authoring modules, programmes, cohorts, groups and ksb_profiles in
    # full once per programme, so without the scope this detail build issued ~250
    # round trips to Neon (~18-30s) instead of ~40 (~3s). The scope is read-only
    # and reentrant, so a caller that already opened one keeps its own lifetime.
    #
    # Targeted: this answers for one programme, so the KSB stats (when asked
    # for) read that programme's weeks/components/mappings rather than the
    # whole tables -- see authoring_child_rows_for_modules.
    with curriculum_read_scope(targeted_child_reads=True):
        return _build_curriculum_programme_tree_detail_payload(identifier, visibility, include_stats, include_components, include_tree, include_week_components, section, **({'workspace_view': True} if workspace_view else {}))


def _build_curriculum_programme_tree_detail_payload(identifier, visibility, include_stats=True, include_components=True, include_tree=True, include_week_components=True, section=None, *, workspace_view=False):
    """Compatibility adapter for the catalogue programme read boundary."""
    from curriculum_api.catalogue.application.programme_detail import _build_curriculum_programme_tree_detail_payload as query
    return query(
        identifier,
        visibility,
        include_stats,
        include_components,
        include_tree,
        include_week_components,
        section,
        workspace_view=workspace_view,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        PROGRAMME_MODULE_IDENTITY_FIELDS=PROGRAMME_MODULE_IDENTITY_FIELDS,
        build_cohorts_and_groups=build_cohorts_and_groups,
        build_modules=build_modules,
        build_programmes=build_programmes,
        read_programme_sessions=read_programme_sessions,
        component_builder_rows=component_builder_rows,
        get_cached_curriculum_rows=get_cached_curriculum_rows,
        is_operational_training_row=is_operational_training_row,
        program_config_by_id=program_config_by_id,
        programme_config_for_programme=programme_config_for_programme,
        programme_module_candidates=programme_module_candidates,
        repair_curriculum_parent_links=repair_curriculum_parent_links,
    )
