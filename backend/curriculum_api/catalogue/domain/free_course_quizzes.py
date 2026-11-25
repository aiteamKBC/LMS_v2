"""Quiz component ownership, canonical links and revision/integrity decisions."""
import json
from .free_course_authoring import MutationError, _check_revision


def owned_component(row):
    if not row:
        raise MutationError("cross_course_id", "The quiz component does not belong to this Free Course Week.", status=409)
    if "quiz" not in str(row[1] or "").casefold():
        raise MutationError("not_quiz_component", "Only a quiz activity can own a quiz.")
    settings = row[2] if isinstance(row[2], dict) else json.loads(row[2] or "{}")
    return {"componentId": row[0], "type": row[1], "settings": settings, "weekTitle": row[4], "courseName": row[5]}


def assert_owner(free_course_week_id, module_week_id, week_id):
    owner = str(free_course_week_id or "")
    if owner != week_id or str(module_week_id or ""):
        raise MutationError(
            "quiz_owner_mismatch",
            "This quiz is not canonically owned by the selected Free Course Week.",
            status=409,
        )


def canonical_link_required(links, course_id, week_id):
    exact = [row for row in links if str(row[1] or "") == course_id and str(row[2] or "") == week_id and not row[3] and not row[4]]
    if len(links) > 1 or len(exact) > 1:
        raise MutationError("duplicate_canonical_quiz_link", "This quiz has duplicate ownership links.", status=409)
    if links and not exact:
        raise MutationError("quiz_owner_mismatch", "This quiz already belongs to different curriculum content.", status=409)
    return not exact


def checked_document(document, expected):
    _check_revision(expected, document["revision"], scope="course")
    if document.get("integrity", {}).get("status") == "blocked":
        raise MutationError(
            "free_course_integrity_blocked",
            "Resolve blocking Free Course integrity issues before changing quizzes.",
            status=409,
            issues=document.get("integrity", {}).get("issues", []),
        )
    return document
