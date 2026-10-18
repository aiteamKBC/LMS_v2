"""Read-only Weekly Learning projection, independent of dashboard aggregates."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from django.db import connections
from .weekly_contract import compact_weekly
from learner_api.progress_rules import progress_counts_as_achieved
from curriculum_api.week_visibility import visible_child_sql, visible_week_sql
from .weekly_live_attendance import (read_weekly_live_evidence, credit_in_week,
                                     week_live_session, add_live_activity_hours)

BUSINESS_ZONE = ZoneInfo('Europe/London')
VISIBLE_WEEK = visible_week_sql('weeks')


def derived_session(start, end, status, attended, now):
    """One temporal/verified-attendance rule for rail and selected session."""
    from learner_api.attendance_rules import attendance_outcome, INVALID
    def aware(value):
        return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value
    start, end = aware(start), aware(end)
    status = str(status or 'scheduled').strip().lower()
    if status in INVALID:
        return {'state': 'cancelled' if status in {'cancelled', 'canceled'} else 'unscheduled',
                'status': status, 'attended': None}
    if not start:
        return {'state': 'unscheduled', 'status': 'scheduled', 'attended': None}
    ended = bool(end and end <= now)
    # Absence is evidence only after the occurrence ends. Positive verified
    # attendance can exist while a session is active (or its date is corrected).
    verified = True if attended is True else False if attended is False and ended else None
    row = {'scheduled_start': start, 'scheduled_end': end,
           'session_date': start.astimezone(BUSINESS_ZONE).date(),
           'attendance_status': 'present' if verified is True else 'absent' if verified is False else 'unmarked'}
    outcome, _ = attendance_outcome(row, now)
    state = {'present': 'attended', 'absent': 'missed', 'in_progress': 'live'}.get(outcome, outcome)
    if start <= now and not ended:
        state = 'live'
    return {'state': state, 'status': 'scheduled' if now < start else 'completed' if ended else 'in_progress',
            'attended': verified}


def visible_week_rows(weeks, session_markers):
    """Keep authored empty weeks; omit only unsupported generated slots."""
    return [week for week in weeks if week.get('weekId') or week.get('totalActivities', 0)
            or week['kind'] == 'reading-week' or week.get('holidays')
            or (week['moduleId'], week['startDate']) in session_markers]


def assignment_projection(query):
    """Read assignment IDs/modes from JSON in SQL, never its content snapshot."""
    from django.db.models import JSONField
    from django.db.models.expressions import RawSQL
    for field, column in (('training_plan', 'Training_plan'), ('learning_plan', 'Learning_plan')):
        query = query.annotate(**{f'_weekly_{field}': RawSQL(
            f'''CASE WHEN jsonb_typeof("{column}"::jsonb)='array' THEN
              (SELECT coalesce(jsonb_agg(jsonb_build_object('moduleId',item->>'moduleId',
                'assignmentMode',item->>'assignmentMode')), '[]'::jsonb)
               FROM jsonb_array_elements("{column}"::jsonb) item WHERE jsonb_typeof(item)='object')
              ELSE NULL END''', [], output_field=JSONField())})
    return query


def activity_completion(component, progress):
    quiz_id = component.get('quiz_id')
    entries = progress['components'].get(str(component['id']), [])
    attempts = [entry for entry in entries if entry['kind'] == 'quiz']
    if quiz_id is not None:
        attempts = attempts + progress['quizzes'].get(str(quiz_id), [])
    if quiz_id is not None:
        done = any(entry['passed'] is True for entry in attempts)
    else:
        done = any(str(entry['component_ref']) == str(component['id'])
                   and (entry['kind'] in {'video', 'component'} or
                        entry['kind'] == 'quiz_reading' and entry['submitted_at'])
                   and progress_counts_as_achieved(entry['kind'], entry['passed']) for entry in entries)
    return done, 'completed' if done else 'in-progress' if attempts else 'not-started'


def progress_index(entries):
    from learner_api.models import _serialise_quiz_ref
    result = {'components': defaultdict(list), 'quizzes': defaultdict(list)}
    for entry in entries:
        result['components'][str(entry['component_ref'])].append(entry)
        if entry['kind'] == 'quiz' and entry['quiz_ref'] is not None:
            result['quizzes'][str(_serialise_quiz_ref(entry['quiz_ref']))].append(entry)
    return result


def week_rows(modules, today):
    result = []
    for module in modules:
        slots = module.get('curriculumSlots', [])
        for index, slot in enumerate(slots):
            start = slot['date'][:10]
            end = (date.fromisoformat(slots[index + 1]['date'][:10]) - timedelta(days=1)
                   if index + 1 < len(slots) else date.fromisoformat(start) + timedelta(days=6)).isoformat()
            result.append({'id': f"{module['id']}:{slot['slotNumber']}",
                           'moduleId': module['id'], 'moduleTitle': module['title'],
                           'weekId': slot.get('weekId'), 'weekNumber': slot.get('sessionNumber') or slot['slotNumber'],
                           'slotNumber': slot['slotNumber'], 'kind': slot['type'],
                           'title': 'Reading week' if slot['type'] == 'reading-week' else slot.get('weekTitle') or f"Week {slot.get('sessionNumber', 0)}",
                           'startDate': start, 'endDate': end,
                           'status': 'upcoming' if start > today else 'past' if end < today else 'current',
                           'progress': 0, 'completedActivities': 0, 'totalActivities': 0,
                           'attended': None, 'sessionState': 'unscheduled',
                           'holidayNote': slot.get('holidayNote') or '',
                           'holidays': [{key: value for key, value in holiday.items() if key in {'id', 'label', 'startDate', 'endDate'}}
                                        for holiday in slot.get('holidays') or []]})
    return result


def read_weekly_learning(context, selection=None, *, module_id=None, include_weeks=True, include_actions=False):
    from learner_api.weekly_hours import module_activity_hours, selected_activity_hours, activity_hours_index
    from learner_api.learning_plan import _effective_plan_ids
    from learner_api import canonical_learning
    from learner_api.training_plan_dashboard import rows, attach_curriculum_slots, plan_session
    from learner_api.learner_detail import _display_component_title, _display_quiz_title, _component_ksb_items, _RESOURCE_URL_KEYS
    from learner_api.subject_content import clean_text

    source = context.source
    if source is None:
        raise LookupError('Learner enrolment is unavailable.')
    owner = getattr(source, '_canonical_profile', None) or canonical_learning.require_profile(source.pk)
    assigned_ids = _effective_plan_ids(source, {})
    ids = list(dict.fromkeys([*assigned_ids, *canonical_learning.curriculum_module_ids_for(owner)]))
    if module_id is not None and str(module_id) not in set(map(str, ids)):
        raise LookupError('Module not found in this learner plan.')
    if module_id is not None:
        module_id = next(value for value in ids if str(value) == str(module_id))
    # Detail reads plan only the requested module. Keep all module titles for
    # canonical title-only ledger attribution (duplicate titles stay ambiguous).
    schedule_ids = [module_id] if module_id is not None and not include_weeks else ids
    # Content assignment and schedule assignment retain their distinct existing rules.
    content_ids = set(assigned_ids) if include_weeks else set(assigned_ids).intersection(schedule_ids)
    now = datetime.now(timezone.utc)
    today = now.astimezone(BUSINESS_ZONE).date().isoformat()
    calendar_columns = '''to_jsonb(m)->'session_holidays' AS session_holidays,
            to_jsonb(m)->'session_overrides' AS session_overrides,
            to_jsonb(m)->'weekly_schedule' AS weekly_schedule,'''
    with connections['enrolment'].cursor() as cur:
        cur.execute(f'''SELECT m.module_catalogue_id AS id,m.title,m.start_date,m.end_date,
            m.weeks_number,m.sessions_number,m.cohort_id,
            {calendar_columns}
            coalesce(nullif(m.session_week_day,''),g.session_week_day) AS session_week_day,
            coalesce(nullif(m.session_start_time,''),g.session_start_time) AS session_start_time,
            coalesce(nullif(m.session_end_time,''),g.session_end_time) AS session_end_time
            FROM curriculum.modules m LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
            WHERE m.module_catalogue_id=ANY(%s) ORDER BY m.title''', [ids])
        modules = rows(cur)
        from learner_api.weekly_calendar import normalise_projected_calendar
        modules = [normalise_projected_calendar(row) for row in modules]
        cur.execute(f'''SELECT id,module_catalogue_id,week_number,title,holiday_note_enabled,holiday_note,display_order
            FROM curriculum.weeks WHERE module_catalogue_id=ANY(%s) AND {VISIBLE_WEEK}
            ORDER BY display_order,week_number,id''', [schedule_ids])
        counts, authored = defaultdict(int), {}
        authored_rows = rows(cur)
        for row in authored_rows:
            mid = row['module_catalogue_id']
            counts[mid] += 1
            authored.setdefault((mid, row['week_number']), {
                'id': row['id'], 'title': clean_text(row['title']), 'learningOutcomes': [],
                'holidayNote': clean_text(row['holiday_note']) if row['holiday_note_enabled'] else ''})
        spine = {row['id']: {'id': row['id'], 'title': clean_text(row['title'])} for row in modules}
        from learner_api.weekly_calendar import cohort_holidays
        calendar_options = {'strict': True, 'holiday_loader': cohort_holidays}
        attach_curriculum_slots([row for row in modules if row['id'] in schedule_ids], spine, counts, authored, **calendar_options)
        # Match learnerHeaderPlan's default module ordering/window selection.
        candidates = sorted([row for row in modules if spine[row['id']].get('curriculumSlots')],
                            key=lambda row: (str(row['start_date'] or '9999'), row['title'], row['id']))
        active = [row for row in candidates if row['start_date'] and row['end_date']
                  and str(row['start_date'])[:10] <= today <= str(row['end_date'])[:10]]
        future = [row for row in candidates if row['start_date'] and str(row['start_date'])[:10] > today]
        past = sorted([row for row in candidates if row['end_date'] and str(row['end_date'])[:10] < today],
                      key=lambda row: (str(row['end_date']), row['id']), reverse=True)
        default_module = module_id or (active or future or past or candidates or [{}])[0].get('id')
        weeks = week_rows([spine[row['id']] for row in modules], today)
        default_weeks = [week for week in weeks if week['moduleId'] == default_module]
        selected = next((week for week in weeks if week['id'] == selection), None) if selection else (
            next((week for week in default_weeks if week['status'] == 'current'), None) or
            next((week for week in default_weeks if week['status'] == 'upcoming'), None) or
            (default_weeks[-1] if default_weeks else None))
        if selection and selected is None:
            raise LookupError('Week not found in this learner plan.')
        if selected is None:
            return compact_weekly(weeks=weeks if include_weeks else ())
        # Navigator needs completion counts, not content. Booleans preserve the
        # existing removed-video visibility rule without transferring any URLs/HTML.
        content_presence = ' OR '.join(f"coalesce(btrim(c.settings_json->>'{key}'),'') <> ''"
                                      for key in ('videoUrl', 'readingContent', 'podcastUrl', 'audioUrl', 'liveSessionUrl', 'teamsMeetingUrl', *_RESOURCE_URL_KEYS))
        detail_filter = ''
        detail_params = [sorted(content_ids)]
        if not include_weeks:
            # Only selected-week activities need completion/content checks. Keep
            # every quiz placement in the module: legacy quiz-only hours must
            # remain ambiguous when the same quiz is placed in another week.
            detail_filter = ''' AND (c.week_id=%s OR l.quiz_id IS NOT NULL
                OR c.settings_json->>'linkedQuizId' ~ '^[0-9]+$')'''
            detail_params.append(selected['weekId'])
        cur.execute(f'''SELECT c.id,c.week_id,c.module_catalogue_id,c.type,
            coalesce(l.quiz_id, CASE WHEN c.settings_json->>'linkedQuizId' ~ '^[0-9]+$'
                THEN (c.settings_json->>'linkedQuizId')::bigint END) AS quiz_id,
            EXISTS(SELECT 1 FROM curriculum.quizzes q WHERE q.id=coalesce(l.quiz_id,
                CASE WHEN c.settings_json->>'linkedQuizId' ~ '^[0-9]+$'
                THEN (c.settings_json->>'linkedQuizId')::bigint END)) AS is_quiz,
            CASE WHEN lower(replace(c.type,'-','_')) <> 'video' THEN true ELSE
              {content_presence} OR coalesce(c.settings_json->>'embedCode','') ~* '<iframe[^>]+src=["'']([^"'']+)["'']' OR
              coalesce(btrim(c.live_sessions_link),'') <> '' END AS has_content
            FROM curriculum.components c LEFT JOIN curriculum.quiz_component_links l ON l.component_id=c.id
            JOIN curriculum.modules cm ON cm.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s) AND {visible_child_sql('c')}
            AND (cm.deleted_at IS NULL OR COALESCE(cm.deleted_via_parent,'') <> '') AND coalesce(btrim(cm.title),'') <> ''
            {detail_filter}
            ORDER BY c.week_id,c.display_order,c.id''', detail_params)
        components = [row for row in rows(cur) if row['has_content'] or row['is_quiz']]
        register, live_credits = read_weekly_live_evidence(source, owner, schedule_ids, sorted(content_ids))
        credits_by_component = {credit['componentId']: credit for credit in live_credits}
        progress_query = context.profile.progress_entries.filter(kind__in=['quiz', 'video', 'component', 'quiz_reading'])
        from django.db.models import Q
        # Restrict completion to the assigned projection, retaining quiz-only
        # legacy attempts and all attempts for each selected component.
        # Keep quiz refs in their legacy text forms (e.g. leading zeroes):
        # progress_index owns their numeric normalization.
        progress_query = progress_query.filter(Q(component_ref__in=[row['id'] for row in components])
                                               | Q(kind='quiz'))
        progress = progress_index(progress_query.values('kind', 'component_ref', 'quiz_ref', 'passed', 'submitted_at'))
        def completion_for_week(component, week):
            credit = credits_by_component.get(str(component['id']))
            if credit is not None and credit_in_week(credit, week):
                return True, 'completed'
            return completion_by_id[component['id']]
        by_week = defaultdict(list)
        completion_by_id = {}
        for component in components:
            if not component['is_quiz']:
                component['quiz_id'] = None
            by_week[(component['module_catalogue_id'], component['week_id'])].append(component)
            completion_by_id[component['id']] = activity_completion(component, progress)
        for week in weeks:
            items = by_week[(week['moduleId'], week['weekId'])] if week['kind'] != 'reading-week' else []
            week['completedActivities'] = sum(completion_for_week(item, week)[0] for item in items)
            week['totalActivities'] = len(items)
            week['progress'] = round(week['completedActivities'] / len(items) * 100, 2) if items else 0
        # Only compact attendance markers are read across the navigator; the
        # selected occurrence's URL/title/timestamps are loaded separately below.
        marker_date_filter = '' if include_weeks else " AND (coalesce(o.scheduled_start,s.start_datetime) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date=%s::date"
        marker_details = ''' ,s.id AS session_id,s.module_catalogue_id AS module_id,s.module_title,
              s.start_datetime,s.duration_minutes,s.join_url AS series_join_url,s.status AS series_status,
              o.id AS occurrence_id,o.scheduled_start,o.scheduled_end,o.join_url'''
        # Select detail columns from the same first occurrence used by the rail.
        # This removes the second attendance EXISTS and the second session read.
        selected_marker_details = ''',session_id,module_id,module_title,start_datetime,duration_minutes,
              series_join_url,series_status,occurrence_id,scheduled_start,scheduled_end,join_url'''
        cur.execute(f'''WITH markers AS (
            SELECT s.module_catalogue_id,coalesce(o.status,s.status) AS status,coalesce(o.scheduled_start,s.start_datetime) AS start,
              coalesce(o.scheduled_end,coalesce(o.scheduled_start,s.start_datetime) + s.duration_minutes * interval '1 minute') AS finish,
              CASE WHEN coalesce(o.attendance_report_id,'')='' THEN NULL ELSE EXISTS(
                SELECT 1 FROM curriculum.live_session_attendance a WHERE a.occurrence_id=o.id
                AND lower(btrim(a.email))=%s AND a.total_attendance_seconds>0) END AS attended{marker_details}
              FROM curriculum.live_sessions s LEFT JOIN curriculum.live_session_occurrences o ON o.live_session_id=s.id
              WHERE s.module_catalogue_id=ANY(%s) AND lower(s.status) NOT IN ('cancelled','deleted','failed','superseded')
              AND (o.id IS NULL AND coalesce(s.repeat_pattern,'') IN ('','none') OR o.id IS NOT NULL
                   AND lower(o.status) NOT IN ('cancelled','deleted','failed','superseded')){marker_date_filter}
            ), dated AS (
              SELECT *, (start AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London')::date AS day FROM markers WHERE start IS NOT NULL
            ) SELECT DISTINCT ON (module_catalogue_id,day) module_catalogue_id,day,attended,start,finish,status{selected_marker_details}
              FROM dated ORDER BY module_catalogue_id,day,start''',
              [str(source.email or '').strip().lower(), schedule_ids] + ([] if include_weeks else [selected['startDate']]))
        marker_rows = rows(cur)
        markers = {}
        navigation = {}
        for row in marker_rows:
            start, finish = row['start'], row['finish']
            navigation[(row['module_catalogue_id'], row['day'].isoformat())] = {
                'sessionStart': (start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start).isoformat(),
                'sessionDurationMinutes': (finish - start).total_seconds() / 60 if finish else None}
            markers[(row['module_catalogue_id'], row['day'].isoformat())] = derived_session(
                row['start'], row['finish'], row['status'], row['attended'], now)
        register_by_module = defaultdict(list)
        for row in register:
            register_by_module[row.get('module_catalogue_id')].append(row)
        canonical_sessions = {}
        for week in weeks:
            canonical_session = week_live_session(register_by_module[week['moduleId']], week, now)
            canonical_sessions[week['id']] = canonical_session
            if canonical_session:
                key = (week['moduleId'], week['startDate'])
                markers[key] = {'state': canonical_session['sessionState'], 'attended': canonical_session['attended']}
                navigation[key] = {'sessionStart': canonical_session['start'],
                                   'sessionDurationMinutes': canonical_session['durationMinutes']}
            marker = markers.get((week['moduleId'], week['startDate'])) if week['kind'] != 'reading-week' else None
            week['attended'] = marker['attended'] if marker else None
            week['sessionState'] = marker['state'] if marker else 'unscheduled'
            week.update(navigation.get((week['moduleId'], week['startDate']), {}))
        weeks = visible_week_rows(weeks, markers)
        retained_modules = {week['moduleId'] for week in weeks}
        default_module = module_id or next((row['id'] for row in active + future + past + candidates
                               if row['id'] in retained_modules), None)
        default_weeks = [week for week in weeks if week['moduleId'] == default_module]
        selected = next((week for week in weeks if week['id'] == selection), None) if selection else (
            next((week for week in default_weeks if week['status'] == 'current'), None) or
            next((week for week in default_weeks if week['status'] == 'upcoming'), None) or
            (default_weeks[-1] if default_weeks else None))
        if selection and selected is None:
            raise LookupError('Week not found in this learner plan.')
        if selected is None:
            return compact_weekly(weeks=weeks if include_weeks else ())
        selected_components = by_week[(selected['moduleId'], selected['weekId'])] if selected['kind'] != 'reading-week' else []
        component_ids = [row['id'] for row in selected_components]
        fallback_columns = f''', (SELECT jsonb_agg(jsonb_build_object('code',k.ksb_code) ORDER BY k.ksb_code)
            FROM curriculum.ksb_mappings k WHERE k.component_id=c.id AND {visible_child_sql('k')})
            AS fallback_ksb_mappings'''
        cur.execute(f'''SELECT c.id,c.title,c.type,c.ksb_mappings,
            CASE WHEN jsonb_typeof(c.settings_json->'durationMinutes')='number'
                THEN c.settings_json->>'durationMinutes' END AS duration_minutes,
            q.title AS quiz_title,q.duration AS quiz_duration,q.time_unit AS quiz_time_unit,
            l.quiz_id AS linked_quiz_id,q.id AS resolved_quiz_id,q.questions AS quiz_questions{fallback_columns}
            FROM curriculum.components c LEFT JOIN curriculum.quiz_component_links l ON l.component_id=c.id
            LEFT JOIN curriculum.quizzes q ON q.id=coalesce(l.quiz_id,
                CASE WHEN c.settings_json->>'linkedQuizId' ~ '^[0-9]+$' THEN (c.settings_json->>'linkedQuizId')::bigint END)
            WHERE c.id=ANY(%s) ORDER BY c.display_order,c.id''', [component_ids])
        details = rows(cur)
        mappings = {row['id']: _component_ksb_items(row['ksb_mappings']) for row in details}
        missing = {cid for cid in component_ids if not mappings.get(cid)}
        for row in details:
            if row['id'] in missing:
                mappings[row['id']] = _component_ksb_items(row.get('fallback_ksb_mappings'))
        completion = {row['id']: completion_for_week(row, selected) for row in selected_components}
        selected_by_id = {row['id']: row for row in selected_components}
        # The Student routing reader needs these same module/week identities;
        # pass request-local facts rather than querying both tables again.
        if include_actions:
            source._weekly_resolved_metadata = {
                'module_titles': {row['id']: row['title'] for row in modules},
                'weeks': [(row['id'], row['module_catalogue_id'], row['title'], row['week_number'], row.get('display_order', 0))
                          for row in authored_rows],
                'quiz_links': {row['id']: row['linked_quiz_id'] for row in details
                               if row['type'] == 'quiz' and row.get('linked_quiz_id') is not None},
                'quiz_meta': {row['resolved_quiz_id']: {'quizId': row['resolved_quiz_id'], 'title': row['quiz_title'],
                              'questions': row['quiz_questions'], 'duration': row['quiz_duration'], 'timeUnit': row['quiz_time_unit']}
                              for row in details if row.get('resolved_quiz_id') is not None},
            }
        activities = []
        for row in details:
            done, status = completion[row['id']]
            duration = float(row['duration_minutes'] or 0) or None
            quiz_duration = row['quiz_duration']
            unit = (row['quiz_time_unit'] or 'mins').strip().lower()
            factor = 60 if unit in {'h','hr','hrs','hour','hours'} else 1/60 if unit in {'s','sec','secs','second','seconds'} else 1 if unit in {'min','mins','minute','minutes'} else None
            minutes = (float(quiz_duration) * factor if factor is not None else None) if quiz_duration else duration
            activities.append({'id': row['id'], 'title': _display_quiz_title(row['quiz_title']) if selected_by_id[row['id']]['is_quiz'] else _display_component_title(row['type'], row['title']),
                               'type': row['type'], 'status': status,
                               'isQuiz': selected_by_id[row['id']]['is_quiz'],
                               'expectedHours': minutes / 60 if minutes is not None else None,
                               'durationMinutes': duration, 'quizDuration': quiz_duration, 'quizTimeUnit': row['quiz_time_unit'],
                               'ksbCodes': sorted({str(item['code']).strip().upper() for item in mappings.get(row['id'], []) if item.get('code')})})
        for activity in activities:
            if activity['isQuiz']:
                activity['quizId'] = selected_by_id[activity['id']]['quiz_id']
        live = None
        if selected['kind'] != 'reading-week':
            sessions = [row for row in marker_rows if row['module_catalogue_id'] == selected['moduleId']
                        and row['day'].isoformat() == selected['startDate']]
            if sessions:
                session = plan_session(sessions[0])
                instant = datetime.fromisoformat(session['start'])
                start = instant.astimezone(BUSINESS_ZONE)
                end = sessions[0].get('scheduled_end')
                if end and end.tzinfo is None:
                    end = end.replace(tzinfo=timezone.utc)
                end = end.astimezone(BUSINESS_ZONE) if end else (instant + timedelta(minutes=session['minutes'])).astimezone(BUSINESS_ZONE) if session['minutes'] else None
                state = derived_session(instant, end, session['status'], session['attended'], now)
                selected['sessionState'], selected['attended'] = state['state'], state['attended']
                live = {'id': session['id'], 'title': session['title'], 'date': start.date().isoformat(),
                        'startTime': start.strftime('%H:%M'), 'endTime': end.strftime('%H:%M') if end else None,
                        'start': session['start'], 'durationMinutes': session['minutes'], 'status': state['status'],
                        'sessionState': state['state'], 'attended': state['attended'], 'joinUrl': session['joinUrl']}
        canonical_session = canonical_sessions.get(selected['id'])
        if canonical_session:
            live = canonical_session
            selected['sessionState'], selected['attended'] = live['sessionState'], live['attended']
    codes = {code for item in activities for code in item['ksbCodes']}
    achieved = {code for item in activities if item['status'] == 'completed' for code in item['ksbCodes']}
    planned = sum(item['expectedHours'] or 0 for item in activities)
    records = canonical_learning.weekly_hour_records(owner)
    activity_hours = module_activity_hours(records, modules)
    activity_hours = add_live_activity_hours(activity_hours, records,
        [credit for credit in live_credits if credit_in_week(credit, selected)
         and credit['componentId'] in selected_by_id])
    module_hours = activity_hours[str(selected['moduleId'])]
    module_components = [component for component in components if component['module_catalogue_id'] == selected['moduleId']]
    # Keep the established total summation/rounding order exactly. The index
    # replaces only the former per-activity rescans of module placements.
    completed_hours = selected_activity_hours(module_hours, selected_components, module_components)
    hours_by_component = activity_hours_index(module_hours, module_components)
    for activity in activities:
        activity['actualHours'] = round(hours_by_component[str(activity['id'])], 4)
    return compact_weekly(weeks=weeks if include_weeks else (selected,), selected=selected,
        summary={'ksbCount': len(codes), 'achievedKsbCount': len(achieved),
                 'otjhHours': completed_hours, 'plannedOtjhHours': planned,
                 'untimedActivities': sum(item['expectedHours'] is None for item in activities)},
        live_session=live, activities=activities)
