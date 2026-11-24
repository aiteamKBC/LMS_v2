"""Concrete catalogue holiday composition bindings.

Owns HTTP/decorator and runtime capability composition. Application operations,
domain policies, SQL and transaction behavior remain in their existing owners.
Public signatures and response contracts are unchanged."""
from curriculum_api import calendar_holidays
from curriculum_api.catalogue.api.adapters import curriculum_results_response
from curriculum_api.catalogue.api.adapters import holiday_date_payload
from curriculum_api.catalogue.api.cache_lifecycle import invalidate_curriculum_cache
from curriculum_api.catalogue.api.responses import curriculum_visibility
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.application.cohort_calendar import serialize_england_holiday_row
from curriculum_api.catalogue.application.cohort_calendar import serialize_holiday_row
from curriculum_api.catalogue.domain.read_contracts import AUTHORED_HOLIDAY_COLOR
from curriculum_api.catalogue.domain.read_contracts import ENGLAND_HOLIDAYS_TABLE
from curriculum_api.catalogue.domain.row_values import require_fields
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows
from curriculum_api.catalogue.infrastructure.cache_access import cached_curriculum_value
from curriculum_api.catalogue.infrastructure.calendar_runtime import authored_holiday_table_name
from curriculum_api.catalogue.infrastructure.calendar_runtime import england_holiday_exists
from curriculum_api.catalogue.infrastructure.catalogue_sources import get_holiday_rows
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.database_reads import fetch_all
from curriculum_api.catalogue.infrastructure.database_reads import table_exists
from curriculum_api.catalogue.infrastructure.database_reads import table_name
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import archive_payload
from curriculum_api.catalogue.infrastructure.write_composition import delete_rows
from datetime import datetime
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET


@require_GET
def curriculum_holidays(request):
    from curriculum_api.catalogue.api.holiday_commands import curriculum_holidays as implementation
    def load_england_holidays():
        from curriculum_api import england_holidays as operation
        return operation
    return implementation(
        request, cached_curriculum_value=cached_curriculum_value,
        curriculum_results_response=curriculum_results_response,
        curriculum_visibility=curriculum_visibility, get_holiday_rows=get_holiday_rows,
        load_england_holidays=load_england_holidays, serialize_holiday_row=serialize_holiday_row,
    )


HOLIDAY_READ_ONLY_MESSAGE = (
    'That holiday is one of the published England and Wales bank holidays, '
    'mirrored from GOV.UK. It cannot be edited here -- it changes when GOV.UK '
    'changes it.'
)


@csrf_exempt
def curriculum_holiday_collection(request):
    from curriculum_api.catalogue.api.holiday_commands import curriculum_holiday_collection as implementation
    return implementation(
        request, AUTHORED_HOLIDAY_COLOR=AUTHORED_HOLIDAY_COLOR, JsonResponse=JsonResponse,
        authored_holiday_table_name=authored_holiday_table_name,
        calendar_holidays=calendar_holidays, clean_str=clean_str,
        curriculum_holidays=curriculum_holidays, datetime=datetime,
        holiday_date_payload=holiday_date_payload, insert_row=insert_row,
        invalidate_curriculum_cache=invalidate_curriculum_cache, json_body=json_body,
        json_error=json_error, require_fields=require_fields,
        serialize_holiday_row=serialize_holiday_row,
    )


@csrf_exempt
def curriculum_holiday_detail(request, identifier):
    from curriculum_api.catalogue.api.holiday_commands import curriculum_holiday_detail as implementation
    return implementation(
        request, identifier, HOLIDAY_READ_ONLY_MESSAGE=HOLIDAY_READ_ONLY_MESSAGE,
        JsonResponse=JsonResponse, archive_payload=archive_payload,
        authored_holiday_table_name=authored_holiday_table_name,
        calendar_holidays=calendar_holidays, clean_str=clean_str, datetime=datetime,
        delete_rows=delete_rows, england_holiday_exists=england_holiday_exists, fetch_all=fetch_all,
        get_holiday_rows=get_holiday_rows, holiday_date_payload=holiday_date_payload,
        invalidate_curriculum_cache=invalidate_curriculum_cache, json_body=json_body,
        json_error=json_error, serialize_holiday_row=serialize_holiday_row, table_name=table_name,
        update_rows=update_rows,
    )


@require_GET
def curriculum_england_holidays(request):
    from curriculum_api.catalogue.api.holiday_commands import curriculum_england_holidays as implementation
    def load_england_holidays():
        from curriculum_api import england_holidays as operation
        return operation
    return implementation(
        request, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, ENGLAND_HOLIDAYS_TABLE=ENGLAND_HOLIDAYS_TABLE,
        JsonResponse=JsonResponse, calendar_holidays=calendar_holidays, fetch_all=fetch_all,
        format_date=format_date, load_england_holidays=load_england_holidays,
        serialize_england_holiday_row=serialize_england_holiday_row, table_exists=table_exists,
        table_name=table_name,
    )


@require_GET
def curriculum_england_holiday_syncs(request):
    from curriculum_api.catalogue.api.holiday_commands import curriculum_england_holiday_syncs as implementation
    def load_england_holidays():
        from curriculum_api import england_holidays as operation
        return operation
    return implementation(
        request, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, JsonResponse=JsonResponse,
        load_england_holidays=load_england_holidays, parse_int=parse_int,
    )


@csrf_exempt
def curriculum_england_holidays_refresh(request):
    from curriculum_api.catalogue.api.holiday_commands import curriculum_england_holidays_refresh as implementation
    def load_england_holidays():
        from curriculum_api import england_holidays as operation
        return operation
    return implementation(
        request, JsonResponse=JsonResponse, json_body=json_body, json_error=json_error,
        load_england_holidays=load_england_holidays, truthy=truthy,
    )
