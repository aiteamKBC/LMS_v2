"""Live lecture workspace. Reads source records; never imports or provisions them."""
from datetime import datetime, timezone as datetime_timezone
from html import unescape
import logging
import re

from django.db import connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET

from audit_api.last_audit_ledger_views import _is_completed
from login.permissions import learner_self_or_staff
from old_otjh.repository import ksb_codes
from .attendance import combined_attendance_rows, _summarize_attendance
from .dashboard_metrics import as_json
from .learner_detail import SOURCE_MODELS
from .progress_rules import progress_record_counts_as_achieved as progress_counts_as_achieved
from .student_activity import CURRENT_SUBJECTS_SQL, _direct_progress_records
from .student_activity_access import student_activity_available
from .training_plan_dashboard import rows as dict_rows

log = logging.getLogger(__name__)
ATTENDANCE_SOURCE_FIELDS = ('id', 'username', 'email', 'aptem_id', 'employer_id')


def _text(value):
    return str(value or '').strip()


def _key(value):
    return re.sub(r'\s+', ' ', _text(value)).casefold()


def _module_key(value, *, without_level=False):
    value = re.sub(r'[\u200b-\u200d\ufeff]', '', unescape(_text(value))).casefold()
    value = re.sub(r'[^\w]+', ' ', value).strip()
    if without_level:
        value = re.sub(r'^level\s+\d+\s+', '', value)
    return value


def _legacy_module_activities(row, meta, activities):
    if meta.get('group_id') is not None:
        return [a for a in activities if str(a['group_id']) == str(meta['group_id'])]
    # Titles vary in punctuation and a leading qualification level between KBC
    # and Last_audit. Resolve only one of this learner's enrolled groups.
    for without_level in (False, True):
        key = _module_key(row.get('module_title'), without_level=without_level)
        if not key:
            return []
        matches = [a for a in activities if _module_key(a['group_name'], without_level=without_level) == key]
        groups = {a['group_id'] for a in matches}
        if groups:
            return matches if len(groups) == 1 else []
    return []


def _activity_ksbs(activities):
    return ksb_codes([code for activity in activities for code in ksb_codes(activity.get('ksbs'))])


def _component_ksbs(component):
    return ksb_codes(component.get('ksb_mappings')) or ksb_codes(component.get('mapped_ksbs'))


def _fill_ksbs(lecture, linked, module_activities, module_codes=None):
    """Keep session mappings first; identify a broader module fallback honestly."""
    for scope, activities in (('activities', linked), ('module', module_activities)):
        codes = module_codes if scope == 'module' and module_codes is not None else _activity_ksbs(activities)
        if codes:
            lecture.update(ksbs=codes, ksbScope=scope)
            return


def _aware(value):
    # Historical native tables use timestamp without time zone, written by
    # Django on a UTC connection. PostgreSQL timestamptz rows are already aware.
    return timezone.make_aware(value, datetime_timezone.utc) if value and timezone.is_naive(value) else value


def session_key(row):
    """Keep existing KBC keys compatible; namespace native occurrences."""
    raw = _text(row.get('session_id'))
    return raw if row.get('source', 'kbc-attendance') == 'kbc-attendance' else f'teams:{raw}'


def report_id(row):
    from .absence_reports import _kbc_attendance_report_id
    # KBC source keys already include learner and date; Teams occurrence IDs do not.
    key = session_key(row)
    if row.get('source') == 'microsoft-teams':
        key = f"{row['learner_id']}:{key}"
    return _kbc_attendance_report_id(key)


def read_native_occurrences(source):
    """Invite-scoped occurrences, including future and unsynced sessions."""
    if not source.email:
        return []
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT o.id AS session_id,o.id AS occurrence_id,
            s.id AS live_session_id,s.module_catalogue_id,s.module_title,
            o.scheduled_start,o.scheduled_end,o.updated_at,o.session_number,
            o.attendance_report_id,s.organizer_email AS coach_name
            FROM curriculum.live_session_occurrences o
            JOIN curriculum.live_sessions s ON s.id=o.live_session_id
            WHERE lower(s.status) NOT IN ('cancelled','canceled','deleted')
              AND lower(o.status) NOT IN ('cancelled','canceled','deleted')
              AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(s.attendees)='array' THEN s.attendees ELSE '[]'::jsonb END) e
                WHERE lower(btrim(e))=%s)
            ORDER BY o.scheduled_start,o.id''', [_key(source.email)])
        result = dict_rows(cur)
    now = timezone.now()
    for row in result:
        row['scheduled_start'] = _aware(row['scheduled_start'])
        row['scheduled_end'] = _aware(row['scheduled_end'])
        row['updated_at'] = _aware(row['updated_at'])
        start = timezone.localtime(row['scheduled_start'])
        end = timezone.localtime(row['scheduled_end'])
        row.update(
            learner_id=source.id, learner_name=source.username or '', learner_email=source.email,
            source='microsoft-teams', session_type='live_session',
            session_title=f"{row['module_title'] or 'Live session'} — Session {row['session_number']}",
            session_date=start.date(), session_start_time=start.time(), session_end_time=end.time(),
            attendance_status='upcoming' if row['scheduled_start'] > now else
                              'in_progress' if row['scheduled_end'] > now else 'pending',
            minutes_late=0, catchup_completed=False,
        )
    return result


def lecture_register(source):
    records = combined_attendance_rows(source)
    scheduled = read_native_occurrences(source)
    by_occurrence = {str(row['session_id']): row for row in scheduled}
    now = timezone.now()
    result = []
    for row in records:
        if row.get('source') == 'microsoft-teams':
            schedule = by_occurrence.pop(str(row['session_id']), None)
            if schedule is None:
                # A cancelled/deleted occurrence no longer belongs in the workspace.
                continue
            if schedule['scheduled_end'] > now:
                row = schedule
            else:
                row = {**schedule, **row, 'scheduled_start': schedule['scheduled_start'],
                       'scheduled_end': schedule['scheduled_end'], 'session_date': schedule['session_date'],
                       'session_start_time': schedule['session_start_time'], 'session_end_time': schedule['session_end_time']}
        elif row['session_date'] > timezone.localdate():
            row = {**row, 'attendance_status': 'upcoming'}
        result.append({**row, 'updated_at': _aware(row.get('updated_at'))})
    result.extend(by_occurrence.values())
    return result


def read_legacy_metadata(source, register):
    if not student_activity_available(source.aptem_id):
        return {}, []
    aptem = int(str(source.aptem_id).strip())
    keys = [row['session_id'] for row in register if row.get('source') == 'kbc-attendance']
    if not keys:
        return {}, []
    with connections['enrolment'].cursor() as cur:
        # The register remains authoritative for attendance/date/title. Last_audit
        # and the audit editor supply details only, joined by the exact source key.
        cur.execute('''SELECT la.source_key,la.activity_hours,
            j.ksbs,r.activity_time,r.completion_note,r.group_id,r.month AS log_month,
            greatest(la.synced_at,r.updated_at,j.updated_at) AS updated_at
            FROM "Last_audit".learner_attendance la
            LEFT JOIN structured_manual_activities.manual_learner_activities r
              ON r.aptem_id=la.aptem_id AND r.source_ref='att:' || la.source_key
             AND r.category='attendance' AND r.deleted_at IS NULL
            LEFT JOIN structured_manual_activities.learner_journal_row_ksbs j
              ON j.aptem_id=r.aptem_id AND j.row_id=r.id
            WHERE la.aptem_id=%s AND la.source_key=ANY(%s)''', [aptem, keys])
        metadata_rows = dict_rows(cur)
        metadata = {}
        for row in metadata_rows:
            # Ambiguous audit links cannot choose another row's KSBs arbitrarily.
            key = row['source_key']
            metadata[key] = row if key not in metadata else None
        # Resolve against every enrolled non-empty group first, preserving the
        # ambiguity rule, then fetch materials only for this register's modules.
        cur.execute('''SELECT DISTINCT gl.group_id,g.group_name
            FROM "Last_audit".learners l
            JOIN "Last_audit".group_learners gl ON gl.learner_id=l.learner_id
            JOIN "Last_audit".groups g ON g.group_id=gl.group_id
            JOIN "Last_audit".group_activities ga ON ga.group_id=gl.group_id
            JOIN "Last_audit".activities a ON a.activity_id=ga.activity_id
            WHERE l.aptem_id=%s''', [aptem])
        groups = dict_rows(cur)
        group_ids = sorted({group['group_id'] for row in register
                            if row.get('source') == 'kbc-attendance'
                            for group in _legacy_module_activities(row, metadata.get(row['session_id']) or {}, groups)})
        if not group_ids:
            return metadata, []
        cur.execute('''SELECT gl.group_id,g.group_name,a.activity_id,a.title,a.activity_date,
            a.activity_type,a.configured_duration_min,a.quiz_id,a.reading_type,
            CASE WHEN nullif(a.reading_iframe_url,'') IS NOT NULL THEN 'present' ELSE '' END AS reading_iframe_url,
            CASE WHEN jsonb_typeof(a.quiz_questions)='array' AND a.quiz_questions<>'[]'::jsonb
                 THEN '[{}]'::jsonb ELSE '[]'::jsonb END AS quiz_questions,
            r.status,r.video_completed,
            r.reading_viewed,r.quiz_passed,r.updated_at,
            coalesce(CASE WHEN lk.source_preference='learner' THEN lk.ksbs ELSE ak.ksbs END,
                     a.raw #> '{live_lms_component,ksbs}') AS ksbs,
            EXISTS (SELECT 1 FROM "Learner".subject_activity_attempts p
              WHERE p.enrolment_id=%s AND p.aptem_id=l.aptem_id AND p.group_id=gl.group_id
                AND p.activity_id=a.activity_id AND p.completed=true) AS new_completed
            FROM "Last_audit".learners l
            JOIN "Last_audit".group_learners gl ON gl.learner_id=l.learner_id
            JOIN "Last_audit".groups g ON g.group_id=gl.group_id
            JOIN "Last_audit".group_activities ga ON ga.group_id=gl.group_id
            JOIN "Last_audit".activities a ON a.activity_id=ga.activity_id
            LEFT JOIN "Last_audit".activity_results r ON r.learner_id=l.learner_id
              AND r.group_id=gl.group_id AND r.activity_id=a.activity_id
            LEFT JOIN structured_manual_activities.learner_activity_ksbs lk
              ON lk.aptem_id=l.aptem_id AND lk.activity_id=a.activity_id
            LEFT JOIN structured_manual_activities.activity_ksbs ak ON ak.activity_id=a.activity_id
            WHERE l.aptem_id=%s AND gl.group_id=ANY(%s)''', [source.id, aptem, group_ids])
        activities = dict_rows(cur)
    return metadata, activities


def read_native_components(source, module_refs=None):
    # Only modules represented by a Teams lecture need activity bundles. Keep
    # direct progress for Recent Activity even on a historical-only register.
    if module_refs is not None and not module_refs:
        return [], _direct_progress_records(source.id)
    with connections['enrolment'].cursor() as cur:
        cur.execute(CURRENT_SUBJECTS_SQL, [source.id])
        modules = [row[0] for row in cur.fetchall() if module_refs is None or row[0] in module_refs]
        cur.execute('''SELECT c.id,c.module_catalogue_id,c.week_id,c.type,c.title,c.description,
            jsonb_build_object(
                'teamsOccurrenceId',c.settings_json->'teamsOccurrenceId',
                'teamsLiveSessionId',c.settings_json->'teamsLiveSessionId',
                'sessionDate',c.settings_json->'sessionDate',
                'sessionPurpose',c.settings_json->'sessionPurpose',
                'legacySettings',CASE WHEN jsonb_typeof(c.settings_json->'legacySettings')='object'
                    THEN jsonb_build_object('teamsOccurrenceId',c.settings_json #> '{legacySettings,teamsOccurrenceId}')
                    ELSE c.settings_json->'legacySettings' END
            ) AS settings_json,c.expected_otjh,c.ksb_mappings,
            (SELECT jsonb_agg(k.ksb_code ORDER BY k.ksb_code)
             FROM curriculum.ksb_mappings k WHERE k.component_id=c.id AND k.deleted_at IS NULL) AS mapped_ksbs
            FROM curriculum.components c
            LEFT JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s) AND c.deleted_at IS NULL
              AND NOT c.is_programme_deleted AND (w.id IS NULL OR
                (w.deleted_at IS NULL AND NOT w.is_programme_deleted))
            ORDER BY c.display_order,c.id''', [modules])
        components = dict_rows(cur)
    progress = _direct_progress_records(source.id)
    completed = {str(row.get('componentId')) for row in progress if progress_counts_as_achieved(row)}
    for component in components:
        settings = as_json(component['settings_json'], {})
        component['settings'] = settings if isinstance(settings, dict) else {}
        component['completed'] = str(component['id']) in completed
    return components, progress


def _component_for(row, components):
    candidates = []
    for component in components:
        if component['type'] != 'live_session' or component['module_catalogue_id'] != row.get('module_catalogue_id'):
            continue
        settings = component['settings']
        legacy = as_json(settings.get('legacySettings'), {})
        legacy = legacy if isinstance(legacy, dict) else {}
        occurrence = settings.get('teamsOccurrenceId') or legacy.get('teamsOccurrenceId')
        if occurrence:
            if occurrence == row['session_id']:
                candidates.append(component)
        elif settings.get('teamsLiveSessionId') == row.get('live_session_id'):
            # Recurring meetings may have one component per occurrence. Require
            # the authored date as well, so completing week one cannot cover ten.
            if settings.get('sessionDate') == row['session_date'].isoformat():
                candidates.append(component)
    return candidates[0] if len(candidates) == 1 else None


def _duration(row):
    if row.get('scheduled_start') and row.get('scheduled_end'):
        return round((row['scheduled_end'] - row['scheduled_start']).total_seconds() / 60)
    return None


def build_lectures(register, legacy_meta, legacy_activities, components, kind, learner_id):
    lectures = []
    # Resolve a module and its KSB fallback once per request, instead of
    # rescanning thousands of activities for every lecture in that module.
    legacy_modules = {}
    native_modules = {}
    module_ksbs = {}
    for component in components:
        native_modules.setdefault(component['module_catalogue_id'], []).append(
            {**component, 'ksbs': _component_ksbs(component)})
    for row in register:
        source = row.get('source', 'kbc-attendance')
        # Monthly Logs groups Teams attendance by the stored scheduled timestamp.
        # Its UTC month can differ from the local date displayed in Attendance.
        log_date = (row.get('scheduled_start') or row['session_date']) if source == 'microsoft-teams' else row['session_date']
        module_id = f"native:{row['module_catalogue_id']}" if source == 'microsoft-teams' else f"legacy:{_key(row.get('module_title'))}"
        lecture = {
            'id': f"{session_key(row)}-{row['session_date'].isoformat()}",
            'sessionId': session_key(row), 'reportId': str(report_id(row)),
            'monthlyLog': {'month': log_date.isoformat()[:7],
                           'sourceRef': f"attendance:{row['session_id']}" if source == 'microsoft-teams' else f"att:{row['session_id']}"},
            'date': row['session_date'].isoformat(), 'title': row.get('session_title') or 'Lecture',
            'moduleId': module_id, 'module': row.get('module_title') or 'Other lectures',
            'source': source, 'startTime': row['session_start_time'].strftime('%H:%M') if row.get('session_start_time') else '',
            'endTime': row['session_end_time'].strftime('%H:%M') if row.get('session_end_time') else '',
            'durationMinutes': _duration(row), 'contentSummary': '', 'ksbs': [], 'ksbScope': None, 'activities': [],
            'status': {'present': 'completed', 'late': 'late', 'absent': 'absent',
                       'upcoming': 'upcoming', 'in_progress': 'in_progress'}.get(row['attendance_status'], 'pending'),
            'catchupStatus': None, 'updatedAt': row['updated_at'].isoformat() if row.get('updated_at') else None,
        }
        if source == 'kbc-attendance':
            meta = legacy_meta.get(row['session_id']) or {}
            if meta.get('log_month'):
                lecture['monthlyLog']['month'] = str(meta['log_month'])[:7]
            lecture['ksbs'] = ksb_codes(meta.get('ksbs'))
            if lecture['ksbs']:
                lecture['ksbScope'] = 'lecture'
            if meta.get('activity_hours') is not None:
                lecture['durationMinutes'] = float(meta['activity_hours']) * 60
            if meta.get('activity_time'):
                lecture['startTime'] = meta['activity_time'].strftime('%H:%M')
            key = ('legacy', meta.get('group_id'), row.get('module_title'))
            if key not in legacy_modules:
                legacy_modules[key] = _legacy_module_activities(row, meta, legacy_activities)
            module_activities = legacy_modules[key]
            linked = [a for a in module_activities if a.get('activity_date') == row['session_date'] or
                      _key(a['title']) == _key(row.get('session_title'))]
            # An explicitly cleared journal mapping remains cleared. Only an
            # absent mapping falls back to the materials' current saved KSBs.
            if meta.get('ksbs') is None and legacy_meta.get(row['session_id'], {}) is not None:
                if key not in module_ksbs:
                    module_ksbs[key] = _activity_ksbs(module_activities)
                _fill_ksbs(lecture, linked, module_activities, module_ksbs[key])
            for activity in linked:
                lecture['activities'].append({
                    'id': f"legacy:{activity['group_id']}:{activity['activity_id']}",
                    'title': activity['title'] or 'Activity', 'type': activity['activity_type'],
                    'completed': bool(activity.get('new_completed') or _is_completed(activity)),
                    'groupId': activity['group_id'], 'activityId': activity['activity_id'],
                })
            lecture['contentSummary'] = '; '.join(dict.fromkeys(a['title'] for a in lecture['activities']))
        else:
            module_activities = native_modules.get(row.get('module_catalogue_id'), [])
            component = _component_for(row, module_activities)
            linked = []
            if component:
                lecture['title'] = component['title'] or lecture['title']
                lecture['contentSummary'] = component['description'] or component['settings'].get('sessionPurpose') or ''
                lecture['ksbs'] = _component_ksbs(component)
                if lecture['ksbs']:
                    lecture['ksbScope'] = 'lecture'
                # The authored week is this lecture's activity bundle.
                linked = [c for c in module_activities if c['id'] == component['id'] or
                          (component['week_id'] is not None and c['week_id'] == component['week_id']
                           and c['type'] != 'live_session')]
                for activity in linked:
                    lecture['activities'].append({
                        'id': activity['id'], 'title': activity['title'] or 'Activity',
                        'type': activity['type'], 'completed': activity['completed'],
                        'href': f"/learner/component/{kind}/{learner_id}/{activity['id']}",
                    })
            if not lecture['ksbs']:
                key = ('native', row.get('module_catalogue_id'))
                if key not in module_ksbs:
                    module_ksbs[key] = _activity_ksbs(module_activities)
                _fill_ksbs(lecture, linked, module_activities, module_ksbs[key])
        if lecture['status'] == 'absent':
            activities = lecture['activities']
            lecture['catchupStatus'] = 'completed' if activities and all(a['completed'] for a in activities) else 'pending'
        lectures.append(lecture)
    return sorted(lectures, key=lambda r: (r['date'], r['startTime'], r['id']))


def lecture_totals(lectures):
    attended = sum(row['status'] in {'completed', 'late'} for row in lectures)
    absent = sum(row['status'] == 'absent' for row in lectures)
    return {'total': len(lectures), 'attended': attended, 'absent': absent,
            'covered': sum(row['catchupStatus'] == 'completed' for row in lectures),
            'upcoming': sum(row['status'] == 'upcoming' for row in lectures),
            'attendanceRate': round(100 * attended / (attended + absent)) if attended + absent else None}


def read_workspace(source, kind):
    from .attendance_mode import read_mode
    register = lecture_register(source)
    metadata, activities = read_legacy_metadata(source, register)
    native_modules = {row['module_catalogue_id'] for row in register if row.get('source') == 'microsoft-teams'}
    components, progress = read_native_components(source, native_modules)
    lectures = build_lectures(register, metadata, activities, components, kind, source.id)
    mode = read_mode(source, kind)
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT id,attendance_id,status,session_title,created_at,updated_at
            FROM "Coach".coach_absence_report WHERE learner_id=%s ORDER BY created_at DESC''', [source.id])
        reports = dict_rows(cur)
        cur.execute('''SELECT id,event_type,status,updated_at FROM "Coach".coach_calendar_event
            WHERE learner_id=%s AND lower(btrim(learner_email))=%s
              AND event_type IN ('student-support','catch-up') AND scheduled_date IS NOT NULL
            ORDER BY updated_at DESC LIMIT 15''', [source.id, _key(source.email)])
        bookings = dict_rows(cur)
        cur.execute('''SELECT p.id,coalesce(nullif(p.feed_title,''),p.component_title) AS title,
            p.feed_action,p.feed_occurred_at
            FROM "Learner".learner_progress_entries p
            JOIN "Learner".learners l ON l.id=p.learner_id
            WHERE l.enrolment_id=%s AND p.kind='activity_event' AND p.feed_occurred_at IS NOT NULL
            ORDER BY p.feed_occurred_at DESC,p.id DESC LIMIT 20''', [source.id])
        events = dict_rows(cur)
    reported = {str(report['attendance_id']): report for report in reversed(reports)}
    recent = []
    for lecture in lectures:
        report = reported.get(lecture['reportId'])
        lecture['absenceReport'] = {'id': report['id'], 'status': report['status']} if report else None
        lecture['canReportAbsence'] = lecture['status'] in {'absent', 'upcoming'} and not report
        if lecture['status'] in {'completed', 'late'} and lecture['updatedAt']:
            recent.append({'id': lecture['id'], 'title': f"{lecture['title']} attended", 'at': lecture['updatedAt'], 'type': 'attendance'})
    for report in reports:
        recent.append({'id': f"report:{report['id']}", 'title': f"Absence report: {report['session_title']} ({report['status']})",
                       'at': _aware(report['updated_at']).isoformat(), 'type': 'absence'})
    for booking in bookings:
        recent.append({'id': f"booking:{booking['id']}",
                       'title': f"{'Support session' if booking['event_type'] == 'student-support' else 'Catch-up session'}: {booking['status']}",
                       'at': _aware(booking['updated_at']).isoformat(), 'type': 'booking'})
    for event in events:
        recent.append({'id': f"event:{event['id']}",
                       'title': f"{event['title'] or 'Activity'} {event['feed_action'] or ''}".strip(),
                       'at': _aware(event['feed_occurred_at']).isoformat(), 'type': 'activity'})
    for entry in progress:
        at = entry.get('submittedAt')
        if at:
            recent.append({'id': f"progress:{entry.get('componentId')}:{at}",
                           'title': f"{entry.get('componentTitle') or 'Activity'} completed" if progress_counts_as_achieved(entry) else
                                    f"{entry.get('componentTitle') or 'Activity'} attempted",
                           'at': at.isoformat() if isinstance(at, datetime) else str(at), 'type': 'activity'})
    if mode.get('updatedAt'):
        recent.append({'id': 'mode', 'title': f"Attendance mode: {mode['requestedMode'] or mode['mode']}",
                       'at': mode['updatedAt'], 'type': 'mode'})
    planned = sum((r['durationMinutes'] or 0) / 60 for r in lectures if r['status'] == 'upcoming')
    mode['unmappedPlannedLectures'] = sum(r['durationMinutes'] is None for r in lectures if r['status'] == 'upcoming')
    mode['plannedLiveHours'] = round(planned, 2) if mode['mode'] == 'live' else 0
    mode['plannedRecordedHours'] = round(planned, 2) if mode['mode'] == 'lazy' else 0
    return {'lectures': lectures, 'totals': lecture_totals(lectures),
            'summary': _summarize_attendance(register), 'mode': mode,
            'modules': [{'id': key, 'title': title} for key, title in sorted({(r['moduleId'], r['module']) for r in lectures}, key=lambda v: v[1])],
            'recentActivity': sorted(recent, key=lambda r: r['at'], reverse=True)[:30]}


@require_GET
@learner_self_or_staff(kwarg='learner_id')
def attendance_lectures(request, kind, learner_id):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Unknown learner kind.'}, status=404)
    try:
        source = model.all_learners.filter(pk=learner_id).only(*ATTENDANCE_SOURCE_FIELDS).first()
        if source is None:
            return JsonResponse({'error': 'Learner not found.'}, status=404)
        payload = read_workspace(source, kind)
    except Exception:
        log.exception('Could not read lecture workspace for learner %s', learner_id)
        return JsonResponse({'error': 'Could not refresh lectures. Please try again.'}, status=502)
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    return response
