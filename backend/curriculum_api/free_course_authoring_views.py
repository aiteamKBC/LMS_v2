"""HTTP contract for read-only canonical Free Course authoring documents."""
from __future__ import annotations

import json
import logging

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils.cache import patch_vary_headers
from django.utils.http import quote_etag
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from django.views.decorators.http import require_http_methods

from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING
from login.permissions import authenticate_request, require_access, require_all_access

from . import free_course_authoring, free_course_authoring_mutations, schema_gate
from .free_course_writer_mode import FreeCourseWriterDisabled


logger = logging.getLogger(__name__)


def _response(document):
    response = JsonResponse(document)
    response["ETag"] = quote_etag(document["revision"])
    response["Cache-Control"] = "private, no-store"
    patch_vary_headers(response, ("Cookie",))
    return response


def _error(code, message, status):
    response = JsonResponse({"error": message, "code": code}, status=status)
    response["Cache-Control"] = "private, no-store"
    patch_vary_headers(response, ("Cookie",))
    return response


def _mutation_error(exc):
    payload = {"error": str(exc), "code": exc.code, **exc.details}
    response = JsonResponse(payload, status=exc.status)
    response["Cache-Control"] = "private, no-store"
    patch_vary_headers(response, ("Cookie",))
    return response


def _body(request):
    header = request.META.get("CONTENT_LENGTH")
    if header:
        try:
            if int(header) > free_course_authoring_mutations.MAX_REQUEST_BYTES:
                raise free_course_authoring_mutations.MutationError(
                    "request_too_large", "Free Course requests are limited to 2 MiB.", status=413,
                )
        except ValueError:
            raise free_course_authoring_mutations.MutationError(
                "invalid_content_length", "Content-Length is invalid.", status=400,
            )
    raw = request.body
    if len(raw) > free_course_authoring_mutations.MAX_REQUEST_BYTES:
        raise free_course_authoring_mutations.MutationError(
            "request_too_large", "Free Course requests are limited to 2 MiB.", status=413,
        )
    try:
        value = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise free_course_authoring_mutations.MutationError("invalid_json", "Invalid JSON body.")
    if not isinstance(value, dict):
        raise free_course_authoring_mutations.MutationError("validation_error", "Request body must be an object.")
    return value


def _unavailable(exc):
    logger.warning("Free Course authoring read is unavailable: %s", type(exc).__name__)
    return _error(
        "free_course_authoring_unavailable",
        "Free Course authoring is temporarily unavailable.",
        503,
    )


@require_access(ACCESS_CURRICULUM)
def _catalogue_get(request):
    try:
        return _response(free_course_authoring.catalogue_document())
    except (DatabaseError, schema_gate.SchemaNotProvisioned) as exc:
        return _unavailable(exc)


@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
def _catalogue_post(request):
    try:
        payload = _body(request)
        account = authenticate_request(request)
        result = free_course_authoring_mutations.create_course(
            payload,
            staff_id=account.subject_id,
            idempotency_key=request.headers.get("Idempotency-Key"),
        )
        response = JsonResponse(result["body"], status=result["status"])
        response["ETag"] = result["etag"]
        response["Location"] = result["location"]
        response["Cache-Control"] = "private, no-store"
        if result["replayed"]:
            response["Idempotency-Replayed"] = "true"
        patch_vary_headers(response, ("Cookie",))
        return response
    except free_course_authoring_mutations.MutationError as exc:
        return _mutation_error(exc)
    except FreeCourseWriterDisabled as exc:
        return _error("free_course_writer_disabled", str(exc), 503)
    except (DatabaseError, schema_gate.SchemaNotProvisioned) as exc:
        return _unavailable(exc)


@ensure_csrf_cookie
@csrf_protect
@require_http_methods(["GET", "POST"])
def catalogue(request):
    return _catalogue_get(request) if request.method == "GET" else _catalogue_post(request)


@ensure_csrf_cookie
@csrf_protect
@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
@require_http_methods(["POST"])
def import_module(request):
    try:
        payload = _body(request)
        account = authenticate_request(request)
        result = free_course_authoring_mutations.clone_normal_module(
            payload,
            staff_id=account.subject_id,
            idempotency_key=request.headers.get("Idempotency-Key"),
        )
        response = JsonResponse(result["body"], status=result["status"])
        response["ETag"] = result["etag"]
        response["Location"] = result["location"]
        if result["replayed"]:
            response["Idempotency-Replayed"] = "true"
        response["Cache-Control"] = "private, no-store"
        return response
    except free_course_authoring_mutations.MutationError as exc:
        return _mutation_error(exc)
    except FreeCourseWriterDisabled as exc:
        return _error("free_course_writer_disabled", str(exc), 503)
    except (DatabaseError, schema_gate.SchemaNotProvisioned) as exc:
        return _unavailable(exc)


@require_access(ACCESS_CURRICULUM)
def _course_get(request, course_id):
    try:
        course_id = free_course_authoring.normalize_course_id(course_id)
    except free_course_authoring.InvalidFreeCourseId:
        return _error(
            "invalid_free_course_id",
            "A valid Free Course id is required.",
            400,
        )
    try:
        return _response(free_course_authoring.course_document(course_id))
    except free_course_authoring.FreeCourseNotFound:
        return _error(
            "free_course_not_found",
            "Free Course not found.",
            404,
        )
    except (DatabaseError, schema_gate.SchemaNotProvisioned) as exc:
        return _unavailable(exc)


@require_all_access(ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING)
def _course_mutation(request, course_id):
    try:
        course_id = free_course_authoring.normalize_course_id(course_id)
        payload = _body(request)
        if request.method == "PATCH":
            document = free_course_authoring_mutations.update_course(course_id, payload)
            return _response(document)
        result = free_course_authoring_mutations.delete_course(course_id, payload)
        response = JsonResponse(result)
        response["Cache-Control"] = "private, no-store"
        return response
    except free_course_authoring.InvalidFreeCourseId:
        return _error("invalid_free_course_id", "A valid Free Course id is required.", 400)
    except free_course_authoring_mutations.MutationError as exc:
        return _mutation_error(exc)
    except FreeCourseWriterDisabled as exc:
        return _error("free_course_writer_disabled", str(exc), 503)
    except (DatabaseError, schema_gate.SchemaNotProvisioned) as exc:
        return _unavailable(exc)


@ensure_csrf_cookie
@csrf_protect
@require_http_methods(["GET", "PATCH", "DELETE"])
def course(request, course_id):
    if request.method == "GET":
        return _course_get(request, course_id)
    return _course_mutation(request, course_id)
