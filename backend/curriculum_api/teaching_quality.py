"""One teaching observation per verified lecture/tutor; no Microsoft operations."""
import json
from uuid import UUID

from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods
from learner_api.constants import ACCESS_CURRICULUM
from login.permissions import require_access
from coach_api import quality_review_api as quality, quality_review_store as store
from coach_api.quality_form_definition import definition_for
from coach_api.quality_review_template import InvalidReview
from . import session_results

FORM_TYPE = 'FORM_TEACHING'


def lecture_snapshot(request):
    keys = ('moduleId', 'seriesId', 'occurrenceId')
    scope = {key: request.GET.get(key, '').strip() for key in keys}
    if any(not value or len(value) > 128 for value in scope.values()):
        raise InvalidReview('Choose a saved module lecture before opening its quality check.')
    rows = session_results.read('''SELECT m.module_catalogue_id, m.title AS module_title,
        coalesce(t.name,'') AS tutor_name, coalesce(t.email,'') AS tutor_email,
        coalesce(p.name,'') AS programme_name, coalesce(c.cohort_name,'') AS cohort_name,
        coalesce(g.group_name,'') AS group_name,
        s.id AS series_id,o.id AS occurrence_id,o.scheduled_start,o.scheduled_end
        FROM curriculum.live_session_occurrences o
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
        LEFT JOIN curriculum.programmes p ON p.programme_id=m.programme_id
        LEFT JOIN curriculum.cohorts c ON c.cohort_id=m.cohort_id
        LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
        LEFT JOIN curriculum.tutors t ON t.id=m.tutor_id
        WHERE m.module_catalogue_id=%s AND s.id=%s AND o.id=%s''',
        [scope[key] for key in keys])
    if not rows:
        return None
    row = rows[0]
    tutor_name = str(row.get('tutor_name') or '').strip()
    tutor_email = str(row.get('tutor_email') or '').strip().casefold()
    if not tutor_name and not tutor_email:
        raise InvalidReview('Assign a tutor to this module before starting its teaching review.')
    start, end = session_results.instant(row['scheduled_start']), session_results.instant(row['scheduled_end'])
    if not start or not end or end <= start:
        raise InvalidReview('This lecture has no valid saved time window.')
    tutor_key = tutor_email or 'name:' + tutor_name.casefold()
    return {
        'scope': 'teaching', 'templateId': 'teaching-session-v1', 'reviewType': FORM_TYPE,
        'identity': store.digest(['teaching-session-v1', *[scope[key] for key in keys], tutor_key]),
        'coach': {'name': tutor_name or tutor_email, 'email': tutor_email}, 'learner': None,
        'lecture': {**scope, 'tutorKey': tutor_key, 'programme': row.get('programme_name') or '',
                    'cohort': row.get('cohort_name') or '', 'group': row.get('group_name') or ''},
        'meeting': {'id': scope['occurrenceId'], 'eventId': scope['seriesId'],
                    'title': row['module_title'], 'startsAt': start.isoformat(), 'endsAt': end.isoformat()},
    }


@require_http_methods(['GET', 'POST'])
@require_access(ACCESS_CURRICULUM)
@csrf_protect
@quality.guarded
def teaching_review(request):
    snapshot = lecture_snapshot(request)
    if snapshot is None:
        return quality._response({'error': 'This module lecture was not found.', 'code': 'not_found'}, 404)
    saved = store.read_review(identity=snapshot['identity'])
    definition = definition_for(saved) if saved else quality.selected_definition(None, FORM_TYPE)
    if request.method == 'GET':
        return quality._response({'template': definition, 'review': saved,
                                  'snapshot': saved or snapshot, 'learners': [], 'observer': request.quality_actor})
    if len(request.body) > 150000:
        raise InvalidReview('The form is too large.')
    try:
        value = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        raise InvalidReview('The form is invalid.')
    allowed = {'templateVersion', 'reviewType', 'expectedVersion', 'status', 'form', 'requestId'}
    if not isinstance(value, dict) or set(value) - allowed or value.get('reviewType') != FORM_TYPE:
        raise InvalidReview('Only the Teaching Session Feedback Form can be used for a lecture.')
    if type(value.get('expectedVersion')) is not int or value['expectedVersion'] < 0:
        raise InvalidReview('Use a valid saved review version.')
    if not isinstance(value.get('requestId'), str):
        raise InvalidReview('Use a valid save identifier.')
    request_id = str(UUID(value['requestId']))
    quality.validate_answers(value, definition)
    # A rescheduled lecture retains the context and form frozen at its first save.
    context = {key: saved[key] for key in snapshot} if saved else snapshot
    saved = store.save_review({**context, 'definition': definition, 'form': value['form'],
                              'status': value['status'], 'reviewer': request.quality_actor},
                             expected=value['expectedVersion'], request_id=request_id, actor=request.quality_actor['id'])
    return quality._response({'review': saved, 'document': quality.document_state(saved)}, 200)
