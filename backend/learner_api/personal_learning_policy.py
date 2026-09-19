"""Pure rules for account-owned personal learning; no ORM, network or setup."""
import re
from urllib.parse import urlsplit, parse_qs, unquote

IDENTITY = re.compile(r'^pl\.(\d+)\.(study|preview|all)\.([A-Za-z0-9_-]+)$')


def context_for(identity, account):
    match = IDENTITY.fullmatch(str(identity or ''))
    if not account or account.role != 'admin' or not match or int(match[1]) != account.id:
        raise PermissionError('Personal learning belongs to the signed-in administrator.')
    return {'id': identity, 'account_id': account.id, 'mode': match[2], 'module_id': match[3]}


def request_target(value, identity):
    target = urlsplit(value)
    if target.scheme or target.netloc or not target.path.startswith('/learner_api/'):
        raise ValueError('Unknown personal learning request.')
    path = unquote(target.path)
    query = {key: values[-1] for key, values in parse_qs(target.query).items()}
    identities = [part for part in path.split('/') if part.startswith('pl.')]
    identities += [value for value in query.values() if value.startswith('pl.')]
    if any(value != identity for value in identities):
        raise PermissionError('This request belongs to a different personal course.')
    return path, query


def component_for(detail, activity_id, activity_kind='component'):
    for component in detail['components']:
        if activity_kind == 'quiz':
            if component.get('isQuiz') and str((component.get('quizMeta') or {}).get('quizId')) == str(activity_id):
                return component
        elif str(component.get('componentId')) == str(activity_id):
            return component
    match = re.fullmatch(r'quiz-(\d+)', str(activity_id or ''))
    if match:
        return component_for(detail, match[1], 'quiz')
    raise LookupError('This activity is not assigned to this course.')


def submission_key(component, activity_id):
    return f"{'quiz' if component.get('isQuiz') else component.get('type')}:{activity_id}"


def progress_detail(detail, progress, submissions):
    """Apply only this enrolment's history; never count unvalidated submissions."""
    result = dict(detail)
    result['quizAttempts'] = [item for item in progress if item.get('kind') == 'quiz']
    result['videoProgress'] = [item for item in progress if item.get('kind') == 'video']
    result['componentProgress'] = [item for item in progress if item.get('kind') in ('component', 'quiz_reading')]
    result['componentMarkingStatus'] = {
        str(item.get('activityId')): {
            'status': item.get('status', ''), 'feedback': item.get('coachFeedback', ''),
            'reviewedBy': item.get('reviewedBy', ''), 'reviewedAt': item.get('reviewedAt'),
        } for item in submissions.values() if item.get('activityId')
    }
    return result
