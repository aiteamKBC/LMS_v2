"""QR evidence storage and final learner-register publication."""
from types import SimpleNamespace

from django.db import connection, transaction


def rows(sql, params=()):
    with connection.cursor() as cursor:
        cursor.execute(sql, params)
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def students(email):
    return [SimpleNamespace(**row) for row in rows('''
        SELECT id, id AS pk, "Programme" AS programme, "Group" AS "group", "Cohort" AS cohort,
               "Learning_plan" AS learning_plan, "Training_plan" AS training_plan
        FROM enrolment."Created_users" WHERE lower(trim("Email")) = %s LIMIT 2
    ''', [email])]


def placements(enrolment_id):
    return rows('''SELECT programme_id, group_id, cohort_id
                  FROM "Learner".learners WHERE enrolment_id = %s''', [enrolment_id])


def programmes():
    return rows('''SELECT programme_id AS id, name FROM curriculum.programmes
                  WHERE deleted_at IS NULL''')


def modules():
    # Explicit placement IDs are the association. Names never grant access.
    # Joining both cohort paths lets the policy detect inconsistent ancestry.
    return rows('''
        SELECT m.module_catalogue_id AS id, m.title, m.programme_id, m.start_date, m.end_date,
               g.group_id, coalesce(c.cohort_id, gc.cohort_id) AS cohort_id,
               g.group_name, coalesce(c.cohort_name, gc.cohort_name) AS cohort_name,
               g.programme_id AS group_programme_id, gc.cohort_id AS group_cohort_id,
               c.programme_id AS cohort_programme_id,
               gc.programme_id AS group_cohort_programme_id,
               m.teams_shared_source_module_id AS shared_source,
               sh.source_module_catalogue_id AS share_relation,
               m.learner_roster_mode,
               (m.deleted_at IS NOT NULL OR m.is_programme_deleted
                OR g.deleted_at IS NOT NULL OR coalesce(g.is_programme_deleted, false)
                OR c.deleted_at IS NOT NULL OR coalesce(c.is_programme_deleted, false)
                OR gc.deleted_at IS NOT NULL OR coalesce(gc.is_programme_deleted, false)) AS deleted
        FROM curriculum.modules m
        LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
        LEFT JOIN curriculum.cohorts c ON c.cohort_id=m.cohort_id
        LEFT JOIN curriculum.cohorts gc ON gc.cohort_id=g.cohort_id
        LEFT JOIN curriculum.module_teams_shares sh ON sh.module_catalogue_id=m.module_catalogue_id
    ''')


def groups():
    return rows('''SELECT group_id AS id, programme_id, cohort_id, group_name, module_ids
                  FROM curriculum.groups WHERE deleted_at IS NULL AND NOT is_programme_deleted''')


def cohorts():
    return rows('''SELECT cohort_id AS id, programme_id, cohort_name
                  FROM curriculum.cohorts WHERE deleted_at IS NULL AND NOT is_programme_deleted''')


def occurrences(module_ids):
    if not module_ids:
        return []
    placeholders = ','.join(['%s'] * len(module_ids))
    return rows(f'''SELECT o.id, o.live_session_id, o.session_number,
                          o.scheduled_start, o.scheduled_end, o.status,
                          s.status AS series_status, s.module_catalogue_id AS source_module_id
                   FROM curriculum.live_session_occurrences o
                   JOIN curriculum.live_sessions s ON s.id=o.live_session_id
                   WHERE s.module_catalogue_id IN ({placeholders})
                   ORDER BY o.scheduled_start, o.id''', list(module_ids))


def occurrences_between(module_ids, start, end):
    """Read only a business day's occurrences for eligible source modules."""
    if not module_ids:
        return []
    placeholders = ','.join(['%s'] * len(module_ids))
    return rows(f'''SELECT o.id, o.live_session_id, o.session_number,
                          o.scheduled_start, o.scheduled_end, o.status,
                          s.status AS series_status, s.module_catalogue_id AS source_module_id
                   FROM curriculum.live_session_occurrences o
                   JOIN curriculum.live_sessions s ON s.id=o.live_session_id
                   WHERE s.module_catalogue_id IN ({placeholders})
                     AND o.scheduled_start >= %s AND o.scheduled_start < %s
                   ORDER BY o.scheduled_start, o.id''', [*module_ids, start, end])


def lecture_components(module_ids):
    """Read authored titles and saved identities only; never provision or sync."""
    if not module_ids:
        return []
    placeholders = ','.join(['%s'] * len(module_ids))
    return rows(f'''SELECT c.id, c.module_catalogue_id, c.title, c.settings_json
                   FROM curriculum.components c
                   JOIN curriculum.weeks w ON w.id=c.week_id
                        AND w.module_catalogue_id=c.module_catalogue_id
                   WHERE c.module_catalogue_id IN ({placeholders})
                     AND c.type IN ('live_session', 'live-session')
                     AND c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted, false)
                     AND w.deleted_at IS NULL AND NOT coalesce(w.is_programme_deleted, false)
                     AND coalesce(c.library_state, '') <> 'library'
                     AND coalesce(w.library_state, '') <> 'library'
                   ORDER BY c.id''', list(module_ids))


INSERT_SQL = '''INSERT INTO curriculum.qr_attendance
    (enrolment_id, programme_id, module_id, occurrence_id,
     assigned_group_id, attended_group_id, assigned_cohort_id, attended_cohort_id)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (enrolment_id, occurrence_id) DO NOTHING
    RETURNING confirmed_at'''


def insert_evidence(cursor, values):
    """The unique constraint serializes concurrent retries, including shared aliases."""
    cursor.execute(INSERT_SQL, values)
    inserted = cursor.fetchone()
    if inserted:
        return True, inserted[0]
    cursor.execute('''SELECT confirmed_at FROM curriculum.qr_attendance
                      WHERE enrolment_id=%s AND occurrence_id=%s''', [values[0], values[3]])
    existing = cursor.fetchone()
    if not existing:
        raise RuntimeError('QR evidence disappeared during confirmation')
    return False, existing[0]


def register_row(cursor, enrolment_id, module_id, occurrence_id):
    """Resolve one stable learner profile and the selected delivery occurrence."""

    cursor.execute('''SELECT id,email,full_name FROM "Learner".learners
                      WHERE enrolment_id=%s ORDER BY id LIMIT 2''', [enrolment_id])
    profiles = cursor.fetchall()
    if len(profiles) != 1:
        return None
    cursor.execute('''SELECT o.live_session_id
                      FROM curriculum.live_session_occurrences o
                      JOIN curriculum.live_sessions s ON s.id=o.live_session_id
                      WHERE o.id=%s''', [occurrence_id])
    occurrence = cursor.fetchone()
    if not occurrence:
        return None
    cursor.execute('''SELECT id,confirmed_at FROM curriculum.qr_attendance
                      WHERE enrolment_id=%s AND occurrence_id=%s''', [enrolment_id, occurrence_id])
    qr = cursor.fetchone()
    if not qr:
        return None
    profile_id, learner_email, learner_name = profiles[0]
    return {
        'occurrence_id': occurrence_id,
        'live_session_id': occurrence[0],
        'module_catalogue_id': module_id,
        'learner_profile_id': profile_id,
        'learner_email': learner_email,
        'learner_name': learner_name,
        'recovery_status': 'none',
        'attended_seconds': 0,
        'attendance_report_id': '',
        'first_join_at': None,
        'last_leave_at': None,
        'calculated_at': qr[1],
        'qr_attendance_id': qr[0],
        'qr_confirmed_at': qr[1],
    }


def confirm(email, module_id, occurrence_id):
    # Re-resolve every submitted identity inside the transaction. No client
    # programme/group/cohort field is used.
    from .qr_attendance import context, lecture_options, AttendanceError
    from .live_session_register import upsert_qr_attendance_register
    with transaction.atomic():
        student, programme_id, placement, catalog, eligible = context(email)
        if module_id not in eligible:
            raise AttendanceError('Choose a module in your programme.', 'invalid_module', 400)
        lectures = lecture_options(module_id, catalog, eligible)
        lecture = next((item for item in lectures if item['id'] == occurrence_id), None)
        if lecture is None:
            raise AttendanceError('This lecture is no longer available. Please choose another.', 'invalid_lecture', 400)
        if not lecture['dueToday']:
            raise AttendanceError('Attendance can only be confirmed on the lecture date in college time.',
                                  'outside_attendance_day', 400)
        # Preserve the selected delivery placement, even when its meeting is
        # hosted by a module in another programme. Never reassign the student.
        selected = eligible[module_id]
        with connection.cursor() as cursor:
            result = insert_evidence(cursor, [student.id, programme_id, module_id, occurrence_id,
                placement['group_id'], selected.get('group_id') or None,
                placement['cohort_id'], selected.get('cohort_id') or selected.get('group_cohort_id') or None])
            final_row = register_row(cursor, student.id, module_id, occurrence_id)
            if final_row is None:
                raise AttendanceError(
                    'Your learner attendance profile could not be matched. Nothing was recorded.',
                    'attendance_profile_unavailable', 409,
                )
            upsert_qr_attendance_register(cursor, final_row)
            return result
