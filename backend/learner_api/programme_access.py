"""Read-only cohort start checks, shared by the dashboard and activity API."""
import re
from zoneinfo import ZoneInfo

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone

from .apprenticeship_agreement import _to_date
from .models import EnrolmentUser


def learning_access(source):
    programme = str(getattr(source, 'programme', '') or '').strip()
    cohort = str(getattr(source, 'cohort', '') or '').strip()
    if programme and cohort:
        # A copied individual date must not open teaching before the cohort.
        with connections['default'].cursor() as cursor:
            cursor.execute(
                '''SELECT start_date FROM curriculum.cohorts
                   WHERE programme_name = %s AND cohort_name = %s AND deleted_at IS NULL
                   ORDER BY updated_at DESC NULLS LAST LIMIT 1''',
                [programme, cohort],
            )
            row = cursor.fetchone()
        start = _to_date(row[0]) if row else None
    else:
        start = _to_date(getattr(source, 'start_date', None))
    today = timezone.localdate(timezone=ZoneInfo('Europe/London'))
    return {'blocked': start is None or start > today, 'startDate': start.isoformat() if start else ''}


def requires_started_programme(path, method='GET'):
    if path.startswith(('/learner_api/time-tracking/', '/learner_api/quizzes/',
                        '/learner_api/videos/', '/learner_api/components/')):
        return True
    if re.match(r'^/learner_api/student-activity/[^/]+/\d+/\d+/\d+/', path):
        return True
    return method not in {'GET', 'HEAD', 'OPTIONS'} and path.startswith((
        '/learner_api/reflection/', '/learner_api/evidence/', '/learner_api/monthly-reports/',
    ))


def refusal(path, account, method='GET'):
    if account.role != 'learner' or not requires_started_programme(path, method):
        return None
    try:
        source = EnrolmentUser.all_learners.only('programme', 'cohort', 'start_date').get(pk=account.subject_id)
        access = learning_access(source)
    except EnrolmentUser.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except DatabaseError:
        return JsonResponse({'error': 'Could not check your programme start date. Please try again.',
                             'code': 'programme_access_unavailable'}, status=503)
    if not access['blocked']:
        return None
    message = (f"Learning activities open on {access['startDate']}. You can view your programme and training plan now."
               if access['startDate'] else 'Your cohort start date must be confirmed before you can begin learning.')
    response = JsonResponse({'error': message, 'code': 'programme_not_started', **access}, status=403)
    response['Cache-Control'] = 'private, no-store'
    return response
