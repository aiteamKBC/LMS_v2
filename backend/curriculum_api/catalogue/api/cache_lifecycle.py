"""Bind catalogue cache lifecycle entry points to their concrete readers and workers.

This API composition owns payload callbacks, including encoded section responses.
Cache mutation, commit hooks and thread state remain in infrastructure. Importing
this module starts no worker and performs no read."""
from curriculum_api.catalogue.infrastructure.runtime_config import CURRICULUM_WARM_DELAY_SECONDS
from curriculum_api.catalogue.infrastructure.runtime_config import CURRICULUM_WARM_ENABLED
from curriculum_api.catalogue.infrastructure.database_reads import _TABLE_EXISTS_CACHE
from curriculum_api.catalogue.api.overview_composition import build_curriculum_payload
from curriculum_api.catalogue.infrastructure.cache_access import bump_shared_curriculum_epoch
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.catalogue.api.catalogue_adapters import enrich_modules_with_authoring
from curriculum_api.catalogue.api.catalogue_adapters import enrich_programmes_with_module_counts
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api import schema_compat
from django.db import transaction
from curriculum_api.catalogue.api.programme_detail_composition import warm_programme_detail_sections


def invalidate_curriculum_cache(content_scope=None):
    """Bind existing runtime capabilities; state belongs to infrastructure."""
    from curriculum_api.catalogue.infrastructure.cache_invalidation import invalidate_curriculum_cache as query

    def retire_all_content():
        from curriculum_api import content_cache
        return content_cache.retire_all()

    def enqueue_all_curriculum_home_refreshes(*, reason):
        from curriculum_api.catalogue.infrastructure.home_read_model import enqueue_all_curriculum_home_refreshes
        return enqueue_all_curriculum_home_refreshes(reason=reason)

    return query(
        content_scope,
        _TABLE_EXISTS_CACHE=_TABLE_EXISTS_CACHE, bump_shared_curriculum_epoch=bump_shared_curriculum_epoch, enqueue_all_curriculum_home_refreshes=enqueue_all_curriculum_home_refreshes,
        logger=logger, retire_all_content=retire_all_content, schedule_curriculum_warm=schedule_curriculum_warm,
        schema_compat=schema_compat, transaction=transaction,
    )


def warm_curriculum_caches():
    from config.management_safety import reconciliation_command
    from curriculum_api.catalogue.application.cache_warming import warm_curriculum_caches as warm
    return warm(
        reconciliation_command=reconciliation_command,
        curriculum_read_scope=curriculum_read_scope,
        cached_curriculum_value=cached_curriculum_value,
        build_curriculum_payload=build_curriculum_payload,
        enrich_modules_with_authoring=enrich_modules_with_authoring,
        enrich_programmes_with_module_counts=enrich_programmes_with_module_counts,
    )


def _curriculum_warm_loop():
    from curriculum_api.catalogue.infrastructure.cache_warming import _curriculum_warm_loop as run
    return run(
        warm_curriculum_caches=warm_curriculum_caches,
        warm_programme_detail_sections=warm_programme_detail_sections,
        delay_seconds=CURRICULUM_WARM_DELAY_SECONDS,
    )


def schedule_curriculum_warm():
    from curriculum_api.catalogue.infrastructure.cache_warming import schedule_curriculum_warm as schedule
    return schedule(enabled=CURRICULUM_WARM_ENABLED, run_warm_loop=_curriculum_warm_loop)
