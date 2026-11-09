"""Canonical learner identity and Free Course assignment selectors.

The URL/session layer identifies learners by ``enrolment.Created_users.id``.
Free Course assignments and progress are owned by ``Learner.learners.id``.
These selectors keep that translation explicit so an enrolment id is never
accidentally used as a learner-profile id.
"""
import json

from django.utils.crypto import salted_hmac

from .models import LearnerFreeCourse, LearnerProfile


VALID_LEARNER_KINDS = frozenset({"commercial", "apprenticeship"})


def canonical_learner(kind, enrolment_id):
    """Resolve one canonical learner profile from its authenticated enrolment."""
    if kind not in VALID_LEARNER_KINDS:
        raise LearnerProfile.DoesNotExist
    return (
        LearnerProfile.objects
        .only("id", "enrolment_id", "learner_type")
        .get(enrolment_id=enrolment_id, learner_type=kind)
    )


def assigned_course_ids(learner):
    """Return canonical course ids in Learning Plan assignment order."""
    return list(
        LearnerFreeCourse.objects
        .filter(learner_id=learner.pk)
        .order_by("position", "id")
        .values_list("free_course_ref", flat=True)
    )


def assignment_version(learner_id, course_ids):
    """Opaque token for one canonical learner's ordered assignment state."""
    payload = json.dumps(
        {"learnerId": int(learner_id), "courseIds": [str(value) for value in course_ids]},
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return salted_hmac("learner-free-course-assignments-v1", payload).hexdigest()
