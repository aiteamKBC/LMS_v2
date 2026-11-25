"""Concrete catalogue ksb mapping composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.revision_adapters import guarded_module_item_write
from curriculum_api.catalogue.domain.archive_policy import active_mapping_rows
from curriculum_api.catalogue.domain.content_values import normalise_ksb_weight
from curriculum_api.catalogue.domain.content_values import normalise_ksb_weight_class
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_bulk_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.authoring_storage import update_authoring_rows
from curriculum_api.catalogue.infrastructure.component_composition import normalise_component_ksb_mappings
from curriculum_api.catalogue.infrastructure.component_composition import validate_ksb_mapping_payload
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_MODULES_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.ksb_coverage import normalise_code as coverage_normalise_code
from curriculum_api.learner_ksb_sync import sync_progress_ksbs
from curriculum_api.reporting.domain.source_values import source_payload_from_mapping
from curriculum_api.reporting.infrastructure.source_catalogue_runtime import infer_mapping_source_from_module
from curriculum_api.reporting.infrastructure.source_runtime import component_ksb_mappings_from_row
from curriculum_api.reporting.infrastructure.source_runtime import normalise_ksb_classification
from datetime import datetime
from django.db import IntegrityError
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt


def store_component_ksb_mappings(component, items, deleted_by):
    from curriculum_api.catalogue.application.component_resources import store_component_ksb_mappings as implementation
    return implementation(
        component,
        items,
        deleted_by,
        sync_component_ksb_projection=sync_component_ksb_projection,
    )


def sync_component_ksb_projection(component_id, component_row=None, module_row=None, week_id=None, deleted_by='component-ksb-sync'):
    from curriculum_api.catalogue.application.component_resources import sync_component_ksb_projection as implementation
    return implementation(
        component_id,
        component_row,
        module_row,
        week_id,
        deleted_by,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        authoring_bulk_upsert=authoring_bulk_upsert,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        component_ksb_mappings_from_row=component_ksb_mappings_from_row,
        has_column=has_column,
        json_db_value=json_db_value,
        normalise_component_ksb_mappings=normalise_component_ksb_mappings,
        sync_progress_ksbs=sync_progress_ksbs,
        update_authoring_rows=update_authoring_rows,
        read_component_items=read_component_items,
    )



@csrf_exempt
def curriculum_ksb_mapping_detail(request, mapping_id):
    from curriculum_api.catalogue.api.content_commands import curriculum_ksb_mapping_detail as implementation
    return implementation(
        request, mapping_id,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        _curriculum_ksb_mapping_detail=_curriculum_ksb_mapping_detail,
        authoring_fetch_all=authoring_fetch_all,
        clean_str=clean_str,
        guarded_module_item_write=guarded_module_item_write,
    )


def _curriculum_ksb_mapping_detail(request, mapping_id):
    from curriculum_api.catalogue.api.content_commands import _curriculum_ksb_mapping_detail as implementation
    return implementation(
        request, mapping_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        AUTHORING_MODULES_TABLE=AUTHORING_MODULES_TABLE,
        IntegrityError=IntegrityError,
        JsonResponse=JsonResponse,
        active_mapping_rows=active_mapping_rows,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        authoring_upsert=authoring_upsert,
        clean_str=clean_str,
        component_ksb_mappings_from_row=component_ksb_mappings_from_row,
        coverage_normalise_code=coverage_normalise_code,
        datetime=datetime,
        infer_mapping_source_from_module=infer_mapping_source_from_module,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        normalise_component_ksb_mappings=normalise_component_ksb_mappings,
        normalise_ksb_classification=normalise_ksb_classification,
        normalise_ksb_weight=normalise_ksb_weight,
        normalise_ksb_weight_class=normalise_ksb_weight_class,
        source_payload_from_mapping=source_payload_from_mapping,
        store_component_ksb_mappings=store_component_ksb_mappings,
        transaction=transaction,
        validate_ksb_mapping_payload=validate_ksb_mapping_payload,
    )

from curriculum_api.catalogue.infrastructure.ksb_read_store import component_items as read_component_items
