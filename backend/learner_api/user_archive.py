"""Reversible directory archiving without changing a learner's programme or work."""
from django.db import DatabaseError, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from login.permissions import staff_only
from .mappers import ValidationError
from .models import EnrolmentUser


ARCHIVE_KEY = "_directoryArchive"


def set_archived(user_id, *, archived):
    # Keep the previous subscription status beside the existing subscription
    # details. Lock the row so repeated archive requests cannot replace it with
    # "Archived", and update only these two columns; no progression/plan writes.
    with transaction.atomic(using="enrolment"):
        user = EnrolmentUser.all_learners.using("enrolment").select_for_update().get(pk=user_id)
        currently_archived = str(user.status or "").strip().casefold() == "archived"
        if currently_archived == archived:
            return user.status
        details = user.subscription_details
        details_were_null = details is None
        if details is not None and not isinstance(details, dict):
            raise ValidationError("Subscription details must be checked before changing the archive status.")
        details = dict(details or {})
        if archived:
            details[ARCHIVE_KEY] = {
                "previousStatus": user.status,
                "archivedAt": timezone.now().isoformat(),
                "detailsWereNull": details_were_null,
            }
            user.status = "Archived"
        else:
            snapshot = details.pop(ARCHIVE_KEY, None)
            if isinstance(snapshot, dict):
                details_were_null = snapshot.get("detailsWereNull", details_were_null)
            # Older records may have been archived by editing their status
            # directly, before a previous status was recorded.
            user.status = snapshot.get("previousStatus", "FullUser") if isinstance(snapshot, dict) else "FullUser"
            if str(user.status or "").strip().casefold() == "archived":
                user.status = "FullUser"
        user.subscription_details = None if not archived and details_were_null and not details else details
        user.save(using="enrolment", update_fields=["status", "subscription_details"])
        return user.status


def _change_archive(request, pk, *, archived):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    try:
        status = set_archived(pk, archived=archived)
    except EnrolmentUser.DoesNotExist:
        return JsonResponse({"error": "User not found."}, status=404)
    except ValidationError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    except DatabaseError:
        return JsonResponse({"error": "Could not update the user's archive status."}, status=502)
    return JsonResponse({"id": str(pk), "subscriptionStatus": status or "", "archived": archived})


@csrf_exempt
@staff_only()
def archive_user(request, pk):
    return _change_archive(request, pk, archived=True)


@csrf_exempt
@staff_only()
def restore_user(request, pk):
    return _change_archive(request, pk, archived=False)
