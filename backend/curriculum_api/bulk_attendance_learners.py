"""Read learner profiles for Curriculum's bulk attendance register.

The curriculum API's session/role middleware protects this GET-only endpoint.
Attendance history keeps its separate KBC/live sources and record keys.
"""
import os

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from django.db import DatabaseError
from django.http import JsonResponse
from django.views.decorators.http import require_GET


def learner_directory_dsn():
    # Retained for legacy KBC attendance history and its identity bridge.
    direct = os.environ.get('KBC_ATTENDANCE_DATABASE_URL', '').strip()
    if direct:
        return direct
    server = os.environ.get('KBCDATABASE', '').strip()
    if not server:
        return ''
    config = conninfo_to_dict(server)
    config['dbname'] = os.environ.get('KBC_ATTENDANCE_DATABASE', 'AiTeamKBC')
    return make_conninfo(**config)


LMS_LEARNERS_SQL = '''
    SELECT CAST(l.aptem_id AS text) AS id, CAST(l.id AS text) AS "profileId",
           l.full_name AS name, l.email AS email,
           coalesce(p.name, '') AS programme, coalesce(g.group_name, '') AS "group",
           l.programme_id AS "programmeId", l.cohort_id AS "cohortId", l.group_id AS "groupId",
           CAST(coalesce(l.end_date, l.learner_end_date) AS text) AS "endDate",
           l.programme_status AS "kbcStatus", l.programme_status AS status,
           'learner' AS "statusSource", {mode} AS "attendanceMode"
    FROM "Learner".learners l
    LEFT JOIN curriculum.programmes p ON p.programme_id = l.programme_id
    LEFT JOIN curriculum.groups g ON g.group_id = l.group_id
    {preference_join}
    WHERE l.aptem_id IS NOT NULL
    ORDER BY lower(coalesce(l.full_name, '')), l.aptem_id
'''


class LearnerDirectoryIdentityError(ValueError):
    """Two profiles cannot share the attendance key exposed by this register."""


def _read_lms_directory(*, with_modes):
    from .bulk_attendance_kbc_source import dict_rows, new_database_cursor

    # Preferences belong directly to the canonical learner profile.
    sql = LMS_LEARNERS_SQL.format(
        mode="CASE WHEN pref.mode = 'lazy' THEN 'lazy' ELSE 'live' END" if with_modes else "'live'",
        preference_join=(
            'LEFT JOIN "Learner".attendance_preferences pref ON pref.learner_id = l.id'
            if with_modes else ''
        ),
    )
    with new_database_cursor(read_only=True) as cursor:
        cursor.execute(sql)
        learners = [
            {key: str(value or '').strip() for key, value in row.items()}
            for row in dict_rows(cursor)
        ]
    # Keep the existing Aptem-based API/selection/history keys, but never merge
    # different profiles into one learner if their external identities conflict.
    ids = [learner['id'] for learner in learners]
    if len(ids) != len(set(ids)):
        raise LearnerDirectoryIdentityError()
    return learners


def read_lms_learners():
    """Profile-only fallback when saved attendance preferences are unavailable."""
    return _read_lms_directory(with_modes=False)


def read_lms_directory():
    """Profile identity, status and placement plus its saved delivery mode.

    Keep the existing population (profiles with an Aptem id) for both learner
    types. The KBC link's availability does not select the learner directory.
    kbcStatus remains as a compatibility field; status is the profile status.
    """
    return _read_lms_directory(with_modes=True)


ATTENDANCE_MODE_WARNING = 'Attendance modes could not be read; showing Live Sessions.'


@require_GET
def bulk_attendance_learners(request):
    warnings = []
    try:
        try:
            learners = read_lms_directory()
        except (psycopg.Error, DatabaseError):
            # A preference-read failure must not replace profile names/statuses
            # with enrolment or KBC data. The existing live fallback stays visible.
            learners = read_lms_learners()
            warnings.append(ATTENDANCE_MODE_WARNING)
    except LearnerDirectoryIdentityError:
        return JsonResponse({
            'error': 'The learner directory has conflicting attendance identities. Please review learner links.',
        }, status=503)
    except (psycopg.Error, DatabaseError):
        # Driver errors can contain connection details; do not expose them.
        return JsonResponse({'error': 'Unable to load the learner directory. Please try again.'}, status=503)

    response = JsonResponse({'learners': learners, 'warnings': warnings})
    response['Cache-Control'] = 'private, no-store'
    return response
