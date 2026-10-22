"""Training Plan content derivation and transactional mutation orchestration.

HTTP authorization and validation precede these internal operations. Existing
transaction alias, lock order, frozen snapshots and post-sign progression stay.
"""
from django.db import transaction
from django.utils import timezone
from ..apprenticeship_agreement import _employer_address, _group_dates, _weeks_between
from ..learner_progression import advance_learner
from ..mappers import _s
from ..models import TrainingPlanDocument
from ..selectors.training_plan_documents import (
    _active_document, _extended_ilr_answers, _learner_kind, _module_breakdown, _plan_modules,
)
from ..serializers.training_plan_documents import _iso

def derive_content(learner):
    """Everything the Training Plan states, from the learner's own records."""
    start, end, dates_from = _group_dates(learner)
    modules = _plan_modules(learner)
    total_hours = round(sum(float(m.get("hours") or 0) for m in modules), 2)
    answers = _extended_ilr_answers(learner.pk)
    employer_block = answers.get("employer") if isinstance(answers.get("employer"), dict) else {}

    weeks = _weeks_between(start, end)

    programme = {
        "apprenticeName": _s(learner.username),
        "programme": _s(learner.programme),
        "cohort": _s(learner.cohort),
        "group": _s(learner.group),
        # We hold no separate standard name/level/reference, so the programme
        # name is what we can honestly state; an officer completes the rest.
        "standard": _s(learner.programme),
        "reference": _s(learner.reference_number),
        "level": "",
        "startDate": _iso(start),
        "endDate": _iso(end),
        "practicalStartDate": _iso(start),
        "practicalEndDate": _iso(end),
        "durationWeeks": float(weeks) if weeks is not None else None,
        "ilrPlannedHours": total_hours,
    }

    employment = {
        "employerName": _s(learner.employer) or _s(employer_block.get("organisationName")),
        "deliveryAddress": _employer_address(learner) or _s(employer_block.get("address")),
        "jobTitle": "",
        "workingHoursPerWeek": "",
        "lineManager": _s(learner.line_manager) or _s(employer_block.get("lineManagerName")),
        "lineManagerTitle": "",
        "startDateWithEmployer": "",
    }

    # Each module with the weeks and components that deliver it, so the printed
    # plan lists actual teaching activities rather than just module names.
    delivery_lead = _s(learner.learning_provider) or "Kent Business College"
    breakdown = _module_breakdown([_s(m.get("moduleId")) for m in modules])
    learning_plan = []
    for m in modules:
        module_id = _s(m.get("moduleId"))
        weeks = breakdown.get(module_id, [])
        # The module total is authoritative (it is what the learning-plan editor
        # agreed); the component sum is shown alongside where it differs.
        component_hours = round(
            sum(c["otjHours"] for w in weeks for c in w["components"]), 2
        )
        learning_plan.append({
            "moduleId": module_id,
            "activity": _s(m.get("moduleTitle")),
            "deliveryLead": delivery_lead,
            "plannedDate": _iso(start),
            "plannedEmHours": None,
            "plannedOtjHours": float(m.get("hours") or 0),
            "groupName": _s(m.get("groupName")),
            "weeks": weeks,
            "componentHours": component_hours,
            "componentCount": sum(len(w["components"]) for w in weeks),
        })

    otjh = {
        # The planned total is the learning plan's; the published minimum and
        # any RPL reduction have no source on our side yet.
        "plannedTotal": total_hours,
        "publishedMinimum": None,
        "rplVolume": None,
        "minimumReducedByRpl": None,
    }

    epa = {"epao": "", "gatewayReviewDate": "", "epaPeriodFrom": "", "epaPeriodTo": ""}

    contacts = {
        "apprentice": {
            "name": _s(learner.username),
            "email": _s(learner.email),
            "telephone": _s(learner.phone_number),
            "address": " ".join(
                p for p in (
                    _s(learner.address_line_1) or _s(learner.address),
                    _s(learner.address_line_2),
                    _s(learner.address_line_3),
                    _s(learner.current_postcode),
                ) if p
            ),
        },
        "employer": {
            "lineManager": employment["lineManager"],
            "position": "",
            "email": _s(employer_block.get("lineManagerEmail")),
            "telephone": _s(employer_block.get("lineManagerPhone")),
            "company": employment["employerName"],
            "address": employment["deliveryAddress"],
        },
    }

    return {
        "programme": programme,
        "employment": employment,
        "learningPlan": learning_plan,
        "otjh": otjh,
        "epa": epa,
        "contacts": contacts,
        "datesFrom": dates_from,
    }



def issue_document(learner, derived):
    """Supersede the active document and freeze current content atomically."""
    kind = _learner_kind(learner)
    with transaction.atomic(using="enrolment"):
        existing = _active_document(kind, learner.pk, lock=True)
        if existing is not None:
            existing.status = TrainingPlanDocument.STATUS_SUPERSEDED
            existing.save(update_fields=["status", "updated_at"])
        document = TrainingPlanDocument.objects.create(
            learner_kind=kind, learner_id=learner.pk,
            programme=derived["programme"], employment=derived["employment"],
            learning_plan=derived["learningPlan"], otjh=derived["otjh"],
            epa=derived["epa"], contacts=derived["contacts"],
        )
    return document


def sign_document(learner, party, signature, name, position):
    """Update one signature under lock; preserve post-transaction progression."""
    with transaction.atomic(using="enrolment"):
        document = _active_document(_learner_kind(learner), learner.pk, lock=True)
        if document is None:
            return None, None
        now = timezone.now() if signature else None
        setattr(document, f"{party}_signature", signature)
        setattr(document, f"{party}_signed_name", name if signature else "")
        setattr(document, f"{party}_position", position if signature else "")
        setattr(document, f"{party}_signed_at", now)
        document.recalculate_signed()
        document.save()
    promoted = advance_learner(learner)
    return document, promoted
