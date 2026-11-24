"""Concrete catalogue content command composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import upload_storage
from curriculum_api.catalogue.api.adapters import ai_material_response
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.catalogue.api.authoring_composition import save_component_builder_payload
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.revision_adapters import refuse_stale_module_write
from curriculum_api.catalogue.application.component_projection import component_rows_for_programme_page
from curriculum_api.catalogue.application.component_projection import component_rows_without_content
from curriculum_api.catalogue.domain.authoring_errors import ModuleAuthoringValidationError
from curriculum_api.catalogue.domain.component_settings import normalise_component_settings_payload
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_UPLOAD_EXTENSIONS
from curriculum_api.catalogue.domain.row_values import require_fields
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import parse_json_value
from curriculum_api.catalogue.infrastructure.authoring_runtime import authoring_fetch_all
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import AI_MATERIAL_COLUMN
from curriculum_api.catalogue.infrastructure.authoring_schema_runtime import ensure_module_authoring_tables
from curriculum_api.catalogue.infrastructure.authoring_storage import authoring_upsert
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.component_composition import component_builder_rows
from curriculum_api.catalogue.infrastructure.content_runtime import component_builder_response
from curriculum_api.catalogue.infrastructure.content_runtime import component_source_inputs_fingerprint
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_ADVANCED_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_COMPONENTS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import AUTHORING_KSB_MAPPINGS_TABLE
from curriculum_api.catalogue.infrastructure.database_reads import authoring_table_name
from curriculum_api.catalogue.infrastructure.database_reads import has_column
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import authoring_soft_delete
from curriculum_api.catalogue.infrastructure.media_runtime import ai_material_record
from curriculum_api.catalogue.infrastructure.media_runtime import component_upload_metadata
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.http_cache import conditional_json_response
from curriculum_api.http_cache import encode_json_bytes
from curriculum_api.http_cache import query_list
from curriculum_api.http_cache import query_value
from datetime import datetime
from django.db import connection
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import hashlib
import mimetypes


AI_MATERIAL_UPLOAD_EXTENSIONS = {'.pdf', '.epub', '.doc', '.docx', '.txt', '.rtf', '.odt'}


AI_MATERIAL_UPLOAD_SLOT = 'ai-material'


def update_component_upload_settings(component_id, component_type, metadata):
    from curriculum_api.catalogue.infrastructure.content_uploads import update_component_upload_settings as implementation
    return implementation(
        component_id, component_type, metadata,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        _update_component_upload_settings=_update_component_upload_settings,
        authoring_table_name=authoring_table_name,
        connection=connection,
        transaction=transaction,
    )


def _update_component_upload_settings(component_id, component_type, metadata):
    from curriculum_api.catalogue.application.component_resources import _update_component_upload_settings as implementation
    return implementation(
        component_id, component_type, metadata,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        authoring_fetch_all=authoring_fetch_all,
        authoring_upsert=authoring_upsert,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_db_value=json_db_value,
        normalise_component_settings_payload=normalise_component_settings_payload,
        parse_json_value=parse_json_value,
    )


@csrf_exempt
def curriculum_component_collection(request):
    from curriculum_api.catalogue.api.content_commands import curriculum_component_collection as implementation
    return implementation(
        request,
        JsonResponse=JsonResponse,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        cached_curriculum_value=cached_curriculum_value,
        clean_str=clean_str,
        component_builder_rows=component_builder_rows,
        component_rows_for_programme_page=component_rows_for_programme_page,
        component_rows_without_content=component_rows_without_content,
        component_source_inputs_fingerprint=component_source_inputs_fingerprint,
        conditional_json_response=conditional_json_response,
        curriculum_results_response=curriculum_results_response,
        encode_json_bytes=encode_json_bytes,
        hashlib=hashlib,
        json_body=json_body,
        json_error=json_error,
        logger=logger,
        query_list=query_list,
        query_value=query_value,
        require_fields=require_fields,
        save_component_builder_payload=save_component_builder_payload,
    )


@csrf_exempt
def curriculum_component_detail(request, component_id):
    from curriculum_api.catalogue.api.content_commands import curriculum_component_detail as implementation
    return implementation(
        request, component_id,
        AUTHORING_COMPONENTS_TABLE=AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=AUTHORING_KSB_MAPPINGS_TABLE,
        JsonResponse=JsonResponse,
        ModuleAuthoringValidationError=ModuleAuthoringValidationError,
        authoring_fetch_all=authoring_fetch_all,
        authoring_soft_delete=authoring_soft_delete,
        clean_str=clean_str,
        component_builder_response=component_builder_response,
        component_builder_rows=component_builder_rows,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_error=json_error,
        logger=logger,
        refuse_stale_module_write=refuse_stale_module_write,
        save_component_builder_payload=save_component_builder_payload,
        transaction=transaction,
    )


@csrf_exempt
def curriculum_component_upload(request, component_id):
    from curriculum_api.catalogue.api.content_uploads import curriculum_component_upload as implementation
    return implementation(
        request, component_id,
        COMPONENT_UPLOAD_EXTENSIONS=COMPONENT_UPLOAD_EXTENSIONS,
        JsonResponse=JsonResponse,
        clean_str=clean_str,
        component_upload_metadata=component_upload_metadata,
        frontend_component_type=frontend_component_type,
        json_error=json_error,
        logger=logger,
        update_component_upload_settings=update_component_upload_settings,
    )


@csrf_exempt
def curriculum_module_ai_material(request, module_catalogue_id):
    from curriculum_api.catalogue.api.content_uploads import curriculum_module_ai_material as implementation
    return implementation(
        request, module_catalogue_id,
        AI_MATERIAL_COLUMN=AI_MATERIAL_COLUMN,
        AI_MATERIAL_UPLOAD_EXTENSIONS=AI_MATERIAL_UPLOAD_EXTENSIONS,
        AI_MATERIAL_UPLOAD_SLOT=AI_MATERIAL_UPLOAD_SLOT,
        AUTHORING_ADVANCED_TABLE=AUTHORING_ADVANCED_TABLE,
        ai_material_record=ai_material_record,
        ai_material_response=ai_material_response,
        authoring_upsert=authoring_upsert,
        clean_str=clean_str,
        component_upload_metadata=component_upload_metadata,
        datetime=datetime,
        ensure_module_authoring_tables=ensure_module_authoring_tables,
        has_column=has_column,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_db_value=json_db_value,
        json_error=json_error,
        logger=logger,
        mimetypes=mimetypes,
        upload_storage=upload_storage,
    )
