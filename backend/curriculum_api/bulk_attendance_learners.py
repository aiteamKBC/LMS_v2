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
    with psycopg.connect(dsn, row_factory=dict_row, connect_timeout=10,
                          options='-c statement_timeout=10000') as connection:
        connection.read_only = True
        with connection.cursor() as cursor:
            cursor.execute('''
                SELECT "ID"::text AS id, "FullName" AS name, "Email" AS email,
                       "Program Name" AS programme, "Group" AS "group",
                       "End-Date"::text AS "endDate"
                FROM public.kbc_users_data
                WHERE "ID" IS NOT NULL
                ORDER BY lower(coalesce("FullName", '')), "ID"
            ''')
            return [
                {key: str(value or '').strip() for key, value in row.items()}
                for row in cursor.fetchall()
            ]


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
    response = JsonResponse({'learners': learners})
    response['Cache-Control'] = 'private, no-store'
    return response
