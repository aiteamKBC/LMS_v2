"""Learner/API compatibility projection of the canonical Free Course catalogue."""
from curriculum_api import free_course_catalogue


def builder_free_courses(course_ids=None, *, include_content=True):
    """Return the established API shape from canonical course identities.

    ``moduleId`` is retained as an empty compatibility field. A canonical Free
    Course has no normal-module identity, so callers must use ``freeCourseId``.
    """
    if course_ids is not None:
        course_ids = list(dict.fromkeys(str(value) for value in course_ids if value))
        if not course_ids:
            return []
    columns = [
        "id", "course_name", "week_count", "component_count", "total_otjh",
    ]
    if include_content:
        columns.extend(["description", "cover_image_url"])
    rows = free_course_catalogue.courses(course_ids=course_ids, columns=columns)
    return [
        {
            "freeCourseId": str(row.get("id") or ""),
            "moduleId": "",
            "courseName": row.get("course_name") or "",
            "description": row.get("description") or "",
            "coverImageUrl": row.get("cover_image_url") or "",
            "weekCount": row.get("week_count") or 0,
            "activityCount": row.get("component_count") or 0,
            "hours": float(row.get("total_otjh") or 0),
            "weeks": [],
        }
        for row in rows
    ]
