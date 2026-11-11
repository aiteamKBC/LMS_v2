"""Stable schema for migration 0080; PostgreSQL is the application database.

The bridge is additive. Original free-course IDs (including completion refs)
and the already adopted module/week/component IDs all remain unchanged.
"""
from pathlib import Path
from hashlib import sha256


def provision(connection):
    if connection.vendor != 'postgresql':
        return
    with connection.cursor() as cursor:
        cursor.execute((Path(__file__).with_name('free_course_storage.sql')).read_text(encoding='utf-8'))
        cursor.execute('SELECT id FROM curriculum.free_courses WHERE module_catalogue_id IS NULL')
        for (course_id,) in cursor.fetchall():
            digest = sha256(f'{course_id}\0{course_id}'.encode()).hexdigest()[:32].upper()
            ident = f'MOD-FREE-{digest}'
            cursor.execute('''UPDATE curriculum.free_courses SET module_catalogue_id = %s
                              WHERE id = %s AND EXISTS (
                                  SELECT 1 FROM curriculum.modules WHERE module_catalogue_id = %s
                                  AND source_id = %s AND source_type IN ('free_course', 'module_authoring'))''',
                           [ident, course_id, ident, course_id])
        # Link old week rows before projecting their current authored values.
        # The ideal branch changed link IDs; never use them to remap an already
        # adopted course's weeks.
        cursor.execute('''SELECT w.id, w.course_id FROM curriculum.free_course_weeks w
                          WHERE w.authoring_week_id IS NULL''')
        for ident, course_id in cursor.fetchall():
            digest = sha256(f'{course_id}\0{ident}'.encode()).hexdigest()[:32].upper()
            cursor.execute('''UPDATE curriculum.free_course_weeks SET authoring_week_id = %s
                              WHERE id = %s AND EXISTS (SELECT 1 FROM curriculum.weeks WHERE id = %s)''',
                           [f'WEEK-FREE-{digest}', ident, f'WEEK-FREE-{digest}'])
        cursor.execute('''SELECT curriculum.refresh_free_course(m) FROM curriculum.modules m
                          WHERE m.source_type = 'free_course'
                          OR EXISTS (SELECT 1 FROM curriculum.free_courses f WHERE f.module_catalogue_id = m.module_catalogue_id)''')
        cursor.execute('''SELECT curriculum.refresh_free_course_week(w) FROM curriculum.weeks w
                          JOIN curriculum.free_courses f ON f.module_catalogue_id = w.module_catalogue_id''')
        cursor.execute('''SELECT curriculum.refresh_free_course_component(c) FROM curriculum.components c
                          JOIN curriculum.free_courses f ON f.module_catalogue_id = c.module_catalogue_id''')
