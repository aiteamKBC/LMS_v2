"""The learner's learning plan — the modules they will actually be taught.

A learner's group already carries a module set (curriculum.groups.module_ids),
so the plan starts as that preset rather than blank. Staff then tune it: drop a
module the learner doesn't need, or add one taught to a *different group on the
same programme*. Crossing programmes is rejected — a plan assembled from another
programme's modules would not map to this learner's KSBs or funding.

Hours come from curriculum.modules.total_otjh (off-the-job hours), summed for
the plan total so staff can see the commitment while editing.

The saved plan lives on enrolment."Created_users"."Learning_plan" (jsonb), which
also feeds the delivery-side training plan.

    GET   /learner_api/learning-plan/<pk>/            -> {plan, preset, available, totals}
    PATCH /learner_api/learning-plan/<pk>/            -> save {modules:[...]}
"""
import json
import logging

from django.db import DatabaseError, connection
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .constants import DELIVERY_PROGRAMME_STATUS
from .mappers import _s
from .models import EnrolmentUser

logger = logging.getLogger(__name__)


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _rows(sql, params):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [c[0] for c in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _hours(value):
    """total_otjh is numeric in Postgres; JSON needs a float (0.0 when unset)."""
    return float(value) if value is not None else 0.0


def _module_payload(row):
    return {
        "moduleId": _s(row.get("module_catalogue_id")),
        "moduleTitle": _s(row.get("title")) or _s(row.get("module_catalogue_id")),
        "groupName": _s(row.get("group_name")),
        "programmeName": _s(row.get("programme_name")),
        "hours": _hours(row.get("total_otjh")),
    }


def _programme_modules(programme):
    """Every module on this programme, whichever group teaches it."""
    if not programme:
        return []
    return [
        _module_payload(r)
        for r in _rows(
            """
            SELECT module_catalogue_id, title, group_name, programme_name, total_otjh
            FROM curriculum.modules
            WHERE programme_name = %s OR programme_id = %s
            ORDER BY group_name, title
            """,
            [programme, programme],
        )
    ]


def _group_module_ids(programme, group):
    """The module ids preset on the learner's group."""
    if not group:
        return []
    rows = _rows(
        """
        SELECT module_ids
        FROM curriculum.groups
        WHERE group_name = %s AND (programme_name = %s OR programme_id = %s)
        LIMIT 1
        """,
        [group, programme, programme],
    )
    if not rows:
        return []
    ids = rows[0].get("module_ids")
    if isinstance(ids, str):
        try:
            ids = json.loads(ids)
        except ValueError:
            return []
    return [_s(i) for i in ids] if isinstance(ids, list) else []


def _saved_modules(learner):
    """The plan already stored on the learner, if any."""
    plan = learner.learning_plan
    if isinstance(plan, str):
        try:
            plan = json.loads(plan)
        except ValueError:
            return []
    if not isinstance(plan, list):
        return []
    return [m for m in plan if isinstance(m, dict)]


def _orphan_module(entry):
    """A saved module with no catalogue match, in the standard shape.

    Covers two cases: a module retired from the programme since the plan was
    saved, and plans written by the earlier wizard, whose entries carry
    weeks/components and no hours. Flagged so the UI can mark it.
    """
    return {
        "moduleId": _s(entry.get("moduleId")),
        "moduleTitle": _s(entry.get("moduleTitle")) or _s(entry.get("moduleId")),
        "groupName": _s(entry.get("groupName")),
        "programmeName": _s(entry.get("programmeName")),
        "hours": float(entry.get("hours") or 0),
        "orphaned": True,
    }


def _totals(modules):
    return {
        "moduleCount": len(modules),
        "totalHours": round(sum(float(m.get("hours") or 0) for m in modules), 2),
    }


def _serialize(learner):
    programme = _s(learner.programme)
    group = _s(learner.group)

    catalogue = _programme_modules(programme)
    by_id = {m["moduleId"]: m for m in catalogue}

    preset_ids = _group_module_ids(programme, group)
    preset = [by_id[i] for i in preset_ids if i in by_id]

    # A saved plan wins; an unsaved learner starts from their group's preset so
    # staff are editing something real rather than an empty list.
    saved = _saved_modules(learner)
    if saved:
        # Re-read hours/titles from the catalogue so an edited module shows its
        # current values. Entries with no catalogue match are kept (the module
        # may have been retired) but normalised to the same shape — plans saved
        # by the older wizard carry weeks/components and no hours at all.
        plan = [
            by_id.get(_s(m.get("moduleId"))) or _orphan_module(m)
            for m in saved
        ]
    else:
        plan = preset

    chosen = {_s(m.get("moduleId")) for m in plan}
    return {
        "learner": {
            "id": str(learner.id),
            "name": _s(learner.username),
            "programme": programme,
            "cohort": _s(learner.cohort),
            "group": group,
            "programmeStatus": _s(learner.programme_status),
        },
        "plan": plan,
        "preset": preset,
        # Same programme, not already on the plan — the add-a-module picker.
        "available": [m for m in catalogue if m["moduleId"] not in chosen],
        "saved": bool(saved),
        "totals": _totals(plan),
    }


@csrf_exempt
def learning_plan(request, pk):
    """GET the learner's plan (with preset + pickable modules), or PATCH to save."""
    try:
        learner = EnrolmentUser.all_learners.get(pk=pk)
    except EnrolmentUser.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        logger.exception("learning_plan: lookup failed")
        return _error(f"Database error: {exc}", 502)

    if request.method == "GET":
        try:
            return JsonResponse(_serialize(learner))
        except DatabaseError as exc:
            logger.exception("learning_plan: read failed")
            return _error(f"Database error: {exc}", 502)

    if request.method not in ("PATCH", "PUT"):
        return _error("Method not allowed.", 405)

    # ---- save ----
    try:
        payload = json.loads(request.body or b"{}")
    except ValueError:
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    modules = payload.get("modules")
    if not isinstance(modules, list):
        return _error("modules must be a list.", 400)

    programme = _s(learner.programme)
    try:
        catalogue = {m["moduleId"]: m for m in _programme_modules(programme)}
    except DatabaseError as exc:
        logger.exception("learning_plan: catalogue lookup failed")
        return _error(f"Database error: {exc}", 502)

    # Rebuild each entry from the catalogue rather than trusting the client's
    # titles/hours, and reject anything outside this learner's programme.
    resolved, seen = [], set()
    for entry in modules:
        module_id = _s(entry.get("moduleId") if isinstance(entry, dict) else entry)
        if not module_id:
            return _error("Every module needs a moduleId.", 400)
        if module_id in seen:
            continue
        if module_id not in catalogue:
            return _error(
                f"Module '{module_id}' is not on the {programme or 'learner'} programme.",
                400,
            )
        seen.add(module_id)
        resolved.append(catalogue[module_id])

    learner.learning_plan = resolved
    try:
        learner.save(update_fields=["learning_plan"])
    except DatabaseError as exc:
        logger.exception("learning_plan: save failed")
        return _error(f"Database error: {exc}", 502)

    return JsonResponse(_serialize(learner))


# ---------------------------------------------------------------------------
# Onboarding completion -> Delivery
# ---------------------------------------------------------------------------
# The three onboarding reviews are the gate into delivery. Once every one of them
# is signed by each party it needs, the learner has nothing left to complete, so
# the status moves itself on rather than waiting for someone to remember.
ONBOARDING_REVIEW_TYPES = ("eligibility-review", "workspace", "training-plan")

# Statuses a learner can be promoted *out of*. Anything else (Active, Completed,
# Withdrawn, On break) is a deliberate later state, so a late signature must not
# drag the learner backwards into Delivery.
PRE_DELIVERY_STATUSES = {"Fresh user", "Onboarding", "Ready to enrol", ""}


def _fully_signed(review):
    """Whether every party this review needs has signed it."""
    from .review_form import employer_signature_required

    if not review.form_completed:
        return False
    if not _s(review.learner_signature) or not _s(review.admin_signature):
        return False
    if employer_signature_required(review) and not _s(review.employer_signature):
        return False
    return True


def onboarding_complete(learner_kind, learner_id):
    """True when all three onboarding reviews are signed off by every party."""
    from .models import EnrolmentReview

    reviews = EnrolmentReview.objects.filter(
        learner_kind=learner_kind,
        learner_id=learner_id,
        review_type__in=ONBOARDING_REVIEW_TYPES,
    ).exclude(status="cancelled")

    signed = {
        _s(r.review_type) for r in reviews if _fully_signed(r)
    }
    return all(t in signed for t in ONBOARDING_REVIEW_TYPES)


def promote_learner_if_ready(learner_kind, learner_id):
    """Move one learner to Delivery if their onboarding reviews are all signed.

    The signature endpoint calls promote_to_delivery_if_ready() the moment the
    last signature lands, which covers the normal path. This is the safety net
    for everything else: reviews signed before that hook existed, or completed
    through another route. Reading a learner's record re-checks them, so a
    qualifying learner cannot stay stuck at Onboarding.

    Returns the new status when it changed, else None. Never raises.
    """
    try:
        if not onboarding_complete(learner_kind, learner_id):
            return None

        learner = EnrolmentUser.all_learners.filter(pk=learner_id).first()
        if learner is None:
            return None
        if _s(learner.programme_status) not in PRE_DELIVERY_STATUSES:
            return None

        learner.programme_status = DELIVERY_PROGRAMME_STATUS
        learner.save(update_fields=["programme_status"])
        return DELIVERY_PROGRAMME_STATUS
    except DatabaseError:
        logger.exception("promote_learner_if_ready: failed for %s/%s", learner_kind, learner_id)
        return None


def promote_to_delivery_if_ready(review):
    """Move a learner to Delivery once their onboarding reviews are all signed.

    Called after a signature is saved. Only ever moves a learner *forward* out of
    the pre-delivery statuses — a learner already Active, Completed or Withdrawn
    is left alone, so a late signature cannot drag them backwards.

    Returns the new status when it changed, else None. Never raises: a failure
    here must not fail the signature that triggered it.
    """
    try:
        if _s(review.review_type) not in ONBOARDING_REVIEW_TYPES:
            return None
        if not onboarding_complete(review.learner_kind, review.learner_id):
            return None

        learner = EnrolmentUser.all_learners.filter(pk=review.learner_id).first()
        if learner is None:
            return None
        if _s(learner.programme_status) not in PRE_DELIVERY_STATUSES:
            return None

        learner.programme_status = DELIVERY_PROGRAMME_STATUS
        learner.save(update_fields=["programme_status"])
        return DELIVERY_PROGRAMME_STATUS
    except DatabaseError:
        logger.exception("promote_to_delivery_if_ready: failed for review %s", review.pk)
        return None
