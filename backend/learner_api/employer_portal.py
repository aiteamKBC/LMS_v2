"""The employer-facing view of their own learners.

    GET  /learner_api/employer-portal/<employer_id>/
        -> the employer, their learners, and each learner's outstanding signatures
    GET  /learner_api/employer-portal/<employer_id>/learner/<kind>/<learner_id>/
        -> one learner: details, performance summary, and their signable documents

An employer is a person at one or more organisations (enrolment."Employers").
Their learners are the ones whose "Employer_id" points at them — the reference
added by apply_created_users_employer_id, which is why this can exist at all: the
old free-text "Employer" column could not reliably identify whose learners these
are.

Signing itself is NOT reimplemented here. Reviews are signed through the existing
/learner_api/reviews/<kind>/<pk>/<event_key>/sign/ endpoint with party="employer",
so all three parties share one code path and one set of validation rules.
Compliance PDFs get their own endpoint (they had no signing flow at all) in
enrolment_api/documents.py.

CSRF is exempted for the same reason as the rest of learner_api: an internal
same-origin dev API behind the Vite proxy.
"""
import logging

from django.db import DatabaseError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from login.permissions import employer_or_staff

from .learner_detail import SOURCE_MODELS
from .mappers import _s, to_employer_row
from .models import Employer, EnrolmentReview
from .review_form import (
    MAX_SIGNATURE_CHARS,
    employer_signature_required,
    sections_for,
)
from .views import _error, _parse_body

logger = logging.getLogger(__name__)

# A learner at this status is on programme, so their card leads with performance.
# Anything else (Onboarding, Ready to enrol, On probation, …) is still being set
# up, so their outstanding paperwork leads instead. Both are always shown — the
# status only decides the order.
ACTIVE_STATUS = "active"


def _iso(value):
    return value.isoformat() if value else None


def _learner_kind(learner):
    return "commercial" if _s(getattr(learner, "learner_type", "")) == "commercial" else "apprenticeship"


def _review_signing_rows(kind, learner_id, *, employer_only=True):
    """This learner's reviews as the employer sees them.

    `employer_only` keeps the list to reviews that actually want an employer
    signature — the employer has no business being shown the RPL review.
    """
    try:
        reviews = EnrolmentReview.objects.filter(
            learner_kind=kind, learner_id=learner_id
        ).order_by("scheduled_date", "id")
    except DatabaseError:
        logger.exception("_review_signing_rows: lookup failed for %s/%s", kind, learner_id)
        return []

    rows = []
    for review in reviews:
        required = employer_signature_required(review)
        if employer_only and not required:
            continue
        signed = bool(_s(review.employer_signature))
        rows.append({
            "kind": "review",
            "eventKey": review.event_key,
            "reviewType": _s(review.review_type),
            "label": _s(review.review_label) or _s(review.review_type),
            "scheduledDate": _s(review.scheduled_date),
            # Only a finished questionnaire can be signed, by any party.
            "signable": bool(review.form_completed),
            "completed": bool(review.form_completed),
            "sectionsTotal": len(sections_for(review.review_type)),
            "employerSignatureRequired": required,
            "signed": signed,
            "signedName": _s(review.employer_signed_name),
            "signedAt": _iso(review.employer_signed_at),
            # Whether the other parties have signed, shown as context so the
            # employer can see they are not the only one outstanding.
            "learnerSigned": bool(_s(review.learner_signature)),
            "adminSigned": bool(_s(review.admin_signature)),
        })
    return rows


def _agreement_signing_rows(kind, learner_id):
    """The learner's active Apprenticeship Agreement, as a signable row.

    The agreement lives in its own table rather than Enrolment_Documents, but the
    employer sees it in the same list as everything else they must sign — so it
    is projected onto the same row shape here.
    """
    from .models import ApprenticeshipAgreement

    try:
        agreement = ApprenticeshipAgreement.objects.filter(
            learner_kind=kind,
            learner_id=learner_id,
            status=ApprenticeshipAgreement.STATUS_ACTIVE,
        ).first()
    except DatabaseError:
        logger.exception("_agreement_signing_rows: lookup failed for %s/%s", kind, learner_id)
        return []
    if agreement is None:
        return []

    return [{
        "kind": "agreement",
        "id": str(agreement.id),
        "docType": "apprenticeship-agreement",
        "label": "Apprenticeship Agreement",
        "generatedAt": _iso(agreement.created_at),
        # Signed by the apprentice and employer only — no provider signature.
        "signable": True,
        "signed": agreement.employer_signed,
        "signedName": _s(agreement.employer_signed_name),
        "signedAt": _iso(agreement.employer_signed_at),
        "parties": ["learner", "employer"],
        "learnerSigned": agreement.apprentice_signed,
        "learnerSignedName": _s(agreement.apprentice_signed_name),
        "learnerSignedAt": _iso(agreement.apprentice_signed_at),
    }]


def _training_plan_signing_rows(kind, learner_id):
    """The learner's active Training Plan, as a signable row.

    Signed by all three parties; the employer is one of them, so it appears in
    their queue alongside the reviews and the apprenticeship agreement.
    """
    from .models import TrainingPlanDocument

    try:
        plan = TrainingPlanDocument.objects.filter(
            learner_kind=kind,
            learner_id=learner_id,
            status=TrainingPlanDocument.STATUS_ACTIVE,
        ).first()
    except DatabaseError:
        logger.exception("_training_plan_signing_rows: lookup failed for %s/%s", kind, learner_id)
        return []
    if plan is None:
        return []

    return [{
        "kind": "training-plan",
        "id": str(plan.id),
        "docType": "training-plan",
        "label": "Training Plan",
        "generatedAt": _iso(plan.created_at),
        "signable": True,
        "signed": plan.employer_signed,
        "signedName": _s(plan.employer_signed_name),
        "signedAt": _iso(plan.employer_signed_at),
        # All three parties, so the employer can see who else is outstanding.
        "parties": ["learner", "employer", "provider"],
        "learnerSigned": plan.apprentice_signed,
        "learnerSignedName": _s(plan.apprentice_signed_name),
        "learnerSignedAt": _iso(plan.apprentice_signed_at),
        "providerSigned": plan.provider_signed,
        "providerSignedName": _s(plan.provider_signed_name),
        "providerSignedAt": _iso(plan.provider_signed_at),
    }]


def _written_agreement_signing_rows(kind, learner_id):
    """The learner's active Written Agreement, as a signable row.

    Signed by the learner, the employer and the provider — the employer is one
    of the three, so it appears in their queue.
    """
    from .models import WrittenAgreement

    try:
        doc = WrittenAgreement.objects.filter(
            learner_kind=kind,
            learner_id=learner_id,
            status=WrittenAgreement.STATUS_ACTIVE,
        ).first()
    except DatabaseError:
        logger.exception("_written_agreement_signing_rows: lookup failed for %s/%s", kind, learner_id)
        return []
    if doc is None:
        return []

    return [{
        "kind": "written-agreement",
        "id": str(doc.id),
        "docType": "written-agreement",
        "label": "Written Agreement",
        "generatedAt": _iso(doc.created_at),
        "signable": True,
        "signed": doc.employer_signed,
        "signedName": _s(doc.employer_signed_name),
        "signedAt": _iso(doc.employer_signed_at),
        "parties": ["learner", "employer", "provider"],
        "learnerSigned": doc.learner_signed,
        "learnerSignedName": _s(doc.learner_signed_name),
        "learnerSignedAt": _iso(doc.learner_signed_at),
        "providerSigned": doc.provider_signed,
        "providerSignedName": _s(doc.provider_signed_name),
        "providerSignedAt": _iso(doc.provider_signed_at),
    }]


def _document_signing_rows(kind, learner_id):
    """The learner's generated compliance PDFs, with employer sign-off state.

    Read with raw SQL rather than a model: enrolment."Enrolment_Documents" is
    owned by enrolment_api and has no Django model — see its document_tables.py.
    """
    from django.db import connections

    from enrolment_api.document_tables import ensure_enrolment_documents_table

    from enrolment_api.documents import SIGNING_PARTIES

    rows_out = (
        _agreement_signing_rows(kind, learner_id)
        + _training_plan_signing_rows(kind, learner_id)
        + _written_agreement_signing_rows(kind, learner_id)
    )

    try:
        ensure_enrolment_documents_table()
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                '''
                select id, "Doc_type", "Doc_name", "Generated_at",
                       "Employer_signature", "Employer_signed_name", "Employer_signed_at",
                       "Learner_signature", "Learner_signed_name", "Learner_signed_at"
                from enrolment."Enrolment_Documents"
                where "Learner_kind" = %s and "Learner_id" = %s
                order by "Generated_at" desc
                ''',
                [kind, learner_id],
            )
            rows = cur.fetchall()
    except DatabaseError:
        logger.exception("_document_signing_rows: lookup failed for %s/%s", kind, learner_id)
        return rows_out

    out = list(rows_out)
    for row in rows:
        (
            doc_id, doc_type, doc_name, generated_at,
            sig, sig_name, sig_at,
            learner_sig, learner_sig_name, learner_sig_at,
        ) = row
        doc_type = _s(doc_type)
        # Only offer documents this type actually asks the employer to sign —
        # a learner-only document has no business appearing in their queue.
        parties = SIGNING_PARTIES.get(doc_type, ("employer",))
        out.append({
            "kind": "document",
            "id": str(doc_id),
            "docType": doc_type,
            "label": _s(doc_name) or doc_type,
            "generatedAt": _iso(generated_at),
            # A generated PDF needs no questionnaire finished first, so it is
            # signable as soon as the employer is one of its parties.
            "signable": "employer" in parties,
            "signed": bool(_s(sig)),
            "signedName": _s(sig_name),
            "signedAt": _iso(sig_at),
            # Who else this document is waiting on, so the employer can see
            # whether the learner has signed their side yet.
            "parties": list(parties),
            "learnerSigned": bool(_s(learner_sig)),
            "learnerSignedName": _s(learner_sig_name),
            "learnerSignedAt": _iso(learner_sig_at),
        })
    return out


def _employer_or_404(employer_id):
    try:
        return Employer.objects.get(pk=employer_id), None
    except Employer.DoesNotExist:
        return None, _error("Employer not found.", 404)
    except DatabaseError as exc:
        return None, _error(f"Database error: {exc}", 502)


def _learner_cards(employer_id):
    """One card per learner belonging to this employer, across both kinds.

    Both learner kinds share one table, so a single query covers them; the row's
    own "Learner_type" decides which `kind` its links use.
    """
    model = SOURCE_MODELS["apprenticeship"]
    try:
        learners = model.all_learners.filter(employer_id=employer_id).order_by("username", "id")
    except DatabaseError:
        logger.exception("_learner_cards: lookup failed for employer %s", employer_id)
        return []

    cards = []
    for learner in learners:
        kind = _learner_kind(learner)
        status = _s(learner.programme_status)
        reviews = _review_signing_rows(kind, learner.pk)
        documents = _document_signing_rows(kind, learner.pk)
        # Only counts what the employer can actually act on now: an unfinished
        # review is not yet signable, so counting it would show a task they
        # cannot complete.
        outstanding = [
            item for item in (*reviews, *documents)
            if item["signable"] and not item["signed"]
        ]
        cards.append({
            "id": str(learner.pk),
            "kind": kind,
            "name": _s(learner.username),
            "email": _s(learner.email),
            "programme": _s(learner.programme),
            "cohort": _s(learner.cohort),
            "programmeStatus": status,
            "onboardingStatus": _s(learner.onboarding_status),
            # Drives which panel the learner page leads with. Both are shown
            # either way — see the module docstring.
            "isActive": status.lower() == ACTIVE_STATUS,
            "outstandingCount": len(outstanding),
            "documentsTotal": len(reviews) + len(documents),
        })
    return cards


@csrf_exempt
@employer_or_staff()
def employer_portal(request, employer_id):
    """The employer's landing page: who they are, and their learners."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    employer, err = _employer_or_404(employer_id)
    if err:
        return err

    cards = _learner_cards(employer_id)
    return JsonResponse({
        "employer": {
            **to_employer_row(employer),
        },
        "learners": cards,
        "outstandingTotal": sum(c["outstandingCount"] for c in cards),
    })


@csrf_exempt
@employer_or_staff()
def employer_portal_learner(request, employer_id, kind, learner_id):
    """One learner, as their employer sees them.

    Returns the learner's own details and progress summary plus every document
    the employer is asked to sign. The learner is checked to actually belong to
    this employer, so an employer cannot read another's learner by guessing ids.
    """
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    employer, err = _employer_or_404(employer_id)
    if err:
        return err

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}.", 404)

    try:
        learner = model.all_learners.get(pk=learner_id)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    # The authorisation check: this endpoint is reachable per employer, so the
    # learner must be one of theirs.
    if learner.employer_id != employer.pk:
        return _error("That learner does not belong to this employer.", 403)

    status = _s(learner.programme_status)
    reviews = _review_signing_rows(kind, learner.pk)
    documents = _document_signing_rows(kind, learner.pk)

    return JsonResponse({
        "employer": {
            "id": str(employer.pk),
            "name": employer.full_name,
        },
        "learner": {
            "id": str(learner.pk),
            "kind": kind,
            "name": _s(learner.username),
            "email": _s(learner.email),
            "phone": _s(learner.phone_number),
            "programme": _s(learner.programme),
            "cohort": _s(learner.cohort),
            "programmeStatus": status,
            "onboardingStatus": _s(learner.onboarding_status),
            "startDate": _s(learner.start_date),
            "endDate": _s(learner.end_date),
            "isActive": status.lower() == ACTIVE_STATUS,
        },
        "performance": _performance(kind, learner),
        "reviews": reviews,
        "documents": documents,
        "outstandingCount": len([
            i for i in (*reviews, *documents) if i["signable"] and not i["signed"]
        ]),
    })


@csrf_exempt
@employer_or_staff()
def employer_portal_learner_plan(request, employer_id, kind, learner_id):
    """The learner's own training plan, hours and KSBs — for their employer.

    Returns exactly the payload the learner's own workspace reads, so the
    employer sees the same weeks, components, OTJ hours and KSB mappings rather
    than a second, divergent summary. Read-only by construction: this is a GET,
    and the employer UI renders it without the learner's start/open actions.

    The employer-owns-this-learner check is the same one employer_portal_learner
    makes — the payload is richer, so the guard matters more, not less.
    """
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    employer, err = _employer_or_404(employer_id)
    if err:
        return err

    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error(f"Unknown kind: {kind!r}.", 404)

    try:
        learner = model.all_learners.get(pk=learner_id)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    if learner.employer_id != employer.pk:
        return _error("That learner does not belong to this employer.", 403)

    from .learner_detail import build_learner_detail

    try:
        return JsonResponse(build_learner_detail(learner, learner.pk))
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)


def _performance(kind, learner):
    """A progress summary for the employer.

    Deliberately a summary, not the learner's full workspace: an employer sees
    how their apprentice is tracking, not every quiz answer. Counts come from the
    active learner profile's progress log, which is the same source the learner's
    own dashboard reads.
    """
    summary = {
        "quizzesTaken": 0,
        "quizzesPassed": 0,
        "averageScore": None,
        "componentsCompleted": 0,
        "ksbsEvidenced": 0,
        "completedHours": None,
        "lastActivityAt": None,
    }

    try:
        from .learner_detail import _active_profile_for_source

        profile = _active_profile_for_source(learner, learner.pk)
    except DatabaseError:
        logger.exception("_performance: profile lookup failed")
        return summary
    if profile is None:
        return summary

    progress = profile.training_plan_progress
    progress = progress if isinstance(progress, list) else []

    quizzes = [r for r in progress if isinstance(r, dict) and r.get("kind", "quiz") == "quiz"]
    others = [r for r in progress if isinstance(r, dict) and r.get("kind", "quiz") != "quiz"]

    scores = []
    passed = 0
    for attempt in quizzes:
        score = attempt.get("scorePercent", attempt.get("score"))
        try:
            value = float(score)
        except (TypeError, ValueError):
            continue
        scores.append(value)
        if attempt.get("passed") is True or value >= 50:
            passed += 1

    dates = [
        _s(r.get("completedAt") or r.get("submittedAt") or r.get("date"))
        for r in progress if isinstance(r, dict)
    ]
    dates = sorted(d for d in dates if d)

    ksbs = profile.ksbs if isinstance(profile.ksbs, list) else []

    summary.update({
        "quizzesTaken": len(quizzes),
        "quizzesPassed": passed,
        "averageScore": round(sum(scores) / len(scores), 1) if scores else None,
        "componentsCompleted": len(others),
        "ksbsEvidenced": len([k for k in ksbs if isinstance(k, dict) and k.get("evidenced")]),
        "completedHours": _s(getattr(profile, "completed_hours", "")) or None,
        "lastActivityAt": dates[-1] if dates else None,
    })
    return summary


