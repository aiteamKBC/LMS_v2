"""Small, read-only weekly overview. Never hydrates a learner or fetches content."""
from datetime import datetime, timedelta, timezone
import logging
from zoneinfo import ZoneInfo

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from login.permissions import learner_self_or_staff
from audit_api.last_audit_ledger_views import _is_completed
from .builder_activity_dates import read_builder_activity_dates
from .dashboard_metrics import metrics_from_loaded, point_codes, ratio
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
            previous.setdefault('component_ids', []).append(str(row['id']))
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


def direct_hours_by_subject(native, progress, links):
    """Attribute recorded time by component/quiz identity, never by a module title."""
    components, quizzes = {}, {}
    for row in native:
        placement = links.get(str(row['id']))
        subject = f'legacy:{placement[0]}' if placement else f'current:{row["module_id"]}'
        components[str(row['id'])] = subject
        if row.get('quiz_id'):
            quizzes.setdefault(str(row['quiz_id']), set()).add(subject)
    grouped = {}
    for entry in progress:
        subject = components.get(str(entry.get('componentId')))
        candidates = quizzes.get(str(entry.get('quizId')), set())
        if not subject and len(candidates) == 1:
            subject = next(iter(candidates))
        if subject:
            grouped.setdefault(subject, []).append(entry)
    return {subject: round(_direct_progress_otjh(entries), 4) for subject, entries in grouped.items()}


def monthly_otjh_summary(activities, progress):
    """Return real planned and recorded current-platform hours by UK month.

    Planned time follows the authored activity delivery date and uses the same
    explicit old/new identity and source-priority rules as the weekly card.
    Recorded time follows the timestamp of the learner's actual progress entry.
    """
    planned, priorities = {}, {}
    for row in activities:
        day = as_date(row.get('date'))
        if not day or row.get('date_needs_review'):
            continue
        month = day.strftime('%Y-%m')
        hour_key = ('legacy', str(row['activity_id'])) if row.get('activity_id') is not None else row['key']
        value = number(row.get('expected_hours'))
        priority = int(row.get('expected_source') == 'native' or row['key'][0] == 'native')
        key = (month, hour_key)
        if key not in planned or value is not None and (planned[key] is None or priority >= priorities[key]):
            planned[key] = value
            priorities[key] = priority

    progress_by_month = {}
    for row in progress:
        day = progress_day(row.get('submittedAt'))
        if day:
            progress_by_month.setdefault(day.strftime('%Y-%m'), []).append(row)

    result = {}
    months = {month for month, _ in planned} | set(progress_by_month)
    for month in sorted(months):
        values = [value for (key_month, _), value in planned.items() if key_month == month]
        missing = sum(value is None for value in values)
        result[month] = {
            'planned': round(sum(value for value in values if value is not None), 4) if values and not missing else None,
            'actual': round(_direct_progress_otjh(progress_by_month.get(month, [])), 4),
            'missingPlannedActivities': missing,
        }
    return result


def summarise_plan(activities, assigned, direct_hours=None):
    """Plan cards need counts and compact monthly rows, never lesson bodies or attempts."""
    subjects = {}
    for row in activities:
        subject = subjects.setdefault(row['subject'], {
            'id': row['subject'], 'title': clean_text(row.get('module_title')) or 'Learning activities',
            'source': 'legacy' if row['subject'].startswith('legacy:') else 'current',
            'total': 0, 'completed': 0, 'dates': set(), 'moduleIds': set(), 'sessionTitles': [],
            'activityCounts': {}, 'ksbCodes': set(), 'ksbMappingMissing': False,
            'ksbProgress': {'completed': 0, 'total': 0},
            'monthlyActivities': [], 'ksbCodesByMonth': {},
        })
        subject['total'] += 1
        subject['completed'] += bool(row['completed'])
        category = clean_text(row.get('type') or row.get('category')) or 'activity'
        monthly_type = category.strip().casefold().replace('-', '_').replace(' ', '_')
        subject['activityCounts'][category] = subject['activityCounts'].get(category, 0) + 1
        codes = point_codes(row.get('ksb_mappings')) if row.get('ksb_mappings') is not None else None
        subject['ksbCodes'].update(codes or [])
        subject['ksbMappingMissing'] |= codes is None
        subject['ksbProgress']['total'] += len(codes or [])
        subject['ksbProgress']['completed'] += len(codes or []) if row['completed'] else 0
        if row.get('module_id'):
            subject['moduleIds'].add(row['module_id'])
        day = as_date(row.get('date'))
        if day and not row.get('date_needs_review'):
            subject['dates'].add(day.isoformat())
            month_codes = subject['ksbCodesByMonth'].setdefault(day.strftime('%Y-%m'), set())
            month_codes.update(codes or [])
            if monthly_type == 'live_session':
                subject['sessionTitles'].append({'date': day.isoformat(), 'title': clean_text(row.get('title'))})
            if monthly_type in ('assignment', 'live_session'):
                native_ids = row.get('component_ids') or []
                component_id = (native_ids[0] if native_ids else row.get('id')) if row.get('module_id') else None
                subject['monthlyActivities'].append({
                    'id': ':'.join(str(value) for value in row['key']),
                    'componentId': str(component_id) if component_id else None,
                    'title': clean_text(row.get('title')) or ('Assignment' if monthly_type == 'assignment' else 'Live session'),
                    'type': monthly_type,
                    'date': day.isoformat(),
                    'weekTitle': clean_text(row.get('section_title')) or None,
                    'expectedHours': number(row.get('expected_hours')),
                    'completed': bool(row['completed']),
                    'ksbCodes': sorted(codes or []),
                })
    represented = {module_id for subject in subjects.values() for module_id in subject['moduleIds']}
    for module_id, title in assigned:
        if module_id not in represented:
            subjects[f'current:{module_id}'] = {
                'id': f'current:{module_id}', 'title': clean_text(title), 'source': 'current',
                'total': 0, 'completed': 0, 'dates': set(), 'moduleIds': {module_id}, 'sessionTitles': [],
                'activityCounts': {}, 'ksbCodes': set(), 'ksbMappingMissing': False,
                'ksbProgress': {'completed': 0, 'total': 0},
                'monthlyActivities': [], 'ksbCodesByMonth': {},
            }
    return [{**subject, 'dates': sorted(subject['dates']), 'moduleIds': sorted(subject['moduleIds']),
             'ksbCodes': sorted(subject['ksbCodes']),
             'ksbCodesByMonth': {month: sorted(codes) for month, codes in subject['ksbCodesByMonth'].items()},
             'ksbProgress': None if subject['ksbMappingMissing'] else subject['ksbProgress'],
             'directHours': (direct_hours or {}).get(subject['id'], 0) if direct_hours is not None else None}
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


def read_week(source, now=None, *, home_kind=None, dashboard_kind=None):
    start, end = week_bounds(now)
    migrated = student_activity_available(source.aptem_id)
    historical, attempts, links = [], set(), {}
    old_hours, undated_hours = 0, 0
    progress = _direct_progress_records(source.pk)
    with connections['enrolment'].cursor() as cur:
        cur.execute(CURRENT_SUBJECTS_SQL, [source.pk])
        assigned = cur.fetchall()
        module_ids = [row[0] for row in assigned]
        cur.execute('''SELECT c.id,c.module_catalogue_id AS module_id,m.title AS module_title,c.title,c.type,c.expected_otjh AS expected_hours,
            w.title AS section_title,c.settings_json->>'dueTiming' AS due_timing,
            coalesce(nullif(c.ksb_mappings,'[]'::jsonb),
                (SELECT jsonb_agg(jsonb_build_object('code',k.ksb_code)) FROM curriculum.ksb_mappings k
                 WHERE k.component_id=c.id AND (k.deleted_at IS NULL OR COALESCE(k.deleted_via_parent, '') <> '')), '[]'::jsonb) AS ksb_mappings,
            coalesce((SELECT q.quiz_id::text FROM curriculum.quiz_component_links q
                      WHERE q.component_id=c.id ORDER BY q.id LIMIT 1),c.settings_json->>'linkedQuizId') AS quiz_id
            FROM curriculum.components c JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
            LEFT JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s) AND (c.deleted_at IS NULL OR COALESCE(c.deleted_via_parent, '') <> '')
              AND (w.id IS NULL OR w.deleted_at IS NULL OR COALESCE(w.deleted_via_parent, '') <> '')''', [module_ids])
        native = rows(cur)
        # Match My Learning's delivery calendar, including undated lesson titles,
        # empty teaching weeks and cohort holidays.
        dates = read_builder_activity_dates(cur, module_ids)
        for row in native:
            row.update(dates.get(str(row['id'])) or activity_schedule(row['title'], section_title=row['section_title']))
        if migrated:
            aptem_id = int(str(source.aptem_id).strip())
            cur.execute('SELECT learner_email FROM "Last_audit".learners WHERE aptem_id=%s', [aptem_id])
            identities = cur.fetchall()
            if len(identities) != 1 or not source.email or str(identities[0][0] or '').strip().casefold() != source.email.strip().casefold():
                raise LookupError('Previous learning could not be linked to this learner.')
            cur.execute('''SELECT gl.group_id,ga.activity_id,g.group_name AS module_title,a.title,
                coalesce(a.activity_type,r.activity_type) AS type,
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
    plan_activities = list(merged_activities(historical, native, progress, attempts, links))
    result = {'weekStart': start.isoformat(), 'weekEnd': end.isoformat(), 'timezone': 'Europe/London',
            **summarise_week(historical, native, progress, attempts, links, start, end),
            'planSubjects': summarise_plan(plan_activities, assigned,
                                          direct_hours_by_subject(native, progress, links)),
            'monthlyOtjh': monthly_otjh_summary(plan_activities, progress),
            'otjh': {'actual': round(old_hours + new_hours, 4) if old_hours is not None and not undated_hours else None,
                     'historical': old_hours, 'new': round(new_hours, 4), 'undatedHistoricalRows': undated_hours}}
    if dashboard_kind:
        with connections['enrolment'].cursor() as cur:
            cur.execute('''SELECT p.component_ref AS "componentId",p.quiz_ref AS "quizId",p.kind,p.passed
                FROM "Learner".learners l JOIN "Learner".learner_progress_entries p ON p.learner_id=l.id
                WHERE l.enrolment_id=%s AND p.kind<>'activity_event' ''', [source.pk])
            metric_progress = rows(cur)
            metric_attempts = attempts
            if migrated:
                aptem_id = int(str(source.aptem_id).strip())
                cur.execute('''SELECT DISTINCT group_id,activity_id FROM "Learner".subject_activity_attempts
                    WHERE enrolment_id=%s AND aptem_id=%s AND completed=true
                      AND submitted_at IS NOT NULL''', [source.pk, aptem_id])
                metric_attempts = {(str(group), str(activity)) for group, activity in cur.fetchall()}
        result['metrics'] = metrics_from_loaded(source, dashboard_kind, migrated=migrated, native=native,
            progress=metric_progress, direct_progress=progress, historical=historical,
            attempts=metric_attempts, links=links, history_ready=True)
    if home_kind:
        from .home_progress import read_home_progress
        result['homeProgress'] = read_home_progress(source, home_kind,
            merged_activities(historical, native, progress, attempts, links), native, progress, assigned, end)
    return result



@require_GET
@learner_self_or_staff(kwarg='pk')
def overview_week(request, kind, pk):
    model = SOURCE_MODELS.get(kind)
    if model is None:
        return JsonResponse({'error': 'Learner not found.'}, status=404)
    try:
        section = request.GET.get('section')
        if section not in (None, 'home', 'dashboard'):
            return JsonResponse({'error': 'Invalid overview section.'}, status=400)
        home = section == 'home'
        fields = ['id', 'aptem_id', 'email']
        if home:
            fields.extend(['username', 'employer_id', 'start_date', 'end_date', 'programme', 'cohort'])
        source = model.all_learners.only(*fields).get(pk=pk)
        payload = read_week(source, home_kind=kind) if home else read_week(
            source, dashboard_kind=kind if section == 'dashboard' else None)
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
