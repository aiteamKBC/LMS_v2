"""Concrete catalogue week template composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.catalogue.api.adapters import requested_expected_revision
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.query_adapters import week_template_detail_response
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.api.responses import record_conflict_response
from curriculum_api.catalogue.application.week_templates import week_template_component_metrics
from curriculum_api.catalogue.application.week_templates import week_template_payload
from curriculum_api.catalogue.domain.content_values import week_template_scope_fields
from curriculum_api.catalogue.domain.read_contracts import WEEK_TEMPLATES_TABLE
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.course_schema_runtime import ensure_week_template_tables
from curriculum_api.catalogue.infrastructure.lifecycle_persistence import soft_delete_rows
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.revision_runtime import lock_record_row
from curriculum_api.catalogue.infrastructure.row_queries import json_db_value
from curriculum_api.catalogue.infrastructure.template_composition import get_week_template_row
from curriculum_api.catalogue.infrastructure.template_composition import get_week_template_rows
from curriculum_api.catalogue.infrastructure.template_composition import save_week_template_components
from curriculum_api.catalogue.infrastructure.template_composition import week_template_record
from curriculum_api.catalogue.infrastructure.template_composition import week_template_revision
from datetime import datetime
from django.db import transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt


WEEK_TEMPLATE_COURSE_TYPES = {'paid', 'free'}


@csrf_exempt
def curriculum_week_template_collection(request):
    from curriculum_api.catalogue.api.week_template_commands import curriculum_week_template_collection as implementation
    return implementation(
        request,
        WEEK_TEMPLATES_TABLE=WEEK_TEMPLATES_TABLE,
        WEEK_TEMPLATE_COURSE_TYPES=WEEK_TEMPLATE_COURSE_TYPES,
        clean_str=clean_str,
        curriculum_results_response=curriculum_results_response,
        datetime=datetime,
        ensure_week_template_tables=ensure_week_template_tables,
        get_week_template_rows=get_week_template_rows,
        insert_row=insert_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_db_value=json_db_value,
        json_error=json_error,
        save_week_template_components=save_week_template_components,
        unique_prefixed_id=unique_prefixed_id,
        week_template_component_metrics=week_template_component_metrics,
        week_template_detail_response=week_template_detail_response,
        week_template_payload=week_template_payload,
        week_template_scope_fields=week_template_scope_fields,
    )


@csrf_exempt
def curriculum_week_template_detail(request, identifier):
    from curriculum_api.catalogue.api.week_template_commands import curriculum_week_template_detail as implementation
    return implementation(
        request, identifier,
        JsonResponse=JsonResponse,
        WEEK_TEMPLATES_TABLE=WEEK_TEMPLATES_TABLE,
        WEEK_TEMPLATE_COURSE_TYPES=WEEK_TEMPLATE_COURSE_TYPES,
        clean_str=clean_str,
        datetime=datetime,
        get_week_template_row=get_week_template_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache,
        json_body=json_body,
        json_db_value=json_db_value,
        json_error=json_error,
        lock_record_row=lock_record_row,
        record_conflict_response=record_conflict_response,
        requested_expected_revision=requested_expected_revision,
        save_week_template_components=save_week_template_components,
        soft_delete_rows=soft_delete_rows,
        transaction=transaction,
        update_rows=update_rows,
        week_template_component_metrics=week_template_component_metrics,
        week_template_detail_response=week_template_detail_response,
        week_template_record=week_template_record,
        week_template_revision=week_template_revision,
        week_template_scope_fields=week_template_scope_fields,
    )
