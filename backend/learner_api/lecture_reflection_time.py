"""Add explicitly entered reflection time through the ordinary activity ledger.

The caller holds the source learner and submission locks in one enrolment
transaction. Drafts never credit time. A server-owned receipt makes retries and
later edits to the same reflection idempotent.
"""
from math import isfinite

from django.db import connections
from django.utils import timezone

RECEIPT = 'lectureReflectionTime'
SECONDS = 'additionalReflectionSeconds'


def add_reflection_time(payload, stored, *, submission_mode):
    receipt = stored.get(RECEIPT)
    if isinstance(receipt, dict) and receipt.get('progressEntryId'):
        # A client cannot replace the receipt or credit the same writing twice.
        requested = payload.get(SECONDS, receipt['seconds'])
        if requested != receipt['seconds']:
            raise ValueError('This reflection time has already been added. Its recorded duration cannot be changed here.')
        return receipt
    if SECONDS not in payload:
        return None
    seconds = payload[SECONDS]
    if type(seconds) not in (int, float) or not isfinite(seconds) or seconds < 0 or seconds != int(seconds):
        raise ValueError('Enter reflection time as a non-negative whole number of seconds.')
    if seconds > 8 * 3600:
        raise ValueError('Reflection time exceeds the 8-hour activity limit. Enter a shorter time.')
    if submission_mode == 'draft' or seconds == 0:
        return None
    if not payload.get('otjhConfirmed') or not payload.get('signedDeclaration'):
        raise ValueError('Confirm the OTJH record and learner declaration before adding reflection time.')
    component_id = str(payload.get('activityId') or '')
    with connections['enrolment'].cursor() as cur:
        cur.execute('SELECT type,settings_json,module_catalogue_id FROM curriculum.components WHERE id=%s', [component_id])
        meta = cur.fetchone()
    if not meta:
        raise ValueError('The lecture could not be found. No time was added.')
    component_type, settings, module_id = meta
    noun = {'live_session': 'session', 'recording_placeholder': 'recording', 'video': 'video'}.get(component_type)
    settings = settings if isinstance(settings, dict) else {}
    is_recording = all(settings.get(key) for key in ('recordingSeriesId', 'recordingSessionNumber', 'recordingDate'))
    if not noun or (component_type == 'video' and not is_recording):
        raise ValueError('Additional reflection time is only available for lectures and their dated recordings.')
    if payload.get('activityType') != noun:
        raise ValueError('The reflection does not match this lecture activity. Reload it before adding time.')
    from .components import SOURCE_MODELS
    from .active_users import learner_profile_for_source, save_progress_record, _progress_record_minutes
    model = SOURCE_MODELS[payload['learnerKind']]
    try:
        source = model.objects.get(pk=payload['learnerId'])
    except model.DoesNotExist as exc:
        raise ValueError('Learner not found. No time was added.') from exc
    from .learning_plan import effective_training_plan
    if module_id not in {str(row.get('moduleId') or '') for row in effective_training_plan(source)}:
        raise ValueError('This lecture is not in your learning plan. No time was added.')
    learner = learner_profile_for_source(source, payload['learnerId'], active_only=True)
    if learner is None:
        raise ValueError('An active learner profile is required to add reflection time.')
    history = learner.training_plan_progress
    completed = any(row.get('componentId') == component_id and row.get('kind') in ('component', 'video')
                    and row.get('passed') is not False for row in history)
    from .live_session_progress import read_live_credits
    credits = read_live_credits(source, module_ids=[module_id])
    # Watching a recording alone is not a new completion route. Retain the
    # existing submitted-completion or attendance requirement.
    matches = [row for row in credits if row['componentId'] == component_id
               and row.get('timeTrackingSource') != 'verified_recording_watch']
    credit = matches[0] if len(matches) == 1 else None
    if not completed and credit is None:
        raise ValueError('Complete the lecture or recording before adding reflection time. You can keep the reflection as a draft.')
    from .working_rules import resolve_completion_instants
    now = timezone.now()
    declared, reason = resolve_completion_instants(payload, now, component_id=component_id)
    record = {
        'kind': 'video' if component_type == 'video' else 'component',
        'componentType': component_type, 'componentId': component_id,
        'reportedTime': f'{seconds / 60:g} minutes', 'claimedSeconds': int(seconds),
        'verifiedSeconds': 0, 'timeTrackingSource': 'lecture_reflection:input',
        'timeTaken': f'{int(seconds) // 60:02d}:{int(seconds) % 60:02d}',
        'submittedAt': now.isoformat(), 'startedAt': now.isoformat(),
        'declaredCompletedAt': declared.isoformat() if declared else None,
        'outsideWorkingHours': bool(reason), 'submissionValidationReason': reason,
        'retakeTimeChoice': 'add',
    }
    from .retake_timing import validate_activity_time
    validate_activity_time(record, history, seconds_for=lambda row: _progress_record_minutes(row) * 60,
                           initial_seconds=credit['hours'] * 3600 if credit else 0)
    progress = save_progress_record(learner, record, {
        'kind': 'component', 'action': 'Added lecture reflection time',
        'title': payload.get('activityTitle') or 'Lecture reflection',
        'detail': record['reportedTime'], 'at': record['submittedAt'],
    })
    return {'seconds': int(seconds), 'progressEntryId': progress.pk,
            'addedAt': record['submittedAt'], 'countedSeconds': record['countedSeconds']}
