"""Mutation policy for the tripartite Training Plan document only.

Use the existing enrolment staff grants and employer link, without granting
authority through a document name, URL, signature image or client role. This
policy intentionally applies even when the general development gate is off.
"""
import functools

from django.db import DatabaseError
from django.http import JsonResponse
from enrolment_api import auth


def _actor_error(request, learner_id, *, issue):
    """Authenticate and scope a mutation once, before HTTP body validation."""
    if not auth.is_authenticated(request):
        return JsonResponse({"error": "Authentication required."}, status=401)

    account = getattr(request, "login_account", None)
    if account is None:
        # The existing gate accepts Django sessions. Only a live Django
        # superuser is an explicit provider authority; is_authenticated or
        # is_staff alone is insufficient.
        user = getattr(request, "user", None)
        if (user is not None and getattr(user, "is_active", False)
                and getattr(user, "is_staff", False) and getattr(user, "is_superuser", False)):
            return None
        return JsonResponse({"error": "Only authorized staff may issue or sign as the provider."}, status=403)

    if not getattr(account, "is_active", False):
        return JsonResponse({"error": "Authentication required."}, status=401)

    role = getattr(account, "role", None)
    if role == "learner":
        if learner_id != account.subject_id:
            return JsonResponse({"error": "Not found."}, status=404)
        if not issue:
            return None
        return JsonResponse({"error": "A learner can only sign as the apprentice."}, status=403)

    if role == "employer":
        if issue:
            return JsonResponse({"error": "An employer can only sign as the employer."}, status=403)
        try:
            linked = auth._employs(account, learner_id)
        except DatabaseError:
            return JsonResponse({"error": "Unable to verify document access. Please retry."}, status=503)
        if linked:
            return None
        return JsonResponse({"error": "Not found."}, status=404)

    if role in auth.STAFF_ROLES and getattr(account, "subject_type", None) == "staff":
        # _may_access uses live enrolment/super-admin grants and fails closed
        # when they cannot be read. Do not infer authority from role alone.
        if auth._may_access(request, "issue_training_plan", {"pk": learner_id}):
            return None
        return JsonResponse({"error": "Not found."}, status=404)
    return JsonResponse({"error": "Only authorized staff may issue or sign as the provider."}, status=403)


def document_mutation_required(*, issue=False):
    """Use explicit document authority independently of development gate flags."""
    def decorate(view):
        @functools.wraps(view)
        def wrapped(request, pk):
            error = _actor_error(request, pk, issue=issue)
            return error if error is not None else view(request, pk)
        return wrapped
    return decorate


def document_party_error(request, party):
    """Narrow an already-authorized actor to their own signatory position."""
    account = getattr(request, "login_account", None)
    role = getattr(account, "role", None)
    if role == "learner":
        if party == "apprentice":
            return None
        return JsonResponse({"error": "A learner can only sign as the apprentice."}, status=403)
    if role == "employer":
        if party == "employer":
            return None
        return JsonResponse({"error": "An employer can only sign as the employer."}, status=403)
    if party == "provider":
        return None
    return JsonResponse({"error": "Authorized staff can only sign as the provider."}, status=403)
