"""Ownership and identity resolution for the read-only Employer Portal.

Separated from `employer_portal` so the summary projection can reuse exactly the
same gate the portal's other endpoints apply, without importing the signing
views (and their write paths) to get at it.

Two rules hold everywhere in here:

* Ownership is decided on the server, from the learner row's own `Employer_id`.
  A client-supplied employer id is only ever used to look the employer up.
* Nothing in this module writes. The portal is a read surface, so profile
  resolution deliberately avoids the repair-on-read helper used elsewhere: a
  read by an employer must not mutate a learner's identity records.
"""

from django.db import DatabaseError

from .learner_detail import SOURCE_MODELS
from .mappers import _s
from .models import LearnerProfile


class EmployerAccessResult:
    """The outcome of "may this employer read this learner?".

    Carries the resolved rows on success, and the message plus HTTP status to
    return on refusal, so callers surface one consistent denial rather than
    inventing their own.
    """

    def __init__(self, employer, learner, error="", status=200):
        self.employer = employer
        self.learner = learner
        self.error = error
        self.status = status

    @property
    def ok(self):
        return not self.error


def resolve_employer_owned_learner(employer, kind, learner_id):
    """Resolve a learner, refusing unless this employer owns them.

    "Not owned" is answered with 403 rather than 404: the caller reached a real
    employer of their own, so hiding the learner's existence buys nothing while a
    distinct status keeps a genuine misroute debuggable.
    """
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return EmployerAccessResult(employer, None, error=f"Unknown kind: {kind!r}.", status=404)

    try:
        learner = model.all_learners.get(pk=learner_id)
    except model.DoesNotExist:
        return EmployerAccessResult(employer, None, error="Learner not found.", status=404)
    except DatabaseError as exc:
        return EmployerAccessResult(employer, None, error=f"Database error: {exc}", status=502)

    # The two kinds share one table and are told apart by "Learner_type", so a
    # matching pk is not on its own proof the URL named the right kind.
    learner_type = _s(getattr(learner, "learner_type", "")).casefold()
    if learner_type and learner_type != _s(kind).casefold():
        return EmployerAccessResult(employer, None, error="Learner not found.", status=404)

    if getattr(learner, "employer_id", None) != getattr(employer, "pk", None):
        return EmployerAccessResult(
            None, None, error="That learner does not belong to this employer.", status=403,
        )

    return EmployerAccessResult(employer, learner)


def resolve_single_profile_for_source(learner, kind):
    """The learner's profile row, read without repairing anything.

    Returns `(profile, error)`. `enrolment_id` is the real link between the
    enrolment and learner schemas; email is kept only as the legacy bridge for
    profiles predating that column.

    An ambiguous match is an error, not a guess: picking one of two colliding
    profiles would show the employer another learner's progress.
    """
    source_pk = getattr(learner, "pk", None)
    try:
        matches = list(LearnerProfile.objects.filter(enrolment_id=source_pk)[:2])
        if not matches:
            email = _s(getattr(learner, "email", ""))
            if email:
                matches = list(LearnerProfile.objects.filter(email__iexact=email)[:2])
    except DatabaseError as exc:
        return None, f"Database error: {exc}"

    if not matches:
        return None, "Learner profile not found."
    if len(matches) > 1:
        return None, "Learner profile could not be identified."
    return matches[0], ""
