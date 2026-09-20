"""Use the existing remedial reading generator with account-owned quiz attempts."""
from types import SimpleNamespace
from contextlib import nullcontext

from django.http import JsonResponse

from . import personal_learning_store as store
from .personal_learning_policy import component_for


def attempt_adapter(attempt):
    def relation(ids):
        values = ids if isinstance(ids, list) else ([] if ids is None else [ids])
        return SimpleNamespace(all=lambda: [SimpleNamespace(answer_ref=value) for value in values])
    answers = [SimpleNamespace(is_correct=row.get('correct'), question_ref=row['questionId'],
        chosen_answers=relation(row.get('chosenAnswerId')), chosen_answer_ref=None,
        correct_answers=relation(row.get('correctAnswerId'))) for row in attempt.get('questions', [])]
    return SimpleNamespace(grade=attempt['grade'], passed=attempt['passed'], quiz_answers=SimpleNamespace(all=lambda: answers))


def reading_record(context, activity_id):
    if context['mode'] != 'study':
        raise PermissionError('Preview does not save quiz attempts or generate personal revision material. Join this course to use revision reading.')
    state = store.load(context['account_id'], context['module_id'])
    reading = next((row for row in state['progress'] if row.get('kind') == 'quiz_reading' and row.get('componentId') == activity_id), None)
    if not reading:
        raise LookupError('Generate reading for your saved quiz attempt first.')
    return reading


def serialize(record):
    return {key: record.get(key) for key in ('id', 'quizId', 'attempt', 'material', 'completed', 'startedAt', 'completedAt', 'timeTaken', 'verifiedSeconds')}


def reading_request(request, context, detail, quiz_id, query, payload):
    from .personal_learning import ensure_open
    from .quiz_reading import _generate_material, _apply_reading_time_mode
    from .quizzes import _fetch_quiz
    from .time_tracking import verify_tracking_session
    ensure_open(detail, context)
    component_for(detail, quiz_id, 'quiz')
    if context['mode'] != 'study':
        raise PermissionError('Join this course to save quiz attempts and use personal revision reading.')
    number = int(query.get('attempt') or 0)
    if number < 1:
        raise ValueError('Choose a saved quiz attempt.')
    activity_id = f'quiz-reading:{quiz_id}:{number}'
    action = payload.get('action', 'generate')
    if request.method not in ('GET', 'POST'):
        raise ValueError('Use GET or POST for revision reading.')
    operation = nullcontext(store.load(context['account_id'], context['module_id'])) if request.method == 'GET' else store.edit(context['account_id'], context['module_id'])
    with operation as state:
        attempt = next((row for row in state['progress'] if row.get('kind') == 'quiz' and str(row.get('quizId')) == str(quiz_id) and row.get('attempt') == number), None)
        if not attempt:
            raise LookupError('Quiz attempt not found in this course.')
        record = next((row for row in state['progress'] if row.get('kind') == 'quiz_reading' and row.get('componentId') == activity_id), None)
        if request.method == 'POST' and action == 'generate' and not record:
            quiz = _fetch_quiz(int(quiz_id))
            if not quiz:
                raise LookupError('Quiz not found.')
            try:
                material = _generate_material(quiz, attempt_adapter(attempt))
            except Exception:
                return JsonResponse({'error': 'Could not generate your revision reading. Please retry.'}, status=502)
            record = {'id': len(state['progress']) + 1, 'kind': 'quiz_reading', 'componentId': activity_id,
                      'quizId': int(quiz_id), 'attempt': number, 'material': material, 'completed': False, 'passed': False}
            state['progress'].append(record)
        elif request.method == 'POST' and action == 'complete' and record and not record.get('completed'):
            tracking = verify_tracking_session(payload.get('trackingToken'), activity_kind='component', activity_id=activity_id,
                learner_kind='personal', learner_id=context['id'], claimed_seconds=payload.get('timeTakenSeconds', 0))
            tracking = _apply_reading_time_mode(tracking, payload.get('timeEntryMode'))
            seconds = tracking['verifiedSeconds']
            record.update(completed=True, passed=True, startedAt=tracking['startedAt'].isoformat(),
                          completedAt=tracking['submittedAt'].isoformat(), submittedAt=tracking['submittedAt'].isoformat(),
                          verifiedSeconds=seconds, timeTaken=f'{seconds // 60:02d}:{seconds % 60:02d}',
                          timeTrackingSessionId=tracking['sessionId'])
        elif request.method not in ('GET', 'POST') or (request.method == 'POST' and action not in ('generate', 'complete')):
            raise ValueError('Unknown revision reading action.')
        if not record:
            raise LookupError('Reading has not been generated yet.')
        return JsonResponse(serialize(record))
