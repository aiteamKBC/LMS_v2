"""Prepare independent module/free-course content copies without saving them."""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def build_free_course_week_structure(source_rows, *, clean_str=_default_clean_str, parse_int=_default_parse_int):
    """Map one free course's week-rows into a module ``weekStructure``.

    One free week -> one module week, one free component -> one normal component.
    ``settings`` is carried verbatim so a linked quiz / media / manualUnlock
    survives; KSB mappings start empty and hours carry the free component's own
    value -- the author adds the apprentice-specific KSBs/hours afterwards. No
    free ids are carried, so fresh WEEK-/COMP- ids mint and the copy is fully
    independent of the free-course rows.
    """
    ordered = sorted(
        source_rows,
        key=lambda row: (parse_int(row.get('displayOrder'), 0), parse_int(row.get('weekNumber'), 0)),
    )
    week_structure = []
    for index, week in enumerate(ordered):
        components = []
        for component in week.get('components') or []:
            components.append({
                'type': component.get('type'),
                'title': component.get('title') or '',
                'description': component.get('description') or '',
                'expectedOtjh': component.get('expectedOtjh'),
                'points': component.get('points'),
                'reflectionRequired': component.get('reflectionRequired'),
                'tutorValidationRequired': component.get('tutorValidationRequired'),
                'ksbMappings': [],
                'settings': component.get('settings') if isinstance(component.get('settings'), dict) else {},
            })
        week_structure.append({
            'weekNumber': parse_int(week.get('weekNumber'), index + 1),
            'title': clean_str(week.get('weekTitle')) or f'Week {index + 1}',
            'summary': '',
            'components': components,
            'ksbMappings': [],
        })
    return week_structure


def build_module_free_course_weeks(
    structure,
    course_id,
    *,
    clean_str=_default_clean_str,
    parse_int=_default_parse_int,
):
    """Inverse of build_free_course_week_structure: a module's authored
    weekStructure -> free-course ``modules[]`` week entries, all sharing one
    ``course_id`` so they group into a single free course. Component ``settings``
    (linked quiz / media / manualUnlock) copy verbatim; KSB mappings and hours
    are not carried (free courses have neither). No week/component ids are set,
    so fresh FREEWEEK-/FREECOMP- ids mint on save.
    """
    course_id = clean_str(course_id)
    course_title = clean_str(structure.get('title')) or 'Untitled course'
    description = clean_str(structure.get('description'))
    cover = clean_str(structure.get('coverImage'))
    weeks = []
    for index, week in enumerate(structure.get('weekStructure') or []):
        components = []
        for component in week.get('components') or []:
            components.append({
                'type': component.get('type'),
                'title': component.get('title') or '',
                'description': component.get('description') or '',
                'expectedOtjh': component.get('expectedOtjh'),
                'points': component.get('points'),
                'reflectionRequired': component.get('reflectionRequired'),
                'workplaceEvidenceRequired': component.get('workplaceEvidenceRequired'),
                'tutorValidationRequired': component.get('tutorValidationRequired'),
                'settings': component.get('settings') if isinstance(component.get('settings'), dict) else {},
            })
        weeks.append({
            'courseId': course_id,
            'courseName': course_title,
            'description': description,
            'coverImageUrl': cover,
            'weekNumber': parse_int(week.get('weekNumber'), index + 1),
            'weekTitle': clean_str(week.get('title')) or f'Week {index + 1}',
            'components': components,
        })
    return weeks


def _free_module_response_to_input(
    module,
):
    """Map one get_free_programme_modules_payload output row back to the
    save-input shape, so existing free courses can be re-sent unchanged through
    the full-replace save (mirrors the frontend savedModuleInput)."""
    course_name = module.get('courseName') or module.get('title') or ''
    return {
        'id': module.get('id'),
        'courseId': module.get('courseId'),
        'weekId': module.get('weekId'),
        'weekNumber': module.get('weekNumber'),
        'weekTitle': module.get('weekTitle'),
        'courseName': course_name,
        'title': course_name,
        'description': module.get('description') or '',
        'coverImageUrl': module.get('coverImageUrl') or '',
        'components': [
            {
                'id': component.get('id'),
                'weekId': component.get('weekId'),
                'displayOrder': component.get('displayOrder'),
                'type': component.get('type'),
                'title': component.get('title'),
                'description': component.get('description'),
                'expectedOtjh': component.get('expectedOtjh'),
                'points': component.get('points'),
                'reflectionRequired': component.get('reflectionRequired'),
                'workplaceEvidenceRequired': component.get('workplaceEvidenceRequired'),
                'tutorValidationRequired': component.get('tutorValidationRequired'),
                'settings': component.get('settings') if isinstance(component.get('settings'), dict) else {},
            }
            for component in module.get('components') or []
        ],
    }
