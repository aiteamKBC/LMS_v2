"""Add explicitly entered reflection time through the ordinary activity ledger.

The caller holds the source learner and submission locks in one enrolment
transaction. Drafts never credit time. A server-owned receipt makes retries and
later edits to the same reflection idempotent.
"""
from math import isfinite

from django.db import connections
from django.utils import timezone
from .lecture_reflection_operations import requested_operation, replayed_receipt

RECEIPT = 'lectureReflectionTime'
SECONDS = 'additionalReflectionSeconds'


def add_reflection_time(payload, stored, *, submission_mode):
    receipt = stored.get(RECEIPT)
    operation = requested_operation(payload)
    replay = replayed_receipt(payload, stored)
    if replay:
        return replay
    previous_reflection = receipt['seconds'] if isinstance(receipt, dict) and receipt.get('progressEntryId') else 0
    if operation and (operation['expectedReflectionSeconds'] != previous_reflection or
            operation['expectedProgressEntryId'] != (receipt or {}).get('progressEntryId', 0)):
        raise ValueError('The saved reflection time changed. Reload the reflection and choose again. Your entered time is kept.')
    if submission_mode == 'draft':
        return receipt if isinstance(receipt, dict) and receipt.get('progressEntryId') else None
    if isinstance(receipt, dict) and receipt.get('progressEntryId') and operation is None:
        # A client cannot replace the receipt or credit the same writing twice.
        requested = payload.get(SECONDS, receipt['seconds'])
        if requested != receipt['seconds']:
            raise ValueError('This reflection time has already been added. Its recorded duration cannot be changed here.')
        return receipt
    if SECONDS not in payload:
        if operation is not None:
            raise ValueError('Enter reflection time for this action.')
        return None
    seconds = payload[SECONDS]
    if type(seconds) not in (int, float) or not isfinite(seconds) or seconds < 0 or seconds != int(seconds):
        raise ValueError('Enter reflection time as a non-negative whole number of seconds.')
    if seconds > 8 * 3600:
        raise ValueError('Reflection time exceeds the 8-hour activity limit. Enter a shorter time.')
    if seconds == 0 and operation is not None:
        raise ValueError('Enter reflection time greater than zero.')
    if seconds == 0:
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
    # Consume the current server completion rules. Linked live/recording cards
    # can represent one lecture whose hours belong to the recording card.
    matches = [row for row in credits if row.get('moduleId', module_id) == module_id
               and component_id in (row.get('creditComponentIds') or [row['componentId']])]
    positive = [row for row in matches if row['hours'] > 0]
    own = [row for row in matches if row['componentId'] == component_id]
    if len(positive) > 1 or len(own) > 1:
        raise ValueError('The lecture time is ambiguous. Ask your coach to review it before adding time.')
    credit = positive[0] if positive else own[0] if own else None
    if not completed and credit is None:
        raise ValueError('Complete the lecture or recording before adding reflection time. You can keep the reflection as a draft.')
    identities = set(credit.get('creditComponentIds') or [credit['componentId']]) if credit else {component_id}
    previous_ids = {row.get('componentId') for row in history if row.get('componentId') in identities
                    and row.get('kind') in ('component', 'video') and row.get('passed') is not False}
    if len(previous_ids) > 1:
        raise ValueError('This lecture has time on multiple linked activities. Ask your coach to review it before adding time.')
    target = next(iter(previous_ids)) if previous_ids else credit['componentId'] if credit else component_id
    if operation and receipt:
        from old_otjh.repository import query
        original = query('''SELECT id,claimed_seconds FROM "Learner".learner_progress_entries
            WHERE id=%s AND learner_id=%s AND component_ref=ANY(%s) AND deleted_at IS NULL''',
            [receipt['progressEntryId'], learner.pk, sorted(identities)])
        expected_claim = receipt.get('ledgerSeconds', receipt.get('inputSeconds', receipt['seconds']))
        if len(original) != 1 or original[0].get('claimed_seconds') != expected_claim:
            raise ValueError('The original reflection time entry needs a coach review. No time was changed.')
    if len(identities) > 1:
        # A protected allocation on either card protects the same lecture.
        from old_otjh.repository import query
        protected = query('''SELECT source_system,actual_basis FROM "Learner".learner_progress_entries
            WHERE learner_id=%s AND component_ref=ANY(%s) AND deleted_at IS NULL''', [learner.pk, sorted(identities)])
        if any(row.get('source_system') or row.get('actual_basis') == 'staff:module-progress' for row in protected):
            raise ValueError('This activity has historical or staff-reviewed hours. Ask your coach to review its time.')
    if target != component_id:
        with connections['enrolment'].cursor() as cur:
            cur.execute('SELECT type,settings_json,module_catalogue_id FROM curriculum.components WHERE id=%s', [target])
            target_meta = cur.fetchone()
        if not target_meta or target_meta[2] != module_id:
            raise ValueError('The linked lecture time could not be resolved. No time was added.')
        component_type = target_meta[0]
    from .working_rules import resolve_completion_instants
    now = timezone.now()
    declared, reason = resolve_completion_instants(payload, now, component_id=component_id)
    record = {
        'kind': 'video' if component_type == 'video' else 'component',
        'componentType': component_type, 'componentId': target,
        'reportedTime': f'{seconds / 60:g} minutes', 'claimedSeconds': int(seconds),
        'verifiedSeconds': 0, 'timeTrackingSource': 'lecture_reflection:input',
        'timeTaken': f'{int(seconds) // 60:02d}:{int(seconds) % 60:02d}',
        'submittedAt': now.isoformat(), 'startedAt': now.isoformat(),
        'declaredCompletedAt': declared.isoformat() if declared else None,
        'outsideWorkingHours': bool(reason), 'submissionValidationReason': reason,
        'retakeTimeChoice': 'add',
    }
    from .retake_timing import validate_activity_time
    baseline = round(credit['hours'] * 3600) if credit else 0
    seconds_for = lambda row: _progress_record_minutes(row) * 60
    baseline_record = {**record, 'retakeTimeChoice': 'retry', 'reportedTime': f'{baseline / 60:g} minutes',
        'claimedSeconds': baseline, 'verifiedSeconds': (credit or {}).get('verifiedSeconds', 0),
        'timeTaken': f'{int(baseline) // 60:02d}:{int(baseline) % 60:02d}',
        'timeTrackingSource': (credit or {}).get('timeTrackingSource', 'verified_session_credit')}
    validate_activity_time(baseline_record, history, seconds_for=seconds_for, initial_seconds=baseline)
    current_total = baseline_record['countedSeconds']
    if previous_reflection > current_total:
        raise ValueError('The saved reflection time no longer matches this lecture. Ask your coach to review it.')
    lecture_seconds = round(max(baseline, current_total - previous_reflection))
    from .retake_timing import combine_seconds
    mode = operation['choice'] if operation else 'add'
    reflection_seconds = int(combine_seconds(previous_reflection, seconds, mode))
    if lecture_seconds + previous_reflection > current_total:
        # Attendance can gain verified credit after the original reflection.
        # Retain that new credit AND the existing writing time before deciding.
        floor = lecture_seconds + previous_reflection
        baseline_record.update(claimedSeconds=floor, reportedTime=f'{floor / 60:g} minutes',
            timeTaken=f'{floor // 60:02d}:{floor % 60:02d}')
        validate_activity_time(baseline_record, history, seconds_for=seconds_for, initial_seconds=baseline)
    if mode != 'add':
        # Quiz arithmetic applies to writing time only. A correction must never
        # replace attendance/recording credit with the smaller writing duration.
        total = lecture_seconds + reflection_seconds
        record.update(retakeTimeChoice=mode, claimedSeconds=total,
            reportedTime=f'{total / 60:g} minutes', timeTaken=f'{total // 60:02d}:{total % 60:02d}')
        if mode == 'correct':
            record['retakeTimeReason'] = operation['reason']
    # Existing native time may be less than lecture credit already included in
    # the read projection. Append that server-owned baseline before adding the
    # writing time, so the supplement cannot absorb the learner's new minutes.
    materialize = bool(previous_ids and baseline_record['countedSeconds'] > baseline_record['retakePreviousSeconds'])
    effective_history = [*history, baseline_record] if materialize else history
    validate_activity_time(record, effective_history, seconds_for=seconds_for, initial_seconds=baseline)
    if materialize:
        save_progress_record(learner, baseline_record, {'kind': 'component',
            'action': 'Recorded existing verified lecture credit', 'title': 'Lecture credit',
            'detail': baseline_record['reportedTime'], 'at': baseline_record['submittedAt']})
    progress = save_progress_record(learner, record, {
        'kind': 'component', 'action': 'Added lecture reflection time',
        'title': payload.get('activityTitle') or 'Lecture reflection',
        'detail': record['reportedTime'], 'at': record['submittedAt'],
    })
    return {'seconds': int(reflection_seconds), 'progressEntryId': progress.pk,
            'addedAt': record['submittedAt'], 'countedSeconds': record['countedSeconds'],
            'lectureSeconds': int(lecture_seconds), 'inputSeconds': int(seconds), 'choice': mode,
            'ledgerSeconds': record['claimedSeconds'],
            **({'operationId': operation['id'], 'reason': operation['reason']} if operation else {})}
