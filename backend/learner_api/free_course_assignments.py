"""Authorized canonical Free Course assignment management.

This is deliberately separate from the Learning Plan module writer. It updates
only ``Learner.learner_free_courses`` and never reads or writes the legacy
``Created_users.Free_courses`` JSON or learner progress.
"""
import json
from dataclasses import dataclass

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.utils.crypto import constant_time_compare
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from login.permissions import require_access

from .constants import ACCESS_ENROLMENT
from .free_course_selectors import assignment_version
from .mappers import _s
from .models import EnrolmentUser, LearnerFreeCourse, LearnerProfile
from .response_cache import bump_learner

ASSIGNMENT_DB = "enrolment"


class AssignmentConflict(Exception):
    pass


class InvalidCourses(Exception):
    pass


@dataclass(frozen=True)
class AssignmentResult:
    learner_id: int
    course_ids: tuple[str, ...]
    course_names: dict[str, str]
    version: str


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _locked_profile(enrolment_id, learner_type):
    return (
        LearnerProfile.objects.using(ASSIGNMENT_DB)
        .select_for_update()
        .only("id")
        .get(enrolment_id=enrolment_id, learner_type=learner_type)
    )


def _locked_assignment_ids(learner_id):
    return list(
        LearnerFreeCourse.objects.using(ASSIGNMENT_DB)
        .select_for_update()
        .filter(learner_id=learner_id)
        .order_by("position", "id")
        .values_list("free_course_ref", flat=True)
    )


def _canonical_course_names(course_ids):
    """Validate ids against the authoritative catalogue in the same DB tx."""
    if not course_ids:
        return {}
    connection = connections[ASSIGNMENT_DB]
    lock = " FOR SHARE" if connection.vendor == "postgresql" else ""
    if connection.vendor == "postgresql":
        where_sql = "id = ANY(%s)"
        params = [list(course_ids)]
    else:
        where_sql = "id IN (" + ", ".join(["%s"] * len(course_ids)) + ")"
        params = list(course_ids)
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, course_name FROM curriculum.free_courses "
            f"WHERE {where_sql}{lock}",
            params,
        )
        return {_s(course_id): _s(course_name) for course_id, course_name in cursor.fetchall()}


def _replace_assignment_rows(learner_id, course_ids, course_names):
    manager = LearnerFreeCourse.objects.using(ASSIGNMENT_DB)
    manager.filter(learner_id=learner_id).delete()
    manager.bulk_create([
        LearnerFreeCourse(
            learner_id=learner_id,
            position=position,
            free_course_ref=course_id,
            # Compatibility snapshot only. Readers use the canonical course.
            free_course_title=course_names[course_id],
        )
        for position, course_id in enumerate(course_ids, 1)
    ])


def _update_assignments(enrolment_id, learner_type, course_ids, expected_version):
    """Lock, compare and replace one learner's assignment set atomically."""
    with transaction.atomic(using=ASSIGNMENT_DB):
        profile = _locked_profile(enrolment_id, learner_type)
        current_ids = _locked_assignment_ids(profile.pk)
        current_version = assignment_version(profile.pk, current_ids)
        if not constant_time_compare(expected_version, current_version):
            raise AssignmentConflict

        course_names = _canonical_course_names(course_ids)
        if any(course_id not in course_names for course_id in course_ids):
            raise InvalidCourses

        _replace_assignment_rows(profile.pk, course_ids, course_names)
        version = assignment_version(profile.pk, course_ids)
        return AssignmentResult(profile.pk, tuple(course_ids), course_names, version)


def _payload(result):
    return {
        "freeCourses": [
            {
                "freeCourseId": course_id,
                "courseName": result.course_names[course_id],
                "addedAt": "",
            }
            for course_id in result.course_ids
        ],
        "freeCourseAssignmentVersion": result.version,
    }


@require_http_methods(["PUT"])
@require_access(ACCESS_ENROLMENT)
@csrf_protect
def free_course_assignments(request, pk):
    """Replace one learner's ordered canonical assignments with concurrency."""
    try:
        payload = json.loads(request.body or b"{}")
    except (TypeError, ValueError, UnicodeDecodeError):
        return _error("Request body must be valid JSON.", 400)
    if not isinstance(payload, dict):
        return _error("Request body must be a JSON object.", 400)

    raw_ids = payload.get("courseIds")
    expected_version = payload.get("expectedVersion")
    if not isinstance(raw_ids, list):
        return _error("courseIds must be a list.", 400)
    if not isinstance(expected_version, str) or not expected_version:
        return _error("expectedVersion is required.", 400)

    course_ids = []
    seen = set()
    for value in raw_ids:
        course_id = _s(value)
        if not course_id:
            return _error("Every assignment needs a Free Course id.", 400)
        if course_id in seen:
            return _error("Free Course assignments must not contain duplicates.", 400)
        seen.add(course_id)
        course_ids.append(course_id)

    try:
        source = (
            EnrolmentUser.all_learners.using(ASSIGNMENT_DB)
            .only("id", "learner_type")
            .get(pk=pk)
        )
    except EnrolmentUser.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError:
        return _error("Could not verify the learner.", 503)

    learner_type = _s(source.learner_type).lower()
    try:
        result = _update_assignments(source.pk, learner_type, course_ids, expected_version)
    except LearnerProfile.DoesNotExist:
        return _error("Learner not found.", 404)
    except AssignmentConflict:
        return _error(
            "Free Course assignments changed in another session. Reload and review them before saving.",
            409,
        )
    except InvalidCourses:
        return _error("One or more Free Courses are unavailable.", 400)
    except DatabaseError:
        return _error("Could not save the Free Course assignments. Please try again.", 503)

    bump_learner(learner_type, source.pk)
    response = JsonResponse(_payload(result))
    response["Cache-Control"] = "private, no-store"
    return response
