"""Concrete catalogue / api / revision adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api.catalogue.api.adapters import requested_expected_revision
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.responses import record_conflict_response
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import unique
from curriculum_api.catalogue.infrastructure.revision_runtime import CURRICULUM_RECORD_REVISIONS
from curriculum_api.catalogue.infrastructure.revision_runtime import curriculum_record_revision
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_module_structure_row
from curriculum_api.catalogue.infrastructure.revision_runtime import module_structure_revision
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.http import require_GET


@require_GET
def curriculum_record_revisions(request):
    from curriculum_api.catalogue.application.record_revisions import read_record_revisions as query
    return JsonResponse(query(
        request.GET.getlist,
        CURRICULUM_RECORD_REVISIONS=CURRICULUM_RECORD_REVISIONS, unique=unique, clean_str=clean_str,
        curriculum_record_revision=curriculum_record_revision,
    ))


def refuse_stale_module_write(request, payload, module_catalogue_id):
    from curriculum_api.catalogue.api.content_commands import refuse_stale_module_write as implementation
    return implementation(
        request, payload, module_catalogue_id,
        json_error=json_error,
        lock_module_structure_row=lock_module_structure_row,
        module_structure_revision=module_structure_revision,
        record_conflict_response=record_conflict_response,
        requested_expected_revision=requested_expected_revision,
    )


def guarded_module_item_write(request, module_catalogue_id, write):
    from curriculum_api.catalogue.api.content_commands import guarded_module_item_write as implementation
    return implementation(
        request, module_catalogue_id, write,
        clean_str=clean_str,
        json_body=json_body,
        refuse_stale_module_write=refuse_stale_module_write,
        transaction=transaction,
    )
