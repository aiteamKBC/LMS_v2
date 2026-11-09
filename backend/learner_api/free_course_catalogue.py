"""Read the standalone catalogue while retaining the normal module identity."""
from django.db import connection


def builder_free_courses(module_ids=None, *, include_content=True):
    """Staff may list the catalogue; learner callers must supply owned module ids.

    No provisioning or migration runs on this read. Converted and archived
    courses continue to have historical rows, but are not standalone offers.
    """
    if module_ids is not None:
        module_ids = list(dict.fromkeys(module_ids))
        if not module_ids:
            return []
    content_columns = 'f.description, f.cover_image_url' if include_content else "'', ''"
    query = f"""SELECT f.id, f.module_catalogue_id, f.course_name, {content_columns},
        f.week_count, f.component_count, m.total_otjh
        FROM curriculum.free_courses f
        JOIN curriculum.modules m ON m.module_catalogue_id = f.module_catalogue_id
        WHERE f.managed_by_builder = true AND f.converted_at IS NULL
          AND f.deleted_at IS NULL AND m.deleted_at IS NULL
          AND m.source_type = 'free_course' AND NOT m.is_programme_deleted
    """
    params = []
    if module_ids is not None:
        query += ' AND f.module_catalogue_id = ANY(%s)'
        params.append(module_ids)
    query += ' ORDER BY f.display_order, f.course_name, f.id'
    with connection.cursor() as cursor:
        cursor.execute(query, params)
        return [dict(
            freeCourseId=course_id, moduleId=module_id, courseName=name or '',
            description=description or '', coverImageUrl=cover or '',
            weekCount=weeks or 0, activityCount=components or 0,
            hours=float(hours or 0), weeks=[],
        ) for course_id, module_id, name, description, cover, weeks, components, hours in cursor.fetchall()]
