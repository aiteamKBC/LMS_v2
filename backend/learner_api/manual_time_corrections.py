"""Correct one learner-entered duration without creating an attempt or timer evidence."""
import hashlib
import json
from decimal import Decimal

from django.conf import settings
from django.core.serializers.json import DjangoJSONEncoder
from django.db import connections
from django.utils import timezone

from old_otjh import repository
from old_otjh.service import ServiceError

FIELDS = ('id', 'learner_id', 'component_ref', 'component_type', 'kind', 'source_system',
          'component_link_source', 'claimed_seconds', 'reported_time', 'time_taken',
          'actual_seconds', 'actual_basis', 'source_payload', 'submitted_at',
          'declared_completed_at', 'reporting_month', 'deleted_at', 'time_tracking_source')


def encode(value):
    return json.dumps(value, cls=DjangoJSONEncoder, sort_keys=True, separators=(',', ':'))


def revision(record):
    return hashlib.sha256(encode({key: record.get(key) for key in FIELDS}).encode()).hexdigest()


def manual_record(record):
    source = str(record.get('time_tracking_source') or '').lower()
    return (isinstance(record.get('id'), int) and not record.get('deleted_at')
            and not record.get('source_system') and record.get('submitted_at') is not None
            and record.get('component_link_source') in {'direct', 'quiz_ref'}
            and record.get('kind') in {'component', 'video', 'quiz'}
            and 'import' not in source and (source.endswith(':input') or 'manual_input' in source)
            and isinstance(record.get('claimed_seconds'), (int, float))
            and record['claimed_seconds'] >= 0)


def annotate(learner, report):
    """Expose only manual entry controls; never change the signed report's facts."""
    if (report.get('source') != 'lms' or report.get('locked')
            or report.get('student_signature') or report.get('coach_signature')):
        return report
    ids = sorted({row.get('progress_id') for row in report['rows']
                  if isinstance(row.get('progress_id'), int)})
    if not ids:
        return report
    owner = learner['_profile']
    records = repository.query('''SELECT * FROM "Learner".learner_progress_entries
        WHERE learner_id=%s AND id=ANY(%s) AND deleted_at IS NULL''', [owner['id'], ids])
    by_id = {record['id']: record for record in records if manual_record(record)}
    rows = []
    for original in report['rows']:
        item = dict(original)
        record = by_id.get(item.get('progress_id'))
        if record:
            item['manual_time'] = {'progress_id': record['id'], 'seconds': record['claimed_seconds'],
                                   'revision': revision(record)}
        rows.append(item)
    return {**report, 'rows': rows}


def require_open_month(owner, month):
    # Same lock/signoff sources used by the existing staff Activity Log editor.
    if repository.query('''SELECT report_month FROM "Learner".learner_monthly_locks
        WHERE learner_id=%s AND report_month=%s AND locked_at IS NOT NULL AND unlocked_at IS NULL''', [owner['id'], month]):
        raise ServiceError('This monthly log is locked. No time was changed.', 'month_locked', 409)
    if repository.query('''SELECT report_month FROM "Learner".learner_monthly_signatures
        WHERE learner_id=%s AND report_month=%s AND review_confirmed IS TRUE''', [owner['id'], month]):
        raise ServiceError('This monthly log is signed. No time was changed.', 'month_signed', 409)
    if owner.get('aptem_id'):
        events = repository.query('''SELECT event_type FROM "Learner".manual_month_finalization_events
            WHERE aptem_id=%s AND report_month=%s ORDER BY id DESC LIMIT 1''', [owner['aptem_id'], month])
        if events and events[0]['event_type'] == 'finalized':
            raise ServiceError('This monthly log is finalized. No time was changed.', 'month_finalized', 409)
        if repository.query('''SELECT report_month FROM "Learner".monthly_audit_signoffs
            WHERE learner_id=%s AND report_month=%s AND review_confirmed IS TRUE''', [str(owner['aptem_id']), month]):
            raise ServiceError('This monthly log has an audit signature. No time was changed.', 'month_signed', 409)


def queue_refresh(owner):
    if not getattr(settings, 'READ_MODEL_OUTBOX_ENABLED', False):
        return
    from .read_model import enqueue_learner_home_refresh
    from coach_api.read_model import enqueue_coach_dashboard_refresh
    if not enqueue_learner_home_refresh(owner['learner_type'], owner['enrolment_id'],
                                       reason='manual-time-correction', using='enrolment'):
        raise ServiceError('Could not refresh the learner summary. No time was changed.', 'refresh_failed', 503)
    if owner.get('coach_email') and not enqueue_coach_dashboard_refresh(
            owner['coach_email'], reason='manual-time-correction', using='enrolment'):
        raise ServiceError('Could not refresh the coach summary. No time was changed.', 'refresh_failed', 503)


def correct(learner, role, actor, month, progress_id, payload, *, authorize=None):
    """Caller owns an enrolment transaction and has authorized monthly_logs.scope."""
    if role not in {'learner', 'coach', 'admin'} or repository._query_alias.get() not in {None, 'enrolment'}:
        raise ServiceError('This record cannot be changed from this view.', 'forbidden', 403)
    if not isinstance(payload, dict) or set(payload) != {'seconds', 'revision', 'reason'}:
        raise ServiceError('Supply the corrected duration, current revision and reason.')
    seconds = payload['seconds']
    if type(seconds) is not int or not 0 < seconds <= 2147483647:
        raise ServiceError('Enter a duration greater than zero in whole seconds.')
    reason = payload['reason']
    if not isinstance(reason, str) or not 3 <= len(reason.strip()) <= 500:
        raise ServiceError('Explain the correction using 3 to 500 characters.')
    owner = learner['_profile']
    if owner.get('progress_transfer_active'):
        raise ServiceError('This transferred record requires a staff review.', 'record_locked', 409)
    if owner.get('learner_type') not in {'commercial', 'apprenticeship'}:
        raise ServiceError('The learner identity needs review.', 'identity_review_required', 409)
    query = repository.query
    lock = ' FOR UPDATE' if connections['enrolment'].vendor == 'postgresql' else ''
    # Same first lock as monthly signing, so a signature cannot race this save.
    query('SELECT id FROM enrolment."Created_users" WHERE id=%s' + lock, [owner['enrolment_id']])
    query('SELECT id FROM "Learner".learners WHERE id=%s' + lock, [owner['id']])
    if authorize is not None:
        fresh, fresh_role = authorize()
        if fresh['_profile']['id'] != owner['id'] or fresh['_profile']['enrolment_id'] != owner['enrolment_id']:
            raise ServiceError('The learner record has changed. Reload before correcting it.', 'record_changed', 409)
        owner, role = fresh['_profile'], fresh_role
        if role not in {'learner', 'coach', 'admin'} or owner.get('progress_transfer_active'):
            raise ServiceError('This record now requires a staff review.', 'record_locked', 409)
    rows = query('''SELECT * FROM "Learner".learner_progress_entries
        WHERE id=%s AND learner_id=%s AND deleted_at IS NULL''' + lock, [progress_id, owner['id']])
    if not rows:
        raise ServiceError('Activity not found.', 'not_found', 404)
    before = rows[0]
    if not manual_record(before):
        raise ServiceError('Only a manually entered duration can be corrected here. Timer and historical evidence are protected.', 'not_manual_time', 409)
    if not isinstance(payload['revision'], str) or payload['revision'] != revision(before):
        raise ServiceError('This entry has changed. Reload it before correcting the time.', 'record_changed', 409)
    from . import canonical_learning as canonical
    original_month = before.get('reporting_month') or canonical.local_instant(before['submitted_at']).strftime('%Y-%m')
    allocated = canonical.allocations({**before, 'reporting_month': original_month})[0]
    if allocated.get('reporting_month') != month:
        raise ServiceError('Activity not found in this month.', 'not_found', 404)
    for target_month in {month, before.get('reporting_month')} - {None, ''}:
        require_open_month(owner, target_month)
    retained = query('''SELECT id FROM "Learner".learner_progress_entries
        WHERE learner_id=%s AND deleted_at IS NULL AND coalesce(source_system,'')<>''
          AND source_payload->>'original_source_ref'=%s''' + lock,
        [owner['id'], f'progress:{progress_id}'])
    if retained:
        raise ServiceError('This time has a retained audit allocation and needs a staff review. No time was changed.', 'allocation_review_required', 409)
    if before.get('component_ref') and query('''SELECT id FROM "Learner".learner_progress_entries
        WHERE learner_id=%s AND component_ref=%s AND id<>%s AND deleted_at IS NULL
          AND actual_basis='staff:module-progress' AND actual_seconds IS NOT NULL''' + lock,
        [owner['id'], before['component_ref'], progress_id]):
        raise ServiceError('A staff-reviewed allocation controls this activity. Ask your coach to correct that allocation.', 'allocation_review_required', 409)
    if before.get('actual_basis') == 'staff:module-progress' and role == 'learner':
        raise ServiceError('Ask your coach to correct this staff-reviewed entry.', 'review_required', 409)
    segments = query('''SELECT * FROM "Learner".learner_activity_reporting_segments
        WHERE progress_id=%s AND learner_id=%s''' + lock, [progress_id, owner['id']])
    if (len(segments) > 1 or (segments and before['actual_seconds'] is None)
            or any(part.get('reporting_month') not in {None, month} for part in segments)):
        raise ServiceError('This entry has several time allocations and needs a staff review.', 'allocation_review_required', 409)
    submissions = query('''SELECT * FROM "Learner".learning_reflection_submissions
        WHERE progress_entry_id=%s AND learner_id=%s AND learner_kind=%s''' + lock,
        [progress_id, str(owner['enrolment_id']), owner['learner_type']])
    if len(submissions) > 1:
        raise ServiceError('The linked submissions need a staff review.', 'submission_review_required', 409)
    if before.get('component_type') == 'assignment' and not submissions:
        raise ServiceError('Correct assignment time through its linked submission.', 'submission_review_required', 409)
    prepared = []
    for submission in submissions:
        if role == 'learner' and (submission['status'] in {'accepted', 'partial'} or (
                submission['activity_type'] in {'assignment', 'extra_activity'} and submission['status'] == 'submitted_for_tutor_review')):
            raise ServiceError('This submission is under review or accepted. Ask your coach to correct its time.', 'review_required', 409)
        content = submission.get('full_submission') or {}
        try:
            content = json.loads(content) if isinstance(content, str) else content
        except (TypeError, ValueError):
            raise ServiceError('The linked submission needs a staff review.', 'submission_review_required', 409) from None
        if not isinstance(content, dict):
            raise ServiceError('The linked submission needs a staff review.', 'submission_review_required', 409)
        from .current_learning import actual_time_seconds
        for value in (submission.get('actual_time_hours'), content.get('actualTimeHours')):
            if value in (None, ''):
                continue
            saved_seconds = actual_time_seconds(value)
            if saved_seconds is None or min(abs(saved_seconds - old) for old in (before['claimed_seconds'], seconds)) > 1:
                raise ServiceError('The linked submission has a different time and needs a staff review.', 'submission_review_required', 409)
        monthly = content.get('monthlyAssignment') or {}
        if not isinstance(monthly, dict):
            raise ServiceError('The linked submission needs a staff review.', 'submission_review_required', 409)
        if monthly.get('timeEntries'):
            raise ServiceError('Correct the dated time entries in the assignment; its total cannot be changed independently.', 'dated_entries_required', 409)
        prepared.append((submission, content))
    if seconds == before['claimed_seconds']:
        return {'progress_id': progress_id, 'seconds': seconds, 'changed': False,
                'learner_kind': owner['learner_type'], 'learner_id': str(owner['enrolment_id'])}
    try:
        metadata = before.get('source_payload')
        metadata = json.loads(metadata) if isinstance(metadata, str) else metadata
        if metadata is not None and not isinstance(metadata, dict):
            raise ValueError('Non-object source metadata')
        metadata = metadata or {}
    except (ValueError, TypeError):
        raise ServiceError('The correction history needs a staff review.', 'history_review_required', 409) from None
    history = metadata.get('manual_time_corrections', [])
    if not isinstance(history, list):
        raise ServiceError('The correction history needs a staff review.', 'history_review_required', 409)
    event = {'actor_id': actor.id, 'actor_role': role, 'at': timezone.now().isoformat(),
             'reason': reason.strip(), 'previous': {key: before.get(key) for key in
                 ('claimed_seconds', 'reported_time', 'time_taken', 'actual_seconds')}, 'seconds': seconds}
    metadata = {**metadata, 'manual_time_corrections': [*history, event]}
    minutes, remaining = divmod(seconds, 60)
    reported = f'{seconds // 60 if remaining == 0 else Decimal(seconds) / Decimal(60)} minutes'
    saved = query('''UPDATE "Learner".learner_progress_entries
        SET claimed_seconds=%s,reported_time=%s,time_taken=%s,
            actual_seconds=CASE WHEN actual_seconds IS NULL THEN NULL ELSE %s END,
            feed_detail=CASE WHEN feed_detail=reported_time THEN %s ELSE feed_detail END,
            source_payload=%s,ssot_updated_at=CURRENT_TIMESTAMP
        WHERE id=%s AND learner_id=%s AND deleted_at IS NULL RETURNING *''',
        [seconds, reported, f'{minutes:02d}:{remaining:02d}', seconds, reported,
         encode(metadata), progress_id, owner['id']])
    timer_and_assessment = ('verified_seconds', 'server_session_seconds', 'time_tracking_session_ref',
                            'time_tracking_calculation', 'time_tracking_source', 'started_at', 'submitted_at',
                            'declared_completed_at', 'accepted', 'passed', 'grade', 'achieved_score',
                            'total_score', 'feedback')
    if (len(saved) != 1 or saved[0]['claimed_seconds'] != seconds
            or saved[0]['actual_seconds'] != (None if before['actual_seconds'] is None else seconds)
            or any(saved[0].get(key) != before.get(key) for key in timer_and_assessment)):
        raise ServiceError('Could not verify the correction. No time was changed.', 'verification_failed', 503)
    if segments:
        updated = query('''UPDATE "Learner".learner_activity_reporting_segments SET actual_seconds=%s
            WHERE id=%s AND progress_id=%s AND learner_id=%s RETURNING actual_seconds''',
            [seconds, segments[0]['id'], progress_id, owner['id']])
        if len(updated) != 1 or updated[0]['actual_seconds'] != seconds:
            raise ServiceError('Could not verify the time allocation. No time was changed.', 'verification_failed', 503)
    for submission, content in prepared:
        hours = str(seconds / 3600)
        updated = query('''UPDATE "Learner".learning_reflection_submissions
            SET actual_time_hours=%s,full_submission=%s WHERE id=%s AND progress_entry_id=%s
              AND learner_id=%s AND learner_kind=%s RETURNING actual_time_hours,status''',
            [hours, encode({**content, 'actualTimeHours': hours, 'reflectionTimeEdited': True}),
             submission['id'], progress_id, str(owner['enrolment_id']), owner['learner_type']])
        if len(updated) != 1 or str(updated[0]['actual_time_hours']) != hours or updated[0]['status'] != submission['status']:
            raise ServiceError('Could not verify the linked submission. No time was changed.', 'verification_failed', 503)
    queue_refresh(owner)
    return {'progress_id': progress_id, 'seconds': seconds, 'changed': True,
            'learner_kind': owner['learner_type'], 'learner_id': str(owner['enrolment_id'])}
