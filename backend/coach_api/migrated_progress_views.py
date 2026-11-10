"""Explicit migrated Calculate/Recalculate; no meeting or external-service work."""
import json
import logging

from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from learner_api.review_progress_snapshot import UnresolvedTrainingPlanTarget

from .auth import attributed_write_view, authenticated_coach_email, coach_access_required, is_coach_view_as
from .migrated_progress import (
    ProgressError, calculate_snapshot, persist_snapshot, require_version, resolve_context,
)


logger = logging.getLogger(__name__)


@coach_access_required
@attributed_write_view
@require_POST
def migrated_review_progress(request, review_id):
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"detail": "A JSON object is required."}, status=400)
    owner = authenticated_coach_email(request).strip().casefold()
    actor = owner
    if is_coach_view_as(request):
        admin = request.coach_view_as_admin
        admin_identity = (getattr(admin, "username", "") or getattr(admin, "email", "") or "").strip() or "Administrator"
        actor = f"{admin_identity} (for {owner})"
    try:
        context = resolve_context(owner, review_id)
        require_version(payload.get("progressVersion"), context.version)
        snapshot = calculate_snapshot(context, actor)
        definition = persist_snapshot(owner, review_id, context, snapshot, preview_only=is_coach_view_as(request))
    except ProgressError as exc:
        return JsonResponse({
            "detail": str(exc),
            **({"errors": exc.errors} if exc.errors else {}),
            **({"code": exc.code} if exc.code else {}),
        }, status=exc.status)
    except UnresolvedTrainingPlanTarget as exc:
        return JsonResponse({"detail": str(exc), "errors": {
            "targetSchedule": exc.calculation.get("unresolvedReasons") or [],
        }}, status=409)
    except ValueError as exc:
        return JsonResponse({"detail": str(exc)}, status=409)
    except DatabaseError:
        logger.warning("Migrated progress calculation could not be saved", exc_info=True)
        return JsonResponse({"detail": "Progress could not be calculated. Please try again."}, status=503)
    return JsonResponse(definition)
