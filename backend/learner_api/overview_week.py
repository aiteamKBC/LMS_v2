"""Small, read-only weekly overview. Never hydrates a learner or fetches content."""
from datetime import datetime, timedelta, timezone
import logging
from zoneinfo import ZoneInfo

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from login.permissions import learner_self_or_staff
from audit_api.last_audit_ledger_views import _is_completed
from .dashboard_metrics import point_codes, ratio
from .progress_rules import progress_counts_as_achieved
from .learner_detail import SOURCE_MODELS
from .student_activity import CURRENT_SUBJECTS_SQL, _direct_progress_records, _direct_progress_otjh
from .student_activity_access import student_activity_available
from .student_activity_data import read_curriculum_schedules, apply_curriculum_schedules
from .subject_dates import activity_schedule, as_date
from .subject_content import clean_text
from .training_plan_dashboard import number, rows

log = logging.getLogger(__name__)
UK = ZoneInfo('Europe/London')


def week_bounds(now=None):
    today = (now or datetime.now(timezone.utc)).astimezone(UK).date()
    start = today - timedelta(days=today.weekday())
    return start, start + timedelta(days=6)


def progress_day(value):
    try:
        value = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return value.replace(tzinfo=timezone.utc).astimezone(UK).date() if value.tzinfo is None else value.astimezone(UK).date()
    except (ValueError, TypeError):
        return None


def focus_latest_module(summary, latest):
    """Keep the newest assigned Builder module visible before its first lesson."""
    if not latest:
        return {**summary, 'latestModuleId': None}
    module_id, title = latest
    existing = next((module for module in summary['modules'] if module_id in module['moduleIds']), None)
    if existing:
        return {**summary, 'latestModuleId': existing['id'], 'modules': [
            {**module, 'title': clean_text(title) or module['title']} if module['id'] == existing['id'] else module
            for module in summary['modules']]}
    placeholder = {'id': f'current:{module_id}', 'title': clean_text(title) or 'Learning activities',
                   'moduleIds': [module_id], 'weekLabels': [], 'completed': 0, 'total': 0,
                   'percent': None, 'ksbCodes': [], 'ksbMappingMissing': False}
    return {**summary, 'modules': [placeholder, *summary['modules']], 'latestModuleId': placeholder['id']}


def merged_activities(historical, native, progress, attempts, links):
    """Merge only explicit identities, using the same completion rule as the cards."""
    achieved = [row for row in progress if progress_counts_as_achieved(row.get('kind'), row.get('passed'))]
    component_ids = {str(row['componentId']) for row in achieved if row.get('componentId')}
    quiz_ids = {str(row['quizId']) for row in achieved if row.get('quizId')}
    activities = {}
    for row in historical:
        key = (str(row['group_id']), str(row['activity_id']))
        done = _is_completed(row) or key in attempts
        previous = activities.get(key)
        activities[key] = {**row, 'key': key, 'subject': f'legacy:{row["group_id"]}',
                           'completed': done or bool(previous and previous['completed'])}
    for row in native:
        key = links.get(str(row['id']), ('native', str(row['id'])))
        previous = activities.get(key)
        done = str(row['id']) in component_ids or bool(row.get('quiz_id') and str(row['quiz_id']) in quiz_ids)
        if previous:
            previous['completed'] |= done
            # A mapped Builder activity can be rescheduled after the export.
            if row.get('date') and not row.get('date_needs_review'):
                for field in ('date', 'week_start', 'week_end', 'section_title', 'date_needs_review'):
                    previous[field] = row.get(field)
            old_codes, new_codes = point_codes(previous.get('ksb_mappings')), point_codes(row.get('ksb_mappings'))
            if old_codes is not None and new_codes is not None:
                previous['ksb_mappings'] = sorted(old_codes | new_codes)
            previous['type'] = row['type']
            previous['due_timing'] = row.get('due_timing')
            previous['module_id'] = row['module_id']
            if number(row.get('expected_hours')) is not None:
                previous['expected_hours'] = row['expected_hours']
                previous['expected_source'] = 'native'
        else:
            activities[key] = {**row, 'key': key, 'subject': f'current:{row["module_id"]}', 'completed': done}
    return activities.values()


def summarise_plan(activities, assigned):
    """Monthly cards need counts and dates, never lesson bodies or attempts."""
    subjects = {}
    for row in activities:
        subject = subjects.setdefault(row['subject'], {
            'id': row['subject'], 'title': clean_text(row.get('module_title')) or 'Learning activities',
            'source': 'legacy' if row['subject'].startswith('legacy:') else 'current',
            'total': 0, 'completed': 0, 'dates': set(), 'moduleIds': set(), 'sessionTitles': [],
        })
        subject['total'] += 1
        subject['completed'] += bool(row['completed'])
        if row.get('module_id'):
            subject['moduleIds'].add(row['module_id'])
        day = as_date(row.get('date'))
        if day and not row.get('date_needs_review'):
            subject['dates'].add(day.isoformat())
            if row.get('type') == 'live_session':
                subject['sessionTitles'].append({'date': day.isoformat(), 'title': clean_text(row.get('title'))})
    represented = {module_id for subject in subjects.values() for module_id in subject['moduleIds']}
    for module_id, title in assigned:
        if module_id not in represented:
            subjects[f'current:{module_id}'] = {
                'id': f'current:{module_id}', 'title': clean_text(title), 'source': 'current',
                'total': 0, 'completed': 0, 'dates': set(), 'moduleIds': {module_id}, 'sessionTitles': [],
            }
    return [{**subject, 'dates': sorted(subject['dates']), 'moduleIds': sorted(subject['moduleIds'])}
            for subject in sorted(subjects.values(), key=lambda item: (item['title'].casefold(), item['id']))]


def summarise_week(historical, native, progress, attempts, links, start, end):
    activities = merged_activities(historical, native, progress, attempts, links)
    modules, deadlines, expected, expected_priority = {}, [], {}, {}
    undated = 0
    for row in activities:
        day = as_date(row.get('date'))
        if not day or row.get('date_needs_review'):
            undated += 1
            continue
        if start <= day <= end:
            # The same historical activity may have multiple group placements.
            # Its expected time is recorded per learner/activity, not per group.
            hour_key = ('legacy', str(row['activity_id'])) if row.get('activity_id') is not None else row['key']
            value = number(row.get('expected_hours'))
            priority = int(row.get('expected_source') == 'native' or row['key'][0] == 'native')
            if hour_key not in expected or value is not None and (expected[hour_key] is None or priority >= expected_priority[hour_key]):
                expected[hour_key] = value
                expected_priority[hour_key] = priority
            module = modules.setdefault(row['subject'], {'id': row['subject'], 'title': clean_text(row.get('module_title')) or 'Learning activities',
                'weekLabels': set(), 'moduleIds': set(), 'completed': 0, 'total': 0, 'ksbCodes': set(), 'ksbMappingMissing': False})
            if row.get('module_id'):
                module['moduleIds'].add(row['module_id'])
            module['total'] += 1
            module['completed'] += row['completed']
            if row.get('section_title'):
                module['weekLabels'].add(clean_text(row['section_title']))
            codes = point_codes(row.get('ksb_mappings')) if row.get('ksb_mappings') is not None else None
            module['ksbMappingMissing'] |= codes is None
            module['ksbCodes'].update(codes or [])
        # A dated learning activity is not automatically a submission deadline.
        # Only an authored due rule can turn its week into a due date.
        if row.get('type') in ('assignment', 'checkpoint') and not row['completed']:
            timing = str(row.get('due_timing') or '').strip().casefold()
            due = as_date(row.get('week_end')) if timing == 'end of week' else None
            if due and due >= start:
                deadlines.append({'id': ':'.join(row['key']), 'title': clean_text(row.get('title')) or 'Assignment',
                                  'type': row['type'], 'date': due.isoformat(), 'subjectId': row['subject']})
    result = []
    for module in modules.values():
        result.append({**module, 'weekLabels': sorted(module['weekLabels']), 'moduleIds': sorted(module['moduleIds']), 'ksbCodes': sorted(module['ksbCodes']),
                       'percent': ratio(module['completed'], module['total'])['percent']})
    return {'modules': sorted(result, key=lambda row: (row['title'].casefold(), row['id'])),
            'deadlines': sorted(deadlines, key=lambda row: (row['date'], row['id'])), 'undatedActivities': undated,
            'expectedHours': round(sum(expected.values()), 4) if expected and all(value is not None for value in expected.values()) else None,
            'missingExpectedHours': sum(value is None for value in expected.values())}


def read_week(source, now=None):
    start, end = week_bounds(now)
    migrated = student_activity_available(source.aptem_id)
    historical, attempts, links = [], set(), {}
    old_hours, undated_hours = 0, 0
    progress = _direct_progress_records(source.pk)
    with connections['enrolment'].cursor() as cur:
        cur.execute(CURRENT_SUBJECTS_SQL, [source.pk])
        assigned = cur.fetchall()
        module_ids = [row[0] for row in assigned]
        # Eligibility comes from this learner's plan. A later title/schedule edit
        # must not turn an older module into their newest module.
        cur.execute('''SELECT module_catalogue_id,title FROM curriculum.modules
            WHERE module_catalogue_id=ANY(%s)
            ORDER BY created_at DESC NULLS LAST,module_catalogue_id DESC LIMIT 1''', [module_ids])
        latest_module = cur.fetchone()
        cur.execute('''SELECT c.id,c.module_catalogue_id AS module_id,m.title AS module_title,c.title,c.type,c.expected_otjh AS expected_hours,
            w.title AS section_title,c.settings_json->>'dueTiming' AS due_timing,
            c.settings_json->>'sessionDate' AS session_date,
            coalesce(c.settings_json->>'sessionDateTimeUtc',c.settings_json->>'teamsStartDateTimeUtc') AS session_instant,
            coalesce(nullif(c.ksb_mappings,'[]'::jsonb),
                (SELECT jsonb_agg(jsonb_build_object('code',k.ksb_code)) FROM curriculum.ksb_mappings k
                 WHERE k.component_id=c.id AND (k.deleted_at IS NULL OR k.deleted_via_parent IS NOT NULL)), '[]'::jsonb) AS ksb_mappings,
            coalesce((SELECT q.quiz_id::text FROM curriculum.quiz_component_links q
                      WHERE q.component_id=c.id ORDER BY q.id LIMIT 1),c.settings_json->>'linkedQuizId') AS quiz_id
            FROM curriculum.components c JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
            LEFT JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s) AND (c.deleted_at IS NULL OR c.deleted_via_parent IS NOT NULL)
              AND (w.id IS NULL OR w.deleted_at IS NULL OR w.deleted_via_parent IS NOT NULL)''', [module_ids])
        native = rows(cur)
        for row in native:
            schedule = activity_schedule(row['title'], section_title=row['section_title'])
            if row['type'] == 'live_session':
                day = progress_day(row['session_instant']) or as_date(row['session_date'])
                if day:
                    schedule = activity_schedule(day.isoformat())
            row.update(schedule)
        if migrated:
            aptem_id = int(str(source.aptem_id).strip())
            cur.execute('SELECT learner_email FROM "Last_audit".learners WHERE aptem_id=%s', [aptem_id])
            identities = cur.fetchall()
            if len(identities) != 1 or not source.email or str(identities[0][0] or '').strip().casefold() != source.email.strip().casefold():
                raise LookupError('Previous learning could not be linked to this learner.')
            cur.execute('''SELECT gl.group_id,ga.activity_id,g.group_name AS module_title,a.title,
                r.status,r.video_completed,r.reading_viewed,r.quiz_passed,a.quiz_id,a.reading_type,ph.planned_hours AS expected_hours,
                CASE WHEN nullif(a.reading_iframe_url,'') IS NOT NULL THEN 'present' ELSE '' END AS reading_iframe_url,
                CASE WHEN jsonb_typeof(a.quiz_questions)='array' AND a.quiz_questions<>'[]'::jsonb THEN '[{}]'::jsonb ELSE '[]'::jsonb END AS quiz_questions,
                jsonb_path_query_array(CASE WHEN lk.source_preference='learner' THEN lk.ksbs ELSE ak.ksbs END,'$[*].code') AS ksb_mappings
                FROM "Last_audit".learners l
                JOIN "Last_audit".group_learners gl ON gl.learner_id=l.learner_id
                JOIN "Last_audit".groups g ON g.group_id=gl.group_id
                JOIN "Last_audit".group_activities ga ON ga.group_id=gl.group_id
                JOIN "Last_audit".activities a ON a.activity_id=ga.activity_id
                LEFT JOIN "Last_audit".activity_results r ON r.learner_id=l.learner_id AND r.group_id=gl.group_id AND r.activity_id=ga.activity_id
                LEFT JOIN structured_manual_activities.learner_activity_ksbs lk ON lk.aptem_id=l.aptem_id AND lk.activity_id=ga.activity_id
                LEFT JOIN structured_manual_activities.activity_ksbs ak ON ak.activity_id=ga.activity_id
                LEFT JOIN "Last_audit".activity_planned_hours ph ON ph.learner_id=l.learner_id AND ph.aptem_id=l.aptem_id
                    AND ph.ref=ga.activity_id::text AND ph.kind=CASE lower(coalesce(a.activity_type,r.activity_type))
                        WHEN 'video' THEN 'video' WHEN 'audio' THEN 'audio' WHEN 'reading+quiz' THEN 'reading_quiz' END
                WHERE l.aptem_id=%s''', [aptem_id])
            historical = rows(cur)
            groups = sorted({row['group_id'] for row in historical})
            schedules = read_curriculum_schedules(cur, groups)
            for row in historical:
                row.update(activity=row['title'], source_activity_id=row['activity_id'])
                row.update(activity_schedule(row['title']))
            apply_curriculum_schedules(historical, schedules)
            cur.execute('''SELECT DISTINCT group_id,activity_id FROM "Learner".subject_activity_attempts
                WHERE enrolment_id=%s AND aptem_id=%s AND completed=true''', [source.pk, aptem_id])
            attempts = {(str(group), str(activity)) for group, activity in cur.fetchall()}
            cur.execute('''WITH exports AS (
                SELECT course_id,CASE WHEN jsonb_typeof(curriculum)='string'
                    THEN (curriculum #>> '{}')::jsonb ELSE curriculum END AS payload
                FROM "MBA".course_curriculum WHERE course_id=ANY(%s))
                SELECT course_id,material->>'component_id',material->>'source_component_id'
                FROM exports CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(payload->'sections')='array' THEN payload->'sections' ELSE '[]'::jsonb END) section
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(section->'materials')='array' THEN section->'materials' ELSE '[]'::jsonb END) material''', [groups])
            candidates = {}
            for group, component, activity in cur.fetchall():
                if component and activity:
                    candidates.setdefault(str(component), set()).add((str(group), str(activity)))
            links = {component: next(iter(keys)) for component, keys in candidates.items() if len(keys) == 1}
            cur.execute('''SELECT coalesce(sum(actual_hours) FILTER (WHERE activity_date BETWEEN %s AND %s),0),
                count(*) FILTER (WHERE activity_date IS NULL AND month=ANY(%s))
                FROM structured_manual_activities.manual_learner_activities
                WHERE aptem_id=%s AND accepted IS TRUE AND deleted_at IS NULL''',
                        [start, end, sorted({start.strftime('%Y-%m'), end.strftime('%Y-%m')}), aptem_id])
            raw_hours, undated_hours = cur.fetchone()
            old_hours = number(raw_hours)
    weekly_progress = [row for row in progress if (day := progress_day(row.get('submittedAt'))) and start <= day <= end]
    new_hours = _direct_progress_otjh(weekly_progress)
    return {'weekStart': start.isoformat(), 'weekEnd': end.isoformat(), 'timezone': 'Europe/London',
            **focus_latest_module(summarise_week(historical, native, progress, attempts, links, start, end), latest_module),
            'planSubjects': summarise_plan(merged_activities(historical, native, progress, attempts, links), assigned),
            'otjh': {'actual': round(old_hours + new_hours, 4) if old_hours is not None and not undated_hours else None,
                     'historical': old_hours, 'new': round(new_hours, 4), 'undatedHistoricalRows': undated_hours}}



@require_GET
@learner_self_or_staff(kwarg='pk')
def overview_week(request, kind, pk):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    try:
        source = model.all_learners.only('id', 'aptem_id', 'email').get(pk=pk)
        payload = read_week(source)
    except model.DoesNotExist:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    except LookupError as error:
        return JsonResponse({'error': str(error)}, status=409)
    except DatabaseError:
        log.warning('Weekly overview unavailable for %s', pk, exc_info=True)
        return JsonResponse({'error': 'Could not load this week. Please try again.'}, status=503)
    response = JsonResponse(payload)
    response['Cache-Control'] = 'private, no-store'
    return response
