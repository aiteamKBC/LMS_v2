"""Canonical learner permission gates for Progress Review URL boundaries."""
import functools

from django.http import JsonResponse

from login.permissions import (
    _read_only_learner_view,
    _unauthenticated,
    auth_gate_enabled,
    authenticate_request,
)

from .identity import LearnerIdentityError, identity_from_enrolment_id


def _not_found():
    return JsonResponse({"error": "Not found."}, status=404)


def _canonical_learner_gate(view, *, kwarg, allow_staff):
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            target = identity_from_enrolment_id(kwargs.get(kwarg))
        except LearnerIdentityError:
            return _not_found()
        request.progress_review_learner_identity = target

        if not auth_gate_enabled():
            authenticate_request(request)
            return view(request, *args, **kwargs)
        if request.method == "OPTIONS":
            authenticate_request(request)
            return view(request, *args, **kwargs)

        account = authenticate_request(request)
        if account is None:
            return _unauthenticated(request)

        if account.role == "learner":
            try:
                actor = identity_from_enrolment_id(account.subject_id)
            except LearnerIdentityError:
                return _not_found()
            request.progress_review_actor_profile_id = actor.profile_id
            if actor.profile_id != target.profile_id:
                return _not_found()
            return view(request, *args, **kwargs)

        if allow_staff and account.role in {"admin", "staff"}:
            return view(request, *args, **kwargs)
        return _read_only_learner_view()

    return wrapped


def canonical_learner_self_only(*, kwarg):
    def decorator(view):
        return _canonical_learner_gate(view, kwarg=kwarg, allow_staff=False)

    return decorator


def canonical_learner_self_or_staff(*, kwarg):
    def decorator(view):
        return _canonical_learner_gate(view, kwarg=kwarg, allow_staff=True)

    return decorator
