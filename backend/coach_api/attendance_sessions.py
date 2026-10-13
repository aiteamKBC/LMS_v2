"""Resolve imported attendance groups through canonical saved module assignments."""
from django.db import connections

from learner_api.attendance_lectures import ATTENDANCE_SUBJECTS_SQL


def assigned_module_ids(profiles):
    # Profiles must already be narrowed by the server's programme/group caseload
    # checks. Reuse the register's JSON + normalized-plan union in one bulk read.
    source_ids = list({source.id for profile in profiles
                       if (source := getattr(profile, '_caseload_source', None)) is not None})
    if not source_ids:
        return []
    sql = ATTENDANCE_SUBJECTS_SQL.replace('WHERE id=%s', 'WHERE id=ANY(%s)')
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(sql, [source_ids])
        return [str(row[0]) for row in cursor.fetchall()]


def assigned_modules_by_source(profiles):
    """The canonical JSON/mirror union, retaining identity for recent evidence."""
    source_ids = list({source.id for profile in profiles
                       if (source := getattr(profile, '_caseload_source', None)) is not None})
    if not source_ids:
        return {}
    sql = ATTENDANCE_SUBJECTS_SQL.replace('WHERE id=%s', 'WHERE id=ANY(%s)').replace(
        "SELECT entry->>'moduleId' AS module_id", "SELECT source.id, entry->>'moduleId' AS module_id").replace(
        'SELECT coalesce(m.curriculum_module_id', 'SELECT source.id, coalesce(m.curriculum_module_id').replace(
        'SELECT DISTINCT cm.module_catalogue_id,cm.title', 'SELECT DISTINCT assigned.id,cm.module_catalogue_id')
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(sql, [source_ids])
        result = {}
        for source_id, module_id in cursor.fetchall():
            result.setdefault(source_id, []).append(str(module_id))
        return result
