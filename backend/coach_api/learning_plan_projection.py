"""Read-only Case File Learning Plan facts and lazy journey projections.

Timeline percentages use canonical_module_progress. Journey states intentionally
use the Coach activity-state decision table, including tutor acceptance. Never
substitute catalogue progress for Journey completion.
"""
from collections import defaultdict
from datetime import date, timedelta
import json
from math import floor
from pathlib import Path
import re

from django.db import connections
from learner_api import canonical_learning
from learner_api.progress_rules import progress_counts_as_achieved
from learner_api.training_plan_dashboard import rows
from old_otjh.repository import query

RULES = json.loads(Path(__file__).with_name('journey_rules.json').read_text())


def journey_status(kind, **facts):
    return next((status for fact, status in RULES[kind] if facts.get(fact)), RULES['default'])


def rollup(items):
    counts = {status: sum(item['status'] == status for item in items)
              for status in ('completed', 'in-progress', 'not-started', 'unavailable')}
    total = len(items)
    return {'componentCount': total, 'completedCount': counts['completed'],
            'inProgressCount': counts['in-progress'], 'notStartedCount': counts['not-started'],
            'unavailableCount': counts['unavailable'],
            'progressPercent': floor(counts['completed'] / total * 100 + .5) if total else 0,
            'status': journey_status('module', allCompleted=total > 0 and counts['completed'] == total,
                started=counts['completed'] > 0 or counts['in-progress'] > 0, unavailable=counts['unavailable'] > 0)}


def native_state(component, detail):
    ident = str(component.get('componentId') or '')
    records = [*({**row, 'kind': 'quiz'} for row in detail.get('quizAttempts', [])),
               *detail.get('videoProgress', []), *detail.get('componentProgress', [])]
    records = [row for row in records if str(row.get('componentId') or '') == ident]
    marking = detail.get('componentMarkingStatus', {}).get(ident) or {}
    done = [row for row in records if progress_counts_as_achieved(row.get('kind'), row.get('passed'))
            and (not component.get('tutorValidationRequired') or marking.get('status') == 'accepted')]
    dates = [value for value in [marking.get('reviewedAt'), *(row.get('submittedAt') for row in done)] if value]
    feed = any(str(row.get('componentId') or '') == ident for row in detail.get('activityFeed', []))
    return {'status': journey_status('native', completed=bool(done), started=bool(records) or feed),
            'completedAt': max(dates) if done and dates else None}


def native_entry(component, detail):
    cid = component.get('componentId')
    qid = (component.get('quizMeta') or {}).get('quizId')
    attempts = [row for row in detail.get('quizAttempts', []) if
                (qid is not None and str(row.get('quizId')) == str(qid)) or (cid and row.get('componentId') == cid)] if component.get('isQuiz') and component.get('quizMeta') else []
    done = any(row.get('passed') for row in attempts) if component.get('isQuiz') else any(
        row.get('componentId') == cid and progress_counts_as_achieved(row.get('kind'), row.get('passed'))
        for row in [*detail.get('videoProgress', []), *detail.get('componentProgress', [])])
    return {**component, 'title': component.get('component') or '', 'quizAttempts': attempts,
            '_done': bool(done)}


def week_key(item):
    source = item.get('date_source')
    if source == 'introduction':
        return 'introduction', None
    if source == 'extra_activity':
        return 'extra:' + (item.get('week') or item.get('section_title') or ''), None
    day = item.get('week_start') or item.get('date')
    try:
        day = date.fromisoformat(str(day)[:10])
        start = (day - timedelta(days=day.weekday())).isoformat()
    except (ValueError, TypeError):
        start = None
    return start or item.get('weekId') or item.get('week') or item.get('section_title') or 'undated', start


def project_journey(detail, activity, metadata, has_history, module_id=None, week_id=None):
    """The Journey projection, shared by initial, module and week responses.

    Membership follows the existing canonical course/Builder IDs. No title
    matching or catalogue-progress substitution. State precedence is shared
    with the original Coach adapter through journey_rules.json.
    """
    subjects = {}
    historical_modules = {row.get('module_id') for row in (activity or {}).get('subjects', []) if row.get('module_id')}
    if has_history:
        for row in activity.get('subjects', []):
            key = f"legacy:{row['id']}"
            link = metadata.get('builder_subjects', {}).get(key, {})
            subjects[key] = {'id': key, 'title': link.get('title') or row['name'], 'items': [], 'moduleId': link.get('id')}
        seen = set()
        for row in activity.get('activities', []):
            key = f"legacy:{row['group_id']}"
            identity = (key, row['activity_id'])
            if identity in seen:
                continue
            seen.add(identity)
            subject = subjects.setdefault(key, {'id': key, 'title': row.get('group_name') or 'Unnamed subject', 'items': [], 'moduleId': None})
            raw_status = re.sub(r'[\s-]+', '_', str(row.get('status') or '').strip().lower())
            started = bool(row.get('video_started') or row.get('reading_viewed') or row.get('quiz_attempted')
                           or (row.get('new_attempt_count') or 0) > 0 or raw_status in RULES['historicalStartedStatuses'])
            subject['items'].append({**row, 'componentId': f"aptem:{key}:{row['activity_id']}",
                'title': row.get('activity') or '', 'type': row.get('category'), 'expectedOtjh': row.get('planned'),
                'status': journey_status('native', completed=bool(row['completed']), started=started), 'completedAt': None,
                '_identity': ('legacy', row['group_id'], row.get('catalogue_kind') or 'material', row['activity_id']) if row.get('source_activity_id') is not None else None})
    for row in metadata.get('current_subjects', []):
        if has_history and row['id'] in historical_modules:
            continue
        subjects.setdefault(f"current:{row['id']}", {'id': f"current:{row['id']}", 'moduleId': row['id'], 'title': row['title'], 'items': []})
    seen_components = set()
    for index, component in enumerate(detail.get('components', [])):
        mid = component.get('moduleId')
        if has_history and mid in historical_modules:
            continue
        if not mid:
            raise LookupError('Journey requires a verified module identity.')
        key = f'current:{mid}'
        subject = subjects.setdefault(key, {'id': key, 'moduleId': mid, 'title': component.get('module') or 'Unnamed subject', 'items': []})
        item = native_entry(component, detail)
        cid, qid = item.get('componentId'), (item.get('quizMeta') or {}).get('quizId')
        identity = ('component', cid) if cid else ('quiz', qid) if qid else None
        if has_history and identity and (key, identity) in seen_components:
            continue
        if identity:
            seen_components.add((key, identity))
        item['_identity'] = identity if has_history else None
        state = native_state(item, detail)
        if has_history and item['_done']:
            state['status'] = 'completed'
        elif has_history and item['quizAttempts']:
            state['status'] = 'in-progress'
        item.update(state)
        item['componentId'] = cid or f"{key}:quiz:{qid if qid is not None else str(item.get('week')) + ':' + str(index)}"
        schedule = metadata.get('activity_dates', {}).get(cid, {})
        if not schedule or schedule.get('date_source') in {'original_created_at', 'source_date', 'undated'}:
            schedule = {'date': item.get('sessionDate')}
        item.update(schedule)
        subject['items'].append(item)
    # Empty authored modules/weeks remain visible. Stable IDs replace the old
    # presentation-only missing module ID without changing labels or counts.
    planned_by_module = defaultdict(list)
    for week in detail.get('week', []):
        if week.get('moduleId'):
            planned_by_module[week['moduleId']].append(week)
    if not has_history:
        subjects = {key: value for key, value in subjects.items() if planned_by_module[value['moduleId']] or value['title'] in detail.get('modules', [])}
    result, seen_history = [], set()
    ordered = sorted(subjects.values(), key=lambda row: (row['title'].casefold(), row['id'])) if has_history else sorted(
        subjects.values(), key=lambda row: (detail.get('modules', []).index(row['title']),
            next((i for i, week in enumerate(detail.get('week', [])) if week.get('moduleId') == row['moduleId']), 0)))
    for subject in ordered:
        groups = {}
        for item in subject['items']:
            identity = item.get('_identity')
            if identity and identity in seen_history:
                continue
            if identity:
                seen_history.add(identity)
            key, start = week_key(item) if has_history else (item.get('weekId') or item.get('week') or 'undated', None)
            group = groups.setdefault(key, {'id': str(key), 'start': start, 'label': '', 'title': item.get('week') or item.get('section_title') or '', 'items': []})
            group['items'].append(item)
        rank = lambda row: -1 if row['id'] == 'introduction' else 2 if row['id'].startswith('extra:') else 0 if row['start'] else 1
        grouped = sorted(groups.values(), key=lambda row: (rank(row), row['start'] or re.sub(r'\d+', lambda m: m[0].zfill(12), row['id'].casefold()))) if has_history else list(groups.values())
        number = 0
        for group in grouped:
            if group['id'] == 'introduction':
                group['label'] = 'Introduction'
            elif group['id'].startswith('extra:'):
                group['label'] = 'Extra activities'
            elif group['id'] == 'undated':
                group['label'] = 'Undated activities'
            else:
                number += 1
                match = re.match(r'week\s*\d+', group['title'], re.I)
                group['label'] = match[0] if match else f'Week {number}' if has_history else group['title']
        for planned in planned_by_module[subject['moduleId']]:
            label = planned['week']
            represented = any(any(item.get('weekId') == planned.get('weekId') if planned.get('weekId') else item.get('week') == label for item in group['items'])
                              or group['title'] == label or group['label'].lower() == label.lower() for group in grouped)
            if not has_history:
                represented = any(group['id'] == str(planned.get('weekId') or label) for group in grouped)
            if not represented:
                grouped.append({'id': str(planned.get('weekId') or label), 'label': label, 'title': label, 'start': None, 'items': []})
        if not has_history:
            # buildLearnerJourney follows authored week order, including empty weeks.
            order = {str(row.get('weekId') or row['week']): i for i, row in enumerate(planned_by_module[subject['moduleId']])}
            grouped.sort(key=lambda row: order.get(row['id'], len(order)))
        weeks = []
        for index, group in enumerate(grouped):
            items = group['items']
            items.sort(key=lambda row: (str(row.get('date') or ''), row.get('position') or 0)) if has_history else None
            components = [{key: item.get(key) for key in ('componentId', 'title', 'type', 'expectedOtjh', 'isQuiz', 'quizMeta', 'quizAttempts', 'status', 'completedAt')} for item in items] if subject['id'] == module_id and group['id'] == week_id else []
            hours = sum(float(item.get('expectedOtjh') or 0) for item in items if not (item.get('isQuiz') or str(item.get('type') or '').lower() == 'quiz') or str(item.get('componentId') or '').startswith('aptem:'))
            weeks.append({'id': group['id'], 'weekNumber': index + 1, 'title': group['label'], **rollup(items), 'otjh': hours, 'components': components})
        items = [item for group in grouped for item in group['items']]
        result.append({'id': subject['id'], 'title': subject['title'], 'weekCount': len(weeks),
                       **rollup(items), 'otjh': sum(week['otjh'] for week in weeks), 'weeks': weeks})
    return result


def journey_response(modules, module_id=None, week_id=None):
    if module_id:
        module = next((row for row in modules if row['id'] == module_id), None)
        if module is None:
            raise LookupError('Module not found in this learner plan.')
        if week_id:
            week = next((row for row in module['weeks'] if row['id'] == week_id), None)
            if week is None:
                raise LookupError('Week not found in this learner module.')
            return {'moduleId': module_id, **week}
        return {**module, 'weeks': [{key: value for key, value in week.items() if key != 'components'} for week in module['weeks']]}
    return {'summary': {'modules': len(modules), 'weeks': sum(row['weekCount'] for row in modules),
                **{name: sum(row[field] for row in modules) for name, field in (
                    ('components', 'componentCount'), ('completed', 'completedCount'), ('inProgress', 'inProgressCount'),
                    ('notStarted', 'notStartedCount'), ('unavailable', 'unavailableCount'))}},
            'modules': [{key: value for key, value in row.items() if key != 'weeks'} for row in modules]}


def read_history(source, owner):
    """Use the canonical catalogue allocator without dashboard/hour aggregates."""
    from learner_api.student_activity_access import student_activity_available
    if not student_activity_available(source.aptem_id):
        return None
    courses = query('''SELECT DISTINCT c.id,c.source_course_ref,c.source_course_title,c.curriculum_module_ref
        FROM "Learner".learner_source_course_memberships m
        JOIN curriculum.source_courses c ON c.id=m.source_course_id AND c.deleted_at IS NULL
        WHERE m.learner_id=%s AND m.deleted_at IS NULL AND c.source_system='old_lms'
          AND c.source_course_ref ~ '^[0-9]+$' ORDER BY c.source_course_title,c.id''', [owner['id']])
    catalogue = query('''SELECT a.id,a.source_course_id,a.source_activity_id,a.source_activity_kind,
        a.source_activity_title,a.source_activity_type,a.source_section_title,a.curriculum_component_ref,
        c.source_course_ref,c.source_course_title,c.curriculum_module_ref,a.source_position AS position
        FROM curriculum.source_activities a
        JOIN curriculum.source_courses c ON c.id=a.source_course_id AND c.deleted_at IS NULL
        WHERE a.source_course_id=ANY(%s) AND a.deleted_at IS NULL AND a.source_system='old_lms'
        ORDER BY c.id,a.source_position NULLS LAST,a.id''', [[row['id'] for row in courses]]) if courses else []
    # Case File's old activity endpoint explicitly used the Student journal
    # perspective. Preserve it here independently of the Coach request context.
    from learner_api import journal_sources
    token = journal_sources._current.set(True)
    try:
        records = canonical_learning.entries_for(owner)
        items, subjects, _ = canonical_learning.recorded_course_items(courses, catalogue, records, include_catalogue=True)
    finally:
        journal_sources._current.reset(token)
    return {'subjects': subjects, 'activities': items}


def read_native_facts(context, assigned):
    """No content bodies, KSB hydration, sessions, or programme-wide schedules."""
    from learner_api.learner_detail import (_RESOURCE_URL_KEYS, _video_url_from_settings,
        component_audio_url, _component_resource_url, _display_component_title, _display_quiz_title)
    from learner_api.mappers import _component_marking_statuses
    settings_keys = list(dict.fromkeys([*_RESOURCE_URL_KEYS, 'uploadedFileUrl', 'podcastUrl', 'audioUrl',
        'embedCode', 'videoUrl', 'liveSessionUrl', 'teamsMeetingUrl', 'sessionDate', 'linkedQuizId']))
    settings_sql = ','.join(f"'{key}',c.settings_json->>'{key}'" for key in settings_keys)
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT module_catalogue_id AS id,title FROM curriculum.modules
            WHERE module_catalogue_id=ANY(%s) AND (deleted_at IS NULL OR COALESCE(deleted_via_parent,'')<>'')''', [assigned])
        titles = {row['id']: str(row['title'] or '') for row in rows(cur)}
        cur.execute('''SELECT id,module_catalogue_id AS module_id,title,week_number FROM curriculum.weeks
            WHERE module_catalogue_id=ANY(%s) AND (deleted_at IS NULL OR COALESCE(deleted_via_parent,'')<>'')
            ORDER BY module_catalogue_id,display_order,week_number,id''', [assigned])
        weeks = [{'moduleId': row['module_id'], 'module': titles[row['module_id']], 'weekId': row['id'],
                  'week': str(row['title'] or f"Week {row['week_number']}")}
                 for row in rows(cur) if titles.get(row['module_id'])]
        by_week = {row['weekId']: row for row in weeks}
        cur.execute(f'''SELECT c.id,c.week_id,c.module_catalogue_id AS module_id,c.type,c.title,
            c.tutor_validation_required,c.live_sessions_link,jsonb_build_object({settings_sql}) AS settings,
            q.id AS quiz_id,q.title AS quiz_title,q.questions
            FROM curriculum.components c
            LEFT JOIN curriculum.quiz_component_links l ON l.component_id=c.id
            LEFT JOIN curriculum.quizzes q ON q.id=coalesce(l.quiz_id,
                CASE WHEN c.settings_json->>'linkedQuizId' ~ '^[0-9]+$' THEN (c.settings_json->>'linkedQuizId')::bigint END)
            WHERE c.module_catalogue_id=ANY(%s) AND (c.deleted_at IS NULL OR COALESCE(c.deleted_via_parent,'')<>'')
            ORDER BY c.week_id,c.display_order,c.id''', [assigned])
        components = []
        for row in rows(cur):
            week = by_week.get(row['week_id'])
            if not week or week['moduleId'] != row['module_id']:
                continue
            settings = json.loads(row['settings']) if isinstance(row['settings'], str) else row['settings'] or {}
            if str(row['type'] or '').strip().lower().replace('-', '_') == 'video' and not (
                row['quiz_id'] or _video_url_from_settings(settings) or component_audio_url(settings, row['type'])
                or _component_resource_url(settings) or row['live_sessions_link']
                or settings.get('liveSessionUrl') or settings.get('teamsMeetingUrl')):
                continue
            components.append({**week, 'componentId': row['id'], 'type': row['type'],
                'component': _display_quiz_title(row['quiz_title']) if row['quiz_id'] else _display_component_title(row['type'], row['title']),
                'tutorValidationRequired': bool(row['tutor_validation_required']), 'isQuiz': bool(row['quiz_id']),
                'quizMeta': {'quizId': row['quiz_id'], 'questions': row['questions']} if row['quiz_id'] else None,
                'sessionDate': settings.get('sessionDate')})
    entries = list(context.profile.progress_entries.exclude(kind='activity_event').values(
        'kind', 'component_ref', 'quiz_ref', 'passed', 'submitted_at', 'grade', 'achieved_score', 'total_score'))
    from learner_api.models import _serialise_quiz_ref
    progress = [{'kind': row['kind'], 'componentId': row['component_ref'], 'quizId': _serialise_quiz_ref(row['quiz_ref']),
                 'passed': row['passed'], 'submittedAt': row['submitted_at'].isoformat() if row['submitted_at'] else '',
                 **{key: float(row[field]) if row[field] is not None else None
                    for key, field in (('grade','grade'),('achievedScore','achieved_score'),('totalScore','total_score'))}} for row in entries]
    # read_plan_detail did not append published/retained quizzes or activityFeed.
    # Keep that exact Journey membership; timeline uses the separate helper.
    return {'modules': list(dict.fromkeys(titles[mid] for mid in assigned if titles.get(mid))), 'week': weeks,
            '_canonical_progress': entries,
            'components': components, 'componentMarkingStatus': _component_marking_statuses(context.source, context.profile),
            'quizAttempts': [row for row in progress if row['kind'] == 'quiz'],
            'videoProgress': [row for row in progress if row['kind'] == 'video'],
            'componentProgress': [row for row in progress if row['kind'] == 'component' or row['kind'] == 'quiz_reading' and row['submittedAt']]}


def read_journey(context, module_id=None, week_id=None):
    from learner_api.learning_plan import _effective_plan_ids
    from learner_api.builder_activity_dates import read_builder_activity_dates
    if context.source is None:
        raise LookupError('Learner enrolment is unavailable.')
    owner = canonical_learning.require_profile(context.source.pk)
    if owner['id'] != context.profile.pk or context.profile.enrolment_id != context.source.pk:
        from old_otjh.service import ServiceError
        raise ServiceError('The consolidated learner identity needs review.', 'identity_review_required', 409)
    assigned = list(dict.fromkeys(_effective_plan_ids(context.source, {})))
    detail = read_native_facts(context, assigned)
    history = read_history(context.source, owner)
    metadata = {'current_subjects': []}
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT module_catalogue_id AS id,title FROM curriculum.modules
            WHERE module_catalogue_id=ANY(%s) AND (deleted_at IS NULL OR deleted_via_parent IS NOT NULL)''', [assigned])
        metadata['current_subjects'] = rows(cur)
        metadata['activity_dates'] = read_builder_activity_dates(cur, assigned) if history is not None or module_id is None else {}
    metadata['_assigned_ids'] = assigned
    modules = project_journey(detail, history, metadata, history is not None, module_id, week_id)
    context._learning_plan_facts = (detail, history, metadata)
    return journey_response(modules, module_id, week_id)


def canonical_progress_facts(context):
    """Compact inputs to the shared calculation, without changing eligibility.

    Journey intentionally does not append assessments/retained quizzes. Do it
    on separate shallow copies for timeline progress using the existing shared
    publication and historical-slot readers, never the full content builder.
    """
    from learner_api.learner_detail import _append_week_quizzes
    from learner_api.retained_quiz_progress import retain_quiz_progress
    from learner_api.subject_content import clean_text

    detail, history, metadata = context._learning_plan_facts
    _, components = _append_week_quizzes(
        [dict(row) for row in detail['week']], [dict(row) for row in detail['components']],
        assigned_modules=[{'moduleId': mid} for mid in metadata['_assigned_ids']])
    canonical = {'components': components,
                 'quizAttempts': [dict(row) for row in detail['quizAttempts']]}
    retain_quiz_progress(canonical)
    current = metadata['current_subjects']
    titles = {f"current:{row['id']}": {'title': clean_text(row['title'])} for row in current}
    return history, canonical, current, detail['_canonical_progress'], titles


def read_timeline(context):
    from learner_api.module_progress import canonical_module_progress
    from learner_api.learning_plan import _effective_plan_ids
    from learner_api.training_plan_dashboard import attach_curriculum_slots
    from learner_api.calendar import coaching_events_for_learner
    from .selectors.otjh import learner_programme_window
    owner = canonical_learning.require_profile(context.source.pk)
    ids = list(dict.fromkeys([*_effective_plan_ids(context.source, {}), *canonical_learning.curriculum_module_ids_for(owner)]))
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT m.module_catalogue_id AS id,m.title,m.start_date,m.end_date,
            m.weeks_number,m.sessions_number,m.cohort_id,
            coalesce(nullif(m.session_week_day,''),g.session_week_day) AS session_week_day,
            coalesce(nullif(m.session_start_time,''),g.session_start_time) AS session_start_time,
            coalesce(nullif(m.session_end_time,''),g.session_end_time) AS session_end_time
            FROM curriculum.modules m LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
            WHERE m.module_catalogue_id=ANY(%s) ORDER BY m.title''', [ids])
        scheduled = rows(cur)
        cur.execute('''SELECT id,module_catalogue_id,week_number,title,holiday_note_enabled,holiday_note
            FROM curriculum.weeks WHERE module_catalogue_id=ANY(%s)
            AND (deleted_at IS NULL OR COALESCE(deleted_via_parent,'')<>'') ORDER BY display_order,week_number,id''', [ids])
        counts, authored = defaultdict(int), {}
        for week in rows(cur):
            counts[week['module_catalogue_id']] += 1
            authored.setdefault((week['module_catalogue_id'], week['week_number']), {'id': week['id'],
                'title': week['title'], 'learningOutcomes': [],
                'holidayNote': str(week['holiday_note'] or '').strip() if week['holiday_note_enabled'] else ''})
        spine = {row['id']: {} for row in scheduled}
        attach_curriculum_slots(scheduled, spine, counts, authored)
        cur.execute('''SELECT s.module_catalogue_id AS module_id,
            min(coalesce(o.scheduled_start,s.start_datetime) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date AS first_date,
            max(coalesce(o.scheduled_start,s.start_datetime) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date AS last_date
            FROM curriculum.live_sessions s LEFT JOIN curriculum.live_session_occurrences o ON o.live_session_id=s.id
            WHERE s.module_catalogue_id=ANY(%s) AND lower(s.status) NOT IN ('cancelled','deleted','failed','superseded')
            AND (o.id IS NULL OR lower(o.status) NOT IN ('cancelled','deleted','failed','superseded'))
            AND (o.id IS NOT NULL OR s.repeat_pattern IS NULL OR s.repeat_pattern IN ('none',''))
            GROUP BY s.module_catalogue_id''', [ids])
        session_dates = {row['module_id']: row for row in rows(cur)}
    progress = canonical_module_progress(context.source, context.profile,
        read_projection=lambda: canonical_progress_facts(context))
    # Exact canonical course identity supplies historical/current association.
    courses = query('''SELECT c.source_course_ref,c.curriculum_module_ref FROM "Learner".learner_source_course_memberships m
        JOIN curriculum.source_courses c ON c.id=m.source_course_id AND c.deleted_at IS NULL
        WHERE m.learner_id=%s AND m.deleted_at IS NULL AND c.source_system='old_lms' ''', [owner['id']])
    links = {f"legacy:{row['source_course_ref']}": row['curriculum_module_ref'] for row in courses}
    by_id = {row['id']: row for row in scheduled}
    facts = getattr(context, '_learning_plan_facts', None)
    history = facts[1] if facts else read_history(context.source, owner)
    history_dates = defaultdict(list)
    for item in (history or {}).get('activities', []):
        if item.get('date') and not item.get('date_needs_review'):
            history_dates[f"legacy:{item['group_id']}"].append(str(item['date'])[:10])
    if facts:
        detail, _, metadata = facts
        for item in detail['components']:
            placement = metadata.get('activity_dates', {}).get(item['componentId'], {})
            if not placement or placement.get('date_source') in {'original_created_at','source_date','undated'}:
                placement = {'date': item.get('sessionDate')}
            if placement.get('date') and not placement.get('date_needs_review'):
                history_dates[f"current:{item['moduleId']}"].append(str(placement['date'])[:10])
    modules = []
    for row in progress:
        mid = row['id'][8:] if row['id'].startswith('current:') else links.get(row['id'])
        schedule = by_id.get(mid, {})
        dates = history_dates[row['id']] + [str(value)[:10] for value in session_dates.get(mid, {}).values() if isinstance(value, date)]
        start = str(schedule.get('start_date') or '')[:10] or (min(dates) if dates else None)
        stored_end = str(schedule.get('end_date') or '')[:10]
        effective_end = spine.get(mid, {}).get('effectiveEndDate') or ''
        end = max(stored_end or (max(dates) if dates else ''), effective_end) or start
        percent = row['percent']
        slots = spine.get(mid, {}).get('curriculumSlots', [])
        anchor = str(session_dates.get(mid, {}).get('first_date') or '') or (slots[0]['date'] if slots else start)
        if start:
            weekdays = {name.lower(): i for i, name in enumerate(('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'))}
            weekdays.update({name[:3]: day for name, day in list(weekdays.items())})
            weekdays.update(tues=1, thurs=3)
            days = [weekdays[value.strip().lower()] for value in str(schedule.get('session_week_day') or '').split(',') if value.strip().lower() in weekdays]
            if days:
                first = date.fromisoformat(start)
                anchor = (first + timedelta(days=min((day-first.weekday()) % 7 for day in days))).isoformat()
        modules.append({'id': row['id'], 'title': row['title'], 'progressPercent': percent,
            'startDate': start, 'endDate': end, 'weekAnchor': anchor,
            'notes': [{key: slot.get(key) for key in ('date','slotNumber','weekTitle','holidayNote','holidays')}
                      for slot in slots if slot.get('holidayNote')],
            'status': 'completed' if row['total'] and row['completed'] == row['total'] else 'in-progress' if row['completed'] else 'not-started'})
    profile = context.profile if context.profile.lifecycle_status == 'active' else None
    events = coaching_events_for_learner(context.source, profile)
    reviews = [{'id': row['id'], 'date': row.get('scheduledDate') or row.get('targetDate') or row.get('date'),
                'type': row.get('source'), 'title': row.get('title'), 'status': row.get('status'), 'invited': row.get('invited')}
               for row in events if row.get('source') in {'mcr','progress-review'} and row.get('status') != 'cancelled']
    start, end = learner_programme_window(context.profile, context.source)
    dates = [str(value)[:7] for value in [start, end, *(row['startDate'] for row in modules),
             *(row['endDate'] for row in modules), *(row['date'] for row in reviews)] if value]
    return {'periodStart': str(start)[:7] if start else min(dates) if dates else None,
            'periodEnd': max(dates) if dates else None,
            'modules': modules, 'reviews': reviews}


def read_learning_plan(context):
    if context.source is None:
        raise LookupError('Learner enrolment is unavailable.')
    journey = read_journey(context)
    return {'timeline': read_timeline(context), 'journey': journey}
