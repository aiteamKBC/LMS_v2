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


def _enrolment_statuses():
    """{Aptem id: LMS enrolment programme status}; KBC ids are Aptem ids."""
    from learner_api.models import EnrolmentUser
    from .bulk_attendance_live_policy import enrolment_status_by_aptem

    return enrolment_status_by_aptem(
        EnrolmentUser.all_learners.values_list('aptem_id', 'programme_status')
    )


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
    response = JsonResponse({'learners': with_statuses(learners, enrolment_statuses), 'warnings': warnings})
    response['Cache-Control'] = 'private, no-store'
    return response
