"""Assign verified historical ledger attribution without changing progress/hours.

No enrollment or deletion filter applies to attribution. Public completion and
attempt APIs retain their own eligibility checks and do not create ledger hours.
This internal service requires the caller's already-authorized learner identity.
"""
from django.db import connections, transaction


def assign_identity(learner_id, progress_id, course_id, component_id):
    """Set an empty identity or accept an identical retry; never overwrite one.

    Catalogue SHARE locks prevent reparenting during validation and persistence.
    Future catalogue writers must separately reject moves that would invalidate
    existing ledger attribution; individual FKs cannot enforce that whole chain.
    Returns True for a new assignment, False for an unchanged retry.
    """
    if any(not isinstance(value, str) or not value.strip() or len(value) > 128
           for value in (course_id, component_id)):
        raise ValueError('Both Free Course identity references are required.')
    with transaction.atomic(using='enrolment'), connections['enrolment'].cursor() as cursor:
        cursor.execute('''LOCK TABLE curriculum.free_courses,curriculum.free_course_weeks,
            curriculum.free_programme_components IN SHARE MODE''')
        cursor.execute('''SELECT free_course_ref,free_component_ref,
            kbc_attendance_key IS NOT NULL OR
                coalesce(source_payload->>'original_source_ref','') LIKE 'att:%%'
            FROM "Learner".learner_progress_entries
            WHERE id=%s AND learner_id=%s FOR UPDATE''', [progress_id, learner_id])
        row = cursor.fetchone()
        if row is None:
            raise LookupError('Progress entry does not belong to this learner.')
        existing, attendance_linked = row[:2], row[2]
        cursor.execute('''SELECT c.id FROM curriculum.free_programme_components c
            JOIN curriculum.free_course_weeks w ON w.id=c.free_module_id
            JOIN curriculum.free_courses f ON f.id=w.course_id
            WHERE c.id=%s AND f.id=%s''', [component_id, course_id])
        if cursor.fetchone() is None:
            raise ValueError('Component does not belong to the specified Free Course.')
        if existing != (None, None):
            if existing != (course_id, component_id):
                raise ValueError('Progress entry already has a different Free Course identity.')
            return False
        if attendance_linked:
            # Its BEFORE trigger can derive a watched attendance key. Attribution
            # must not cause that repair or a cache invalidation as a side effect.
            raise ValueError('Attendance-linked progress requires separate identity review.')
        # Deliberately bypass model save hooks: only these two un-watched columns
        # change. No timestamps, cache versions, payloads or totals are rewritten.
        cursor.execute('''UPDATE "Learner".learner_progress_entries
            SET free_course_ref=%s,free_component_ref=%s
            WHERE id=%s AND learner_id=%s''', [course_id, component_id, progress_id, learner_id])
        return True
