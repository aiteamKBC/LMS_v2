"""Quiz defaults and explicit learner rules. Historical scores are never rewritten."""
from copy import deepcopy
from math import isfinite

from django.db import connections
from django.db import DatabaseError
from django.db.models import Case, Count, F, FloatField, Max, Q, When

GENERAL_DEFAULTS = {
    'attemptMode': 'unlimited', 'attemptLimit': 3, 'attemptHistory': True,
    'retakeAfterPass': True, 'quizStyle': 'pagination',
}
GRADE_DEFAULTS = {
    'resultDisplay': 'grade_percentage', 'scoreSeparator': '/', 'coursePageDisplay': 'inside_quiz',
    'rows': [{'grade': name, 'point': point, 'min': minimum, 'color': color} for name, point, minimum, color in (
        ('A+', 5, 95, '#1d7df2'), ('A', 4.5, 90, '#2148f3'), ('A-', 4, 85, '#1457ee'),
        ('B+', 3.5, 80, '#10a957'), ('B', 3, 75, '#08a51d'), ('B-', 2.5, 70, '#0aa650'),
        ('C+', 2, 65, '#ef1717'), ('C', 1.5, 60, '#f20707'), ('C-', 1, 55, '#ef1717'),
        ('D', 0, 50, '#8f8a8d'))],
}


def integer(value, label, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f'{label} must be a whole number.')
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{label} must be a whole number.') from None
    if not minimum <= number <= maximum:
        raise ValueError(f'{label} must be between {minimum} and {maximum}.')
    return number


def boolean(value, label):
    if type(value) is not bool:
        raise ValueError(f'{label} must be true or false.')
    return value


def validate_general(value):
    if not isinstance(value, dict) or set(value) - GENERAL_DEFAULTS.keys():
        raise ValueError('Invalid general quiz settings.')
    result = {**GENERAL_DEFAULTS, **value}
    if result['attemptMode'] not in ('limited', 'unlimited'):
        raise ValueError('Choose limited or unlimited attempts.')
    if result['quizStyle'] not in ('default', 'pagination', 'global'):
        raise ValueError('Choose a supported quiz style.')
    result['attemptLimit'] = integer(result['attemptLimit'], 'Attempt limit', 1, 20)
    for key in ('attemptHistory', 'retakeAfterPass'):
        boolean(result[key], key)
    return result


def validate_grades(value):
    if not isinstance(value, dict) or set(value) - GRADE_DEFAULTS.keys():
        raise ValueError('Invalid grade settings.')
    result = {**deepcopy(GRADE_DEFAULTS), **value}
    if result['resultDisplay'] not in ('grade', 'percentage', 'points', 'grade_percentage'):
        raise ValueError('Choose a supported result display.')
    if result['coursePageDisplay'] not in ('separate_tab', 'inside_quiz', 'hidden'):
        raise ValueError('Choose a supported grades display.')
    if not isinstance(result['scoreSeparator'], str) or not 1 <= len(result['scoreSeparator'].strip()) <= 10:
        raise ValueError('Score separator must contain 1 to 10 characters.')
    rows = result['rows']
    if not isinstance(rows, list) or not 1 <= len(rows) <= 30:
        raise ValueError('Provide between 1 and 30 grade rows.')
    names, thresholds, normalized = set(), set(), []
    import re
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'grade', 'point', 'min', 'color'}:
            raise ValueError('Each grade needs a name, points, minimum percentage and colour.')
        if not isinstance(row['grade'], str) or not 1 <= len(row['grade'].strip()) <= 20:
            raise ValueError('Grade names must contain 1 to 20 characters.')
        row = dict(row)
        row['min'] = integer(row['min'], 'Grade minimum', 0, 100)
        if type(row['point']) not in (int, float) or not isfinite(row['point']) or not 0 <= row['point'] <= 100:
            raise ValueError('Grade points must be between 0 and 100.')
        if not isinstance(row['color'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', row['color']):
            raise ValueError('Choose a valid grade colour.')
        if row['grade'].strip().casefold() in names or row['min'] in thresholds:
            raise ValueError('Grade names and minimum percentages must be unique.')
        names.add(row['grade'].strip().casefold())
        thresholds.add(row['min'])
        normalized.append(row)
    result['rows'] = sorted(normalized, key=lambda row: row['min'], reverse=True)
    return result


def default_settings():
    return {'general': deepcopy(GENERAL_DEFAULTS), 'grades': deepcopy(GRADE_DEFAULTS)}


def load_defaults():
    from .models import QuizDefaults
    saved = QuizDefaults.objects.filter(pk=1).first()
    if saved is None:
        raise DatabaseError('Quiz defaults have not been provisioned.')
    return {'general': saved.general, 'grades': saved.grades, 'revision': saved.revision}


def quiz_settings(payload, *, creating=False, defaults=None):
    """Validate supplied fields only; an unrelated PATCH cannot activate old rules."""
    result = {}
    if creating:
        defaults = defaults if defaults is not None else load_defaults()
        general = defaults['general']
        result = {'policy_enabled': True, 'attempt_limit': general['attemptLimit'],
                  'limit_attempts': general['attemptMode'] == 'limited',
                  'attempt_history': general['attemptHistory'], 'retake_after_pass': general['retakeAfterPass'],
                  'quiz_style': general['quizStyle'], 'grade_settings': deepcopy(defaults['grades']),
                  'retake_points_cut': 0}
    for key, attr in (('policyEnabled', 'policy_enabled'), ('randomizeQuestions', 'randomize_questions'),
                      ('randomizeAnswers', 'randomize_answers'), ('showCorrectAnswer', 'show_correct_answer'),
                      ('attemptHistory', 'attempt_history'), ('retakeAfterPass', 'retake_after_pass'),
                      ('limitAttempts', 'limit_attempts')):
        if key in payload:
            result[attr] = boolean(payload[key], key)
    if creating:
        result['policy_enabled'] = True
    for key, attr, low, high in (('attemptLimit', 'attempt_limit', 1, 20),
                               ('duration', 'duration', 0, 86400), ('passingGrade', 'passing_grade', 0, 100)):
        if key in payload:
            result[attr] = integer(payload[key], key, low, high)
    for key, attr, allowed in (('quizStyle', 'quiz_style', ('default', 'pagination', 'global')),
                               ('timeUnit', 'time_unit', ('minutes', 'seconds'))):
        if key in payload:
            if payload[key] not in allowed:
                raise ValueError(f'Unsupported {key}.')
            result[attr] = payload[key]
    for key, attr in (('shortDescription', 'short_description'), ('lessonContent', 'lesson_content')):
        if key in payload:
            if payload[key] is None:
                result[attr] = ''
            elif not isinstance(payload[key], str):
                raise ValueError(f'{key} must be text.')
            else:
                result[attr] = payload[key]
    if 'gradeSettings' in payload:
        result['grade_settings'] = validate_grades(payload['gradeSettings'])
    # Compatibility with older editors: zero is accepted; a penalty is not applied.
    if 'retakePointsCut' in payload and integer(payload['retakePointsCut'], 'Retake penalty', 0, 100) != 0:
        raise ValueError('Retakes keep the highest score; no grade penalty is applied.')
    return result


class QuizPolicyConflict(ValueError):
    def __init__(self, state):
        self.state = state
        super().__init__(state['unavailableReason'])


def attempt_stats(learner, quiz_id):
    from learner_api.models import LearnerProgressEntry
    if learner is None:
        return {'used': 0, 'best': None, 'passed': 0}
    return LearnerProgressEntry.objects.filter(learner=learner, kind='quiz', quiz_ref=str(quiz_id),
                                              deleted_at__isnull=True).aggregate(
        used=Count('id'), best=Max(Case(When(grade__gt=1, then=F('grade') / 100.0),
                                      default=F('grade'), output_field=FloatField())),
        passed=Count('id', filter=Q(passed=True)))


def learner_policy(quiz, stats):
    enabled = quiz.get('policyEnabled') is True
    reason = code = None
    if enabled:
        if quiz.get('status') not in ('published', 'private'):
            reason, code = 'This quiz is not available for new attempts.', 'quiz_not_published'
        elif not quiz.get('retakeAfterPass', True) and stats['passed']:
            reason, code = 'You have passed this quiz. Further attempts are not enabled.', 'quiz_already_passed'
        elif quiz.get('limitAttempts') and stats['used'] >= quiz['attemptLimit']:
            reason, code = 'You have used all available attempts for this quiz.', 'quiz_attempt_limit'
    return {'enabled': enabled, 'attemptsUsed': stats['used'],
            'attemptLimit': quiz.get('attemptLimit') if enabled and quiz.get('limitAttempts') else None,
            'retakeAfterPass': quiz.get('retakeAfterPass', True) if enabled else True,
            'bestGrade': float(stats['best']) if stats['best'] is not None else None,
            'passed': bool(stats['passed']), 'canAttempt': reason is None,
            'unavailableReason': reason, 'code': code}


def check_locked_attempt(learner, quiz_id, record):
    """Called inside the existing learner transaction. SHARE permits other learners."""
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT policy_enabled, status, limit_attempts, attempt_limit, retake_after_pass
            FROM curriculum.quizzes WHERE id=%s FOR SHARE''', [quiz_id])
        row = cursor.fetchone()
    if row is None:
        raise ValueError('This quiz is no longer available.')
    quiz = dict(zip(('policyEnabled', 'status', 'limitAttempts', 'attemptLimit', 'retakeAfterPass'), row))
    stats = attempt_stats(learner, quiz_id)
    state = learner_policy(quiz, stats)
    if not state['canAttempt']:
        raise QuizPolicyConflict(state)
    next_stats = {'used': stats['used'] + 1,
                  'best': max(float(stats['best']) if stats['best'] is not None else 0, record['grade']),
                  'passed': stats['passed'] + int(record.get('passed') is True)}
    record['quizPolicy'] = learner_policy(quiz, next_stats)


def visible_learner_attempts(detail):
    """Redact a response copy only; staff evidence and stored history stay intact."""
    attempts = detail.get('quizAttempts') or []
    ids = {str(row.get('quizId')) for row in attempts if str(row.get('quizId') or '').isdigit()}
    if not ids:
        return detail
    from .models import QuizPackage
    rules = {str(row['id']): row for row in QuizPackage.objects.using('enrolment').filter(
        pk__in=ids, policy_enabled=True).values('id', 'attempt_history', 'show_correct_answer')}
    if not rules:
        return detail
    result = {**detail, 'quizAttempts': []}
    for row in attempts:
        rule = rules.get(str(row.get('quizId')))
        if not rule:
            result['quizAttempts'].append(row)
            continue
        if not rule['attempt_history']:
            questions = []
        elif not rule['show_correct_answer']:
            questions = [{key: value for key, value in question.items()
                          if key not in ('correctAnswer', 'correctAnswerId', 'correctText')}
                         for question in row.get('questions') or []]
        else:
            questions = row.get('questions') or []
        result['quizAttempts'].append({**row, 'questions': questions})
    return result
