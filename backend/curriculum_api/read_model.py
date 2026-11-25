"""Shared read model for the heavy Curriculum Home aggregation."""

from __future__ import annotations

from django.conf import settings

from read_models.outbox import enqueue_read_model_event
from read_models.registry import ReadModelSpec, register
from read_models.repository import get_read_model


from curriculum_api.catalogue.infrastructure.home_read_model import (
    MODEL_KEY,
    SCOPE_TYPE,
    SCHEMA_VERSION,
    EVENT_REFRESH_REQUESTED,
    VISIBILITIES,
    curriculum_scope_id,
    curriculum_home_scope_ids,
    get_curriculum_home,
    enqueue_curriculum_home_refresh,
    enqueue_all_curriculum_home_refreshes,
)


def build_curriculum_home(scope_id: str) -> dict:
    """Build both initial Curriculum Home responses from one source snapshot."""
    from curriculum_api.catalogue.api.overview_composition import build_curriculum_payload
    from curriculum_api.catalogue.infrastructure.structure_runtime import compact_module_rows
    from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
    from curriculum_api.catalogue.api.catalogue_adapters import enrich_modules_with_authoring, enrich_programmes_with_module_counts

    visibility = curriculum_scope_id(scope_id)
    with curriculum_read_scope():
        overview = build_curriculum_payload(
            visibility, compact=True, force=True,
        )
        overview_response = {
            **overview,
            'modules': compact_module_rows(overview['modules']),
        }
        enriched_modules = enrich_modules_with_authoring(
            overview['modules'], include_programme_deleted=visibility == 'all',
        )
        programmes = enrich_programmes_with_module_counts(
            overview['programmes'],
            enriched_modules,
            modules_enriched=True,
            include_archived=visibility == 'all',
        )
    return {
        'overview': overview_response,
        'programmes': programmes,
    }


def register_curriculum_home_read_model() -> None:
    register(ReadModelSpec(
        model_key=MODEL_KEY,
        scope_type=SCOPE_TYPE,
        schema_version=SCHEMA_VERSION,
        ttl_seconds=max(int(getattr(settings, 'CURRICULUM_HOME_READ_MODEL_TTL_SECONDS', 30)), 1),
        builder=build_curriculum_home,
        scope_source=curriculum_home_scope_ids,
    ))
