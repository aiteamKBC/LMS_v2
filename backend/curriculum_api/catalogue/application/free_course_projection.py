"""Application free course projection. Explicit read capabilities preserve legacy contracts."""

from curriculum_api.catalogue.domain.component_types import is_retired_component_type as _default_is_retired_component_type
from curriculum_api.catalogue.domain.content_validation import frontend_component_type as _default_frontend_component_type
from curriculum_api.catalogue.domain.values import as_json_value as _default_as_json_value
from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_float as _default_parse_float
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def free_programme_component_response(
    row,
    week=None,
    *,
    as_json_value=_default_as_json_value,
    frontend_component_type=_default_frontend_component_type,
    parse_float=_default_parse_float,
    parse_int=_default_parse_int,
):
    """Return a component with canonical and compatibility week identities.

    ``freeCourseWeekId`` owns the relationship. ``weekId`` is retained only as
    the optional legacy source-week provenance expected by older consumers.
    """
    week = week or {}
    # Canonical rows do not contain ``week_id``.  The fallback exists only for
    # old import/export payloads that explicitly carried the source week.
    provenance = (week.get('legacy_copied_from_week_id')
                  or row.get('legacy_copied_from_week_id')
                  or row.get('week_id')
                  or '')
    return {
        'id': row.get('id'),
        'moduleId': row.get('free_module_id'),
        'freeCourseWeekId': row.get('free_module_id') or '',
        'weekId': provenance,
        'legacyCopiedFromWeekId': provenance or None,
        'type': frontend_component_type(row.get('type')),
        'title': row.get('title') or '',
        'description': row.get('description') or '',
        'expectedOtjh': parse_float(row.get('expected_otjh'), 0),
        'points': parse_int(row.get('points'), 0),
        'reflectionRequired': bool(row.get('reflection_required')),
        'workplaceEvidenceRequired': bool(row.get('workplace_evidence_required')),
        'tutorValidationRequired': bool(row.get('tutor_validation_required')),
        'displayOrder': parse_int(row.get('display_order'), 0),
        'settings': as_json_value(row.get('settings_json'), {}),
    }


def free_programme_module_response(
    row,
    components,
    course=None,
    *,
    as_json_value=_default_as_json_value,
    clean_str=_default_clean_str,
    free_course_catalogue,
    free_programme_component_response=free_programme_component_response,
    is_retired_component_type=_default_is_retired_component_type,
    parse_float=_default_parse_float,
    parse_int=_default_parse_int,
    pricing_payload,
):
    """Return one canonical Free Course week without joining normal weeks.

    ``id`` and ``freeCourseWeekId`` identify the Free Course week. ``weekId``
    remains a backwards-compatible provenance alias and may be empty.
    """
    module_id = row.get('id')
    course = course or {}
    identity = free_course_catalogue.week_api_identity(row)
    # Old import/export payloads used ``week_id`` for the same provenance role.
    if not identity['weekId'] and row.get('week_id'):
        identity['weekId'] = row.get('week_id')
        identity['legacyCopiedFromWeekId'] = row.get('week_id')
    module_components = [
        free_programme_component_response(component, row)
        for component in components
        if clean_str(component.get('free_module_id')) == clean_str(module_id)
        and not is_retired_component_type(component.get('type'))
    ]
    return {
        'id': module_id,
        'courseId': row.get('course_id') or course.get('id') or module_id,
        **identity,
        'weekNumber': parse_int(row.get('week_number'), 1),
        'weekTitle': row.get('title') or row.get('week_title') or '',
        'weekSummary': row.get('summary') or '',
        'summary': row.get('summary') or '',
        'status': row.get('status') or '',
        'learningOutcomes': as_json_value(row.get('learning_outcomes'), []),
        'holidayNoteEnabled': bool(row.get('holiday_note_enabled')),
        'holidayNote': row.get('holiday_note') or '',
        'courseName': course.get('course_name') or row.get('course_name') or '',
        'title': course.get('course_name') or row.get('course_name') or '',
        'description': course.get('description') if course.get('description') is not None else row.get('description') or '',
        'coverImageUrl': course.get('cover_image_url') if course.get('cover_image_url') is not None else row.get('cover_image_url') or '',
        'weekBuilderWeekIds': as_json_value(course.get('week_builder_week_ids'), []),
        # The course's own sale metadata (curriculum.free_courses owns it).
        **pricing_payload(course),
        'displayOrder': parse_int(row.get('display_order'), 0),
        'componentCount': len(module_components),
        'totalOtjh': parse_float(row.get('total_otjh'), 0),
        'components': module_components,
    }
