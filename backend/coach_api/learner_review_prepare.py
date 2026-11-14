"""Prepare an owned Aptem review without booking a meeting."""
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST

from learner_api.models import EnrolmentUser
from login.permissions import authenticate_request
from .migrated_completion_views import _party_definition
from .migrated_initialization import initialize_imported_review
from .migrated_reviews import EDITABLE_STATUSES, review_family, source_is_completed
from .migrated_template_sync import lock_template_family
from .models import ImportedReviewInstance
from .review_sources import ReviewIdentityConflict, review_profile_for_source, source_for_learner


class _ReviewNotFound(Exception):
    pass


def _preview_caseload_error(account, profile):
    """A coach may preview only their own caseload; an admin is unscoped.

    Coaches sign in as ``staff`` (login.models.ROLE_CHOICES has no separate
    coach role), so the role alone cannot authorize this read. Ownership is
    the learner profile's assigned coach, the same field every other coach
    scope uses -- never a learner id supplied in the URL.
    """
    if account.role == "admin":
        return None
    assigned = str(getattr(profile, "coach_email", "") or "").strip().casefold()
    if not assigned or assigned != str(account.email or "").strip().casefold():
        return JsonResponse({"detail": "This learner is not on your caseload."}, status=403)
    return None


@require_GET
def preview_learner_review(request, review_id, kind, pk):
    """Read a learner's form without initializing or saving it.

    Admins may read any learner; a coach may read their own caseload. Both are
    read-only: nothing here initializes an overlay, writes answers or
    signatures, or touches the Aptem source.
    """
    account = authenticate_request(request)
    if account is None:
        return JsonResponse({"detail": "Sign in to view this review."}, status=401)
    if account.role not in {"admin", "staff"}:
        return JsonResponse({"detail": "This preview is available to staff only."}, status=403)
    if not review_id.startswith("imported-review:"):
        return JsonResponse({"detail": "Review not found."}, status=404)
    from learner_api.learner_detail import SOURCE_MODELS
    model = SOURCE_MODELS.get(kind)
    learner = model.all_learners.filter(pk=pk).first() if model else None
    if learner is None or str(getattr(learner, "learner_type", "") or "").strip().casefold() != kind:
        return JsonResponse({"detail": "Review not found."}, status=404)
    try:
        profile = review_profile_for_source(learner)
    except ReviewIdentityConflict:
        return JsonResponse({"detail": "The learner's Review identity could not be verified."}, status=409)
    if profile is None or source_for_learner(learner, profile).kind != "aptem":
        return JsonResponse({"detail": "Review not found."}, status=404)
    denied = _preview_caseload_error(account, profile)
    if denied is not None:
        return denied
    from .views import _imported_review_definition
    overlays = list(ImportedReviewInstance.objects.filter(
        event_key=review_id, learner_id=profile.pk, source_review_id__isnull=False,
    )[:2])
    if len(overlays) > 1:
        return JsonResponse({"detail": "The existing review association could not be verified."}, status=409)
    owner = overlays[0].owner_email if overlays else profile.coach_email
    definition = _imported_review_definition((owner or "").strip().casefold(),
                                             review_id, preview_only=True, learners=[profile])
    if not definition or definition.get("instance", {}).get("learnerId") != profile.pk:
        return JsonResponse({"detail": "Review not found."}, status=404)
    if review_family((definition.get("historicalReview") or {}).get("type")) not in {"MCM", "PR", "PR_SKILLS_RADAR", "PSP"}:
        return JsonResponse({"detail": "Review not found."}, status=404)
    if not definition.get("migratedForm") and not definition.get("previewOnly"):
        return JsonResponse({"detail": "An approved review form is not available."}, status=409)
    definition["readOnly"] = True
    for field in ("historicalReview", "progressVersion", "ragHistory", "summaryBinding", "answerVersion"):
        definition.pop(field, None)
    response = JsonResponse(definition)
    response["Cache-Control"] = "private, no-store"
    return response


@require_POST
@csrf_protect
def prepare_learner_review(request, review_id):
    account = authenticate_request(request)
    if account is None:
        return JsonResponse({"detail": "Sign in to view this review."}, status=401)
    if account.role != "learner" or request.GET.get("viewAsCoach") or request.GET.get("viewAsLearner"):
        return JsonResponse({"detail": "Only the learner can prepare their review."}, status=403)
    if not review_id.startswith("imported-review:"):
        return JsonResponse({"detail": "Review not found."}, status=404)
    learner = EnrolmentUser.all_learners.filter(pk=account.subject_id).first()
    if learner is None:
        return JsonResponse({"detail": "Review not found."}, status=404)
    try:
        profile = review_profile_for_source(learner)
    except ReviewIdentityConflict:
        return JsonResponse({"detail": "The learner's Review identity could not be verified."}, status=409)
    if profile is None or source_for_learner(learner, profile).kind != "aptem":
        return JsonResponse({"detail": "Review not found."}, status=404)
    owner = (profile.coach_email or "").strip().casefold()
    from .views import _imported_review_definition, lock_learner_calendar
    try:
        # Reject an unrelated or unsupported source before taking the learner
        # lock: acquiring that lock may create a sequence row on first use.
        preliminary = list(ImportedReviewInstance.objects.filter(
            event_key=review_id, learner_id=profile.pk, source_review_id__isnull=False,
        )[:2])
        if len(preliminary) > 1:
            raise ValueError("The existing review association could not be verified.")
        initial_owner = preliminary[0].owner_email.strip().casefold() if preliminary else owner
        if not initial_owner:
            raise ValueError("A coach must be assigned before this review can be opened.")
        initial = _imported_review_definition(initial_owner, review_id,
                                              **({"learners": [profile]} if preliminary else {}))
        initial_history = (initial or {}).get("historicalReview") or {}
        if (not initial or initial.get("instance", {}).get("learnerId") != profile.pk
                or review_family(initial_history.get("type")) not in {"MCM", "PR", "PR_SKILLS_RADAR"}
                or (source_is_completed(initial_history) and not initial.get("migratedForm"))):
            return JsonResponse({"detail": "Review not found for this account."}, status=404)
        with transaction.atomic():
            lock_learner_calendar(profile.pk)
            existing = list(ImportedReviewInstance.objects.filter(
                event_key=review_id, learner_id=profile.pk, source_review_id__isnull=False,
            )[:2])
            if len(existing) > 1:
                raise ValueError("The existing review association could not be verified.")
            if existing:
                owner = existing[0].owner_email.strip().casefold()
                definition = _imported_review_definition(owner, review_id, learners=[profile])
            else:
                if not owner:
                    raise ValueError("A coach must be assigned before this review can be opened.")
                definition = _imported_review_definition(owner, review_id)
            history = (definition or {}).get("historicalReview") or {}
            family = review_family(history.get("type"))
            if (not definition or definition["instance"]["learnerId"] != profile.pk
                    or family not in {"MCM", "PR", "PR_SKILLS_RADAR"}
                    or (source_is_completed(history) and not definition.get("migratedForm"))):
                raise _ReviewNotFound()
            lock_template_family(family)
            overlays = list(ImportedReviewInstance.objects.filter(
                Q(event_key=definition["instance"]["id"]) | Q(source_review_id=history["id"]),
            )[:2])
            if overlays:
                overlay = overlays[0]
                if (len(overlays) != 1 or overlay.owner_email.casefold() != owner
                        or overlay.learner_id != profile.pk
                        or str(overlay.source_review_id) != str(history["id"])
                        or not definition.get("migratedForm")):
                    raise ValueError("The existing review association could not be verified.")
            else:
                status = str(definition.get("sourceStatus") or "").strip().casefold().replace(" ", "-")
                if status not in EDITABLE_STATUSES or not definition.get("canInitialize"):
                    raise ValueError("An active review template is not available. Ask your coach to check Review Templates.")
                overlay, _ = initialize_imported_review(owner, definition)
            result = _party_definition(overlay, account)
            if result is None:
                raise ValueError("The review could not be loaded. Please try again.")
            return JsonResponse(result)
    except _ReviewNotFound:
        return JsonResponse({"detail": "Review not found for this account."}, status=404)
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=409)
