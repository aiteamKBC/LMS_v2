"""Server-owned reflection time decisions and immutable submission snapshots."""
from copy import deepcopy
from uuid import UUID

RECEIPT = 'lectureReflectionTime'
HISTORY = 'lectureReflectionTimeHistory'
ATTEMPTS = 'lectureReflectionAttempts'
OPERATION = 'reflectionTimeOperation'
PENDING = 'lectureReflectionPendingTime'


def requested_operation(payload):
    value = payload.get(OPERATION)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('Choose how this reflection time should count.')
    try:
        ident = str(UUID(value.get('id', '')))
    except (ValueError, TypeError, AttributeError):
        raise ValueError('Reload the reflection before recording a new time action.') from None
    if value.get('choice') not in {'correct', 'add', 'retry'}:
        raise ValueError('Choose correction, addition or another reflection attempt.')
    reason = value.get('reason', '')
    if not isinstance(reason, str) or len(reason) > 500 or (value['choice'] == 'correct' and len(reason.strip()) < 3):
        raise ValueError('Explain the time correction using 3 to 500 characters.')
    for key in ('expectedReflectionSeconds', 'expectedProgressEntryId'):
        if type(value.get(key)) is not int or value[key] < 0:
            raise ValueError('Reload the reflection before recording a new time action.')
    return {**value, 'id': ident, 'reason': reason.strip()}


def receipts(stored):
    history = stored.get(HISTORY, [])
    if not isinstance(history, list) or any(not isinstance(row, dict) for row in history):
        raise ValueError('The reflection time history needs a coach review.')
    result = deepcopy(history)
    receipt = stored.get(RECEIPT)
    if isinstance(receipt, dict) and receipt.get('progressEntryId') and not any(
            row.get('progressEntryId') == receipt['progressEntryId'] for row in result):
        result.append(deepcopy(receipt))
    return result


def replayed_receipt(payload, stored):
    op = requested_operation(payload)
    if op is None:
        return None
    for row in receipts(stored):
        if row.get('operationId') == op['id']:
            if (row.get('choice') != op['choice'] or row.get('inputSeconds') != payload.get('additionalReflectionSeconds')
                    or row.get('reason', '') != op['reason']):
                raise ValueError('This time action was already submitted with different values. Reload before choosing another action.')
            return row
    return None


def preserve_time_history(incoming, stored, receipt, *, status=None, submitted_at=None,
                          feedback=None, reviewer=None, reviewed_at=None):
    """A draft or old client cannot clear history, receipts or snapshots."""
    pending = requested_operation(incoming)
    leaving_submission = status and status != 'draft' and incoming.get('submissionMode') == 'draft' and (
        pending or stored.get(RECEIPT) or (incoming.get('reflectionDraftIntent') == 'manual'
            and incoming.get('activityType') in {'session', 'recording', 'video'}))
    for key in (HISTORY, ATTEMPTS, OPERATION, PENDING, 'reflectionDraftIntent'):
        incoming.pop(key, None)
    if pending and incoming.get('submissionMode') == 'draft':
        seconds = incoming.get('additionalReflectionSeconds', 0)
        if type(seconds) not in (int, float) or not 0 <= seconds <= 8 * 3600 or int(seconds) != seconds:
            raise ValueError('Enter reflection time as whole seconds, up to 8 hours.')
        incoming[PENDING] = {'operation': pending, 'seconds': int(seconds)}
    history = receipts(stored)
    attempts = deepcopy(stored.get(ATTEMPTS, []))
    if not isinstance(attempts, list):
        raise ValueError('The reflection attempt history needs a coach review.')
    is_new = receipt and not any(row.get('progressEntryId') == receipt['progressEntryId'] for row in history)
    if is_new or leaving_submission:
        if status and status != 'draft':
            content = deepcopy(stored)
            for key in (ATTEMPTS, HISTORY, OPERATION, PENDING):
                content.pop(key, None)
            stamp = lambda value: value.isoformat() if hasattr(value, 'isoformat') else value
            attempts.append({'status': status, 'submittedAt': stamp(submitted_at),
                'coachFeedback': feedback, 'reviewedBy': reviewer, 'reviewedAt': stamp(reviewed_at), 'content': content})
        if is_new:
            history.append(deepcopy(receipt))
    if history:
        incoming[HISTORY] = history
    if attempts:
        incoming[ATTEMPTS] = attempts
