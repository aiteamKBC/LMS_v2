"""Concrete catalogue / api / adapters capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""
from curriculum_api import pptx_slides
from curriculum_api import upload_storage
from curriculum_api.catalogue.api.responses import json_body
from curriculum_api.catalogue.api.responses import json_error
from curriculum_api.catalogue.application.tutor_availability import tutor_conflict_message
from curriculum_api.catalogue.domain.archive_policy import programme_deleted_row
from curriculum_api.catalogue.domain.content_validation import frontend_component_type
from curriculum_api.catalogue.domain.hierarchy_dates import calculate_cohort_end_date
from curriculum_api.catalogue.domain.hierarchy_dates import cohort_apprenticeship_end_date
from curriculum_api.catalogue.domain.hierarchy_dates import infer_duration_months
from curriculum_api.catalogue.domain.hierarchy_dates import payload_apprenticeship_end_override
from curriculum_api.catalogue.domain.hierarchy_dates import payload_epa_months
from curriculum_api.catalogue.domain.read_contracts import COMPONENT_UPLOAD_EXTENSIONS
from curriculum_api.catalogue.domain.read_contracts import MODULE_COVER_FILE_PATH
from curriculum_api.catalogue.domain.read_contracts import OFFICE_PREVIEW_EXTENSIONS
from curriculum_api.catalogue.domain.read_contracts import OFFICE_PREVIEW_MAX_AGE_SECONDS
from curriculum_api.catalogue.domain.read_contracts import OFFICE_PREVIEW_SALT
from curriculum_api.catalogue.domain.staff_identity import staff_assignment_key
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.catalogue.domain.values import format_date
from curriculum_api.catalogue.domain.values import parse_date
from curriculum_api.catalogue.domain.values import parse_int
from curriculum_api.catalogue.domain.values import truthy
from curriculum_api.catalogue.infrastructure.cache_composition import recent_curriculum_changes
from curriculum_api.catalogue.infrastructure.cache_composition import shared_curriculum_epoch
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_delivery_day_gap
from curriculum_api.catalogue.infrastructure.calendar_runtime import module_schedule_view
from curriculum_api.catalogue.infrastructure.database_reads import CURRICULUM_SCHEMA
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import permanent_delete_reference_blockers
from curriculum_api.catalogue.infrastructure.lifecycle_runtime import surviving_authoring_module_rows
from curriculum_api.catalogue.infrastructure.media_runtime import component_upload_metadata
from curriculum_api.catalogue.infrastructure.placement_runtime import safe_group_delivery_rows
from curriculum_api.catalogue.infrastructure.row_queries import safe_authoring_module_rows
from curriculum_api.catalogue.infrastructure.runtime_config import logger
from curriculum_api.catalogue.infrastructure.upload_paths import COMPONENT_UPLOAD_ROOT
from curriculum_api.course_pricing import API_FIELDS as COURSE_PRICING_FIELDS
from curriculum_api.meetings.api.adapters import teams_delivery_metadata_from_weeks
from django.core import signing
from django.core.serializers.json import DjangoJSONEncoder
from django.http import FileResponse
from django.http import Http404
from django.http import HttpResponse
from django.http import HttpResponseNotModified
from django.http import HttpResponseRedirect
from django.http import JsonResponse
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET
from html import escape
from pathlib import Path
from urllib import parse as urllib_parse
from urllib.parse import urlparse
import hashlib
import json
import mimetypes
import re
import tempfile


def request_bypasses_curriculum_cache(request):
    from curriculum_api.catalogue.api.read_responses import request_bypasses_curriculum_cache as query
    return query(
        request, clean_str=clean_str, truthy=truthy,
    )


def reference_json_response(request, payload):
    from curriculum_api.catalogue.api.read_responses import reference_json_response as query
    return query(
        request, payload, DjangoJSONEncoder=DjangoJSONEncoder, HttpResponse=HttpResponse,
        HttpResponseNotModified=HttpResponseNotModified, clean_str=clean_str, hashlib=hashlib, json=json,
    )


def tutor_assignment_delivery_day_error(candidate, before=None, groups=None):
    from curriculum_api.catalogue.api.authoring_guards import tutor_assignment_delivery_day_error as implementation
    return implementation(
        candidate, before, groups, clean_str=clean_str, json_error=json_error,
        module_delivery_day_gap=module_delivery_day_gap, staff_assignment_key=staff_assignment_key,
    )


def tutor_conflict_error(candidate, conflicts):
    return json_error(
        tutor_conflict_message(candidate, conflicts),
        status=409,
        tutorConflicts=conflicts,
        tutor=candidate.get('tutor_name'),
        moduleName=candidate.get('title'),
    )


def group_tutor_assignment_delivery_day_error(group_id, tutor_name, module_rows=None, next_week_day=None):
    from curriculum_api.catalogue.api.authoring_guards import group_tutor_assignment_delivery_day_error as implementation
    return implementation(
        group_id, tutor_name, module_rows, next_week_day, clean_str=clean_str,
        module_delivery_day_gap=module_delivery_day_gap, module_schedule_view=module_schedule_view,
        safe_authoring_module_rows=safe_authoring_module_rows,
        safe_group_delivery_rows=safe_group_delivery_rows, staff_assignment_key=staff_assignment_key,
        surviving_authoring_module_rows=surviving_authoring_module_rows,
        tutor_assignment_delivery_day_error=tutor_assignment_delivery_day_error,
    )


def paginate_curriculum_results(request, results, max_page_size=250):
    from curriculum_api.catalogue.api.read_responses import paginate_curriculum_results as query
    return query(
        request, results, max_page_size, clean_str=clean_str, parse_int=parse_int,
    )


def curriculum_collection_response(payload, key, results=None, request=None):
    from curriculum_api.catalogue.api.read_responses import curriculum_collection_response as query
    return query(
        payload, key, results, request, JsonResponse=JsonResponse,
        paginate_curriculum_results=paginate_curriculum_results,
    )


def curriculum_results_response(results, request=None):
    from curriculum_api.catalogue.api.read_responses import curriculum_results_response as query
    return query(
        results, request, CURRICULUM_SCHEMA=CURRICULUM_SCHEMA, JsonResponse=JsonResponse,
        paginate_curriculum_results=paginate_curriculum_results,
    )


def requested_expected_revision(request, payload):
    from curriculum_api.catalogue.api.authoring_guards import requested_expected_revision as implementation
    return implementation(
        request, payload, clean_str=clean_str,
    )


def authoring_summary_catalogue_item(summary):
    from curriculum_api.catalogue.application.authoring_summaries import authoring_summary_catalogue_item as query
    return query(
        summary,
        COURSE_PRICING_FIELDS=COURSE_PRICING_FIELDS,
        programme_deleted_row=programme_deleted_row,
        teams_delivery_metadata_from_weeks=teams_delivery_metadata_from_weeks,
    )


@require_GET
def curriculum_cache_epoch(request):
    """The number that changes whenever curriculum data is written.

    A client polls this to find out that somebody else has saved. It is the same
    counter `invalidate_curriculum_cache()` bumps, so it moves on every write and
    on nothing else -- no timestamps, no per-record versions to keep in step.

    Deliberately the cheapest read in this module: at most one single-row read
    per worker per SHARED_EPOCH_POLL_SECONDS, no payload build. A tab open in
    another country polls it every few seconds, so it has to stay that way.
    Reading it must never fail a page either -- `shared_curriculum_epoch()`
    answers with the last value this worker saw when the counter cannot be read,
    and a client that sees a frozen epoch simply keeps the data it has and falls
    back on its own refresh-when-you-return.

    Meaningful across workers because the counter lives in the database. It used
    to live in Django's cache, which is per process without a Redis CACHE_URL,
    so under nine two-worker services it told seventeen workers out of eighteen
    nothing at all.

    `changes` says which paths moved the counter, so a client that is only a few
    epochs behind can refresh those and leave the rest of its cache alone. It is
    a hint and nothing more: a client is expected to check that the entries cover
    every epoch it missed, and to fall back to refreshing everything when they do
    not. Reading it costs one more Redis GET and it is capped at
    CURRICULUM_CHANGE_LOG_SIZE entries, so this stays the cheap read it has to be.
    """
    return JsonResponse({
        'epoch': shared_curriculum_epoch(),
        'changes': [] if getattr(getattr(request, 'login_account', None), 'role', None) == 'learner'
        else recent_curriculum_changes(),
    })


@csrf_exempt
def curriculum_preview_cohort_end_date(request):
    from curriculum_api.catalogue.api.cohort_preview import curriculum_preview_cohort_end_date as implementation
    return implementation(
        request, JsonResponse=JsonResponse, calculate_cohort_end_date=calculate_cohort_end_date,
        cohort_apprenticeship_end_date=cohort_apprenticeship_end_date, format_date=format_date,
        infer_duration_months=infer_duration_months, json_body=json_body, json_error=json_error,
        parse_date=parse_date, parse_int=parse_int,
        payload_apprenticeship_end_override=payload_apprenticeship_end_override,
        payload_epa_months=payload_epa_months,
    )


def request_reads_after_write(request):
    from curriculum_api.catalogue.api.programme_detail import request_reads_after_write as query
    return query(
        request,
        clean_str=clean_str,
    )


def canonical_programme_detail_issues(payload):
    from curriculum_api.catalogue.api.programme_detail import canonical_programme_detail_issues as query
    return query(
        payload,
        clean_str=clean_str,
    )


def ai_material_response(module_catalogue_id, record, **extra):
    from curriculum_api.catalogue.api.content_uploads import ai_material_response as implementation
    return implementation(
        module_catalogue_id, record,
        JsonResponse=JsonResponse,
        **extra,
    )


@csrf_exempt
def curriculum_week_component_upload(request, component_id):
    from curriculum_api.catalogue.api.content_uploads import curriculum_week_component_upload as implementation
    return implementation(
        request, component_id,
        COMPONENT_UPLOAD_EXTENSIONS=COMPONENT_UPLOAD_EXTENSIONS,
        JsonResponse=JsonResponse,
        clean_str=clean_str,
        component_upload_metadata=component_upload_metadata,
        frontend_component_type=frontend_component_type,
        json_error=json_error,
        logger=logger,
    )


def uploads_relative_path(src):
    from curriculum_api.catalogue.api.media_delivery import uploads_relative_path as implementation
    return implementation(
        src, COMPONENT_UPLOAD_ROOT=COMPONENT_UPLOAD_ROOT, clean_str=clean_str, pptx_slides=pptx_slides,
        urllib_parse=urllib_parse, urlparse=urlparse,
    )


def parse_byte_range(header, total_size):
    from curriculum_api.catalogue.api.media_delivery import parse_byte_range as implementation
    return implementation(header, total_size)


@require_GET
def curriculum_presentation_slides(request):
    from curriculum_api.catalogue.api.media_delivery import curriculum_presentation_slides as implementation
    from curriculum_api.catalogue.infrastructure.presentation_sources import source_exists
    from curriculum_api.catalogue.application.presentation_reads import read_uploaded_presentation

    def load_legacy_attachment_bytes(attachment_id):
        from learner_api.media_proxy import _load_legacy_attachment_bytes
        return _load_legacy_attachment_bytes(attachment_id)

    def read(relative_path):
        return read_uploaded_presentation(
            relative_path, content_stamp=upload_storage.content_stamp,
            cached_for_stamp=pptx_slides.deck_model_for_stamp, local_copy=upload_storage.local_copy,
            source_exists=source_exists, cached_model=pptx_slides.cached_deck_model,
            render_model=pptx_slides.render_uploaded_deck, UnsupportedDeck=pptx_slides.UnsupportedDeck,
        )
    return implementation(
        request, JsonResponse=JsonResponse, Path=Path, clean_str=clean_str, json_error=json_error,
        pptx_slides=pptx_slides, re=re, tempfile=tempfile, uploads_relative_path=uploads_relative_path,
        urlparse=urlparse, load_legacy_attachment_bytes=load_legacy_attachment_bytes,
        read_uploaded_presentation=read,
    )


def office_preview_link(relative_path):
    from curriculum_api.catalogue.api.media_delivery import office_preview_link as implementation
    return implementation(
        relative_path, OFFICE_PREVIEW_SALT=OFFICE_PREVIEW_SALT, Path=Path, signing=signing,
        urllib_parse=urllib_parse,
    )


def curriculum_upload_storage_error(error):
    from curriculum_api.catalogue.api.media_delivery import curriculum_upload_storage_error as implementation
    return implementation(error, json_error=json_error, logger=logger, upload_storage=upload_storage)


@require_GET
def curriculum_office_preview_file(request, token, filename):
    from curriculum_api.catalogue.api.media_delivery import curriculum_office_preview_file as implementation
    return implementation(
        request, token, filename, COMPONENT_UPLOAD_ROOT=COMPONENT_UPLOAD_ROOT, FileResponse=FileResponse,
        Http404=Http404, OFFICE_PREVIEW_MAX_AGE_SECONDS=OFFICE_PREVIEW_MAX_AGE_SECONDS,
        OFFICE_PREVIEW_SALT=OFFICE_PREVIEW_SALT, Path=Path,
        curriculum_upload_storage_error=curriculum_upload_storage_error, mimetypes=mimetypes, signing=signing,
        upload_storage=upload_storage,
    )


@require_GET
@xframe_options_sameorigin
def curriculum_uploaded_file(request, path):
    from curriculum_api.catalogue.api.media_delivery import curriculum_uploaded_file as implementation
    return implementation(
        request, path, COMPONENT_UPLOAD_ROOT=COMPONENT_UPLOAD_ROOT, FileResponse=FileResponse,
        Http404=Http404, HttpResponse=HttpResponse, HttpResponseRedirect=HttpResponseRedirect,
        MODULE_COVER_FILE_PATH=MODULE_COVER_FILE_PATH, OFFICE_PREVIEW_EXTENSIONS=OFFICE_PREVIEW_EXTENSIONS,
        Path=Path, clean_str=clean_str, curriculum_upload_storage_error=curriculum_upload_storage_error,
        escape=escape, mimetypes=mimetypes, office_preview_link=office_preview_link,
        parse_byte_range=parse_byte_range, re=re, upload_storage=upload_storage, urllib_parse=urllib_parse,
    )


def permanent_delete_reference_refusal(kind, identifier):
    from curriculum_api.catalogue.api.authoring_guards import permanent_delete_reference_refusal as implementation
    return implementation(
        kind, identifier, clean_str=clean_str, json_error=json_error,
        permanent_delete_reference_blockers=permanent_delete_reference_blockers,
    )


def holiday_date_payload(payload, existing=None):
    from curriculum_api.catalogue.api.authoring_guards import holiday_date_payload as implementation
    return implementation(
        payload, existing, format_date=format_date, json_error=json_error,
    )
