"""The Individual Learner Record — issue, sign and retrieve.

The ILR is the learner's identity, eligibility and funding record. Two parties
sign it:

  * the learner, via the learning declaration (their information is accurate,
    and they agree to their PLR being shared with the provider and funding
    bodies), and
  * the provider, via the Provider/Sub-contractor declaration (identity,
    immigration permission and eligibility evidence have been seen).

The employer has no part in an ILR and never sees it — which is why this has no
employer party and is not projected into the employer portal.

Content is assembled from what we already hold:
  * page 1 learner details  -> the learner record + the enrolment wizard's
    personal-details step
  * ULN / prior attainment  -> the RPL review, where they are captured
  * the Extended ILR block  -> enrolment."Extended_ILR".Answers

Those values are SNAPSHOT onto the row when the ILR is issued, so a learner
editing their wizard answers afterwards cannot rewrite a signed record. Fields
we hold no source for are left blank rather than guessed.

    GET  /learner_api/ilr-document/<pk>/          details + document
    POST /learner_api/ilr-document/<pk>/issue/    create/reissue
    POST /learner_api/ilr-document/<pk>/sign/     one party signs
"""
import json
import logging

from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .mappers import _s
from .models import EnrolmentUser, IlrDocument

logger = logging.getLogger(__name__)

SIGNING_PARTIES = ("learner", "provider")
MAX_SIGNATURE_CHARS = 400_000


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _iso(value):
    return value.isoformat() if value else ""


# ---------------------------------------------------------------------------
# Assembling the record
# ---------------------------------------------------------------------------
def _wizard_personal(learner_id):
    """The enrolment wizard's personal-details step, if the learner reached it."""
    try:
        from enrolment_api.models import WizardPersonalDetails

        return WizardPersonalDetails.objects.filter(learner_id=learner_id).first()
    except DatabaseError:
        logger.exception("_wizard_personal: lookup failed")
        return None


def _rpl_detail(learner_id):
    """The RPL review, which is where ULN and prior attainment are captured."""
    try:
        from .models import RplReviewDetail

        return RplReviewDetail.objects.filter(learner_id=learner_id).first()
    except DatabaseError:
        logger.exception("_rpl_detail: lookup failed")
        return None


def _extended_ilr(learner_id):
    """The Extended ILR questionnaire the learner completed in the wizard."""
    try:
        from enrolment_api.models import ExtendedIlr

        return ExtendedIlr.objects.filter(learner_id=learner_id).first()
    except DatabaseError:
        logger.exception("_extended_ilr: lookup failed")
        return None


def derive_learner_details(learner):
    """Page 1 of the form. Blank where we hold no source, never guessed."""
    personal = _wizard_personal(learner.pk)
    rpl = _rpl_detail(learner.pk)

    # The wizard's own name/DOB win: the learner entered them on their own
    # record, whereas the console row may carry a single display name.
    first = _s(getattr(personal, "first_name", ""))
    last = _s(getattr(personal, "last_name", ""))
    if not (first or last):
        parts = _s(learner.username).split()
        first, last = (" ".join(parts[:-1]), parts[-1]) if len(parts) > 1 else (_s(learner.username), "")

    address_lines = [
        _s(learner.address_line_1) or _s(learner.address),
        _s(learner.address_line_2),
        _s(learner.address_line_3),
        _s(learner.address_line_4),
    ]

    return {
        # No column holds a learner reference number yet.
        "learnerReferenceNumber": "",
        "uln": _s(getattr(rpl, "uln", "")),
        "familyName": last,
        "givenNames": first,
        "dateOfBirth": _iso(getattr(personal, "date_of_birth", None)) or _s(learner.date_of_birth),
        "address1": address_lines[0],
        "address2": address_lines[1],
        "address3": address_lines[2],
        "address4": address_lines[3],
        "yearsAtAddress": "",
        "telephone": _s(learner.phone_number) or _s(getattr(personal, "phone", "")),
        "email": _s(learner.email) or _s(getattr(personal, "email", "")),
        "currentPostcode": _s(learner.current_postcode),
        "postcodePriorToEnrolment": "",
        "nationalInsuranceNumber": _s(learner.national_insurance_number),
        "sex": _s(getattr(personal, "sex", "")) or _s(learner.legal_sex),
        "ethnicity": "",
        # Health / education / employment: prior attainment comes from the RPL
        # review; the rest have no source yet.
        "longTermDisability": None,
        "priorAttainment": _s(getattr(rpl, "reported_attainment", "")),
        "employmentStatus": "",
        "employmentStartDate": "",
        "dateStatusApplies": "",
        "jobTitle": "",
        "edrsErn": "",
        "selfEmployed": None,
        "fullTimeEducationPrior": None,
        "contractedHoursPerWeek": "",
        "isSmallEmployer": None,
    }


def derive_answers(learner):
    """The Extended ILR questionnaire, as the wizard stored it."""
    row = _extended_ilr(learner.pk)
    answers = getattr(row, "answers", None)
    return answers if isinstance(answers, dict) else {}


# ---------------------------------------------------------------------------
# Serialising
# ---------------------------------------------------------------------------
def _party_json(signature, name, at):
    return {
        "signed": bool(_s(signature)),
        "name": _s(name),
        "signedAt": at.isoformat() if at else None,
    }


def _document_json(document):
    if document is None:
        return None
    return {
        "id": str(document.id),
        "status": _s(document.status),
        "fullySigned": bool(document.fully_signed),
        "createdAt": document.created_at.isoformat() if document.created_at else None,
        "updatedAt": document.updated_at.isoformat() if document.updated_at else None,
        # The frozen content — what was signed.
        "learnerDetails": document.learner_details or {},
        "answers": document.answers or {},
        "signatures": {
            "learner": _party_json(
                document.learner_signature,
                document.learner_signed_name,
                document.learner_signed_at,
            ),
            "provider": _party_json(
                document.provider_signature,
                document.provider_signed_name,
                document.provider_signed_at,
            ),
        },
        "marks": {
            "learner": _s(document.learner_signature),
            "provider": _s(document.provider_signature),
        },
    }


def _saved_learner_signature(learner_id):
    """The signature drawn during enrolment, offered as the learner's default."""
    personal = _wizard_personal(learner_id)
    if personal is None:
        return {}
    signature = _s(getattr(personal, "signature", ""))
    if not signature.startswith("data:image/"):
        return {}
    return {
        "signature": signature,
        "name": " ".join(
            p for p in (_s(personal.first_name), _s(personal.last_name)) if p
        ),
        "date": _iso(getattr(personal, "signature_date", None)),
    }


def _active_document(learner_kind, learner_id):
    return IlrDocument.objects.filter(
        learner_kind=learner_kind,
        learner_id=learner_id,
        status=IlrDocument.STATUS_ACTIVE,
    ).first()


def _learner_kind(learner):
    return _s(getattr(learner, "learner_type", "")) or "apprenticeship"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@csrf_exempt
def ilr_document(request, pk):
    """The learner's ILR document, plus the details a new one would carry."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        details = derive_learner_details(learner)
        answers = derive_answers(learner)
        document = _active_document(_learner_kind(learner), learner.pk)
    except DatabaseError as exc:
        logger.exception("ilr_document: build failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({
        "learner": {
            "id": str(learner.id),
            "name": _s(learner.username),
            "programmeStatus": _s(learner.programme_status),
        },
        # What a freshly issued ILR would state, from live data.
        "learnerDetails": details,
        "answers": answers,
        "document": _document_json(document),
        "savedLearnerSignature": _saved_learner_signature(learner.pk),
    })


@csrf_exempt
def issue_ilr(request, pk):
    """Issue the ILR, snapshotting the current details and answers onto a row."""
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    try:
        learner = EnrolmentUser.all_learners.filter(pk=pk).first()
        if learner is None:
            return _error("Learner not found.", 404)

        kind = _learner_kind(learner)
        details = derive_learner_details(learner)
        answers = derive_answers(learner)

        with transaction.atomic():
            existing = _active_document(kind, learner.pk)
            if existing is not None:
                existing.status = IlrDocument.STATUS_SUPERSEDED
                existing.save(update_fields=["status", "updated_at"])

            document = IlrDocument.objects.create(
                learner_kind=kind,
                learner_id=learner.pk,
                learner_details=details,
                answers=answers,
            )
    except DatabaseError as exc:
        logger.exception("issue_ilr: failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"document": _document_json(document)}, status=201)


@csrf_exempt
def sign_ilr(request, pk):
    """Record the learner's or the provider's signature on the ILR.

    Posting an empty signature withdraws that party's sign-off.
    """
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

    signature = _s(payload.get("signature"))
    name = _s(payload.get("name"))
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

        document = _active_document(_learner_kind(learner), learner.pk)
        if document is None:
            return _error("No ILR has been issued for this learner yet.", 404)

        now = timezone.now() if signature else None
        if party == "learner":
            document.learner_signature = signature
            document.learner_signed_name = name if signature else ""
            document.learner_signed_at = now
        else:
            document.provider_signature = signature
            document.provider_signed_name = name if signature else ""
            document.provider_signed_at = now

        document.recalculate_signed()
        document.save()
    except DatabaseError as exc:
        logger.exception("sign_ilr: failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse({"document": _document_json(document)})
