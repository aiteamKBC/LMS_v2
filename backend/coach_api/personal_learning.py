"""Coach review endpoints; personal records never enter official marking totals."""
import functools
import json

from django.db import DatabaseError
from django.http import JsonResponse

from .auth import coach_access_required, attributed_write_view
from learner_api import personal_learning_review as review
from learner_api import personal_learning_store as store


def endpoint(view):
    @coach_access_required
    @attributed_write_view
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            response = view(request, *args, **kwargs)
        except PermissionError as exc:
            response = JsonResponse({'detail': str(exc)}, status=403)
        except LookupError as exc:
            response = JsonResponse({'detail': str(exc)}, status=404)
        except (ValueError, TypeError) as exc:
            response = JsonResponse({'detail': str(exc)}, status=400)
        except DatabaseError:
            response = JsonResponse({'detail': 'Personal coursework could not be loaded. Please retry.'}, status=503)
        response['Cache-Control'] = 'private, no-store'
        return response
    return wrapped


def selected_course(request, submission_id):
    for course in review.review_courses(request, submission_id):
        for submission in course['submissions'].values():
            if submission.get('id') == str(submission_id) and submission.get('status') != 'draft':
                return course, submission
    raise LookupError('Submission not found for this course coach.')


@endpoint
def marking(request, submission_id=None):
    if submission_id:
        course, submission = selected_course(request, submission_id)
        if request.method == 'GET':
            return JsonResponse({'item': review.submission_item(course, submission)})
        if request.method != 'PATCH':
            return JsonResponse({'detail': 'Method not allowed.'}, status=405)
        payload = json.loads(request.body or b'{}')
        if not isinstance(payload, dict):
            raise ValueError('A review object is required.')
        with store.edit(course['accountId'], course['moduleId']) as state:
            # Recheck the current curriculum assignment after taking the lock.
            current, _ = selected_course(request, submission_id)
            result = review.decide(state, submission_id, payload, request.login_account, current['coach'])
        return JsonResponse(result)
    if request.method != 'GET':
        return JsonResponse({'detail': 'Method not allowed.'}, status=405)
    rows = [review.submission_item(course, submission) for course in review.review_courses(request)
            for submission in course['submissions'].values() if submission.get('status') != 'draft']
    kind = request.GET.get('kind', '')
    if kind not in ('', 'assignment', 'reflection'):
        raise ValueError('Choose assignments or reflection validation.')
    kinds = {'assignmentItems': sum(r.get('activityType') == 'assignment' for r in rows),
             'reflectionItems': sum(r.get('activityType') != 'assignment' for r in rows)}
    if kind:
        rows = [r for r in rows if (r.get('activityType') == 'assignment') == (kind == 'assignment')]
    rows.sort(key=lambda row: row.get('submittedAt') or '', reverse=True)
    summary = {**kinds, 'totalItems': len(rows), 'activeLearners': len({r['learnerId'] for r in rows}),
               'pendingItems': sum(r['status'] == 'pending' for r in rows), 'acceptedItems': sum(r['status'] == 'accepted' for r in rows),
               'referredItems': sum(r['status'] in ('referred', 'rejected') for r in rows),
               'overdueItems': sum(r['isOverdue'] for r in rows), 'oldestSubmission': rows[-1]['submittedDisplay'] if rows else '--',
               'overdueThresholdDays': 7}
    status = request.GET.get('status', 'all')
    if status not in ('all', 'pending', 'accepted', 'referred', 'overdue'):
        raise ValueError('Choose a valid status filter.')
    if status != 'all':
        rows = [r for r in rows if (r['isOverdue'] if status == 'overdue' else
                r['status'] in ('referred', 'rejected') if status == 'referred' else r['status'] == status)]
    page, size = int(request.GET.get('page', '1')), min(int(request.GET.get('page_size', '25')), 100)
    if page < 1 or size < 1:
        raise ValueError('Choose a valid page.')
    count = len(rows)
    return JsonResponse({'items': rows[(page - 1) * size:page * size], 'summary': summary,
        'pagination': {'page': page, 'pageSize': size, 'totalItems': count, 'totalPages': (count + size - 1) // size,
                       'hasNext': page * size < count, 'hasPrevious': page > 1}})


@endpoint
def evidence(request, submission_id, file_id=None):
    if request.method != 'GET':
        return JsonResponse({'detail': 'Method not allowed.'}, status=405)
    from learner_api.personal_learning_activities import public_file, download_url
    course, submission = selected_course(request, submission_id)
    state = store.load(course['accountId'], course['moduleId'])
    files = [file for file in state['evidence'].values() if not file.get('deletedAt')
             and file.get('activityId', file.get('sectionRef')) == submission['activityId']]
    if file_id:
        file = next((file for file in files if file['id'] == str(file_id)), None)
        if not file:
            raise LookupError('Evidence not found for this submission.')
        return JsonResponse({'url': download_url(file)})
    return JsonResponse({'results': [public_file(state, file) for file in files]})
