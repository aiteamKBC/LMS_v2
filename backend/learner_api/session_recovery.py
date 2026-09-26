"""Link approved lecture excuses to coach-completed catch-up sessions."""
import json
from collections import defaultdict

from django.db import connections, transaction, DatabaseError, router
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_POST
from login.permissions import learner_self_or_admin


def apply_recovery_to_rows(rows):
    from curriculum_api.session_results import apply_recovery
    grouped = defaultdict(list)
    for row in rows:
        if row.get('occurrence_id'):
            grouped[row['occurrence_id']].append(row)
    sessions = [{'id': key, 'attendance': [{'email': str(row['learner_email']).strip().casefold(),
        'status': row['attendance_status'], 'seconds': row.get('attended_seconds', 0),
        'attendance': 1 if row['attendance_status'] == 'present' else 0,
        'excused': False, 'catchupCompleted': False} for row in group]} for key, group in grouped.items()]
    apply_recovery(sessions)
    for session in sessions:
        for row, person in zip(grouped[session['id']], session['attendance']):
            row['catchup_completed'] = person['catchupCompleted']
            row['excused'] = person['excused']
            row['raw_attendance_status'] = person['rawStatus']
            row['effective_attendance_status'] = person['effectiveStatus']
            row['effective_attendance'] = person['effectiveAttendance']
            row['final_outcome'] = person['finalOutcome']
            row['excuse_status'] = person['excuseStatus']
            row['recovery_status'] = person['recoveryStatus']
            if person['catchupCompleted']:
                row['absence_reason'] = (
                    'Excused absence; attended approved alternative session'
                    if person.get('recoveryType') == 'alternative'
                    else 'Excused absence; completed coach catch-up'
                )
            elif person['excused']:
                row['absence_reason'] = (
                    'Excused absence; alternative session scheduled'
                    if person.get('recoveryType') == 'alternative'
                    else 'Excused absence; coach catch-up required'
                )
    return rows


def refresh_catchup_attendance(event_key):
    """Queue refreshed effective results without rewriting raw Teams attendance."""
    from coach_api.models import CoachAbsenceReport, CoachCalendarEvent
    from .absence_reports import _kbc_attendance_report_id
    event = CoachCalendarEvent.objects.filter(event_key=event_key, event_type='catch-up', status='completed').first()
    if not event:
        return
    # A completed catch-up recovers the lecture only if the learner attended it.
    from .catchup_outcomes import learner_attended_catchup
    if not learner_attended_catchup(event_key):
        return
    reports = list(CoachAbsenceReport.objects.filter(catchup_event_key=event_key, status='approved'))
    with transaction.atomic(), connections['default'].cursor() as cursor:
        from curriculum_api.live_session_absences import complete_reported_catchup
        from curriculum_api.models import LiveSessionAbsence
        complete_reported_catchup(
            database=router.db_for_write(LiveSessionAbsence) or 'default',
            event_key=event_key,
            source_learner_ids=[report.learner_id for report in reports],
        )
        for report in reports:
            cursor.execute('''SELECT d.learner_id,d.session_id FROM "Learner".learner_attendance_details d
                JOIN "Learner".learners l ON l.id=d.learner_id
                WHERE l.enrolment_id=%s AND lower(btrim(l.email))=%s AND d.source='microsoft_teams' ''',
                [report.learner_id, str(event.learner_email or '').strip().casefold()])
            for attendance_learner_id, session_id in cursor.fetchall():
                if _kbc_attendance_report_id(f'{report.learner_id}:teams:{session_id}') != report.attendance_id:
                    continue
                cursor.execute('''UPDATE "Learner".learner_attendance_details
                    SET catchup_completed=true,
                        absence_reason='Excused absence; completed coach catch-up',updated_at=now()
                    WHERE learner_id=%s AND session_id=%s AND source='microsoft_teams' ''',
                    [attendance_learner_id, session_id])
                cursor.execute('''INSERT INTO curriculum.session_result_jobs(live_session_id)
                    SELECT live_session_id FROM curriculum.live_session_occurrences WHERE id=%s
                    ON CONFLICT(live_session_id) DO UPDATE
                    SET state=CASE WHEN session_result_jobs.state='running' THEN 'running' ELSE 'queued' END,
                        requested_at=now(),next_attempt_at=now(),attempts=0''', [session_id])


@require_POST
@csrf_protect
@learner_self_or_admin(kwarg='learner_id')
def link_catchup(request, kind, learner_id):
    from coach_api.models import CoachAbsenceReport, CoachCalendarEvent
    from .absence_reports import _source_learner, _catchup_booking, RecoveryPlanError
    from .models import LearnerProfile
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict):
            raise ValueError()
        report_id = int(payload.get('reportId'))
        event_key = str(payload.get('eventKey') or '')
    except (ValueError, TypeError, UnicodeDecodeError):
        return JsonResponse({'error': 'Select an absence report and a catch-up booking.'}, status=400)
    learner = _source_learner(kind, learner_id)
    if not learner:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    try:
        with transaction.atomic():
            report = CoachAbsenceReport.objects.select_for_update().filter(pk=report_id, learner_id=learner_id).first()
            if not report or report.status == 'declined':
                return JsonResponse({'error': 'Absence report not found.'}, status=404)
            # A completed catch-up the learner missed can be replaced by a new booking.
            from .catchup_outcomes import learner_attended_catchup
            if (report.catchup_event_key
                    and CoachCalendarEvent.objects.filter(event_key=report.catchup_event_key, status='completed').exists()
                    and learner_attended_catchup(report.catchup_event_key)):
                return JsonResponse({'error': 'A completed catch-up cannot be replaced.'}, status=409)
            mirror = LearnerProfile.objects.filter(enrolment_id=learner_id).first()
            _catchup_booking(learner, mirror, event_key, report.session_date, lock=True)
            report.catchup_event_key = event_key
            report.recovery_method = 'catch-up'
            # A learner's recovery choice needs no coach approval, as when reporting.
            report.status = CoachAbsenceReport.STATUS_APPROVED
            report.save(update_fields=['catchup_event_key', 'recovery_method', 'status', 'updated_at'])
            _record_linked_catchup(learner_id, report.attendance_id, event_key)
        return JsonResponse({'saved': True, 'message': 'Catch-up linked. The absence is made up once your coach confirms the catch-up is completed.'})
    except RecoveryPlanError as error:
        return JsonResponse({'error': str(error)}, status=409)
    except DatabaseError:
        return JsonResponse({'error': 'Catch-up could not be linked. Please retry.'}, status=503)


def _record_linked_catchup(learner_id, attendance_id, event_key):
    """Point the reported live-session absence at the newly linked catch-up.

    Completion is matched on the absence ledger (see complete_reported_catchup),
    so a catch-up linked after the report must be recorded there as well.
    KBC register absences have no ledger row and are left unchanged.
    """
    from curriculum_api.live_session_absences import recovery_status_for
    from curriculum_api.models import LiveSessionAbsence, LiveSessionLearnerAttendance
    from .absence_reports import _kbc_attendance_report_id
    database = router.db_for_write(LiveSessionAbsence) or 'default'
    absences = LiveSessionAbsence.objects.using(database)
    matches = [
        row for row in absences.filter(source_learner_id=learner_id)
        .values('id', 'occurrence_id', 'learner_profile_id')
        if _kbc_attendance_report_id(f"{learner_id}:teams:{row['occurrence_id']}") == attendance_id
    ]
    status, now = recovery_status_for('catch-up'), timezone.now()
    for row in matches:
        absences.filter(pk=row['id']).update(
            recovery_status=status, recovery_method='catch-up', recovery_reference=event_key, updated_at=now,
        )
        LiveSessionLearnerAttendance.objects.using(database).filter(
            occurrence_id=row['occurrence_id'],
            learner_profile_id=row['learner_profile_id'],
            attendance_status=LiveSessionLearnerAttendance.STATUS_ABSENT,
        ).update(recovery_status=status, updated_at=now)
    return len(matches)
