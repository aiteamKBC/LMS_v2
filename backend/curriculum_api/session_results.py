"""Saved session results. GET never calls Graph, provisions tables or starts jobs."""
import json
import logging
from collections import defaultdict

from django.db import connections, DatabaseError, transaction
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST
from login.permissions import require_role, learner_self_or_staff

from .session_results_policy import session_roster, attendance_csv, instant, session_runs, evidence_seconds
from .session_media_policy import hidden_artifact_ids, recording_transcript_links, transcript_timing_ready, artifact_metadata
from .session_sync_runtime import start_requested_sync
from .session_transfer_progress import summarize_transfers

log = logging.getLogger(__name__)


def read(sql, params=()):
    with connections['default'].cursor() as cursor:
        cursor.execute(sql, params)
        names = [column[0] for column in cursor.description]
        return [dict(zip(names, values)) for values in cursor.fetchall()]


def json_value(value, default):
    if isinstance(value, type(default)):
        return value
    try:
        decoded = json.loads(value or '')
        return decoded if isinstance(decoded, type(default)) else default
    except (ValueError, TypeError):
        return default


def archive_schema_missing(error):
    """Only a missing table allows explicitly degraded saved-result reads."""
    cause = error.__cause__ or error
    return getattr(cause, 'sqlstate', None) == '42P01'


def launch_expectations(series_ids, emails=None):
    """Authenticated LMS launches add an expected learner only to that occurrence.

    The learner Join endpoint already checks their assigned module. A launch is
    never presence; the completed report still decides the duration and result.
    """
    params = [list(series_ids)]
    scope = ''
    if emails is not None:
        scope = ' AND lower(btrim(viewer_email))=ANY(%s)'
        params.append(list(emails))
    rows = read('''SELECT DISTINCT live_session_id,occurrence_id,lower(btrim(viewer_email)) AS email
        FROM curriculum.live_session_join_launches WHERE live_session_id=ANY(%s)
        AND coalesce(viewer_email,'')<>'' ''' + scope, params)
    by_series, by_occurrence = defaultdict(set), defaultdict(set)
    for row in rows:
        by_series[row['live_session_id']].add(row['email'])
        by_occurrence[row['occurrence_id']].add(row['email'])
    return by_series, by_occurrence


def result_rows(series, *, session_number=None, email=None):
    params = [series['id']]
    where = ''
    if session_number is not None:
        where = ' AND session_number=%s'
        params.append(session_number)
    occurrences = read('SELECT * FROM curriculum.live_session_occurrences WHERE live_session_id=%s' + where + ' ORDER BY session_number,id', params)
    ids = [item['id'] for item in occurrences]
    if not ids:
        return []
    records = read('SELECT * FROM curriculum.live_session_attendance WHERE occurrence_id=ANY(%s)', [ids])
    archive_ready = True
    try:
        artifacts = read('''SELECT a.id,a.occurrence_id,a.artifact_type,a.created_datetime,a.end_datetime,
            a.call_id,a.content_correlation_id,a.metadata,
            r.status AS archive_status,r.transcript_text,r.updated_at AS archived_at
            FROM curriculum.live_session_artifacts a
            LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id
            WHERE a.occurrence_id=ANY(%s) ORDER BY a.created_datetime,a.id''', [ids])
    except DatabaseError as error:
        if not archive_schema_missing(error):
            raise
        archive_ready = False
        artifacts = read('''SELECT id,occurrence_id,artifact_type,created_datetime,end_datetime,
            call_id,content_correlation_id,metadata,
            NULL AS archive_status,NULL AS transcript_text,NULL AS archived_at
            FROM curriculum.live_session_artifacts WHERE occurrence_id=ANY(%s)
            ORDER BY created_datetime,id''', [ids])
    attendance_by_id, artifacts_by_id = defaultdict(list), defaultdict(list)
    for record in records:
        record['intervals'] = json_value(record.get('intervals'), [])
        attendance_by_id[record['occurrence_id']].append(record)
    hidden = set()
    for occurrence_id in ids:
        hidden.update(hidden_artifact_ids([row for row in artifacts if row['occurrence_id'] == occurrence_id]))
    for artifact in artifacts:
        if email is not None and artifact['id'] in hidden:
            continue
        artifacts_by_id[artifact['occurrence_id']].append({
            'id': artifact['id'], 'type': artifact['artifact_type'], 'createdAt': artifact['created_datetime'],
            'state': artifact['archive_status'] or 'pending', 'text': artifact['transcript_text'],
            'hiddenFromLearners': artifact['id'] in hidden,
            'endsAt': instant(artifact.get('end_datetime')),
            'timingReady': transcript_timing_ready(artifact) if artifact['artifact_type'] == 'transcript' else False,
            'transcriptLinks': recording_transcript_links(artifact, [row for row in artifacts
                if row['occurrence_id'] == artifact['occurrence_id'] and (email is None or row['id'] not in hidden)])
                if artifact['artifact_type'] == 'recording' else [],
        })
    expected = set(json_value(series.get('attendees'), []))
    _by_series, launches = launch_expectations([series['id']])
    results = []
    for item in occurrences:
        complete = bool(item.get('attendance_report_id') and item.get('actual_end'))
        roster = session_roster(expected | launches[item['id']], attendance_by_id[item['id']], complete=complete)
        runs = session_runs(item, attendance_by_id[item['id']])
        results.append({'id': item['id'], 'seriesId': series['id'], 'sessionNumber': item['session_number'],
                        'title': series.get('module_title') or '',
                        'startsAt': instant(item['scheduled_start']), 'endsAt': instant(item['scheduled_end']),
                        'actualStartsAt': instant(runs[0]['startsAt']) if runs else instant(item.get('actual_start')),
                        'actualEndsAt': max(instant(run['endsAt']) for run in runs) if runs else instant(item.get('actual_end')),
                        'runs': runs,
                        'state': item['status'], 'reportReady': complete, 'archiveReady': archive_ready,
                        'syncedAt': instant(item.get('artifacts_synced_at')),
                        'attendance': roster, 'artifacts': artifacts_by_id[item['id']]})
    apply_recovery(results)
    if email is not None:
        for item in results:
            item['attendance'] = [person for person in item['attendance'] if person['email'] == email.casefold()]
    return results


def apply_recovery(results):
    """Layer recovery over raw Teams evidence using exact learner/occurrence identity.

    ``status`` and ``attendance`` remain the result of the original meeting.
    Recovery only changes the explicitly named effective fields.
    """
    from learner_api.absence_reports import _kbc_attendance_report_id
    from learner_api.alternative_recovery import alternative_occurrence_id
    emails = list({person['email'] for item in results for person in item['attendance'] if person['email']})
    if not emails:
        return
    profiles = read('SELECT enrolment_id,lower(btrim(email)) AS email FROM "Learner".learners WHERE lower(btrim(email))=ANY(%s)', [emails])
    email_ids = defaultdict(set)
    for profile in profiles:
        if profile['enrolment_id']:
            email_ids[profile['email']].add(profile['enrolment_id'])
    report_keys = {_kbc_attendance_report_id(f"{next(iter(email_ids[p['email']]))}:teams:{item['id']}")
                   for item in results for p in item['attendance'] if len(email_ids[p['email']]) == 1}
    if not report_keys:
        return
    reports = read('''SELECT r.attendance_id,r.status,r.recovery_method,r.catchup_event_key,r.learner_id,
        e.status AS catchup_status,e.learner_email,e.event_type
        FROM "Coach".coach_absence_report r
        LEFT JOIN "Coach".coach_calendar_event e ON e.event_key=r.catchup_event_key
        WHERE r.attendance_id=ANY(%s) ORDER BY r.updated_at,r.id''', [list(report_keys)])
    target_ids = sorted({
        alternative_occurrence_id(report.get('catchup_event_key'))
        for report in reports
        if report.get('recovery_method') == 'alternative'
    } - {''})
    alternative_evidence = defaultdict(list)
    target_states = {}
    if target_ids:
        for record in read('''SELECT occurrence_id,email,total_attendance_seconds,intervals
            FROM curriculum.live_session_attendance WHERE occurrence_id=ANY(%s)''', [target_ids]):
            email = str(record.get('email') or '').strip().casefold()
            if email:
                record['intervals'] = json_value(record.get('intervals'), [])
                alternative_evidence[(record['occurrence_id'], email)].append(record)
        target_states = {
            row['id']: row for row in read('''SELECT id,status,actual_end,attendance_report_id,scheduled_end
                FROM curriculum.live_session_occurrences WHERE id=ANY(%s)''', [target_ids])
        }
    reports = {str(report['attendance_id']): report for report in reports}
    for item in results:
        for person in item['attendance']:
            raw_status = person.get('rawStatus', person.get('status'))
            raw_attendance = person.get('rawAttendance', person.get('attendance'))
            person.update(rawStatus=raw_status, rawAttendance=raw_attendance,
                          excuseStatus='none', recoveryStatus='none',
                          recoveryType='none',
                          effectiveStatus=raw_status, effectiveAttendance=raw_attendance,
                          finalOutcome=raw_status)
            ids = email_ids[person['email']]
            if len(ids) != 1:
                continue
            learner_id = next(iter(ids))
            report = reports.get(str(_kbc_attendance_report_id(f"{learner_id}:teams:{item['id']}")))
            if not report or report['learner_id'] != learner_id:
                continue
            person['excuseStatus'] = report['status'] or 'none'
            person['excused'] = report['status'] == 'approved'
            recovery_method = report.get('recovery_method') or 'none'
            person['recoveryType'] = recovery_method
            coach_completed = bool(person['excused'] and report['catchup_status'] == 'completed'
                and report['event_type'] == 'catch-up'
                and str(report['learner_email'] or '').strip().casefold() == person['email'])
            target_id = alternative_occurrence_id(report.get('catchup_event_key'))
            alternative_seconds = evidence_seconds(alternative_evidence[(target_id, person['email'])]) if target_id else 0
            alternative_completed = bool(
                person['excused']
                and recovery_method == 'alternative'
                and alternative_seconds > 180
            )
            person['catchupCompleted'] = bool(coach_completed or alternative_completed)
            if person['catchupCompleted'] and raw_status == 'absent':
                person.update(recoveryStatus='completed', effectiveStatus='made_up',
                              effectiveAttendance=1, finalOutcome='made_up')
            elif person['excused'] and raw_status == 'absent':
                if recovery_method == 'alternative' and target_id:
                    target = target_states.get(target_id) or {}
                    target_complete = bool(target.get('actual_end') and target.get('attendance_report_id'))
                    target_status = str(target.get('status') or '').strip().casefold()
                    recovery_status = (
                        'cancelled'
                        if target_status in {'cancelled', 'canceled', 'deleted', 'failed', 'superseded'}
                        else 'missed' if target_complete else 'scheduled'
                    )
                elif report['event_type'] == 'catch-up':
                    recovery_status = report['catchup_status']
                elif recovery_method == 'recorded':
                    recovery_status = 'recording_only'
                else:
                    recovery_status = 'none'
                person.update(recoveryStatus=recovery_status or 'none',
                              effectiveStatus='absent_excused', effectiveAttendance=0,
                              finalOutcome='absent_excused')


def unavailable():
    log.exception('Could not read saved session results')
    return JsonResponse({'error': 'Saved session results are unavailable. Check the session archive setup and try again.'}, status=503)


def add_sync_progress(jobs):
    if not jobs:
        return
    rows = read('''SELECT o.live_session_id,o.session_number,a.artifact_type,r.status,
        CASE WHEN a.metadata::jsonb->'lmsArchiveProgress'->>'leaseId'=j.lease_id
            THEN (a.metadata::jsonb->'lmsArchiveProgress')-'leaseId' ELSE NULL END AS transfer
        FROM curriculum.live_session_artifacts a
        JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
        JOIN curriculum.session_result_jobs j ON j.live_session_id=o.live_session_id
        LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id
        WHERE o.live_session_id=ANY(%s) AND a.artifact_type IN ('recording','transcript')''',
        [[job['live_session_id'] for job in jobs]])
    for job in jobs:
        job['progress'] = summarize_transfers([row for row in rows if row['live_session_id'] == job['live_session_id']])
        if job['state'] not in {'running', 'failed'}:
            job['progress']['transfer'] = None


@require_GET
@require_role('admin', 'staff')
def module_results(request, module_id):
    try:
        series = read('''SELECT s.* FROM curriculum.live_sessions s
            JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
            WHERE s.module_catalogue_id=%s AND m.deleted_at IS NULL
            AND s.status NOT IN ('deleted','superseded','failed') ORDER BY s.created_at DESC''', [module_id])
        ids = [row['id'] for row in series]
        # Only a small index is returned on opening the tab. Rosters and transcript
        # bodies are fetched when one session is opened.
        occurrences = read('''SELECT o.id,o.live_session_id AS "seriesId",o.session_number AS "sessionNumber",
            o.scheduled_start AS "startsAt",o.scheduled_end AS "endsAt",o.status AS state,
            o.artifacts_synced_at AS "syncedAt",
            (o.attendance_report_id IS NOT NULL AND o.attendance_report_id<>'' AND o.actual_end IS NOT NULL) AS "reportReady",
            (SELECT count(*) FROM curriculum.live_session_artifacts a WHERE a.occurrence_id=o.id) AS "fileCount"
            FROM curriculum.live_session_occurrences o WHERE o.live_session_id=ANY(%s)
            ORDER BY o.session_number,o.id''', [ids]) if ids else []
        for item in occurrences:
            item['title'] = next((row.get('module_title') or '' for row in series if row['id'] == item['seriesId']), '')
            for key in ('startsAt', 'endsAt', 'syncedAt'):
                item[key] = instant(item[key])
        results = [{'id': row['id'], 'title': row['module_title'],
                    'sessions': [item for item in occurrences if item['seriesId'] == row['id']]} for row in series]
        payload = {'series': results, 'jobs': [], 'presenceThresholdSeconds': 180, 'syncAvailable': True}
        if series:
            try:
                payload['jobs'] = read('SELECT live_session_id,state,last_error,finished_at FROM curriculum.session_result_jobs WHERE live_session_id=ANY(%s)', [ids])
                add_sync_progress(payload['jobs'])
            except DatabaseError as error:
                if not archive_schema_missing(error):
                    raise
                payload.update(syncAvailable=False, warning='Recording storage needs setup. You can open saved sessions and attendance; synchronization is unavailable until setup is complete.')
        return JsonResponse(payload)
    except DatabaseError:
        return unavailable()


@require_GET
@require_role('admin', 'staff')
def admin_session(request, series_id, session_number):
    try:
        series = read('SELECT * FROM curriculum.live_sessions WHERE id=%s', [series_id])
        sessions = result_rows(series[0], session_number=session_number) if series else []
        if not sessions:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        job = None
        try:
            jobs = read('''SELECT live_session_id,state,last_error,started_at,finished_at
                FROM curriculum.session_result_jobs WHERE live_session_id=%s''', [series_id])
            job = jobs[0] if jobs else None
            add_sync_progress(jobs)
        except DatabaseError as error:
            if not archive_schema_missing(error):
                raise
        return JsonResponse({'sessions': sessions, 'job': job})
    except DatabaseError:
        return unavailable()


def learner_series(kind, learner_id, series_id):
    from learner_api.learner_detail import SOURCE_MODELS
    from learner_api.attendance_lectures import read_assigned_modules
    model = SOURCE_MODELS.get(kind)
    learner = model.all_learners.filter(pk=learner_id).first() if model else None
    if not learner:
        return None, None
    modules = {str(item['id']) for item in read_assigned_modules(learner)}
    rows = read('''SELECT s.* FROM curriculum.live_sessions s JOIN curriculum.modules m
        ON m.module_catalogue_id=s.module_catalogue_id
        WHERE s.id=%s AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
        AND s.status NOT IN ('deleted','superseded','failed')''', [series_id])
    if not rows or str(rows[0]['module_catalogue_id']) not in modules:
        return None, None
    return learner, rows[0]


@require_GET
@learner_self_or_staff(kwarg='learner_id')
def learner_results(request, kind, learner_id, series_id, session_number):
    try:
        learner, series = learner_series(kind, learner_id, series_id)
        if not series:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        sessions = result_rows(series, session_number=session_number, email=learner.email.strip().casefold())
        return JsonResponse({'sessions': sessions})
    except DatabaseError:
        return unavailable()


@require_GET
@learner_self_or_staff(kwarg='learner_id')
def learner_join(request, kind, learner_id, series_id, session_number):
    from .teams_calendar_checks import safe_teams_join_url
    import uuid
    try:
        learner, series = learner_series(kind, learner_id, series_id)
        rows = read('SELECT * FROM curriculum.live_session_occurrences WHERE live_session_id=%s AND session_number=%s', [series_id, session_number]) if series else []
        if len(rows) != 1:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        occurrence = rows[0]
        end = instant(occurrence.get('scheduled_end'))
        if not end or end <= timezone.now() or series['status'] == 'cancelled' or occurrence['status'] in {'cancelled', 'deleted', 'superseded'}:
            return JsonResponse({'error': 'This session has ended or is unavailable.'}, status=410)
        url = occurrence.get('join_url') or series.get('join_url')
        if not safe_teams_join_url(url):
            return JsonResponse({'error': 'The Teams link is unavailable.'}, status=409)
        # A launch is context for matching a meeting run, not proof of attendance.
        with connections['default'].cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.live_session_join_launches
                (id,live_session_id,occurrence_id,viewer_email,launched_at) VALUES (%s,%s,%s,%s,now() AT TIME ZONE 'UTC')''',
                ['JOIN-' + uuid.uuid4().hex.upper(), series_id, occurrence['id'], learner.email.strip().casefold()])
        response = HttpResponseRedirect(url)
        response['Cache-Control'] = 'private, no-store'
        return response
    except DatabaseError:
        return unavailable()


@require_POST
@csrf_protect
@require_role('admin', 'staff')
def queue_sync(request, series_id):
    try:
        if not read('SELECT id FROM curriculum.live_sessions WHERE id=%s', [series_id]):
            return JsonResponse({'error': 'Session not found.'}, status=404)
        with transaction.atomic(), connections['default'].cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.session_result_jobs(live_session_id,force_refresh) VALUES (%s,true)
                ON CONFLICT(live_session_id) DO UPDATE SET state='queued',requested_at=now(),next_attempt_at=now(),attempts=0,last_error='',force_refresh=true
                WHERE session_result_jobs.state NOT IN ('running','queued')''', [series_id])
            transaction.on_commit(lambda: start_requested_sync(series_id))
        return JsonResponse({'state': 'queued', 'message': 'Sync requested. Results will update automatically as processing completes.'}, status=202)
    except RuntimeError:
        log.error('Could not start requested session sync. The saved request remains queued.')
        return JsonResponse({'error': 'Your sync request was saved, but processing could not start. Please retry or contact an administrator.',
                             'code': 'session_sync_start_failed'}, status=503)
    except DatabaseError as error:
        if archive_schema_missing(error):
            return JsonResponse({'error': 'Recording storage needs setup before synchronization can run.',
                                 'code': 'session_archive_setup_required'}, status=503)
        return unavailable()


def stored_content(request, series_id, artifact_id, *, learner_view=False):
    if learner_view:
        siblings = read('''SELECT a.* FROM curriculum.live_session_artifacts a
            JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
            WHERE o.live_session_id=%s AND a.occurrence_id=(
                SELECT occurrence_id FROM curriculum.live_session_artifacts WHERE id=%s)''', [series_id, artifact_id])
        if not any(row['id'] == artifact_id for row in siblings) or artifact_id in hidden_artifact_ids(siblings):
            return JsonResponse({'error': 'File not found.'}, status=404)
    rows = read('''SELECT r.*,a.artifact_type,a.metadata FROM curriculum.session_result_archive r
        JOIN curriculum.live_session_artifacts a ON a.id=r.artifact_id
        JOIN curriculum.live_session_occurrences o ON o.id=r.occurrence_id
        WHERE r.artifact_id=%s AND o.live_session_id=%s''', [artifact_id, series_id])
    if not rows or rows[0]['status'] != 'ready':
        return JsonResponse({'error': 'This file is still being saved. Please try again later.'}, status=409)
    row = rows[0]
    if row['artifact_type'] == 'transcript' and request.GET.get('format') == 'cues':
        if not transcript_timing_ready(row):
            return JsonResponse({'error': 'Transcript timing is being prepared.', 'code': 'transcript_timing_pending'}, status=409)
        response = JsonResponse({'cues': artifact_metadata(row)['lmsTranscriptTimeline']['cues']})
    elif row['artifact_type'] == 'transcript' and request.GET.get('format') == 'txt':
        response = HttpResponse(row['transcript_text'] or '', content_type='text/plain; charset=utf-8')
        response['Content-Disposition'] = 'attachment; filename="transcript.txt"'
    else:
        from learner_api.evidence_storage import get_read_sas
        try:
            # A two-hour lesson must remain seekable beyond the default 15-minute
            # document URL lifetime. This URL still grants read access to one blob.
            options = {'ttl_minutes': 240} if row['artifact_type'] == 'recording' else {}
            response = HttpResponseRedirect(get_read_sas(row['container'], row['blob_name'], **options))
        except Exception as error:
            log.warning('Session file signing failed: %s', type(error).__name__)
            return JsonResponse({'error': 'File access is temporarily unavailable.'}, status=503)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@require_role('admin', 'staff')
def admin_content(request, series_id, artifact_id):
    try:
        return stored_content(request, series_id, artifact_id)
    except DatabaseError:
        return unavailable()


@require_GET
@learner_self_or_staff(kwarg='learner_id')
def learner_content(request, kind, learner_id, series_id, artifact_id):
    try:
        _learner, series = learner_series(kind, learner_id, series_id)
        if not series:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        return stored_content(request, series_id, artifact_id, learner_view=True)
    except DatabaseError:
        return unavailable()


@require_POST
@csrf_protect
@require_role('admin', 'staff')
def recording_visibility(request, series_id, artifact_id):
    try:
        payload = json.loads(request.body)
    except (ValueError, TypeError):
        return JsonResponse({'error': 'A boolean hidden value is required.'}, status=400)
    if not isinstance(payload, dict) or type(payload.get('hidden')) is not bool:
        return JsonResponse({'error': 'A boolean hidden value is required.'}, status=400)
    try:
        with connections['default'].cursor() as cursor:
            cursor.execute('''UPDATE curriculum.live_session_artifacts a
                SET metadata=jsonb_set(coalesce(a.metadata::jsonb,'{}'::jsonb),
                    '{lmsHiddenFromLearners}',%s::jsonb),updated_at=now()
                FROM curriculum.live_session_occurrences o
                WHERE a.id=%s AND a.occurrence_id=o.id AND o.live_session_id=%s
                  AND a.artifact_type='recording' RETURNING a.id''',
                [json.dumps(payload['hidden']), artifact_id, series_id])
            if not cursor.fetchone():
                return JsonResponse({'error': 'Recording not found.'}, status=404)
        return JsonResponse({'id': artifact_id, 'hiddenFromLearners': payload['hidden']})
    except DatabaseError:
        return unavailable()


@require_GET
@require_role('admin', 'staff')
def export_attendance(request, series_id, session_number, file_format='csv'):
    try:
        series = read('SELECT * FROM curriculum.live_sessions WHERE id=%s', [series_id])
        sessions = result_rows(series[0], session_number=session_number) if series else []
        if not sessions:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        if file_format == 'pdf':
            from .session_attendance_pdf import build_attendance_pdf
            response = HttpResponse(build_attendance_pdf(sessions[0]), content_type='application/pdf')
        else:
            response = HttpResponse(attendance_csv(sessions[0]['attendance']), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="attendance-session-{session_number}.{file_format}"'
        response['Cache-Control'] = 'private, no-store'
        return response
    except DatabaseError:
        return unavailable()
