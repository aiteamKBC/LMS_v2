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

from .session_results_policy import attendance_display_name, attendance_name_key, session_roster, attendance_csv, instant, session_runs
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


def attendance_alias_rows(module_catalogue_id):
    """Read optional identity aliases without taking session results offline."""

    try:
        return read('''SELECT alias_email,learner_profile_id,canonical_email
            FROM curriculum.live_session_attendance_aliases
            WHERE module_catalogue_id=%s''', [module_catalogue_id or ''])
    except DatabaseError as error:
        if not archive_schema_missing(error):
            raise
        return []


def attendance_identity_link_rows(occurrence_ids):
    """Read optional reviewed links for raw Teams rows without an email."""

    try:
        return read('''SELECT occurrence_id,attendance_row_id,learner_profile_id,canonical_email
            FROM curriculum.live_session_attendance_identity_links
            WHERE occurrence_id=ANY(%s)''', [list(occurrence_ids)])
    except DatabaseError as error:
        if not archive_schema_missing(error):
            raise
        return []


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
    register_rows = read('''SELECT occurrence_id,learner_profile_id,learner_email,learner_name,
        attendance_status,recovery_status,attended_seconds,attendance_report_id,first_join_at,last_leave_at
        FROM curriculum.live_session_learner_attendance
        WHERE occurrence_id=ANY(%s) ORDER BY learner_name,learner_profile_id''', [ids])
    aliases = attendance_alias_rows(series.get('module_catalogue_id')) if email is None else []
    identity_links = attendance_identity_link_rows(ids) if email is None else []
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
    attendance_by_id, register_by_id, artifacts_by_id = defaultdict(list), defaultdict(list), defaultdict(list)
    for record in records:
        record['intervals'] = json_value(record.get('intervals'), [])
        record['display_name'] = attendance_display_name(record)
        attendance_by_id[record['occurrence_id']].append(record)
    for register_row in register_rows:
        register_by_id[register_row['occurrence_id']].append(register_row)
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
    results = []
    linked_aliases = {
        str(row.get('alias_email') or '').strip().casefold()
        for row in aliases if str(row.get('alias_email') or '').strip()
    }
    linked_source_ids = {
        (str(row.get('occurrence_id') or ''), str(row.get('attendance_row_id') or ''))
        for row in identity_links
        if str(row.get('attendance_row_id') or '').strip()
    }
    protected_emails = {
        str(value or '').strip().casefold()
        for key in ('organizer_email', 'presenters', 'co_organizers')
        for value in (
            json_value(series.get(key), [])
            if key != 'organizer_email' else [series.get(key)]
        )
        if str(value or '').strip()
    }
    for item in occurrences:
        complete = bool(item.get('attendance_report_id') and item.get('actual_end'))
        saved_register = register_by_id[item['id']]
        learner_by_email = {
            str(row.get('learner_email') or '').strip().casefold(): row
            for row in saved_register if str(row.get('learner_email') or '').strip()
        }
        expected = set(learner_by_email)
        candidate_emails_by_name = defaultdict(set)
        for learner_email, learner_row in learner_by_email.items():
            name_key = attendance_name_key(learner_row.get('learner_name'))
            if name_key:
                candidate_emails_by_name[name_key].add(learner_email)
        unique_email_by_name = {
            name_key: next(iter(candidate_emails))
            for name_key, candidate_emails in candidate_emails_by_name.items()
            if len(candidate_emails) == 1
        }
        def saved_exact_name_match(row):
            if str(row.get('email') or '').strip():
                return False
            matched_email = unique_email_by_name.get(attendance_name_key(row.get('display_name')))
            saved = learner_by_email.get(matched_email) if matched_email else None
            return bool(
                saved
                and saved.get('attendance_status') == 'present'
                and int(saved.get('attended_seconds') or 0) > 0
            )
        learner_records = [
            row for row in attendance_by_id[item['id']]
            if str(row.get('email') or '').strip().casefold() in expected
        ]
        roster = session_roster(expected, learner_records, complete=complete)
        for person in roster:
            saved = learner_by_email.get(person['email'])
            if not saved:
                continue
            status = saved.get('attendance_status')
            person.update(
                name=saved.get('learner_name') or person['name'],
                seconds=max(0, int(saved.get('attended_seconds') or 0)),
                status=status,
                attendance=1 if status == 'present' else 0,
                rawStatus=status,
                rawAttendance=1 if status == 'present' else 0,
                effectiveStatus=status,
                effectiveAttendance=1 if status == 'present' else 0,
                finalOutcome=status,
            )
        runs = session_runs(item, attendance_by_id[item['id']])
        unmatched_records = [] if email is not None else [
            row for row in attendance_by_id[item['id']]
            if str(row.get('email') or '').strip().casefold() not in expected
            and str(row.get('email') or '').strip().casefold() not in linked_aliases
            and str(row.get('email') or '').strip().casefold() not in protected_emails
            and (str(item['id']), str(row.get('id') or '')) not in linked_source_ids
            and str(row.get('role') or '').strip().casefold() not in {'organizer', 'presenter', 'coorganizer', 'co-organizer'}
            and not saved_exact_name_match(row)
        ]
        unmatched = session_roster(set(), unmatched_records, complete=complete)
        for person in unmatched:
            suggested_email = unique_email_by_name.get(attendance_name_key(person.get('name')))
            suggested = learner_by_email.get(suggested_email) if suggested_email else None
            person['suggestedLearnerProfileId'] = (
                suggested.get('learner_profile_id') if suggested else None
            )
        candidates = [
            {
                'learnerProfileId': row.get('learner_profile_id'),
                'email': str(row.get('learner_email') or '').strip().casefold(),
                'name': row.get('learner_name') or row.get('learner_email') or 'Learner',
            }
            for row in saved_register
        ] if email is None else []
        results.append({'id': item['id'], 'seriesId': series['id'], 'sessionNumber': item['session_number'],
                        'title': series.get('module_title') or '',
                        'startsAt': instant(item['scheduled_start']), 'endsAt': instant(item['scheduled_end']),
                        'actualStartsAt': instant(runs[0]['startsAt']) if runs else instant(item.get('actual_start')),
                        'actualEndsAt': max(instant(run['endsAt']) for run in runs) if runs else instant(item.get('actual_end')),
                        'runs': runs,
                        'state': item['status'], 'reportReady': complete, 'archiveReady': archive_ready,
                        'syncedAt': instant(item.get('artifacts_synced_at')),
                        'attendance': roster, 'unmatchedAttendance': unmatched,
                        'attendanceCandidates': candidates,
                        'artifacts': artifacts_by_id[item['id']]})
    apply_recovery(results)
    if email is not None:
        for item in results:
            item['attendance'] = [person for person in item['attendance'] if person['email'] == email.casefold()]
    return results


def apply_recovery(results):
    """Add reported recovery details without changing original attendance."""

    occurrence_ids = [str(item.get('id') or '') for item in results if item.get('id')]
    emails = list({person['email'] for item in results for person in item['attendance'] if person['email']})
    if not emails or not occurrence_ids:
        return
    reports = read('''SELECT occurrence_id,lower(btrim(learner_email)) AS learner_email,
        recovery_status,recovery_method,recovery_reference
        FROM curriculum.live_session_absences
        WHERE occurrence_id=ANY(%s) AND lower(btrim(learner_email))=ANY(%s)
        ORDER BY updated_at,id''', [occurrence_ids, emails])
    reports = {
        (str(report.get('occurrence_id') or ''), str(report.get('learner_email') or '').strip().casefold()): report
        for report in reports
    }
    # An approved alternative session (learner_api.alternative_recovery key
    # "alternative:<occurrence>") makes up the absence once the saved register
    # shows the learner present there, i.e. more than three minutes in Teams.
    alternative_targets = {
        key: str(report.get('recovery_reference') or '')[len('alternative:'):]
        for key, report in reports.items()
        if report.get('recovery_method') == 'alternative'
        and str(report.get('recovery_reference') or '').startswith('alternative:')
    }
    attended_alternatives = {
        (str(row.get('occurrence_id') or ''), str(row.get('learner_email') or '').strip().casefold())
        for row in read('''SELECT occurrence_id,lower(btrim(learner_email)) AS learner_email
            FROM curriculum.live_session_learner_attendance
            WHERE occurrence_id=ANY(%s) AND lower(btrim(learner_email))=ANY(%s)
              AND attendance_status='present' ''', [
                sorted(set(alternative_targets.values())),
                sorted({email for _occurrence, email in alternative_targets}),
            ])
    } if alternative_targets else set()
    for item in results:
        for person in item['attendance']:
            raw_status = person.get('rawStatus', person.get('status'))
            raw_attendance = person.get('rawAttendance', person.get('attendance'))
            person.update(rawStatus=raw_status, rawAttendance=raw_attendance,
                          excuseStatus='none', recoveryStatus='none',
                          recoveryType='none',
                          recoveryReference='', absenceReported=False,
                          effectiveStatus=raw_status, effectiveAttendance=raw_attendance,
                          finalOutcome=raw_status)
            if raw_status != 'absent':
                continue
            key = (str(item.get('id') or ''), person['email'].strip().casefold())
            report = reports.get(key)
            if report:
                person.update(
                    absenceReported=True,
                    recoveryStatus=report.get('recovery_status') or 'none',
                    recoveryType=report.get('recovery_method') or 'none',
                    recoveryReference=report.get('recovery_reference') or '',
                )
                alternative_attended = (alternative_targets.get(key), key[1]) in attended_alternatives
                if alternative_attended:
                    person['recoveryStatus'] = 'completed'
                if report.get('recovery_status') == 'completed' or alternative_attended:
                    person.update(
                        excuseStatus='approved',
                        excused=True,
                        catchupCompleted=True,
                        effectiveStatus='made_up',
                        effectiveAttendance=1,
                        finalOutcome='made_up',
                    )


def unavailable():
    log.exception('Could not read saved session results')
    return JsonResponse({'error': 'Saved session results are unavailable. Check the session archive setup and try again.'}, status=503)


@require_POST
@csrf_protect
@require_role('admin', 'staff')
def link_attendance_alias(request, series_id, session_number):
    """Link one reported Teams identity to a learner already in this module roster."""

    try:
        payload = json.loads(request.body or b'{}')
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid JSON body.'}, status=400)
    alias_email = str(payload.get('aliasEmail') or '').strip().casefold()
    raw_source_record_ids = payload.get('sourceRecordIds') or []
    if not isinstance(raw_source_record_ids, list):
        return JsonResponse({'error': 'Attendance record IDs must be a list.'}, status=400)
    source_record_ids = sorted({
        str(value or '').strip() for value in raw_source_record_ids
        if str(value or '').strip()
    })
    try:
        learner_profile_id = int(payload.get('learnerProfileId'))
    except (TypeError, ValueError):
        learner_profile_id = 0
    if (alias_email and '@' not in alias_email) or (not alias_email and not source_record_ids):
        return JsonResponse({'error': 'Choose a reported Teams identity to link.'}, status=400)
    if len(alias_email) > 320 or any(len(value) > 128 for value in source_record_ids):
        return JsonResponse({'error': 'The reported Teams identity is invalid.'}, status=400)
    if len(source_record_ids) > 100:
        return JsonResponse({'error': 'Too many attendance records were selected.'}, status=400)
    if learner_profile_id <= 0:
        return JsonResponse({'error': 'Choose a learner from this module.'}, status=400)

    try:
        occurrence_rows = read('''SELECT o.id,s.module_catalogue_id
            FROM curriculum.live_session_occurrences o
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            WHERE s.id=%s AND o.session_number=%s''', [series_id, session_number])
        if not occurrence_rows:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        occurrence = occurrence_rows[0]
        if alias_email:
            reported = read('''SELECT id,display_name FROM curriculum.live_session_attendance
                WHERE occurrence_id=%s AND lower(btrim(email))=%s''', [occurrence['id'], alias_email])
        else:
            reported = read('''SELECT id,display_name,raw_data FROM curriculum.live_session_attendance
                WHERE occurrence_id=%s AND id=ANY(%s) AND coalesce(btrim(email),'')='' ''',
                [occurrence['id'], source_record_ids])
            if {str(row.get('id') or '') for row in reported} != set(source_record_ids):
                reported = []
        if not reported:
            return JsonResponse({'error': 'That identity is not present in this Teams attendance report.'}, status=404)
        candidates = read('''SELECT learner_profile_id,lower(btrim(learner_email)) AS learner_email,learner_name
            FROM curriculum.live_session_learner_attendance
            WHERE occurrence_id=%s AND learner_profile_id=%s''', [occurrence['id'], learner_profile_id])
        if not candidates:
            return JsonResponse({'error': 'Choose a learner assigned to this module session.'}, status=400)
        candidate = candidates[0]
        canonical_email = str(candidate.get('learner_email') or '').strip().casefold()
        if not canonical_email or (alias_email and canonical_email == alias_email):
            return JsonResponse({'error': 'This learner already uses that attendance email.'}, status=400)
        if alias_email:
            existing = read('''SELECT learner_profile_id FROM curriculum.live_session_attendance_aliases
                WHERE module_catalogue_id=%s AND alias_email=%s''',
                [occurrence['module_catalogue_id'], alias_email])
        else:
            existing = read('''SELECT attendance_row_id,learner_profile_id
                FROM curriculum.live_session_attendance_identity_links
                WHERE occurrence_id=%s AND attendance_row_id=ANY(%s)''',
                [occurrence['id'], source_record_ids])
        if any(int(row['learner_profile_id']) != learner_profile_id for row in existing):
            return JsonResponse({'error': 'This Teams identity is already linked to another learner.'}, status=409)

        actor = getattr(request, 'account', None)
        actor_label = str(getattr(actor, 'email', '') or getattr(actor, 'subject_id', '') or '').strip()[:320]
        with transaction.atomic():
            with connections['default'].cursor() as cursor:
                if alias_email and not existing:
                    cursor.execute('''INSERT INTO curriculum.live_session_attendance_aliases
                        (module_catalogue_id,alias_email,learner_profile_id,canonical_email,created_by)
                        VALUES (%s,%s,%s,%s,%s)''', [
                            occurrence['module_catalogue_id'], alias_email, learner_profile_id,
                            canonical_email, actor_label,
                        ])
                if not alias_email:
                    existing_ids = {str(row.get('attendance_row_id') or '') for row in existing}
                    names_by_id = {
                        str(row.get('id') or ''): attendance_display_name(row)
                        for row in reported
                    }
                    for source_record_id in source_record_ids:
                        if source_record_id in existing_ids:
                            continue
                        cursor.execute('''INSERT INTO curriculum.live_session_attendance_identity_links
                            (occurrence_id,attendance_row_id,learner_profile_id,canonical_email,display_name,created_by)
                            VALUES (%s,%s,%s,%s,%s,%s)''', [
                                occurrence['id'], source_record_id, learner_profile_id, canonical_email,
                                names_by_id.get(source_record_id, '')[:500], actor_label,
                            ])

        from learner_api.teams_attendance import sync_verified_teams_attendance_reporting
        sync_verified_teams_attendance_reporting(module_refs=[occurrence['module_catalogue_id']])
        return JsonResponse({
            'aliasEmail': alias_email,
            'sourceRecordIds': source_record_ids,
            'learnerProfileId': learner_profile_id,
            'learnerEmail': canonical_email,
            'learnerName': candidate.get('learner_name') or canonical_email,
        })
    except DatabaseError as error:
        if archive_schema_missing(error):
            return JsonResponse({
                'error': 'Attendance identity linking is not set up on this database yet.'
            }, status=503)
        return unavailable()


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
