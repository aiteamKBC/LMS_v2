"""Read-document projection; no database, HTTP or writer dependencies."""
from ..domain.free_course_integrity import (
    _quiz_reference, _integrity_status, ownership_issues,
)
from ..domain.free_course_identity import week_api_identity
from curriculum_api.catalogue.domain.free_course_revisions import CATALOGUE_SCHEMA_VERSION
from curriculum_api.catalogue.domain.free_course_revisions import canonical_value
from curriculum_api.catalogue.domain.free_course_revisions import canonical_json_bytes
from curriculum_api.catalogue.domain.free_course_revisions import catalogue_revision
from curriculum_api.catalogue.domain.free_course_revisions import course_revision

def _public_course(row, *, include_counts=False):
    value = {
        "courseId": str(row.get("id") or ""),
        "courseName": row.get("course_name") or "",
        "description": row.get("description") or "",
        "coverImageUrl": row.get("cover_image_url") or "",
        "displayOrder": row.get("display_order"),
        "courseType": row.get("course_type") or "",
        "isForSale": bool(row.get("is_for_sale")),
        "price": canonical_value(row.get("price")),
        "currency": row.get("currency") or "",
    }
    if include_counts:
        value.update({
            "weekCount": row.get("week_count") or 0,
            "componentCount": row.get("component_count") or 0,
            "totalOtjh": canonical_value(row.get("total_otjh") or 0),
            "authoringHref": (
                "/curriculum_api/curriculum/free-courses/"
                f"{row.get('id')}/authoring/"
            ),
        })
    return value


def _catalogue_from_rows(rows):
    return {
        "schemaVersion": CATALOGUE_SCHEMA_VERSION,
        "scope": "catalogue",
        "revision": catalogue_revision(rows),
        "courses": [_public_course(row, include_counts=True) for row in rows],
    }


def _assemble_course_document(course, weeks, components, decoded, quiz_links, quizzes):
    course_id = str(course.get("id") or "")
    decoded_settings, referenced_quiz_ids, initial_issues, malformed_quiz = decoded
    quiz_by_id = {str(row.get("id") or ""): row for row in quizzes}
    links_by_quiz = {}
    for link in quiz_links:
        links_by_quiz.setdefault(str(link.get("quiz_id") or ""), []).append(link)

    issues = list(initial_issues)
    issues.extend(ownership_issues(
        course_id, weeks, components, quizzes, quiz_links, referenced_quiz_ids,
    ))

    public_components = {}
    legacy_count = 0
    for component in components:
        component_id = str(component.get("id") or "")
        quiz_id, malformed = malformed_quiz[component_id]
        quiz_reference, quiz_issues, legacy = _quiz_reference(
            component, course_id, quiz_id, malformed, quiz_by_id, links_by_quiz
        )
        issues.extend(quiz_issues)
        legacy_count += int(legacy)
        public_components.setdefault(str(component.get("free_module_id") or ""), []).append({
            "id": component_id,
            "freeCourseWeekId": str(component.get("free_module_id") or ""),
            "type": component.get("type") or "",
            "title": component.get("title") or "",
            "description": component.get("description") or "",
            "expectedOtjh": canonical_value(component.get("expected_otjh") or 0),
            "points": component.get("points") or 0,
            "reflectionRequired": bool(component.get("reflection_required")),
            "workplaceEvidenceRequired": bool(component.get("workplace_evidence_required")),
            "tutorValidationRequired": bool(component.get("tutor_validation_required")),
            "displayOrder": component.get("display_order"),
            "settings": decoded_settings[component_id],
            "quizReference": quiz_reference,
        })

    for rows in public_components.values():
        rows.sort(key=lambda row: (
            row.get("displayOrder") is None,
            row.get("displayOrder"),
            row["title"],
            row["id"],
        ))
    public_weeks = []
    for week in sorted(
        weeks,
        key=lambda row: (
            row.get("display_order") is None, row.get("display_order"),
            row.get("week_number") is None, row.get("week_number"), str(row.get("id") or ""),
        ),
    ):
        week_id = str(week.get("id") or "")
        provenance = str(week.get("legacy_copied_from_week_id") or "").strip() or None
        public_weeks.append({
            "freeCourseWeekId": week_id,
            "legacyCopiedFromWeekId": provenance,
            "weekNumber": week.get("week_number"),
            "title": week.get("title") or "",
            "summary": week.get("summary") or "",
            "learningOutcomes": week.get("learning_outcomes") or "",
            "status": week.get("status") or "",
            "holidayNoteEnabled": bool(week.get("holiday_note_enabled")),
            "holidayNote": week.get("holiday_note") or "",
            "displayOrder": week.get("display_order"),
            "components": public_components.get(week_id, []),
        })

    # Only canonical quiz ownership participates beyond the component's own
    # linkedQuizId. Legacy normal-owned quiz metadata remains diagnostic and
    # read-only, so unrelated changes there cannot stale a Free Course edit.
    canonical_quiz_ids = {
        str(link.get("quiz_id") or "")
        for link in quiz_links
        if str(link.get("free_course_id") or "") == course_id
    }
    revision_quizzes = [row for row in quizzes if str(row.get("id") or "") in canonical_quiz_ids]
    revision_links = [
        row for row in quiz_links
        if str(row.get("free_course_id") or "") == course_id
    ]
    revision = course_revision(
        course, weeks, components, revision_quizzes, revision_links
    )
    issues.sort(key=lambda issue: canonical_json_bytes(issue))
    return {
        "schemaVersion": CATALOGUE_SCHEMA_VERSION,
        "scope": "course",
        "revision": revision,
        "course": _public_course(course),
        "weeks": public_weeks,
        "integrity": {
            "status": _integrity_status(issues),
            "issues": issues,
            "legacyQuizReferenceCount": legacy_count,
        },
        "policies": {
            "expectedRevisionRequired": True,
            "componentWeekMoveAllowed": False,
            "assignedContentDeletionAllowed": True,
            "quizOwnershipEditingAllowed": False,
            "normalToFreeMode": "clone-only",
        },
    }

