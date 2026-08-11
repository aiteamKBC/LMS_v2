"""Extended ILR + wizard draft read/write endpoint.

GET  /enrolment_api/extended-ilr/<kind>/<id>/   -> {answers, draft, meta}
PUT  /enrolment_api/extended-ilr/<kind>/<id>/   -> upsert, returns the same shape

`answers` is the wizard's IlrForm document and `draft` is every other wizard step
(personal details, skills radar, PLR, CV/job, policies), both stored verbatim as
jsonb. The server does not enumerate their fields — the ILR is reworded whenever
the ESFA revises it, and mirroring every question here would mean a backend change
for each edit. What the server does own is the envelope: which learner the row
belongs to, and the signature/completion flags other features report on, which are
derived from the document on every write so they cannot drift from it.

`draft` is optional on write: omitting it leaves any stored draft untouched, so a
caller that only has ILR data cannot silently wipe the other steps.
"""
import json

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from learner_api.models import CommercialUser, EnrolmentUser

from .models import ExtendedIlr
from .wizard_steps import project_draft, read_projection

KINDS = {"apprenticeship": EnrolmentUser, "commercial": CommercialUser}

# Guardrail against a runaway payload filling the column. Covers `answers` plus
# `draft` together — the ILR is ~8KB, but the draft carries the skills-radar
# assessments (one entry per KSB) and signature data URLs, so allow headroom.
MAX_ANSWERS_BYTES = 2 * 1024 * 1024


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _s(value):
    return "" if value is None else str(value).strip()


def _signature_state(answers):
    """Derive the flat signature/completion columns from the answers document.

    Kept server-side so the flags always agree with the stored document even if a
    client sends them inconsistently (or not at all).
    """
    learner = answers.get("learnerSignature") or {}
    provider = answers.get("providerSignature") or {}
    learner_signed = bool(learner.get("signatureUrl"))
    provider_signed = bool(provider.get("signatureUrl"))
    return {
        "learner_signed": learner_signed,
        "learner_signed_date": _s(learner.get("date")) or None,
        "provider_signed": provider_signed,
        "provider_signed_date": _s(provider.get("date")) or None,
        # "Completed" means the compliance artefact is finished: both parties signed.
        "completed": learner_signed and provider_signed,
    }


def _payload(row):
    return {
        "answers": row.answers or {},
        "draft": row.wizard_draft or {},
        "meta": {
            "learnerKind": row.learner_kind,
            "learnerId": row.learner_id,
            "learnerName": _s(row.learner_name),
            "learnerSigned": row.learner_signed,
            "learnerSignedDate": _s(row.learner_signed_date),
            "providerSigned": row.provider_signed,
            "providerSignedDate": _s(row.provider_signed_date),
            "completed": row.completed,
            "updatedAt": row.updated_at.isoformat() if row.updated_at else "",
        },
    }


def _empty_payload(kind, learner_id, learner_name):
    """Shape returned when a learner has no saved ILR yet — a 200, not a 404.

    The wizard opens on a blank form for every learner, so "nothing saved" is a
    normal state, not an error the UI should have to special-case.
    """
    return {
        "answers": None,
        "draft": None,
        "meta": {
            "learnerKind": kind,
            "learnerId": learner_id,
            "learnerName": learner_name,
            "learnerSigned": False,
            "learnerSignedDate": "",
            "providerSigned": False,
            "providerSignedDate": "",
            "completed": False,
            "updatedAt": "",
        },
    }


def read_extended_ilr(kind, learner_id, learner_name):
    """The GET payload, as a plain dict.

    Split out from the view so the wizard-bootstrap endpoint can compose this
    with the learner's board in one response without re-implementing the
    fallbacks below or paying a second HTTP round-trip. Raises DatabaseError,
    which the caller is expected to turn into its own error response.
    """
    row = ExtendedIlr.objects.filter(learner_kind=kind, learner_id=learner_id).first()
    if row is None:
        # No ILR row, but the per-step tables may still hold a partly-filled
        # wizard (e.g. a learner who only completed Personal Details).
        payload = _empty_payload(kind, int(learner_id), learner_name)
        projected = read_projection(kind, int(learner_id))
        if projected:
            payload["draft"] = projected
        return payload

    payload = _payload(row)
    # Rows written before Wizard_draft existed have an empty draft; rebuild it
    # from the per-step tables so nothing looks lost in the wizard.
    if not payload["draft"]:
        payload["draft"] = read_projection(kind, int(learner_id))
    return payload


@csrf_exempt
def extended_ilr(request, kind, learner_id):
    model = KINDS.get(kind)
    if model is None:
        return _error(f"Unknown learner kind '{kind}'. Expected one of: {', '.join(sorted(KINDS))}.", 400)

    try:
        learner = model.objects.filter(pk=learner_id).first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if learner is None:
        return _error("Learner not found.", 404)
    learner_name = _s(learner.username)

    if request.method == "GET":
        try:
            return JsonResponse(read_extended_ilr(kind, learner_id, learner_name))
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)

    if request.method in ("PUT", "PATCH", "POST"):
        if not request.body:
            return _error("Request body is required.", 400)
        if len(request.body) > MAX_ANSWERS_BYTES:
            return _error("Payload too large.", 413)
        try:
            body = json.loads(request.body)
        except ValueError:
            return _error("Request body must be valid JSON.", 400)
        if not isinstance(body, dict):
            return _error("Request body must be a JSON object.", 400)

        answers = body.get("answers", body)
        if not isinstance(answers, dict):
            return _error("'answers' must be a JSON object.", 400)

        # The wizard's other steps. Optional: a client that only knows about the
        # ILR keeps working, and omitting the key leaves any stored draft alone
        # rather than wiping it.
        draft = body.get("draft")
        if draft is not None and not isinstance(draft, dict):
            return _error("'draft' must be a JSON object.", 400)

        state = _signature_state(answers)
        defaults = {"answers": answers, "learner_name": learner_name, **state}
        if draft is not None:
            defaults["wizard_draft"] = draft
        try:
            with transaction.atomic(using="enrolment"):
                row, _ = ExtendedIlr.objects.update_or_create(
                    learner_kind=kind,
                    learner_id=learner_id,
                    defaults=defaults,
                )
                # Same transaction as the document, so the queryable per-step
                # tables can never disagree with the draft they came from.
                if draft is not None:
                    project_draft(kind, int(learner_id), draft)
        except DatabaseError as exc:
            return _error(f"Database error: {exc}", 502)

        return JsonResponse(_payload(row))

    return _error("Method not allowed.", 405)
