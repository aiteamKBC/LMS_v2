"""Existing Training Plan document HTTP endpoints and compatibility imports.

Reads, business/write orchestration and frozen JSON formatting have dedicated
owners; routes, payloads and current external database dependencies are retained.
"""
import json
import logging
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from enrolment_api.auth import enrolment_login_required
from .mappers import _s
from .models import EnrolmentUser
from .training_plan_document_permissions import document_mutation_required, document_party_error
from .selectors.training_plan_documents import (
    _active_document, _extended_ilr_answers, _learner_kind, _module_breakdown, _plan_modules,
)
from .serializers.training_plan_documents import (
    COMPONENT_METHODS, _document_json, _iso, _method_label, _party_json,
)
from .services.training_plan_documents import derive_content, issue_document, sign_document

logger = logging.getLogger(__name__)

SIGNING_PARTIES = ("apprentice", "employer", "provider")

MAX_SIGNATURE_CHARS = 400_000


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


@enrolment_login_required
@csrf_exempt
def training_plan_document(request, pk):
    """The learner's Training Plan, plus the content a new one would carry."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        derived = derive_content(learner)
        document = _active_document(_learner_kind(learner), learner.pk)
    except DatabaseError as exc:
        logger.error('training_plan_document: build failed (%s)', type(exc).__name__)
        return _error("The database service is temporarily unavailable.", 502)

    return JsonResponse({
        "learner": {
            "id": str(learner.id),
            "name": _s(learner.username),
            "programmeStatus": _s(learner.programme_status),
        },
        # What a freshly issued plan would state, from live data.
        "programme": derived["programme"],
        "employment": derived["employment"],
        "learningPlan": derived["learningPlan"],
        "otjh": derived["otjh"],
        "epa": derived["epa"],
        "contacts": derived["contacts"],
        "meta": {
            "datesFrom": derived["datesFrom"],
            "moduleCount": len(derived["learningPlan"]),
        },
        "document": _document_json(document),
    })


@document_mutation_required(issue=True)
@csrf_exempt
def issue_training_plan(request, pk):
    """Issue the plan, snapshotting the current content onto a new row."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        derived = derive_content(learner)
        document = issue_document(learner, derived)
    except DatabaseError as exc:
        logger.error('issue_training_plan: failed (%s)', type(exc).__name__)
        return _error("The database service is temporarily unavailable.", 502)

    return JsonResponse({"document": _document_json(document)}, status=201)


@document_mutation_required()
@csrf_exempt
def sign_training_plan(request, pk):
    """Record one party's signature. Empty signature withdraws that sign-off."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    party = _s(payload.get("party")).lower()
    if party not in SIGNING_PARTIES:
        allowed = "', '".join(SIGNING_PARTIES)
        return _error(f"party must be one of '{allowed}'.", 400)
    party_error = document_party_error(request, party)
    if party_error is not None:
        return party_error

    signature = _s(payload.get("signature"))
    name = _s(payload.get("name"))
    position = _s(payload.get("position"))
    if signature:
        if len(signature) > MAX_SIGNATURE_CHARS:
            return _error("That signature image is too large.", 400)
        if not signature.startswith("data:image/"):
            return _error("signature must be a PNG data URL.", 400)
        if not name:
            return _error("name is required when signing.", 400)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        document, promoted = sign_document(learner, party, signature, name, position)
        if document is None:
            return _error("No training plan has been issued for this learner yet.", 404)
    except DatabaseError as exc:
        logger.error('sign_training_plan: failed (%s)', type(exc).__name__)
        return _error("The database service is temporarily unavailable.", 502)

    return JsonResponse({
        "document": _document_json(document),
        "programmeStatus": _s(learner.programme_status),
        "programmeStatusChangedTo": promoted,
    })
