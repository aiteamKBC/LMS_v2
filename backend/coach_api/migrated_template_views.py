"""Curriculum administration of migrated Aptem templates, isolated from native forms."""
from copy import deepcopy
from functools import wraps
import json

from django.db import IntegrityError, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie

from learner_api.constants import ACCESS_CURRICULUM
from login.permissions import require_access
from .migrated_reviews import render_sections
from .migrated_templates import (
    FAMILIES, historical_candidate, resolution_metadata, resolve_template,
    serialize_template, validate_managed_definition, validate_slot,
)
from .models import MigratedReviewTemplate
from .migrated_template_sync import lock_template_family


def management_endpoint(methods):
    def decorate(view):
        @wraps(view)
        @require_access(ACCESS_CURRICULUM)
        @ensure_csrf_cookie
        @csrf_protect
        def guarded(request, *args, **kwargs):
            if request.method not in methods:
                return JsonResponse({"detail": "Method not allowed."}, status=405)
            if request.method != "GET" and (request.GET.get("viewAsCoach") or request.GET.get("viewAsLearner")):
                return JsonResponse({"detail": "View-as is read-only."}, status=403)
            try:
                return view(request, *args, **kwargs)
            except (ValueError, TypeError) as exc:
                return JsonResponse({"detail": str(exc)}, status=400)
            except IntegrityError:
                return JsonResponse({"detail": "Another template is active for this family and scope. Deactivate it before activating this version."}, status=409)
        return guarded
    return decorate


def body(request):
    if len(request.body) > 1_000_000:
        raise ValueError("Template payload is too large.")
    value = json.loads(request.body or b"{}")
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object.")
    return value


def template_name(value):
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > 255:
        raise ValueError("A template name of at most 255 characters is required.")
    return value.strip()


@management_endpoint({"GET", "POST"})
def collection(request):
    if request.method == "GET":
        key = request.GET.get("programme_key", "")
        templates = list(MigratedReviewTemplate.objects.filter(scope="GLOBAL").order_by("-updated_at", "-pk"))
        if key:
            validate_slot("PROGRAMME", "MCM", key)
            templates += list(MigratedReviewTemplate.objects.filter(scope="PROGRAMME", programme_key=key).order_by("-updated_at", "-pk"))
        resolutions = []
        for family in FAMILIES:
            overrides = [t for t in templates if t.scope == "PROGRAMME" and t.review_family == family]
            active_override = next((t for t in overrides if t.is_active), None)
            global_template = next((t for t in templates if t.scope == "GLOBAL" and t.review_family == family and t.is_active), None)
            resolved = active_override or global_template
            resolutions.append({**resolution_metadata(resolved, family), "programme_override_exists": bool(overrides)})
        response = JsonResponse({"templates": [serialize_template(t) for t in templates],
                                 "resolutions": resolutions, "can_manage": True, "csrf_token": get_token(request)})
        response["Cache-Control"] = "no-store"
        return response
    payload = body(request)
    scope, family, key = payload.get("scope"), payload.get("review_family"), payload.get("programme_key", "")
    validate_slot(scope, family, key)
    name = template_name(payload.get("name"))
    with transaction.atomic():
        lock_template_family(family)
        if scope == "PROGRAMME":
            # Only create overrides from an approved Global definition. A copy is
            # a new inactive record; editing/activation remains an explicit action.
            source = resolve_template(None, family, lock=True)
            if source is None:
                raise ValueError("An active Global template is required to create an override.")
            definition = deepcopy(source.definition_json)
            validate_managed_definition(definition)
            metadata = {"copiedFromTemplateId": source.pk, "globalSource": deepcopy(source.source_metadata)}
        else:
            source_id = payload.get("source_review_id")
            if type(source_id) is not int or source_id <= 0:
                raise ValueError("A Completed Aptem source internal review ID is required.")
            definition, metadata = historical_candidate(source_id, family)
        template = MigratedReviewTemplate.objects.create(
            scope=scope, programme_key=key, review_family=family, name=name,
            definition_json=definition, source_metadata=metadata, is_active=False,
        )
    return JsonResponse(serialize_template(template, definition=True), status=201)


@management_endpoint({"GET", "PATCH"})
def detail(request, template_id):
    with transaction.atomic():
        query = MigratedReviewTemplate.objects
        if request.method == "PATCH":
            family = query.filter(pk=template_id).values_list("review_family", flat=True).first()
            if family is None:
                return JsonResponse({"detail": "Migrated template not found."}, status=404)
            lock_template_family(family)
            query = query.select_for_update()
        template = query.filter(pk=template_id).first()
        if template is None:
            return JsonResponse({"detail": "Migrated template not found."}, status=404)
        if request.method == "PATCH":
            payload = body(request)
            if set(payload) - {"name", "definition", "is_active", "updated_at"}:
                raise ValueError("Only name, definition and active state may be edited. Template identity is fixed.")
            if payload.get("updated_at") != template.updated_at.isoformat():
                return JsonResponse({"detail": "This template changed since it was opened. Reload before saving."}, status=409)
            if "name" in payload:
                template.name = template_name(payload["name"])
            if "definition" in payload:
                template.definition_json = validate_managed_definition(payload["definition"])
            if "is_active" in payload:
                if type(payload["is_active"]) is not bool:
                    raise ValueError("Active state must be true or false.")
                template.is_active = payload["is_active"]
            validate_slot(template.scope, template.review_family, template.programme_key)
            if template.is_active:
                validate_managed_definition(template.definition_json)
            template.save(update_fields=["name", "definition_json", "is_active", "updated_at"])
        response = JsonResponse(serialize_template(template, definition=True))
        response["Cache-Control"] = "no-store"
        return response


@management_endpoint({"GET", "POST"})
def preview(request):
    if request.method == "POST":
        definition = validate_managed_definition(body(request).get("definition"))
        metadata = {}
    else:
        if request.GET.get("template_id"):
            template = MigratedReviewTemplate.objects.filter(pk=int(request.GET["template_id"])).first()
            family = template.review_family if template else None
        else:
            key, family = request.GET.get("programme_key", ""), request.GET.get("review_family")
            validate_slot("PROGRAMME" if key else "GLOBAL", family, key)
            template = resolve_template(key, family)
        if template is None:
            return JsonResponse({"detail": "No approved migrated form configured for this family."}, status=404)
        definition = template.definition_json
        metadata = resolution_metadata(template, family)
    sections, warnings = render_sections(definition, {})
    response = JsonResponse({**metadata, "sections": sections, "warnings": warnings, "readOnly": True})
    response["Cache-Control"] = "no-store"
    return response


@management_endpoint({"POST"})
def reset(request):
    payload = body(request)
    key, family = payload.get("programme_key", ""), payload.get("review_family")
    validate_slot("PROGRAMME", family, key)
    with transaction.atomic():
        lock_template_family(family)
        active = MigratedReviewTemplate.objects.select_for_update().filter(
            scope="PROGRAMME", programme_key=key, review_family=family, is_active=True).first()
        # Bind the action to the active version the administrator actually saw.
        if active and (payload.get("template_id") != active.pk or payload.get("updated_at") != active.updated_at.isoformat()):
            return JsonResponse({"detail": "The override changed. Refresh before resetting it."}, status=409)
        if active:
            active.is_active = False
            active.updated_at = timezone.now()
            active.save(update_fields=["is_active", "updated_at"])
    return JsonResponse(resolution_metadata(resolve_template(key, family), family))
