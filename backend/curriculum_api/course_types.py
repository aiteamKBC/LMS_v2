"""Catalogue course categories; independent of programme/learner classification."""

COURSE_TYPES = frozenset(('free', 'apprentices'))


class CourseTypeError(ValueError):
    pass


def normalise_course_type(value):
    value = str(value or '').strip().lower()
    if value not in COURSE_TYPES:
        raise CourseTypeError('Course type must be Free or Apprentices.')
    return value


def course_types_for_modules(modules, existing_types):
    """Validate the complete replacement before writes; legacy clients retain type."""
    result, courses = {}, {}
    for index, module in enumerate(modules):
        if not isinstance(module, dict):
            continue
        course_id = str(module.get('courseId') or module.get('course_id') or '').strip()
        value = module.get('courseType', existing_types.get(course_id, 'free'))
        course_type = normalise_course_type(value)
        if course_id and course_id in courses and courses[course_id] != course_type:
            raise CourseTypeError('All weeks in a course must have the same course type.')
        if course_id:
            courses[course_id] = course_type
        result[index] = course_type
    return result
