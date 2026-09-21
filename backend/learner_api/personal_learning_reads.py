"""Read-only curriculum and saved recording adapters for personal courses."""
import copy
import re

from django.db import connections
from django.http import JsonResponse
from django.utils import timezone


def learning_schedule(context):
    from .training_plan_dashboard import plan_module, rows
    from curriculum_api.views import cohort_selected_holidays_by_cohort, module_session_plan_for_count, module_stored_session_count
    mid = context['module_id']
    with connections['enrolment'].cursor() as cursor:
        cursor.execute('''SELECT m.*, m.module_catalogue_id AS id,
            coalesce(nullif(m.session_week_day,''),g.session_week_day) AS session_week_day,
            coalesce(nullif(m.session_start_time,''),g.session_start_time) AS session_start_time,
            coalesce(nullif(m.session_end_time,''),g.session_end_time) AS session_end_time
            FROM curriculum.modules m LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
            WHERE m.module_catalogue_id=%s AND m.deleted_at IS NULL''', [mid])
        found = rows(cursor)
        if not found:
            raise LookupError('Course not found.')
        row = found[0]
        cursor.execute('''SELECT learning_outcomes FROM curriculum.weeks WHERE module_catalogue_id=%s
            AND (deleted_at IS NULL OR COALESCE(deleted_via_parent,'')<>'') ORDER BY display_order,week_number,id''', [mid])
        weeks = cursor.fetchall()
    result = plan_module(row)
    result['learning_outcomes'] = list(dict.fromkeys(value for week in weeks for value in (week[0] if isinstance(week[0], list) else []) if isinstance(value, str) and value.strip()))
    holidays = cohort_selected_holidays_by_cohort([row.get('cohort_id')])
    plan = module_session_plan_for_count(row, module_stored_session_count(row, len(weeks)), holidays=holidays.get(str(row.get('cohort_id') or ''), []))
    result.update(curriculumSlots=plan.get('slots') or [], effectiveEndDate=plan.get('finalEndDate') or '', originalEndDate=plan.get('originalEndDate') or '')
    return {'modules': [result], 'moduleLinks': {f'current:{mid}': {'id': mid, 'title': row['title']}}, 'generatedAt': timezone.now().isoformat()}


def session_read(request, context, detail, path, query):
    from curriculum_api.session_results import read, result_rows, stored_content
    from .personal_learning import ensure_open
    ensure_open(detail, context)
    prefix = '/learner_api/session-results/commercial/' + re.escape(context['id']) + '/'
    match = re.fullmatch(prefix + r'([^/]+)/(sessions/(\d+)|artifacts/([^/]+))/', path)
    if not match:
        raise LookupError('Live participation is not part of personal learning.')
    series_id, number, artifact = match[1], match[3], match[4]
    series = read('''SELECT * FROM curriculum.live_sessions WHERE id=%s AND module_catalogue_id=%s
        AND status NOT IN ('deleted','superseded','failed')''', [series_id, context['module_id']])
    assigned = [c for c in detail['components'] if c.get('teamsLiveSessionId') == series_id]
    if not series or not assigned:
        raise LookupError('Session not found in this course.')
    allowed = {str(c.get('teamsSessionNumber')) for c in assigned if c.get('teamsSessionNumber')}
    if number:
        if number not in allowed:
            raise LookupError('Session not found in this course.')
        sessions = result_rows(series[0], session_number=int(number), email='')
        # Empty email applies the same recording visibility filter as learners.
        # Personal study has no attendance identity, roster or join-launch row.
        for session in sessions:
            session.pop('attendance', None)
        return JsonResponse({'sessions': sessions})
    found = read('''SELECT o.session_number FROM curriculum.live_session_artifacts a
        JOIN curriculum.live_session_occurrences o ON o.id=a.occurrence_id
        WHERE a.id=%s AND o.live_session_id=%s''', [artifact, series_id])
    if not found or str(found[0]['session_number']) not in allowed:
        raise LookupError('File not found in this course.')
    scoped_request = copy.copy(request)
    scoped_request.GET = request.GET.copy()
    if query.get('format') in ('txt', 'cues'):
        scoped_request.GET['format'] = query['format']
    return stored_content(scoped_request, series_id, artifact, learner_view=True)
