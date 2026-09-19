"""Personal course workspace using the learner's content and assessment rules.

The login identity never changes. Progress is stored outside official learner
tables, so reports, caseloads, attendance and Teams rosters cannot pick it up.
Preview requests use transient state and cannot issue certificates.
"""
import functools
import json
import re
import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from urllib.parse import unquote

from django.db import DatabaseError, connections, transaction
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from login.permissions import authenticate_request, _unauthenticated
from . import personal_learning_store as store
from .personal_learning_policy import context_for, request_target, component_for, progress_detail, submission_key


def endpoint(view):
    @csrf_exempt
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        try:
            account = authenticate_request(request)
        except DatabaseError:
            return JsonResponse({'error': 'The sign-in service is temporarily unavailable.', 'code': 'session_unavailable'}, status=503)
        if account is None:
            return _unauthenticated(request)
        if account.role != 'admin':
            return JsonResponse({'error': 'Personal learning is available to administrators.'}, status=403)
        # Same JSON API CSRF boundary as login, enforced even when the optional
        # legacy learner gate is disabled. No identity is accepted from a body.
        if request.method not in ('GET', 'HEAD') and request.headers.get('X-Requested-With') != 'XMLHttpRequest':
            return JsonResponse({'error': 'Request verification is required.'}, status=403)
        try:
            response = view(request, account, *args, **kwargs)
        except PermissionError as exc:
            response = JsonResponse({'error': str(exc)}, status=403)
        except LookupError as exc:
            response = JsonResponse({'error': str(exc)}, status=404)
        except (ValueError, TypeError) as exc:
            response = JsonResponse({'error': str(exc)}, status=400)
        except DatabaseError:
            response = JsonResponse({'error': 'Personal learning is unavailable. Please contact an administrator.'}, status=503)
        response['Cache-Control'] = 'no-store'
        return response
    return wrapped


def body(request):
    try:
        payload = json.loads(request.body or b'{}')
    except (ValueError, UnicodeDecodeError):
        raise ValueError('A JSON object is required.') from None
    if not isinstance(payload, dict):
        raise ValueError('A JSON object is required.')
    return payload


def module_row(module_id):
    # Direct SELECT: never invoke the authoring schema-repair helpers on a read.
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('SELECT row_to_json(m) FROM curriculum.modules m WHERE module_catalogue_id=%s AND deleted_at IS NULL', [module_id])
        row = cursor.fetchone()
    if not row:
        raise LookupError('This course is no longer available.')
    return store.json_value(row[0], dict)


def course_detail(context, account, state=None):
    from .learner_detail import _resolve_from_master, _append_week_quizzes, _apply_programme_assignment_template, _annotate_otjh
    module = module_row(context['module_id'])
    assigned = [{'moduleId': context['module_id']}]
    modules, weeks, components = _resolve_from_master([], [], [], assigned_modules=assigned)
    components = _apply_programme_assignment_template(components, module.get('programme_name', ''))
    components, expected_otjh = _annotate_otjh(components)
    weeks, components = _append_week_quizzes(weeks, components, assigned_modules=assigned)
    if not modules:
        raise ValueError('The course content could not be loaded. Please try again.')
    # Preserve all authored fields except participation in a live meeting.
    components = [dict(component, liveSessionUrl=None) for component in components]
    from .programme_access import learning_access
    access = learning_access(SimpleNamespace(programme=module.get('programme_name'), cohort=module.get('cohort_name'), start_date=module.get('start_date')))
    start = access['startDate']
    blocked = context['mode'] != 'all' and access['blocked']
    mappings = {item['code']: item for component in components for item in component.get('ksbMappings', []) if item.get('code')}
    detail = {
        'id': context['id'], 'name': account.display_name or account.email, 'email': account.email,
        'phone': '', 'programme': module.get('programme_name') or '', 'programmeStatus': 'Active',
        'learnerType': 'commercial', 'cohort': module.get('cohort_name') or '', 'group': module.get('group_name') or '',
        'employer': '', 'lineManager': '', 'isActive': True, 'studentActivityAvailable': False,
        'programmeStartDate': start, 'programmeEndDate': str(module.get('end_date') or '')[:10],
        'cohortStartDate': start, 'modules': modules, 'week': weeks, 'components': components,
        'ksbs': [{'code': code, 'type': code[:1], 'number': code[1:], 'description': item.get('description') or ''} for code, item in mappings.items()],
        'accessGate': {'blocked': blocked, 'reasons': [('start-date-future' if start else 'start-date-missing')] if blocked else [], 'startDate': start, 'outstandingDocuments': []},
        'learningAccess': {**access, 'blocked': blocked},
        'totalExpectedOtjh': expected_otjh,
        'personalLearning': {'mode': context['mode'], 'moduleId': context['module_id'], 'contentOnly': True},
    }
    state = state if state is not None else (store.load(account.id, context['module_id']) if context['mode'] == 'study' else {'progress': [], 'submissions': {}})
    return progress_detail(detail, state['progress'], state['submissions']), module


def ensure_open(detail, context):
    if detail['learningAccess']['blocked'] and context['mode'] != 'all':
        raise PermissionError(f"Learning activities open on {detail['learningAccess']['startDate']}." if detail['learningAccess']['startDate'] else 'The cohort start date must be confirmed before learning can begin.')


@contextmanager
def activity_state(context):
    if context['mode'] == 'study':
        with store.edit(context['account_id'], context['module_id']) as state:
            yield state
    else:
        yield {'progress': [], 'submissions': {}}


def progress(detail, module_id):
    from .certificates import _module_progress
    if not detail['components']:
        return {'progressPercent': 0, 'trackableTotal': 0, 'trackableDone': 0, 'finalTestPassed': False, 'moduleRef': f'current:{module_id}', 'moduleTitle': detail['modules'][0]}
    return _module_progress(detail, f'current:{module_id}')


@endpoint
def courses(request, account):
    if request.method == 'POST':
        module_id = str(body(request).get('moduleId') or '')
        context_for(f'pl.{account.id}.study.{module_id}', account)
        module_row(module_id)
        store.enrol(account.id, module_id)
        return JsonResponse({'id': f'pl.{account.id}.study.{module_id}', 'moduleId': module_id})
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    result = []
    for course in store.list_courses(account.id):
        identity = f"pl.{account.id}.study.{course['moduleId']}"
        try:
            detail, module = course_detail(context_for(identity, account), account)
            from .personal_learning_review import module_coach
            coach = module_coach(course['moduleId'])
            result.append({**course, 'id': identity, 'title': module.get('title') or course['moduleId'],
                           'reviewCoach': coach['name'] if coach else '',
                           'reviewCoachIsSelf': bool(coach and coach['email'].strip().lower() == account.email.strip().lower()),
                           **progress(detail, course['moduleId']), 'startDate': detail['programmeStartDate'], 'blocked': detail['learningAccess']['blocked']})
        except LookupError:
            result.append({**course, 'id': identity, 'title': course['moduleId'], 'unavailable': True})
    return JsonResponse({'courses': result, 'csrfToken': get_token(request)})


def metadata(detail, module):
    from .student_activity import _builder_subject_metadata, read_builder_activity_dates
    mid = detail['personalLearning']['moduleId']
    with connections['enrolment'].cursor() as cursor:
        covers, subjects = _builder_subject_metadata(cursor, [f'current:{mid}'])
        dates = read_builder_activity_dates(cursor, [mid])
    return {'covers': covers, 'activity_dates': dates,
            'builder_subjects': subjects, 'current_subjects': [{'id': mid, 'title': module.get('title') or mid}]}


def metrics(detail, context):
    summary = progress(detail, context['module_id'])
    done = {str(row.get('componentId')) for row in [*detail['videoProgress'], *detail['componentProgress'], *detail['quizAttempts']] if row.get('passed') is True}
    codes = {k['code'] for k in detail['ksbs']}
    completed_codes = {k['code'] for c in detail['components'] if str(c.get('componentId')) in done for k in c.get('ksbMappings', [])}
    return {'migrated': False,
            'programme': {'completed': summary['trackableDone'], 'total': summary['trackableTotal'], 'percent': summary['progressPercent'], 'status': 'ready' if summary['trackableTotal'] else 'empty'},
            'ksb': {'completed': len(completed_codes), 'total': len(codes), 'percent': round(len(completed_codes) / len(codes) * 100, 2) if codes else None, 'status': 'ready' if codes else 'empty'},
            'otjh': {'historical': None, 'new': 0, 'actual': None, 'planned': None}}


def tracking_record(context, payload, activity_id, activity_kind, history):
    from .time_tracking import verify_tracking_session, outside_uk_working_hours
    tracking = verify_tracking_session(payload.get('trackingToken'), activity_kind=activity_kind,
        activity_id=activity_id, learner_kind='personal', learner_id=context['id'],
        claimed_seconds=payload.get('timeTakenSeconds', 0))
    previous = next((item for item in history if item.get('timeTrackingSessionId') == tracking['sessionId']), None)
    if previous:
        return previous, True
    outside = activity_kind != 'quiz' and outside_uk_working_hours(tracking['submittedAt'])
    if outside and payload.get('outsideWorkingHoursConfirmed') is not True:
        raise ValueError('Confirm that this activity was completed outside normal working hours.')
    seconds = tracking['verifiedSeconds']
    return {'kind': activity_kind, 'componentId': str(activity_id), 'timeTrackingSessionId': tracking['sessionId'],
            'startedAt': tracking['startedAt'].isoformat(), 'submittedAt': tracking['submittedAt'].isoformat(),
            'timeTaken': f'{seconds // 60:02d}:{seconds % 60:02d}', 'verifiedSeconds': seconds,
            'claimedSeconds': tracking['claimedSeconds'], 'serverSessionSeconds': tracking['serverSessionSeconds'],
            'timeTrackingSource': tracking['source'], 'feedback': str(payload.get('feedback') or ''),
            'reportedTime': str(payload.get('reportedTime') or ''), 'ksbs': [], 'passed': True,
            'outsideWorkingHours': outside, 'outsideWorkingHoursConfirmed': outside,
            'outsideWorkingHoursConfirmedAt': tracking['submittedAt'].isoformat() if outside else None}, False


def complete_activity(context, account, detail, activity_id, activity_kind, payload):
    component = component_for(detail, activity_id, activity_kind)
    ensure_open(detail, context)
    if component.get('isQuiz'):
        raise ValueError('Submit this quiz through its assessment page.')
    with activity_state(context) as state:
        record, repeated = tracking_record(context, payload, activity_id, activity_kind, state['progress'])
        if not repeated:
            quality_checks = None
            if component.get('type') == 'assignment':
                from .personal_learning_activities import validate_assignment
                saved = state['submissions'].get(f'assignment:{activity_id}', {})
                quality_checks = validate_assignment(context, detail, state, saved)
                record['ksbs'] = [claim['code'] for claim in (saved.get('monthlyAssignment') or {}).get('claims', [])]
            validation = bool(component.get('tutorValidationRequired') or component.get('type') == 'assignment')
            if (component.get('reflectionRequired') or validation) and not str(payload.get('feedback') or '').strip() and component.get('type') != 'assignment':
                raise ValueError('Complete the reflection before submitting this activity.')
            record.update({'componentType': component.get('type'), 'moduleId': context['module_id'],
                           'componentTitle': component.get('component'), 'passed': not validation,
                           'attempt': 1 + sum(row.get('componentId') == str(activity_id) for row in state['progress'])})
            if validation:
                key = f"{component.get('type') or 'component'}:{activity_id}"
                previous = state['submissions'].get(key, {})
                if previous.get('status') == 'accepted' or (previous.get('status') == 'submitted_for_tutor_review' and any(row.get('submissionId') == previous.get('id') for row in state['progress'])):
                    raise ValueError('This activity has already been submitted. Reload to see its status.')
                record['submissionId'] = (previous.get('id') if previous.get('status') in ('draft', 'submitted_for_tutor_review') else None) or str(uuid.uuid4())
                state['submissions'][key] = {**previous, 'id': record['submissionId'], 'activityId': str(activity_id),
                    'activityTitle': component.get('component'), 'activityType': component.get('type'),
                    'learnerName': account.display_name or account.email, 'programmeName': detail.get('programme', ''),
                    'moduleTitle': component.get('module'), 'weekTitle': component.get('week'),
                    'version': previous.get('version', 0) + 1,
                    'status': 'submitted_for_tutor_review', 'feedback': record['feedback'],
                    'submittedAt': record['submittedAt'], 'locked': True}
                if quality_checks is not None:
                    state['submissions'][key].update(qualityChecks=quality_checks, qualityScore=100)
            state['progress'].append(record)
    return {'record': record, 'componentTitle': component.get('component'), 'videoTitle': component.get('component'),
            'componentType': component.get('type'), 'week': component.get('week'), 'module': component.get('module'),
            'preview': context['mode'] != 'study'}


def submit_quiz(context, account, detail, quiz_id, payload):
    from .quizzes import _fetch_quiz, _grade_question
    component = component_for(detail, quiz_id, 'quiz')
    ensure_open(detail, context)
    quiz = _fetch_quiz(quiz_id)
    if not quiz or not quiz['questions']:
        raise ValueError('This quiz has no questions available.')
    answers = payload.get('answers')
    if not isinstance(answers, dict):
        raise ValueError('Quiz answers are required.')
    breakdown, stored, earned, possible = [], [], 0, 0
    for question in quiz['questions']:
        result = _grade_question(question, answers.get(str(question['id'])))
        earned += result['earned']
        possible += result['possible']
        breakdown.append({**result, 'questionId': question['id'], 'questionText': question['text'], 'type': question['type'], 'points': question['points']})
        stored.append({'questionId': question['id'], 'earned': result['earned'], 'correct': result['correct'],
                       'chosenText': result.get('chosenAnswer'), 'chosenAnswerId': result.get('chosenAnswerId'), 'correctAnswerId': result.get('correctAnswerId')})
    with activity_state(context) as state:
        record, repeated = tracking_record(context, payload, quiz_id, 'quiz', state['progress'])
        if repeated:
            return record['result']
        if not repeated:
            record.update({'componentId': component.get('componentId'), 'moduleId': context['module_id'], 'quizId': int(quiz_id),
                'attempt': 1 + sum(str(row.get('quizId')) == str(quiz_id) for row in state['progress']),
                'grade': round(earned / possible, 2) if possible else 0,
                'passed': bool(possible) and round(earned / possible * 100, 1) >= (quiz.get('passingGrade') or 0),
                'achievedScore': sum(row['correct'] for row in stored), 'totalScore': len(stored), 'questions': stored})
            result = {'attempt': dict(record), 'breakdown': breakdown, 'earned': earned, 'possible': possible,
            **{key: record[key] for key in ('grade', 'passed', 'achievedScore', 'totalScore', 'timeTaken')},
            'quizName': quiz['title'], 'preview': context['mode'] != 'study'}
            record['result'] = result
            state['progress'].append(record)
    return result


def certificate(context, account, detail, request, issue=False):
    from .certificates import _template_dict, _published_template
    with connections['enrolment'].cursor() as cursor:
        template = _template_dict(_published_template(cursor))
    if not issue:
        return {'configured': bool(template), 'template': template, 'csrfToken': get_token(request)}
    if context['mode'] != 'study':
        raise PermissionError('Certificates cannot be issued in preview. Join this course to earn a certificate.')
    if not template:
        raise ValueError('No published certificate template has been configured.')
    with transaction.atomic(using='enrolment'):
        state = store.load(account.id, context['module_id'], lock=True)
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('SELECT certificate FROM "Learner".personal_course_certificates WHERE account_id=%s AND module_id=%s AND template_id=%s AND template_version=%s',
                           [account.id, context['module_id'], template['id'], template['version']])
            existing = cursor.fetchone()
            if existing:
                return {'certificate': store.json_value(existing[0], dict), 'template': template, 'issued': False}
            detail, _ = course_detail(context, account, state)
            ensure_open(detail, context)
            eligibility = progress(detail, context['module_id'])
            if not eligibility['trackableTotal'] or eligibility['progressPercent'] < template['minimumProgress'] or (template['requireFinalTest'] and not eligibility['finalTestPassed']):
                raise PermissionError('Complete the required activities, tutor reviews and assessments before requesting this certificate.')
            token = str(uuid.uuid4())
            snapshot = {**eligibility, 'certificateTitle': template['title'], 'bodyText': template['bodyText'], 'layoutConfig': template['layoutConfig'],
                        'learner': {'kind': 'personal', **{key: detail.get(key, '') for key in ('id', 'name', 'email', 'programme', 'cohort', 'group', 'employer')}},
                        'programme': detail['programme'], 'minimumProgress': template['minimumProgress'], 'personalLearning': True}
            issued = {'id': 0, 'certificateNumber': f'PL-{uuid.uuid4().hex[:12].upper()}', 'templateId': template['id'],
                      'templateVersion': template['version'], 'progressPercent': eligibility['progressPercent'], 'snapshot': snapshot,
                      'issuedAt': timezone.now().isoformat(), 'pdfBlobUrl': '', 'verificationToken': token,
                      'verificationUrl': f'/verify-personal-certificate/{token}', 'moduleRef': eligibility['moduleRef'], 'moduleTitle': eligibility['moduleTitle']}
            cursor.execute('INSERT INTO "Learner".personal_course_certificates (account_id,module_id,template_id,template_version,token,certificate) VALUES (%s,%s,%s,%s,%s,%s::jsonb) RETURNING id',
                           [account.id, context['module_id'], template['id'], template['version'], token, json.dumps(issued)])
            issued['id'] = cursor.fetchone()[0]
            cursor.execute('UPDATE "Learner".personal_course_certificates SET certificate=%s::jsonb WHERE id=%s', [json.dumps(issued), issued['id']])
    return {'certificate': issued, 'template': template, 'eligibility': eligibility, 'issued': True}


def verify_certificate(request, token):
    if request.method != 'GET':
        return JsonResponse({'error': 'Method not allowed.'}, status=405)
    try:
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('SELECT certificate FROM "Learner".personal_course_certificates WHERE token=%s', [token])
            row = cursor.fetchone()
    except DatabaseError:
        return JsonResponse({'error': 'Certificate verification is unavailable.'}, status=503)
    if not row:
        return JsonResponse({'error': 'Certificate not found.'}, status=404)
    response = JsonResponse({'valid': True, 'certificate': store.json_value(row[0], dict)})
    response['Cache-Control'] = 'private, no-store'
    return response


@endpoint
def learner_request(request, account, identity):
    context = context_for(identity, account)
    path, query = request_target(request.GET.get('path', ''), identity)
    payload = body(request) if request.method in ('POST', 'PATCH') and request.content_type == 'application/json' else {}
    if payload.get('learnerId') not in (None, identity):
        raise PermissionError('This request belongs to another learner.')
    detail, module = course_detail(context, account)
    reading_match = re.fullmatch(r'/learner_api/quizzes/(\d+)/reading/', path)
    if reading_match:
        from .personal_learning_quiz_reading import reading_request
        return reading_request(request, context, detail, reading_match[1], query, payload)
    if request.method == 'GET':
        if re.fullmatch(r'/learner_api/learner-(detail|summary)/commercial/' + re.escape(identity) + '/', path):
            if query.get('content') == 'reading':
                component = component_for(detail, query.get('component_id'))
                return JsonResponse({'componentId': component['componentId'], 'contentHtml': component.get('contentHtml')})
            return JsonResponse(detail)
        if path == f'/learner_api/subject-covers/{identity}/':
            return JsonResponse(metadata(detail, module))
        if path == f'/learner_api/metrics/commercial/{identity}/':
            return JsonResponse(metrics(detail, context))
        if path == f'/learner_api/training-plan-dashboard/commercial/{identity}/' and query.get('section') == 'learning':
            from .personal_learning_reads import learning_schedule
            return JsonResponse(learning_schedule(context))
        match = re.fullmatch(r'/learner_api/quizzes/(\d+)/', path)
        if match:
            from .quizzes import _fetch_quiz, _scrub_answer_key
            ensure_open(detail, context)
            component_for(detail, match[1], 'quiz')
            quiz = _fetch_quiz(int(match[1]))
            if not quiz:
                raise LookupError('Quiz not found.')
            return JsonResponse(_scrub_answer_key(quiz))
        if path == f'/learner_api/certificates/commercial/{identity}/template/':
            return JsonResponse(certificate(context, account, detail, request))
        if path == '/learner_api/reflection/submissions/':
            state = store.load(account.id, context['module_id']) if context['mode'] == 'study' else {'submissions': {}}
            if query.get('activityId'):
                component = component_for(detail, query['activityId'])
                return JsonResponse({'submission': state['submissions'].get(submission_key(component, query['activityId']))})
            return JsonResponse({'statuses': list(state['submissions'].values())})
    from .personal_learning_activities import handle_activity_request
    response = handle_activity_request(request, context, account, detail, path, query, payload)
    if response is not None:
        return response
    if request.method == 'GET' and path.startswith(f'/learner_api/session-results/commercial/{identity}/'):
        from .personal_learning_reads import session_read
        return session_read(request, context, detail, path, query)
    if request.method == 'POST':
        if path == '/learner_api/time-tracking/start/':
            from .time_tracking import issue_tracking_session
            ensure_open(detail, context)
            if str(payload.get('activityId') or '').startswith('quiz-reading:') and payload.get('activityKind') == 'component':
                from .personal_learning_quiz_reading import reading_record
                reading_record(context, payload['activityId'])
            else:
                component_for(detail, payload.get('activityId'), payload.get('activityKind'))
            return JsonResponse(issue_tracking_session(activity_kind=payload.get('activityKind'), activity_id=payload.get('activityId'),
                learner_kind='personal', learner_id=identity, counting_mode=payload.get('countingMode')))
        match = re.fullmatch(r'/learner_api/(components|videos)/([^/]+)/complete/', path)
        if match:
            return JsonResponse(complete_activity(context, account, detail, match[2], 'video' if match[1] == 'videos' else 'component', payload))
        match = re.fullmatch(r'/learner_api/quizzes/(\d+)/submit/', path)
        if match:
            return JsonResponse(submit_quiz(context, account, detail, match[1], payload))
        match = re.fullmatch(r'/learner_api/certificates/commercial/[^/]+/modules/([^/]+)/issue/', path)
        if match and unquote(match[1]) == f"current:{context['module_id']}":
            return JsonResponse(certificate(context, account, detail, request, issue=True))
    raise LookupError('This action is not available in this personal course.')
