"""Write the learner-only register while preserving each attendance source."""


REGISTER_TABLE = 'curriculum.live_session_learner_attendance'


def _basis(row):
    value = str(row.get('attendance_basis') or 'teams').strip().lower()
    return value if value in {'teams', 'qr', 'teams_qr', 'staff'} else 'teams'


def load_qr_evidence(cursor, rows):
    """Return exact QR evidence keyed by learner profile, occurrence and delivery.

    The enrolment and learner-profile primary keys are different. Only a unique
    ``Learner.learners.enrolment_id`` bridge may make QR evidence authoritative.
    """

    profile_ids = sorted({int(row['learner_profile_id']) for row in rows if row.get('learner_profile_id')})
    occurrence_ids = sorted({str(row['occurrence_id']) for row in rows if row.get('occurrence_id')})
    module_ids = sorted({str(row['module_catalogue_id']) for row in rows if row.get('module_catalogue_id')})
    if not (profile_ids and occurrence_ids and module_ids):
        return {}
    cursor.execute('''SELECT q.id,p.id,q.occurrence_id,q.module_id,q.confirmed_at
        FROM curriculum.qr_attendance q
        JOIN "Learner".learners p ON p.enrolment_id=q.enrolment_id
        WHERE p.id=ANY(%s) AND q.occurrence_id=ANY(%s) AND q.module_id=ANY(%s)
          AND NOT EXISTS (
              SELECT 1 FROM "Learner".learners duplicate
              WHERE duplicate.enrolment_id=p.enrolment_id AND duplicate.id<>p.id
          )''', [profile_ids, occurrence_ids, module_ids])
    return {
        (int(profile_id), str(occurrence_id), str(module_id)): {
            'id': qr_id, 'confirmed_at': confirmed_at,
        }
        for qr_id, profile_id, occurrence_id, module_id, confirmed_at in cursor.fetchall()
    }


def merge_qr_evidence(rows, evidence):
    """Apply ``Teams present OR QR confirmed`` without fabricating Teams time."""

    merged = []
    for source in rows:
        row = dict(source)
        basis = _basis(row)
        raw_status = str(row.get('attendance_status') or '').strip().lower()
        qr = evidence.get((
            int(row['learner_profile_id']), str(row['occurrence_id']),
            str(row['module_catalogue_id']),
        ))
        if basis == 'staff':
            row['teams_attendance_status'] = row.get('teams_attendance_status')
        else:
            row['teams_attendance_status'] = raw_status
            if qr:
                row['attendance_status'] = 'present'
                row['attendance_basis'] = 'teams_qr' if raw_status == 'present' else 'qr'
                row['qr_attendance_id'] = qr['id']
                row['qr_confirmed_at'] = qr['confirmed_at']
            else:
                row['attendance_basis'] = 'teams'
        row.setdefault('attendance_source_occurrence_id', row['occurrence_id'])
        merged.append(row)
    return merged


def register_params(row):
    """Return the stable register values for one delivery learner."""

    basis = _basis(row)
    teams_status = row.get('teams_attendance_status')
    if teams_status not in {'present', 'absent'}:
        teams_status = None
    return (
        row['occurrence_id'],
        row['live_session_id'],
        row['module_catalogue_id'],
        row['learner_profile_id'],
        str(row.get('learner_email') or '').strip().casefold(),
        str(row.get('learner_name') or '').strip(),
        row['attendance_status'],
        str(row.get('recovery_status') or 'none').strip(),
        max(0, int(row.get('attended_seconds') or 0)),
        str(row.get('attendance_report_id') or '').strip(),
        row.get('first_join_at'),
        row.get('last_leave_at'),
        row['calculated_at'],
        basis,
        teams_status,
        str(row.get('attendance_source_occurrence_id') or row['occurrence_id']),
        row.get('qr_attendance_id'),
        row.get('qr_confirmed_at'),
    )


def upsert_live_session_register(cursor, rows):
    """Publish final results after merging exact QR evidence in one transaction."""

    if not rows:
        return 0
    params = [register_params(row) for row in merge_qr_evidence(rows, load_qr_evidence(cursor, rows))]
    cursor.executemany(
        f'''INSERT INTO {REGISTER_TABLE} AS current_register (
            occurrence_id, live_session_id, module_catalogue_id,
            learner_profile_id, learner_email, learner_name,
            attendance_status, recovery_status, attended_seconds, attendance_report_id,
            first_join_at, last_leave_at, calculated_at,
            attendance_basis, teams_attendance_status, attendance_source_occurrence_id,
            qr_attendance_id, qr_confirmed_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ON CONSTRAINT curriculum_live_learner_attendance_uniq DO UPDATE SET
            live_session_id = EXCLUDED.live_session_id,
            learner_email = EXCLUDED.learner_email,
            learner_name = EXCLUDED.learner_name,
            attendance_status = CASE
                WHEN EXCLUDED.attendance_basis='staff' THEN EXCLUDED.attendance_status
                WHEN current_register.attendance_basis='staff'
                    THEN current_register.attendance_status
                WHEN current_register.parallel_source_occurrence_id IS NOT NULL
                    THEN 'present'
                WHEN current_register.qr_attendance_id IS NOT NULL
                     AND EXCLUDED.qr_attendance_id IS NULL
                    THEN current_register.attendance_status
                ELSE EXCLUDED.attendance_status END,
            recovery_status = EXCLUDED.recovery_status,
            attended_seconds = EXCLUDED.attended_seconds,
            attendance_report_id = EXCLUDED.attendance_report_id,
            first_join_at = EXCLUDED.first_join_at,
            last_leave_at = EXCLUDED.last_leave_at,
            calculated_at = EXCLUDED.calculated_at,
            attendance_basis = CASE
                WHEN EXCLUDED.attendance_basis='staff' THEN 'staff'
                WHEN current_register.attendance_basis='staff' THEN 'staff'
                WHEN current_register.parallel_source_occurrence_id IS NOT NULL
                     AND EXCLUDED.attendance_status='absent' THEN 'parallel'
                WHEN current_register.qr_attendance_id IS NOT NULL
                     AND EXCLUDED.qr_attendance_id IS NULL
                    THEN current_register.attendance_basis
                ELSE EXCLUDED.attendance_basis END,
            teams_attendance_status = coalesce(
                EXCLUDED.teams_attendance_status,
                current_register.teams_attendance_status
            ),
            attendance_source_occurrence_id = EXCLUDED.attendance_source_occurrence_id,
            qr_attendance_id = coalesce(EXCLUDED.qr_attendance_id, current_register.qr_attendance_id),
            qr_confirmed_at = coalesce(EXCLUDED.qr_confirmed_at, current_register.qr_confirmed_at),
            updated_at = CURRENT_TIMESTAMP''',
        params,
    )
    return len(params)


def upsert_qr_attendance_register(cursor, row):
    """Make one QR confirmation present without erasing saved Teams evidence."""

    params = register_params({
        **row,
        'attendance_status': 'present',
        'attendance_basis': 'qr',
        'teams_attendance_status': None,
        'attendance_source_occurrence_id': row['occurrence_id'],
    })
    cursor.execute(
        f'''INSERT INTO {REGISTER_TABLE} AS current_register (
            occurrence_id, live_session_id, module_catalogue_id,
            learner_profile_id, learner_email, learner_name,
            attendance_status, recovery_status, attended_seconds, attendance_report_id,
            first_join_at, last_leave_at, calculated_at,
            attendance_basis, teams_attendance_status, attendance_source_occurrence_id,
            qr_attendance_id, qr_confirmed_at
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT ON CONSTRAINT curriculum_live_learner_attendance_uniq DO UPDATE SET
            learner_email = EXCLUDED.learner_email,
            learner_name = EXCLUDED.learner_name,
            attendance_status = CASE
                WHEN current_register.attendance_basis='staff'
                    THEN current_register.attendance_status
                ELSE 'present' END,
            attendance_basis = CASE
                WHEN current_register.attendance_basis='staff' THEN 'staff'
                WHEN current_register.teams_attendance_status='present' THEN 'teams_qr'
                ELSE 'qr' END,
            attendance_source_occurrence_id = EXCLUDED.attendance_source_occurrence_id,
            qr_attendance_id = EXCLUDED.qr_attendance_id,
            qr_confirmed_at = EXCLUDED.qr_confirmed_at,
            calculated_at = EXCLUDED.calculated_at,
            updated_at = CURRENT_TIMESTAMP''',
        params,
    )
    return 1
