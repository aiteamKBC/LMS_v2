"""Concrete reporting / api / adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import curriculum_collection_response
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.gzip import gzip_page
from django.views.decorators.http import require_GET


@csrf_exempt
def curriculum_ksb_framework_detail(request, identifier):
    from curriculum_api.catalogue.api.ksb_sources import curriculum_ksb_framework_detail as read
    return read(request, identifier,
        json_error=json_error,
    )


@gzip_page
@require_GET
def curriculum_ksb_set_definitions(request, identifier):
    from curriculum_api.catalogue.api.ksb_sources import curriculum_ksb_set_definitions as read
    return read(request, identifier,
        json_error=json_error,
    )


@gzip_page
@require_GET
def curriculum_ksb_sets(request):
    from curriculum_api.catalogue.api.ksb_sources import curriculum_ksb_sets as read
    return read(request,
        CURRICULUM_SCHEMA=CURRICULUM_SCHEMA,
        curriculum_collection_response=curriculum_collection_response,
    )
