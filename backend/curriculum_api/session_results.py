"""Saved session results. GET never calls Graph, provisions tables or starts jobs."""
import json
import logging
import re
from collections import defaultdict
from pathlib import PurePosixPath
from zoneinfo import ZoneInfo

from django.db import connections, DatabaseError, transaction
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_GET, require_POST
from login.permissions import require_role, learner_self_or_staff

from .attendance_identity import identity_check, staff_roles
from .attendance_link_policy import apply_reviewed_identities, identity_key, link_specs, record_key, unmatched_roster
from .attendance_link_store import identity_rules, save_rule
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


def module_tutor_emails(module_catalogue_id):
    """Tutor emails assigned to the module; absent column or table reads as none."""

    try:
        rows = read('''SELECT DISTINCT lower(btrim(tutor_email)) AS email FROM curriculum.modules
            WHERE module_catalogue_id=%s AND deleted_at IS NULL AND coalesce(tutor_email,'')<>'' ''',
            [module_catalogue_id or ''])
    except DatabaseError as error:
        cause = error.__cause__ or error
        if getattr(cause, 'sqlstate', None) not in {'42P01', '42703'}:
            raise
        return []
    return [row['email'] for row in rows if row.get('email')]


def college_tenant_id():
    """The college's Entra tenant, read from configuration (no Graph call)."""

    try:
        from coach_api.views import get_graph_settings
        return get_graph_settings().get('tenant_id') or ''
    except Exception:
        log.warning('Could not read the Microsoft tenant setting for the account check.')
        return ''


def replaced_module_register_rows(module_catalogue_id, source_occurrence_ids):
    """Destination roster rows whose replaced link resolves to these source occurrences."""

    if not module_catalogue_id or not source_occurrence_ids:
        return []
    from learner_api.replaced_teams_attendance import REPLACED_ATTENDANCE_LATERAL_SQL
    rows = read(f'''SELECT replaced_attendance.occurrence_id AS source_occurrence_id,
        r.occurrence_id,r.learner_profile_id,r.learner_email,r.learner_name,
        r.attendance_status,r.recovery_status,r.attended_seconds,
        r.attendance_report_id,r.first_join_at,r.last_leave_at
        FROM curriculum.live_session_occurrences o
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id
        {REPLACED_ATTENDANCE_LATERAL_SQL}
        LEFT JOIN curriculum.live_session_learner_attendance r ON r.occurrence_id=o.id
        WHERE s.module_catalogue_id=%s
          AND replaced_attendance.occurrence_id=ANY(%s)
        ORDER BY r.learner_name,r.learner_profile_id''', [
            module_catalogue_id, source_occurrence_ids,
        ])
    if rows:
        return rows
    # A shared Teams duplicate deliberately owns no live_sessions or
    # occurrences. The builder projects the source module's meeting identity
    # onto it at read time (views.apply_shared_teams_settings_to_weeks). Match
    # that same explicit ownership relation and use the duplicate's learner
    # plan mirror as its roster; never fall back to the source module's roster.
    return read('''SELECT source_o.id AS source_occurrence_id,
        NULL AS occurrence_id,learner.id AS learner_profile_id,
        lower(btrim(learner.email)) AS learner_email,
        learner.full_name AS learner_name,
        CASE WHEN coalesce(source_o.attendance_report_id,'')<>'' AND source_o.actual_end IS NOT NULL
             THEN 'absent' ELSE 'pending' END AS attendance_status,
        'none' AS recovery_status,0 AS attended_seconds,
        source_o.attendance_report_id,NULL AS first_join_at,NULL AS last_leave_at
        FROM curriculum.modules target_module
        JOIN curriculum.live_sessions source_session
          ON source_session.module_catalogue_id=target_module.teams_shared_source_module_id
        JOIN curriculum.live_session_occurrences source_o
          ON source_o.live_session_id=source_session.id
        LEFT JOIN "Learner".learner_training_plan_modules plan_module
          ON plan_module.module_ref=target_module.module_catalogue_id
        LEFT JOIN "Learner".learners learner ON learner.id=plan_module.learner_id
        WHERE target_module.module_catalogue_id=%s
          AND source_o.id=ANY(%s)
          AND lower(btrim(source_session.status)) NOT IN ('cancelled','canceled','deleted','failed','superseded')
          AND lower(btrim(source_o.status)) NOT IN ('cancelled','canceled','deleted','failed','superseded')
        ORDER BY learner.full_name,learner.id''', [module_catalogue_id, source_occurrence_ids])


def result_rows(series, *, session_number=None, email=None, identity=False, module_catalogue_id=''):
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
    context_register_rows = []
    context_requested = (email is None and module_catalogue_id
                         and str(module_catalogue_id) != str(series.get('module_catalogue_id') or ''))
    if context_requested:
        context_register_rows = replaced_module_register_rows(module_catalogue_id, ids)
    context_by_source_id = defaultdict(list)
    context_source_ids = set()
    for row in context_register_rows:
        source_id = row.get('source_occurrence_id')
        if source_id:
            context_source_ids.add(source_id)
            if row.get('learner_profile_id') is not None:
                context_by_source_id[source_id].append(row)
    if context_requested and not context_source_ids:
        return []
    roster_module_id = module_catalogue_id if context_source_ids else series.get('module_catalogue_id')
    aliases = attendance_alias_rows(roster_module_id)
    identity_links = attendance_identity_link_rows(ids)
    rules = identity_rules([roster_module_id])
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
    protected_emails = {
        str(value or '').strip().casefold()
        for key in ('organizer_email', 'presenters', 'co_organizers')
        for value in (
            json_value(series.get(key), [])
            if key != 'organizer_email' else [series.get(key)]
        )
        if str(value or '').strip()
    }
    if identity and email is None:
        staff = staff_roles(series, module_tutor_emails(roster_module_id))
        home_tenant = college_tenant_id()
    for item in occurrences:
        complete = bool(item.get('attendance_report_id') and item.get('actual_end'))
        replaced_roster = item['id'] in context_source_ids
        saved_register = (context_by_source_id[item['id']]
                          if replaced_roster else register_by_id[item['id']])
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
        reviewed_records = apply_reviewed_identities(attendance_by_id[item['id']], aliases, identity_links, rules)
        for row in reviewed_records:
            if not row.get('email') and not row.get('identityReviewRequired') and not row.get('identityAmbiguous'):
                matched = unique_email_by_name.get(attendance_name_key(row.get('display_name')))
                if matched and saved_exact_name_match(row):
                    row['email'] = matched
        learner_records = [row for row in reviewed_records
                           if str(row.get('email') or '').strip().casefold() in expected
                           and not row.get('identityReviewRequired')]
        linked_identities = []
        if email is None:
            visible_rules = {(row['identity_kind'], row['identity_value']): row for row in rules
                             if row.get('active') and (row['identity_kind'] != 'record'
                             or row['identity_value'].startswith(str(item['id']) + ':'))}
            for row in reviewed_records:
                rule = row.get('identityRule')
                if rule and rule.get('active'):
                    visible_rules.setdefault((rule['identity_kind'], rule['identity_value']), rule)
            for (kind, value), rule in visible_rules.items():
                sources = [row for row in attendance_by_id[item['id']]
                           if (identity_key(row) if kind != 'record' else record_key(row)) == (kind, value)]
                linked_identities.append({
                    'identityKind': kind, 'identityValue': value, 'revision': rule.get('revision', 0),
                    'name': rule.get('display_name') or (attendance_display_name(sources[0]) if sources else value),
                    'aliasEmail': value if kind == 'email' else '',
                    'sourceRecordIds': [str(row['id']) for row in sources],
                    'learnerProfileId': rule['learner_profile_id'],
                    'learnerName': (learner_by_email.get(rule['canonical_email']) or {}).get('learner_name') or rule['canonical_email'],
                    'scope': 'session' if kind == 'record' else 'module',
                })
        roster = session_roster(expected, learner_records, complete=complete)
        for person in roster:
            saved = learner_by_email.get(person['email'])
            if not saved:
                continue
            status = saved.get('attendance_status')
            person['name'] = saved.get('learner_name') or person['name']
            # A replaced module compares its own roster directly with the
            # source report.  Its reporting row may still contain an older
            # absence until the background reporting refresh runs.  Preserve
            # a saved positive match (aliases/name review), but never let that
            # stale absence erase direct source evidence for this learner.
            if not (rules or aliases or identity_links) and (not replaced_roster or person.get('status') != 'present'):
                person.update(
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
            row for row in reviewed_records
            if (str(row.get('email') or '').strip().casefold() not in expected or row.get('identityReviewRequired'))
            and str(row.get('email') or '').strip().casefold() not in protected_emails
            and str(row.get('role') or '').strip().casefold() not in {'organizer', 'presenter', 'coorganizer', 'co-organizer'}
        ]
        unmatched = unmatched_roster(unmatched_records, complete=complete)
        for person in unmatched:
            suggested_email = unique_email_by_name.get(attendance_name_key(person.get('name')))
            suggested = learner_by_email.get(suggested_email) if suggested_email else None
            person['suggestedLearnerProfileId'] = (
                suggested.get('learner_profile_id') if suggested and not person.get('identityAmbiguous') else None
            )
        candidates = [
            {
                'learnerProfileId': row.get('learner_profile_id'),
                'email': str(row.get('learner_email') or '').strip().casefold(),
                'name': row.get('learner_name') or row.get('learner_email') or 'Learner',
            }
            for row in saved_register
        ] if email is None else []
        session_identity = None
        if identity and email is None:
            # Staff only: which Microsoft account each row came from, beside the
            # LMS email it counts for. Read-only; the register above is unchanged.
            session_identity = identity_check(
                attendance_by_id[item['id']],
                learners={key: {'name': row.get('learner_name') or key, 'learnerProfileId': row.get('learner_profile_id')}
                          for key, row in learner_by_email.items()},
                aliases={str(source.get('email') or '').strip().casefold(): str(mapped.get('email') or '').strip().casefold()
                         for source, mapped in zip(attendance_by_id[item['id']], reviewed_records)
                         if source.get('email') and mapped.get('identityRule') and not mapped.get('identityReviewRequired')},
                reviewed_links={str(row['id']): str(row.get('email') or '').strip().casefold()
                                for row in reviewed_records if row.get('identityRule') and not row.get('identityReviewRequired')},
                name_match=lambda row: next((str(mapped.get('email') or '') for mapped in reviewed_records
                                            if str(mapped.get('id')) == str(row.get('id')) and not mapped.get('identityReviewRequired')), '') or None,
                staff=staff,
                organizer_email=str(series.get('organizer_email') or '').strip().casefold(),
                home_tenant=home_tenant,
            )
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
                        **({'linkedIdentities': linked_identities} if email is None else {}),
                        'artifacts': artifacts_by_id[item['id']],
                        **({'identityCheck': session_identity} if session_identity is not None else {})})
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
    """Create, correct or revoke a reviewed identity in the authorized module."""
    try:
        payload = json.loads(request.body or b'{}')
        if not isinstance(payload, dict):
            raise ValueError()
        action = payload.get('action', 'link')
        if action not in {'link', 'change', 'unlink'}:
            raise ValueError()
        learner_profile_id = int(payload.get('learnerProfileId') or 0)
        expected_revision = int(payload.get('expectedRevision') or 0)
        expected_learner = int(payload.get('expectedLearnerProfileId') or 0)
        source_ids = payload.get('sourceRecordIds') or []
        if not isinstance(source_ids, list) or len(source_ids) > 100:
            raise ValueError()
        source_ids = sorted({str(value) for value in source_ids if value})
        alias_email = str(payload.get('aliasEmail') or '').strip().casefold()
        if len(alias_email) > 320 or any(len(value) > 128 for value in source_ids):
            raise ValueError()
    except (TypeError, ValueError):
        return JsonResponse({'error': 'Invalid identity correction request.'}, status=400)
    if action != 'unlink' and learner_profile_id <= 0:
        return JsonResponse({'error': 'Choose a learner from this module.'}, status=400)
    if action != 'link' and expected_learner <= 0:
        return JsonResponse({'error': 'Refresh the current link before correcting it.'}, status=409)
    try:
        occurrences = read('''SELECT o.id,s.module_catalogue_id FROM curriculum.live_session_occurrences o
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            WHERE s.id=%s AND o.session_number=%s''', [series_id, session_number])
        if not occurrences:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        occurrence = occurrences[0]
        module_id = str(payload.get('moduleId') or occurrence['module_catalogue_id']).strip()
        if module_id != str(occurrence['module_catalogue_id']):
            roster = replaced_module_register_rows(module_id, [occurrence['id']])
            if not any(str(row.get('source_occurrence_id')) == str(occurrence['id']) for row in roster):
                return JsonResponse({'error': 'This session is not linked to that module.'}, status=400)
        else:
            roster = read('''SELECT learner_profile_id,learner_email,learner_name
                FROM curriculum.live_session_learner_attendance WHERE occurrence_id=%s''', [occurrence['id']])
        candidate = next((row for row in roster if row.get('learner_profile_id') == learner_profile_id), None)
        if action != 'unlink' and (not candidate or not candidate.get('learner_email')):
            return JsonResponse({'error': 'Choose a learner assigned to this module session.'}, status=400)
        records = read('SELECT * FROM curriculum.live_session_attendance WHERE occurrence_id=%s', [occurrence['id']])
        selected = [row for row in records if
                    (str(row.get('email') or '').strip().casefold() == alias_email if alias_email else
                     str(row.get('id')) in source_ids and not str(row.get('email') or '').strip())]
        if not payload.get('identityKind') and (not selected or (not alias_email and
                {str(row['id']) for row in selected} != set(source_ids))):
            return JsonResponse({'error': 'That identity is not present in this Teams attendance report.'}, status=404)
        if any(str(row.get('role') or '').casefold() in {'organizer', 'presenter', 'coorganizer', 'co-organizer'} for row in selected):
            return JsonResponse({'error': 'Staff meeting identities cannot be linked to a learner.'}, status=400)
        actor = getattr(request, 'account', None)
        actor_label = str(getattr(actor, 'email', '') or getattr(actor, 'subject_id', '') or '')[:320]
        with transaction.atomic(using='default'):
            with connections['default'].cursor() as cursor:
                # Serialize even a first link (no rule row yet), including concurrent corrections.
                cursor.execute('SELECT module_catalogue_id FROM curriculum.modules WHERE module_catalogue_id=%s FOR UPDATE', [module_id])
                if not cursor.fetchone():
                    return JsonResponse({'error': 'Module not found.'}, status=404)
                rules = identity_rules([module_id])
                aliases = attendance_alias_rows(module_id)
                legacy = attendance_identity_link_rows([occurrence['id']])
                effective = apply_reviewed_identities(selected, aliases, legacy, rules)
                by_key = {(row['identity_kind'], row['identity_value']): row for row in rules}
                for row in aliases:
                    by_key.setdefault(('email', row['alias_email']), {**row, 'active': True, 'revision': 0,
                        'identity_kind': 'email', 'identity_value': row['alias_email']})
                for row in effective:
                    previous = row.get('identityRule')
                    if previous:
                        by_key.setdefault((previous['identity_kind'], previous['identity_value']), previous)
                if payload.get('identityKind'):
                    spec = (str(payload['identityKind']), str(payload.get('identityValue') or ''))
                    if action == 'link' or spec not in by_key:
                        return JsonResponse({'error': 'Refresh the current identity link.'}, status=409)
                    specs = [spec]
                else:
                    specs = link_specs(selected, records)
                changes = []
                for spec in specs:
                    before = by_key.get(spec)
                    if before is None and spec[0] != 'record':
                        before = next((row.get('identityRule') for row in effective
                                       if identity_key(row) == spec or record_key(row) == spec
                                       or len(specs) == 1), None)
                    if before and before.get('active', True):
                        if action == 'link':
                            if int(before['learner_profile_id']) != learner_profile_id:
                                return JsonResponse({'error': 'Already linked. Use Change learner to correct this link.'}, status=409)
                        elif int(before.get('revision') or 0) != expected_revision or int(before['learner_profile_id']) != expected_learner:
                            return JsonResponse({'error': 'This link changed in another window. Refresh and review it again.'}, status=409)
                    elif action != 'link':
                        return JsonResponse({'error': 'This link is no longer active. Refresh saved results.'}, status=409)
                    canonical = str(candidate.get('learner_email') or '').strip().casefold() if candidate else before['canonical_email']
                    if action != 'unlink' and spec[0] == 'email' and canonical == spec[1]:
                        return JsonResponse({'error': 'This learner already uses that attendance email.'}, status=400)
                    after = {'learner_profile_id': learner_profile_id if candidate else before['learner_profile_id'],
                             'canonical_email': canonical, 'active': action != 'unlink',
                             'display_name': (before or {}).get('display_name') or
                                 (attendance_display_name(selected[0]) if selected else spec[1])}
                    after['display_name'] = str(after['display_name'])[:500]
                    changes.append((spec, before, after))
                for spec, before, after in changes:
                    # A retried successful link is idempotent and creates no extra history.
                    if action == 'link' and before and before.get('revision') and before.get('active') and before['learner_profile_id'] == learner_profile_id:
                        continue
                    save_rule(cursor, module_id, spec, before, after, actor_label)
                if specs[0][0] == 'record' and selected:
                    # Once two participants share a name, a later single join
                    # cannot safely be assumed to be the earlier module match.
                    name_spec = identity_key(selected[0])
                    recurring = by_key.get(name_spec)
                    if recurring and recurring.get('active'):
                        save_rule(cursor, module_id, name_spec, recurring,
                                  {**recurring, 'active': False}, actor_label)
        # Reporting uses a separate DB alias: recalculate only after the decision commits.
        # A failure must not pretend the already-saved decision was rolled back.
        recalculation = 'complete'
        try:
            from learner_api.teams_attendance import sync_verified_teams_attendance_reporting
            updated_rows = sync_verified_teams_attendance_reporting(module_refs=[module_id])
            if updated_rows == 0:
                recalculation = 'pending'
        except Exception:
            log.exception('Saved identity decision; attendance reporting refresh failed')
            recalculation = 'failed'
        return JsonResponse({'aliasEmail': alias_email, 'sourceRecordIds': source_ids,
            'learnerProfileId': learner_profile_id,
            'learnerEmail': str((candidate or {}).get('learner_email') or ''),
            'learnerName': str((candidate or {}).get('learner_name') or ''),
            'action': action, 'scope': 'session' if specs[0][0] == 'record' else 'module',
            'recalculation': recalculation})
    except ValueError as error:
        return JsonResponse({'error': str(error)}, status=400)
    except DatabaseError as error:
        if archive_schema_missing(error):
            return JsonResponse({'error': 'Attendance identity corrections need database migration 0071.'}, status=503)
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
        if series:
            from .teams_week_meeting import ensure_week_meeting_occurrence
            ensure_week_meeting_occurrence(series[0])
        module_catalogue_id = str(request.GET.get('moduleId') or '').strip()
        result_options = {'session_number': session_number, 'identity': True}
        if module_catalogue_id:
            result_options['module_catalogue_id'] = module_catalogue_id
        sessions = result_rows(series[0], **result_options) if series else []
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
    """The learner and a series from one of their assigned modules, else (None, None).

    A module duplicated to share another module's Teams meeting has no series
    of its own, so its learners are matched through the source module. The
    duplicates that led here are kept on the row as ``learner_shared_module_ids``.
    """
    from learner_api.learner_detail import SOURCE_MODELS
    from learner_api.attendance_lectures import read_assigned_modules, shared_teams_sources
    model = SOURCE_MODELS.get(kind)
    learner = model.all_learners.filter(pk=learner_id).first() if model else None
    if not learner:
        return None, None
    modules = {str(item['id']) for item in read_assigned_modules(learner)}
    rows = read('''SELECT s.* FROM curriculum.live_sessions s JOIN curriculum.modules m
        ON m.module_catalogue_id=s.module_catalogue_id
        WHERE s.id=%s AND m.deleted_at IS NULL AND NOT coalesce(m.is_programme_deleted,false)
        AND lower(btrim(s.status)) NOT IN ('deleted','superseded','failed')''', [series_id])
    if not rows:
        return None, None
    series = rows[0]
    owner = str(series['module_catalogue_id'])
    if owner in modules:
        return learner, series
    shared = sorted(alias for alias, sources in shared_teams_sources(modules).items() if owner in sources)
    if not shared:
        return None, None
    return learner, {**series, 'learner_shared_module_ids': shared}


@require_GET
@learner_self_or_staff(kwarg='learner_id')
def learner_results(request, kind, learner_id, series_id, session_number):
    try:
        learner, series = learner_series(kind, learner_id, series_id)
        if not series:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        sessions = result_rows(series, session_number=session_number, email=str(learner.email or '').strip().casefold())
        return JsonResponse({'sessions': sessions})
    except DatabaseError:
        return unavailable()


def join_url_for(series, occurrence):
    """Where Join sends this learner for one occurrence, or '' when no link is usable.

    Replace Teams links stores the new link only on the module's live-session
    components (``liveSessionLinkOverride``); the meeting rows keep Microsoft's
    original, so an override wins. A shared duplicate keeps its own replaced
    link on its own components, which carry no meeting ids: they line up with
    the source's live sessions by authored position, as in
    views.apply_shared_teams_settings_to_weeks. Otherwise the occurrence, then
    the series, link applies; a component's ordinary link can be stale after a
    reschedule, so it is only the last resort.
    """
    from .teams_calendar_checks import safe_teams_join_url
    owner = str(series.get('module_catalogue_id') or '')
    shared = list(series.get('learner_shared_module_ids') or [])
    try:
        # Live-session components in authored order, reading only the keys a
        # join needs: settings_json also carries the whole calendar payload.
        rows = read('''SELECT c.module_catalogue_id,
                c.settings_json->>'teamsOccurrenceId' AS occurrence_id,
                c.settings_json->>'teamsLiveSessionId' AS series_id,
                c.settings_json->>'teamsSessionNumber' AS session_number,
                c.settings_json->>'liveSessionLinkOverride' AS link_override,
                c.settings_json->>'teamsMeetingUrl' AS teams_meeting_url,
                c.settings_json->>'liveSessionUrl' AS live_session_url
            FROM curriculum.components c
            LEFT JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s) AND c.deleted_at IS NULL AND NOT coalesce(c.is_programme_deleted,false)
              AND (w.id IS NULL OR (w.deleted_at IS NULL AND NOT coalesce(w.is_programme_deleted,false)))
              AND lower(replace(coalesce(c.type,''),'-','_'))='live_session'
            ORDER BY w.display_order,w.week_number,w.id,c.display_order,c.id''', [[owner, *shared]])
    except DatabaseError:
        # The meeting's own link still works without the authored overrides.
        log.warning('Could not read replaced Teams links for series %s.', series.get('id'), exc_info=True)
        rows = []
    occurrence_id, number = str(occurrence.get('id') or ''), str(occurrence.get('session_number') or '')
    source = [row for row in rows if row['module_catalogue_id'] == owner]
    exact = [index for index, row in enumerate(source)
             if (row.get('occurrence_id') and row['occurrence_id'] == occurrence_id)
             or (row.get('series_id') == str(series['id']) and str(row.get('session_number') or '') == number)]
    # A component booked against the whole series rather than one session.
    whole_series = [row for row in source if row.get('series_id') == str(series['id'])
                    and not row.get('occurrence_id') and not row.get('session_number')]
    candidates = []
    for module_id in shared:
        own = [row for row in rows if row['module_catalogue_id'] == module_id]
        candidates += [own[index].get('link_override') for index in exact[:1] if index < len(own)]
    candidates += [source[index].get('link_override') for index in exact]
    candidates += [row.get('link_override') for row in whole_series]
    candidates += [occurrence.get('join_url'), series.get('join_url')]
    candidates += [source[index].get(key) for index in exact for key in ('teams_meeting_url', 'live_session_url')]
    return next((str(url).strip() for url in candidates if safe_teams_join_url(str(url or '').strip())), '')


def learner_join_failure(kind, learner_id, reason):
    """Back to the learner's Attendance page with a readable message.

    Join opens in a new tab, so a JSON error would be all the learner sees.
    """
    response = HttpResponseRedirect(f'/learner/attendance/{kind}/{learner_id}?joinError={reason}')
    response['Cache-Control'] = 'private, no-store'
    return response


@require_GET
@learner_self_or_staff(kwarg='learner_id')
def learner_join(request, kind, learner_id, series_id, session_number):
    import uuid
    try:
        learner, series = learner_series(kind, learner_id, series_id)
        rows = read('SELECT * FROM curriculum.live_session_occurrences WHERE live_session_id=%s AND session_number=%s', [series_id, session_number]) if series else []
        if len(rows) != 1:
            return learner_join_failure(kind, learner_id, 'not-found')
        occurrence = rows[0]
        end = instant(occurrence.get('scheduled_end'))
        # Joining early is fine: Teams holds the learner in the lobby until it starts.
        if not end or end <= timezone.now():
            return learner_join_failure(kind, learner_id, 'ended')
        if (str(series.get('status') or '').strip().lower() in {'cancelled', 'canceled'}
                or str(occurrence.get('status') or '').strip().lower() in {'cancelled', 'canceled', 'deleted', 'superseded', 'failed'}):
            return learner_join_failure(kind, learner_id, 'unavailable')
        url = join_url_for(series, occurrence)
    except DatabaseError:
        log.exception('Could not open the Teams join for series %s session %s', series_id, session_number)
        return learner_join_failure(kind, learner_id, 'unavailable')
    if not url:
        return learner_join_failure(kind, learner_id, 'unavailable')
    email = str(getattr(learner, 'email', '') or '').strip().casefold()
    if email:
        # A launch is context for matching a meeting run, not proof of attendance.
        # It never stands between the learner and the meeting; its own
        # transaction keeps a failed write from affecting anything else.
        try:
            with transaction.atomic(), connections['default'].cursor() as cursor:
                cursor.execute('''INSERT INTO curriculum.live_session_join_launches
                    (id,live_session_id,occurrence_id,viewer_email,launched_at) VALUES (%s,%s,%s,%s,now() AT TIME ZONE 'UTC')''',
                    ['JOIN-' + uuid.uuid4().hex.upper(), series_id, occurrence['id'], email])
        except DatabaseError:
            log.warning('Could not record the Teams join launch for occurrence %s.', occurrence['id'], exc_info=True)
    response = HttpResponseRedirect(url)
    response['Cache-Control'] = 'private, no-store'
    return response


@require_POST
@csrf_protect
@require_role('admin', 'staff')
def queue_sync(request, series_id):
    try:
        series = read('SELECT * FROM curriculum.live_sessions WHERE id=%s', [series_id])
        if not series:
            return JsonResponse({'error': 'Session not found.'}, status=404)
        from .teams_week_meeting import ensure_week_meeting_occurrence
        ensure_week_meeting_occurrence(series[0])
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


def recording_download_name(row):
    """A saved recording's file name: module, session number and date, nothing a header could break on."""
    found = read('''SELECT s.module_title,o.session_number,o.scheduled_start FROM curriculum.live_session_occurrences o
        JOIN curriculum.live_sessions s ON s.id=o.live_session_id WHERE o.id=%s''', [row.get('occurrence_id')])
    session = found[0] if found else {}
    start = instant(session.get('scheduled_start'))
    parts = [session.get('module_title') or 'Live session',
             f"session {session['session_number']}" if session.get('session_number') else '',
             start.astimezone(ZoneInfo('Europe/London')).date().isoformat() if start else '']
    stem = re.sub(r'[^A-Za-z0-9]+', '-', ' '.join(part for part in parts if part)).strip('-')[:120] or 'session-recording'
    suffix = re.sub(r'[^A-Za-z0-9.]', '', PurePosixPath(row.get('blob_name') or '').suffix)[:8] or '.mp4'
    return stem + suffix


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
            # Staff asking to keep a copy get the file saved, not played.
            if row['artifact_type'] == 'recording' and not learner_view and request.GET.get('download') == '1':
                options['content_disposition'] = f'attachment; filename="{recording_download_name(row)}"'
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
        module_catalogue_id = str(request.GET.get('moduleId') or '').strip()
        result_options = {'session_number': session_number}
        if module_catalogue_id:
            result_options['module_catalogue_id'] = module_catalogue_id
        sessions = result_rows(series[0], **result_options) if series else []
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
