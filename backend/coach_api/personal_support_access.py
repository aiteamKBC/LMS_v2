"""Prepare an owned Aptem PSP on learner open, without changing its booking."""
from django.db import transaction
from django.db.models import Q
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST

from learner_api.models import EnrolmentUser
from login.permissions import authenticate_request

from .migrated_completion_views import _party_definition
from .migrated_initialization import initialize_imported_review
from .migrated_reviews import EDITABLE_STATUSES, review_family, source_is_completed
from .migrated_template_sync import lock_template_family
from .models import ImportedReviewInstance
from .review_sources import ReviewIdentityConflict, review_profile_for_source, source_for_learner


@require_POST
@csrf_protect
def prepare_learner_personal_support(request, review_id):
    account = authenticate_request(request)
    if account is None:
        return JsonResponse({"detail": "Sign in to view this review."}, status=401)
    if (account.role != "learner" or request.GET.get("viewAsCoach")
            or request.GET.get("viewAsLearner")):
        return JsonResponse({"detail": "Only the learner can prepare their Personal Support Plan."}, status=403)
    if not review_id.startswith("imported-review:"):
        return JsonResponse({"detail": "Personal Support Plan not found."}, status=404)
    learner = EnrolmentUser.all_learners.filter(pk=account.subject_id).first()
    if learner is None:
        return JsonResponse({"detail": "Learner not found."}, status=404)
    try:
        profile = review_profile_for_source(learner)
    except ReviewIdentityConflict:
        return JsonResponse({"detail": "The learner's Review identity could not be verified."}, status=409)
    if profile is None or source_for_learner(learner, profile).kind != "aptem":
        return JsonResponse({"detail": "Personal Support Plan not found."}, status=404)
    owner = (profile.coach_email or "").strip().casefold()
    if not owner:
        return JsonResponse({"detail": "A coach must be assigned before this plan can be opened."}, status=409)

    from .views import _imported_review_definition
    try:
        with transaction.atomic():
            # The coach initializer and template editor take this same lock.
            # Recheck eligibility after it: concurrent opens reuse one form.
            lock_template_family("PSP")
            definition = _imported_review_definition(owner, review_id)
            history = (definition or {}).get("historicalReview") or {}
            if (not definition or definition["instance"]["learnerId"] != profile.pk
                    or review_family(history.get("type")) != "PSP"
                    or source_is_completed(history)):
                return JsonResponse({"detail": "Personal Support Plan not found for this account."}, status=404)
            key = definition["instance"]["id"]
            overlays = list(ImportedReviewInstance.objects.filter(
                Q(event_key=key) | Q(source_review_id=history["id"]),
            )[:2])
            if overlays:
                overlay = overlays[0]
                if (len(overlays) != 1 or overlay.owner_email.casefold() != owner
                        or overlay.learner_id != profile.pk
                        or str(overlay.source_review_id) != str(history["id"])
                        or not definition.get("migratedForm")):
                    raise ValueError("The existing Personal Support Plan association could not be verified.")
            else:
                status = str(definition.get("sourceStatus") or "").strip().casefold().replace(" ", "-")
                if status not in EDITABLE_STATUSES or not definition.get("canInitialize"):
                    raise ValueError("An active Personal Support Plan template is not available for this review. Ask your coach to check Review Templates.")
                overlay, _ = initialize_imported_review(owner, definition)
            result = _party_definition(overlay, account)
            if result is None:
                raise ValueError("The Personal Support Plan could not be loaded. Please try again.")
            return JsonResponse(result)
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=409)
