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
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from login.permissions import employer_or_staff

from .learner_detail import SOURCE_MODELS
from .identity import learner_profile_for_source
from .mappers import _s, to_employer_row
from .models import Employer, EnrolmentReview
from .review_form import (
    MAX_SIGNATURE_CHARS,
    employer_signature_required,
    sections_for,
)
from .views import _error, _parse_body
from coach_api.models import CoachCalendarEvent
from curriculum_api import review_instances

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
    # Curriculum instances are the canonical review records. Keep them in the
    # existing employer queue shape while the old EnrolmentReview records drain.
    # Instances are normally keyed by the internal LearnerProfile id, while
    # this portal is addressed by the source enrolment id. Read both identities
    # so a valid review cannot disappear from the employer queue.
    instance_learner_ids = [str(learner_id)]
    source_model = SOURCE_MODELS.get(kind)
    if source_model is not None:
        try:
            source_learner = source_model.all_learners.get(pk=learner_id)
            profile = learner_profile_for_source(source_learner, learner_id, active_only=True)
            if profile is not None and str(profile.pk) not in instance_learner_ids:
                instance_learner_ids.append(str(profile.pk))
        except (source_model.DoesNotExist, DatabaseError):
            pass
    instance_rows = []
    seen_instance_ids = set()
    for instance_learner_id in instance_learner_ids:
        try:
            candidates = review_instances.list_review_instances_for_learner(instance_learner_id)
        except DatabaseError:
            candidates = []
        for instance in candidates:
            instance_id = _s(instance.get('id'))
            if instance_id and instance_id in seen_instance_ids:
                continue
            if instance_id:
                seen_instance_ids.add(instance_id)
            instance_rows.append(instance)
    for instance in instance_rows:
        definition = review_instances.review_instance_form_definition(instance)
        if employer_only and not definition['template']['visibleTo'].get('employer', False):
            continue
        employer_state = definition['signatures'].get('employer', {})
        if not employer_state.get('required'):
            continue
        signatures = definition['signatures']
        calendar_record = CoachCalendarEvent.objects.filter(pk=instance.get('calendar_event_id')).first() if instance.get('calendar_event_id') else None
        rows.append({
            "kind": "review",
            "eventKey": _s(getattr(calendar_record, 'event_key', '')) or _s(instance.get('id')),
            "reviewInstanceId": _s(instance.get('id')),
            "reviewType": _s(definition['template'].get('reviewTypeCode')) or 'review',
            "label": _s(definition['template'].get('name')) or 'Review',
            "scheduledDate": _s(instance.get('target_date')),
            "signable": instance.get('status') in ('awaiting-signature', 'completed'),
            "completed": instance.get('status') in ('awaiting-signature', 'completed'),
            "sectionsTotal": len(definition.get('sections') or []),
            "employerSignatureRequired": True,
            "signed": bool(employer_state.get('signed')),
            "signedName": _s(employer_state.get('signedName')),
            "signedAt": employer_state.get('signedAt'),
            "learnerSigned": bool(signatures.get('participant', {}).get('signed')),
            "adminSigned": bool(signatures.get('advisor', {}).get('signed')),
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
def employer_portal_documents(request, employer_id):
    """Every signable item across this employer's learners, in one list.

    The same rows the learner page's Documents tab shows (reviews wanting an
    employer signature, then compliance PDFs), each tagged with its learner so
    the portal can sign or open it without visiting that learner first. The
    learners are exactly the employer's own — the same query as the landing
    page's cards — so no learner id from the client is trusted here.
    """
    if request.method != "GET":
        return _error("Method not allowed.", 405)

    employer, err = _employer_or_404(employer_id)
    if err:
        return err

    model = SOURCE_MODELS["apprenticeship"]
    try:
        learners = list(model.all_learners.filter(employer_id=employer.pk).order_by("username", "id"))
    except DatabaseError:
        logger.exception("employer_portal_documents: lookup failed for employer %s", employer.pk)
        return _error("Could not load documents. Please try again.", 503)

    items = []
    for learner in learners:
        kind = _learner_kind(learner)
        owner = {
            "id": str(learner.pk),
            "kind": kind,
            "name": _s(learner.username),
            "programme": _s(learner.programme),
        }
        for item in (*_review_signing_rows(kind, learner.pk), *_document_signing_rows(kind, learner.pk)):
            items.append({**item, "learner": owner})

    return JsonResponse({
        "employer": {"id": str(employer.pk), "name": employer.full_name},
        "items": items,
        "outstandingTotal": len([i for i in items if i["signable"] and not i["signed"]]),
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
            # The learner record's employer display name, as the learner's own
            # dashboard header shows it.
            "employer": _s(learner.employer),
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
def employer_review_instance(request, employer_id, kind, learner_id, event_key):
    """Read or sign the same Curriculum Review instance used by coach/learner."""
    if request.method not in ("GET", "POST"):
        return _error("Method not allowed.", 405)
    employer, err = _employer_or_404(employer_id)
    if err:
        return err
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return _error("Unknown learner kind.", 404)
    try:
        learner = model.all_learners.get(pk=learner_id)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    if learner.employer_id != employer.pk:
        return _error("That learner does not belong to this employer.", 403)
    record = CoachCalendarEvent.objects.filter(event_key=event_key).first()
    if record and str(record.learner_id or '') != str(learner_id) and _s(record.learner_email).casefold() != _s(learner.email).casefold():
        record = None
    instance = review_instances.get_review_instance(getattr(record, 'review_instance_id', '')) if record else review_instances.get_review_instance(event_key)
    if not instance:
        return _error("Review instance not found.", 404)
    definition = review_instances.review_instance_form_definition(instance)
    if not definition['template']['visibleTo'].get('employer', False):
        return _error("This review is not visible to the employer.", 403)
    if request.method == "GET":
        return JsonResponse(definition)
    try:
        payload = _parse_body(request)
    except (TypeError, ValueError, ValidationError):
        return _error("Invalid JSON body.", 400)

    # Saving the Employer's own answers to whichever fields the Review's
    # Curriculum template opted the Employer into answering -- a distinct
    # shape from the signature POST below, so an existing sign-off caller
    # (which never sends `answers`) is unaffected.
    if isinstance(payload.get('answers'), dict):
        try:
            updated = review_instances.save_review_instance_answers_for_role(
                instance, payload['answers'], 'employer',
                actor=_s(getattr(request.login_account, 'email', '')) or 'employer',
            )
        except PermissionError as exc:
            return _error(str(exc), 403)
        except ValueError as exc:
            return _error(str(exc), 409)
        return JsonResponse(updated)

    signature = _s(payload.get('signature'))
    name = _s(payload.get('name'))
    if not signature.startswith('data:image/'):
        return _error("A valid employer signature is required.", 400)
    if not name:
        return _error("Name is required when signing.", 400)
    try:
        updated = review_instances.record_review_instance_signature(
            instance, 'employer', signed_by=_s(getattr(request.login_account, 'email', '')),
            signed_name=name, signature=signature,
            actor=_s(getattr(request.login_account, 'email', '')) or 'employer',
        )
    except ValueError as exc:
        return _error(str(exc), 409)
    return JsonResponse(updated)


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


#: The learner-dashboard reads behind the employer's Overview tab. Each part is
#: served by the same reader as the learner's own endpoint (overview-week,
#: training-plan-dashboard, monthly-logs, profile-photo), so the employer sees
#: the learner's timeline and progress rather than a second calculation of them.
OVERVIEW_PARTS = frozenset({"week", "schedule", "contract", "hours", "photo"})

#: Monthly-log fields the dashboard's hours figures need. The employer gets the
#: per-month totals only, never the activity rows or signatures behind them.
_HOURS_MONTH_FIELDS = ("month", "source", "training_plan_target", "not_accepted_hours", "actual_hours")


def _without_meeting_links(payload):
    """Drop join and booking links: the employer's view is read-only.

    Teaching-session join URLs, review meeting links and the coach's booking
    link are the learner's to use. The cards render without them.
    """
    return {
        **payload,
        "sessions": [{**session, "joinUrl": None} for session in payload.get("sessions") or []],
        "reviews": [{**review, "meetingLink": None} for review in payload.get("reviews") or []],
        "coach": {**(payload.get("coach") or {}), "bookingUrl": None},
    }


def _overview_part(part, learner):
    if part == "week":
        from .overview_week import read_week

        return read_week(learner)
    if part in ("schedule", "contract"):
        from .training_plan_dashboard import read_dashboard

        if part == "contract":
            return read_dashboard(learner, section="contract")
        return _without_meeting_links(read_dashboard(learner, section="overview"))

    from old_otjh import service as old_service
    from . import monthly_log_sources, monthly_logs

    record = old_service.resolve_record(learner.pk)
    summary = monthly_logs.summary_data(
        {**record, "_profile": monthly_log_sources.profile(learner.pk), "_view_as": True},
        include_open=True,
    )
    return {
        "learner": {"aptem_id": summary["learner"].get("aptem_id")},
        "months": [{key: month.get(key) for key in _HOURS_MONTH_FIELDS} for month in summary["months"]],
    }


@csrf_exempt
@employer_or_staff()
def employer_portal_learner_overview(request, employer_id, kind, learner_id, part):
    """The learner's dashboard timeline and progress — for their employer.

    The learner's own dashboard endpoints admit only the learner and staff, so
    an employer signed in to their portal could not load them. This serves the
    same payloads behind the same employer-owns-this-learner check as the rest
    of the portal. GET only, with meeting and booking links removed.
    """
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    if part not in OVERVIEW_PARTS:
        return _error("Unknown overview part.", 404)

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
    except DatabaseError:
        logger.exception("employer_portal_learner_overview: learner lookup failed")
        return _error("Could not load this learner. Please try again.", 503)

    if learner.employer_id != employer.pk:
        return _error("That learner does not belong to this employer.", 403)

    if part == "photo":
        from azure.core.exceptions import AzureError
        from django.http import HttpResponse
        from .profile_photo import photo_bytes

        try:
            content = photo_bytes(learner.pk)
        except (AzureError, RuntimeError):
            logger.warning("Profile photo storage unavailable for learner %s", learner.pk)
            return _error("The photo could not be loaded.", 503)
        response = HttpResponse(content, content_type="image/jpeg") if content is not None else HttpResponse(status=204)
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    from old_otjh.service import ServiceError

    try:
        payload = _overview_part(part, learner)
    except ServiceError as exc:
        return _error(str(exc), exc.status)
    except LookupError as exc:
        return _error(str(exc), 404)
    except DatabaseError:
        logger.exception("employer_portal_learner_overview: %s unavailable for %s", part, learner.pk)
        return _error("Could not load this learner's progress. Please try again.", 503)
    response = JsonResponse(payload)
    response["Cache-Control"] = "private, no-store"
    return response


def _owned_learner(employer_id, kind, learner_id):
    """(learner, None) when this learner belongs to this employer, else (None, error response)."""
    employer, err = _employer_or_404(employer_id)
    if err:
        return None, err
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return None, _error(f"Unknown kind: {kind!r}.", 404)
    try:
        learner = model.all_learners.get(pk=learner_id)
    except model.DoesNotExist:
        return None, _error("Learner not found.", 404)
    except DatabaseError:
        logger.exception("_owned_learner: learner lookup failed")
        return None, _error("Could not load this learner. Please try again.", 503)
    if learner.employer_id != employer.pk:
        return None, _error("That learner does not belong to this employer.", 403)
    return learner, None


#: A learner's handed-in assignments: every status except an unsent draft.
_SUBMITTED_ASSIGNMENTS_SQL = """
    select activity_id, activity_title, module_title, week_title, status, submitted_at, date_completed
    from "Learner"."learning_reflection_submissions"
    where learner_kind = %s and learner_id = %s and activity_type = 'assignment' and status <> 'draft'
    order by coalesce(submitted_at, date_completed) desc nulls last, activity_title
"""

#: Scanned-clean uploads, keyed by the activity they were uploaded to.
_ASSIGNMENT_FILES_SQL = """
    select id, original_filename, section_ref, uploaded_at
    from "Learner"."evidence_files"
    where learner_kind = %s and learner_id = %s and status = 'approved' and section_ref = any(%s)
    order by uploaded_at
"""


def _iso_any(value):
    return value.isoformat() if hasattr(value, "isoformat") else (_s(value) or None)


def _learner_assignments(kind, learner):
    """The learner's submitted assignments, LMS then legacy Aptem, without marks or feedback.

    The employer sees what was handed in, when, and where it stands; the tutor's
    score, written feedback and the Aptem assessment report are left out.
    """
    from django.db import connections

    from . import legacy_assignments

    with connections["enrolment"].cursor() as cur:
        cur.execute(_SUBMITTED_ASSIGNMENTS_SQL, [kind, str(learner.pk)])
        submissions = cur.fetchall()
        files_by_activity = {}
        activity_ids = [row[0] for row in submissions]
        if activity_ids:
            cur.execute(_ASSIGNMENT_FILES_SQL, [kind, str(learner.pk), activity_ids])
            for file_id, name, section_ref, uploaded_at in cur.fetchall():
                files_by_activity.setdefault(section_ref, []).append(
                    {"source": "lms", "id": str(file_id), "name": _s(name) or "Uploaded file"},
                )

    items = [{
        "id": f"lms:{activity_id}",
        "source": "lms",
        "title": _s(title) or "Assignment",
        "moduleTitle": _s(module),
        "weekTitle": _s(week),
        "status": _s(status),
        "submittedAt": _iso_any(submitted_at) or _iso_any(completed),
        "files": files_by_activity.get(activity_id, []),
    } for activity_id, title, module, week, status, submitted_at, completed in submissions]

    for row in legacy_assignments.classified_rows(kind, learner.pk):
        submission = legacy_assignments.classified_submission(row, kind, learner.pk)
        documents = submission["legacyAssignment"]["documents"]
        items.append({
            "id": submission["id"],
            "source": "aptem",
            "title": submission["activityTitle"] or "Assignment",
            "moduleTitle": submission["moduleTitle"] or "",
            "weekTitle": "",
            "status": submission["status"],
            "submittedAt": submission["submittedAt"] or submission["dateCompleted"] or None,
            # The learner's own upload only; the "report" part is the assessor's.
            "files": [
                {"source": "aptem", "id": str(doc["evidenceId"]), "activityId": submission["activityId"], "name": doc["name"]}
                for doc in documents if doc["part"] == "file"
            ],
        })
    return items


@csrf_exempt
@employer_or_staff()
def employer_portal_learner_assignments(request, employer_id, kind, learner_id):
    """Every assignment this learner has handed in, with their uploaded files."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    learner, err = _owned_learner(employer_id, kind, learner_id)
    if err:
        return err
    try:
        items = _learner_assignments(kind, learner)
    except DatabaseError:
        logger.exception("employer_portal_learner_assignments: unavailable for %s", learner.pk)
        return _error("Could not load assignments. Please try again.", 503)
    response = JsonResponse({"assignments": items})
    response["Cache-Control"] = "private, no-store"
    return response


@csrf_exempt
@employer_or_staff()
def employer_portal_assignment_file(request, employer_id, kind, learner_id, file_id):
    """A short-lived link to one uploaded assignment file.

    Only a scanned-clean file, uploaded by this learner, to an assignment they
    have handed in — an evidence upload with no submitted assignment behind it
    is not the employer's to open.
    """
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    learner, err = _owned_learner(employer_id, kind, learner_id)
    if err:
        return err
    from django.conf import settings
    from django.db import connections

    from .evidence_storage import azure_configured, get_download_sas

    if not azure_configured():
        return _error("Document storage is not configured.", 503)
    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                """
                select f.blob_name, f.original_filename
                from "Learner"."evidence_files" f
                where f.id = %s and f.learner_kind = %s and f.learner_id = %s and f.status = 'approved'
                  and exists (
                    select 1 from "Learner"."learning_reflection_submissions" s
                    where s.learner_kind = f.learner_kind and s.learner_id = f.learner_id
                      and s.activity_type = 'assignment' and s.status <> 'draft'
                      and s.activity_id = f.section_ref
                  )
                """,
                [str(file_id), kind, str(learner.pk)],
            )
            row = cur.fetchone()
    except DatabaseError:
        logger.exception("employer_portal_assignment_file: lookup failed")
        return _error("Could not open the file. Please try again.", 503)
    if not row:
        return _error("File not found.", 404)
    blob_name, name = row
    try:
        url = get_download_sas(settings.AZURE_APPROVED_CONTAINER, blob_name, filename=_s(name) or None)
    except Exception:
        logger.warning("employer_portal_assignment_file: SAS failed for %s", file_id)
        return _error("Could not open the file. Please try again.", 503)
    response = JsonResponse({"url": url})
    response["Cache-Control"] = "private, no-store"
    return response


@csrf_exempt
@employer_or_staff()
def employer_portal_legacy_assignment_file(request, employer_id, kind, learner_id, evidence_id):
    """A short-lived link to a legacy (Aptem) assignment upload — the learner's file, never the assessor's report."""
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    learner, err = _owned_learner(employer_id, kind, learner_id)
    if err:
        return err
    from . import evidence_storage, legacy_assignments

    activity_id = _s(request.GET.get("activityId"))
    if not activity_id:
        return _error("activityId is required.", 400)
    if not evidence_storage.azure_configured():
        return _error("Document storage is not configured.", 503)
    try:
        rows = legacy_assignments.classified_rows(kind, learner.pk, activity_id)
    except DatabaseError:
        logger.exception("employer_portal_legacy_assignment_file: lookup failed")
        return _error("Could not open the file. Please try again.", 503)
    if not rows or str(rows[0]["evidence_id"]) != str(evidence_id) or not rows[0].get("file_blob"):
        return _error("File not found.", 404)
    document = rows[0]
    try:
        url = evidence_storage.get_download_sas(
            "fetch-aptem-evidences", document["file_blob"], filename=_s(document["evidence_name"]) or None,
        )
    except Exception:
        logger.warning("employer_portal_legacy_assignment_file: SAS failed for %s", evidence_id)
        return _error("Could not open the file. Please try again.", 503)
    response = JsonResponse({"url": url})
    response["Cache-Control"] = "private, no-store"
    return response


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


