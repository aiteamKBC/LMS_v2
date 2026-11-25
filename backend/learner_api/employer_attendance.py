"""Employer-only attendance totals; source registers and watch history stay intact."""
from django.db import connections
from django.utils import timezone

from .attendance import _summarize_attendance
from .attendance_rules import INVALID, attendance_outcome
from curriculum_api.session_results_policy import instant


FIELDS = ('sessions', 'present', 'absent', 'late', 'attendanceRate')


def read_plan_session_target(source):
    """Current authored plan target, independent of attendance and recordings."""
    from curriculum_api.learning_storage import read_sql
    from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
    from .attendance_assignments import assigned_module_ids
    from .training_plan_dashboard import is_educational_live_session_week, rows

    ids = assigned_module_ids(source)
    if not ids:
        return None
    with connections['enrolment'].cursor() as cur:
        cur.execute(read_sql('''SELECT m.module_catalogue_id AS id,m.sessions_number
            FROM curriculum.modules m WHERE m.module_catalogue_id=ANY(%s)
              AND (m.deleted_at IS NULL OR COALESCE(m.deleted_via_parent,'')<>'')''', cur.db), [ids])
        modules = {row['id']: row for row in rows(cur)}
        cur.execute(read_sql(f'''SELECT w.module_catalogue_id,w.title,count(c.id) AS sessions
            FROM curriculum.weeks w LEFT JOIN curriculum.components c
              ON c.module_catalogue_id=w.module_catalogue_id AND c.week_id=w.id
              AND lower(replace(coalesce(c.type,''),'-','_'))='live_session'
              AND {visible_child_sql('c')}
            WHERE w.module_catalogue_id=ANY(%s) AND {visible_week_sql('w')}
            GROUP BY w.id,w.module_catalogue_id,w.title''', cur.db), [list(modules)])
        authored = dict.fromkeys(modules, 0)
        for row in rows(cur):
            if is_educational_live_session_week(row['title']):
                authored[row['module_catalogue_id']] += row['sessions']
    # Match Training Plan module targets: teaching components first, then the
    # module's configured session count when no teaching components exist yet.
    total = sum(authored[mid] or max(0, int(module['sessions_number'] or 0))
                for mid, module in modules.items())
    return total or None


def _recorded(row):
    return row.get('attendance_basis') == 'recorded' or row.get('final_outcome') == 'recorded'


def _occurrence(row):
    if row.get('source') != 'microsoft-teams':
        return ''
    return str(row.get('attendance_source_occurrence_id') or row.get('occurrence_id')
               or row.get('session_id') or '')


def _eligible(rows, now):
    return [row for row in rows if row.get('session_date') and attendance_outcome(row, now)[0]
            not in {'upcoming', 'in_progress'} and not any(
                str(row.get(field) or '').strip().lower() in INVALID
                for field in ('status', 'session_status', 'occurrence_status', 'attendance_status'))]


def project_attendance(rows, *, recordings, session_target, mode='live', now=None):
    if session_target is None or session_target <= 0:
        return None
    now = now or timezone.now()
    summary = _summarize_attendance(rows, now=now)
    if summary:
        summary = {**{field: summary[field] for field in FIELDS},
                   'sessions': session_target,
                   'attendanceRate': round(summary['present'] / session_target * 100, 2)}
    live, recorded, available, counted, late = set(), set(), set(), set(), set()
    for index, row in enumerate(_eligible(rows, now)):
        occurrence = _occurrence(row)
        key = ('teams', occurrence) if occurrence else (
            row.get('source') or 'kbc-attendance', str(row.get('session_id') or f'row:{index}'))
        status, counts = attendance_outcome(row, now)
        evidence = recordings.get(occurrence) or {}
        available_at = instant(evidence.get('availableAt'))
        completed_at = instant(evidence.get('completedAt'))
        ready = evidence.get('ready') and (available_at is None or available_at <= now)
        watched = ready and evidence.get('completed') and (completed_at is None or completed_at <= now)
        if counts:
            counted.add(key)
        if counts and status == 'present' and not _recorded(row):
            live.add(key)
            if row.get('attendance_status') == 'late' or (row.get('minutes_late') or 0) > 0:
                late.add(key)
        if ready or _recorded(row):
            available.add(key)
        if watched or _recorded(row):
            recorded.add(key)

    if not recorded and (mode != 'lazy' or live):
        # Preserve Live credit rules; only the denominator follows the plan.
        return summary
    if not available:
        if mode == 'lazy' and not live:
            return None
        return summary

    delivery = 'mixed' if live else 'recorded'
    total = session_target
    completed_recordings = recorded - live
    completed = len(live | recorded) if delivery == 'mixed' else len(recorded)
    observed_total = len(counted | available) if delivery == 'mixed' else len(available)
    return {
        'sessions': total, 'present': completed, 'absent': max(0, observed_total - completed),
        'late': len(late), 'attendanceRate': round(completed / total * 100, 2),
        'mode': delivery, 'livePresent': len(live),
        'recordedPresent': len(completed_recordings), 'recordedTotal': len(available),
    }


def read_attendance(source, kind=None):
    from .attendance_lectures import lecture_register
    from .recorded_attendance import saved_delivery_mode
    from curriculum_api.recording_views import recording_completion_evidence

    now = timezone.now()
    session_target = read_plan_session_target(source)
    if session_target is None:
        return None
    register = lecture_register(source)
    eligible = _eligible(register, now)
    occurrence_ids = {_occurrence(row) for row in eligible} - {''}
    if not occurrence_ids and not any(_recorded(row) for row in eligible):
        return project_attendance(register, recordings={}, session_target=session_target, now=now)
    learner_id = getattr(source, 'pk', None) or source.id
    kind = kind or ('commercial' if getattr(source, 'learner_type', '') == 'commercial' else 'apprenticeship')
    # This helper reads saved, playable recording identities and completed watch
    # evidence only. It does not sync Microsoft or settle recovery workflows.
    recordings = recording_completion_evidence(kind, learner_id, occurrence_ids) if occurrence_ids else {}
    return project_attendance(register, recordings=recordings, session_target=session_target,
                              mode=saved_delivery_mode(learner_id), now=now)
