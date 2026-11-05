"""Read the KBC learner directory for Curriculum's bulk attendance register.

The curriculum API's session/role middleware protects this GET-only endpoint,
including requests through the batch transport. It never writes attendance.
"""
import os

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row
from django.http import JsonResponse
from django.views.decorators.http import require_GET


def learner_directory_dsn():
    direct = os.environ.get('KBC_ATTENDANCE_DATABASE_URL', '').strip()
    if direct:
        return direct
    server = os.environ.get('KBCDATABASE', '').strip()
    if not server:
        return ''
    config = conninfo_to_dict(server)
    config['dbname'] = os.environ.get('KBC_ATTENDANCE_DATABASE', 'AiTeamKBC')
    return make_conninfo(**config)


def read_learners(dsn):
    # One small directory read, not the attendance/evidence JSON on each row.
    # The KBC source sits behind Neon's pooler, which rejects startup `options`,
    # so the timeout is set per transaction instead.
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10) as connection:
        connection.read_only = True
        connection.execute("SET LOCAL statement_timeout = '10s'")
        with connection.cursor() as cursor:
            cursor.execute('''
                SELECT "ID"::text AS id, "FullName" AS name, "Email" AS email,
                       "Program Name" AS programme, "Group" AS "group",
                       "End-Date"::text AS "endDate", "Program-Status" AS "kbcStatus"
                FROM public.kbc_users_data
                WHERE "ID" IS NOT NULL
                ORDER BY lower(coalesce("FullName", '')), "ID"
            ''')
            return [
                {key: str(value or '').strip() for key, value in row.items()}
                for row in cursor.fetchall()
            ]


ENROLMENT_STATUS_WARNING = 'Enrolment statuses could not be read; showing KBC statuses.'
ENROLMENT_EMAIL_WARNING = 'LMS emails could not be read; learners are matched by their KBC email only.'
ENROLMENT_ATTENDANCE_MODE_WARNING = 'Attendance modes could not be read; showing Live Sessions.'


def _enrolment_statuses():
    """{Aptem id: LMS enrolment programme status}; KBC ids are Aptem ids."""
    from learner_api.models import EnrolmentUser
    from .bulk_attendance_live_policy import enrolment_status_by_aptem

    return enrolment_status_by_aptem(
        EnrolmentUser.all_learners.values_list('aptem_id', 'programme_status')
    )


def _enrolment_emails():
    """{Aptem id: LMS enrolment email}; KBC ids are Aptem ids."""
    from learner_api.models import EnrolmentUser

    return enrolment_email_by_aptem(EnrolmentUser.all_learners.values_list('aptem_id', 'email'))


def _enrolment_attendance_modes():
    """{Aptem id: attendance mode}; learners without a saved row are live."""
    from django.db import connections
    from learner_api.models import EnrolmentUser

    learner_links = list(EnrolmentUser.all_learners.values_list('id', 'aptem_id', 'email'))
    learner_ids = [learner_id for learner_id, _, _ in learner_links if learner_id is not None]
    if not learner_ids:
        return {}

    with connections['enrolment'].cursor() as cursor:
        cursor.execute('SELECT to_regclass(%s)', ['"Learner".attendance_preferences'])
        if cursor.fetchone()[0] is None:
            return {}
        cursor.execute(
            'SELECT learner_id, mode FROM "Learner".attendance_preferences WHERE learner_id = ANY(%s)',
            [learner_ids],
        )
        saved_by_learner = {
            str(learner_id): ('lazy' if mode == 'lazy' else 'live')
            for learner_id, mode in cursor.fetchall()
        }
    mode_pairs = [
        (learner_id, aptem_id, email, saved_by_learner.get(str(learner_id), 'live'))
        for learner_id, aptem_id, email in learner_links
    ]
    return {
        'byAptem': attendance_mode_by_aptem(
            (aptem_id, mode)
            for _, aptem_id, _, mode in mode_pairs
            if aptem_id is not None
        ),
        'byEmail': attendance_mode_by_email(
            (email, mode)
            for _, _, email, mode in mode_pairs
        ),
    }


def enrolment_email_by_aptem(pairs):
    """{aptem id: lower-cased email}. An id with more than one email is left out."""
    emails = {}
    for aptem_id, email in pairs:
        key = str(aptem_id or '').strip()
        value = str(email or '').strip().lower()
        if key and value:
            emails.setdefault(key, set()).add(value)
    return {key: next(iter(values)) for key, values in emails.items() if len(values) == 1}


def attendance_mode_by_aptem(pairs):
    """Resolve one unambiguous mode per Aptem ID; conflicts fall back to live."""
    modes = {}
    for aptem_id, mode in pairs:
        key = str(aptem_id or '').strip()
        value = 'lazy' if str(mode or '').strip().lower() == 'lazy' else 'live'
        if key:
            modes.setdefault(key, set()).add(value)
    return {key: next(iter(values)) for key, values in modes.items() if len(values) == 1}


def attendance_mode_by_email(pairs):
    """Resolve one unambiguous mode per normalized email for legacy links."""
    modes = {}
    for email, mode in pairs:
        key = str(email or '').strip().lower()
        value = 'lazy' if str(mode or '').strip().lower() == 'lazy' else 'live'
        if key:
            modes.setdefault(key, set()).add(value)
    return {key: next(iter(values)) for key, values in modes.items() if len(values) == 1}


def with_lms_emails(learners, enrolment_emails):
    """Add the LMS enrolment email when it differs from the KBC one.

    The curriculum roster lists learners by their LMS email, so a learner whose
    KBC directory email differs is still matched through the shared KBC id.
    """
    result = []
    for learner in learners:
        lms_email = enrolment_emails.get(learner['id'], '')
        if lms_email and lms_email != str(learner.get('email') or '').strip().lower():
            learner = {**learner, 'lmsEmail': lms_email}
        result.append(learner)
    return result


def with_attendance_modes(learners, attendance_modes):
    """Expose the saved learner mode beside the KBC directory row.

    Aptem is the normal key. Email is retained as a legacy fallback for rows
    whose KBC Aptem link was repaired or is not present on the enrolment row.
    """
    by_aptem = attendance_modes.get('byAptem', attendance_modes)
    by_email = attendance_modes.get('byEmail', {})
    return [
        {
            **learner,
            'attendanceMode': by_aptem.get(learner['id'])
            or by_email.get(str(learner.get('email') or '').strip().lower())
            or by_email.get(str(learner.get('lmsEmail') or '').strip().lower())
            or 'live',
        }
        for learner in learners
    ]


def with_statuses(learners, enrolment_statuses):
    """The LMS enrolment status wins; learners not enrolled keep their KBC status."""
    result = []
    for learner in learners:
        enrolment = enrolment_statuses.get(learner['id'])
        result.append({
            **learner,
            'status': enrolment or learner.get('kbcStatus', ''),
            'statusSource': 'enrolment' if enrolment else 'kbc',
        })
    return result


@require_GET
def bulk_attendance_learners(request):
    try:
        dsn = learner_directory_dsn()
        if not dsn:
            return JsonResponse({'error': 'The learner directory is not configured.'}, status=503)
        learners = read_learners(dsn)
    except psycopg.Error:
        # Driver errors can contain connection details; do not expose them.
        return JsonResponse({'error': 'Unable to load the learner directory. Please try again.'}, status=503)

    from django.db import DatabaseError

    warnings = []
    try:
        enrolment_statuses = _enrolment_statuses()
    except DatabaseError:
        enrolment_statuses = {}
        warnings.append(ENROLMENT_STATUS_WARNING)
    try:
        enrolment_emails = _enrolment_emails()
    except DatabaseError:
        # Matching then falls back to the KBC email alone, as before.
        enrolment_emails = {}
        warnings.append(ENROLMENT_EMAIL_WARNING)
    try:
        attendance_modes = _enrolment_attendance_modes()
    except DatabaseError:
        attendance_modes = {}
        warnings.append(ENROLMENT_ATTENDANCE_MODE_WARNING)
    learners = with_attendance_modes(
        with_lms_emails(with_statuses(learners, enrolment_statuses), enrolment_emails),
        attendance_modes,
    )
    response = JsonResponse({'learners': learners, 'warnings': warnings})
    response['Cache-Control'] = 'private, no-store'
    return response
