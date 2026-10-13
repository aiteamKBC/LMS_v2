"""Read-only Monthly Focus display projection; no dashboard aggregates."""
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from django.db import connections
from learner_api import canonical_learning
from learner_api.dashboard_metrics import point_codes
from learner_api.subject_content import clean_text
from learner_api.training_plan_dashboard import rows
from old_otjh.repository import query

BUSINESS_ZONE = ZoneInfo('Europe/London')


def month_bounds(month):
    first = date.fromisoformat(month + '-01')
    last = first.replace(day=monthrange(first.year, first.month)[1])
    return (datetime.combine(first, time.min, BUSINESS_ZONE).astimezone(timezone.utc),
            datetime.combine(last + timedelta(days=1), time.min, BUSINESS_ZONE).astimezone(timezone.utc))


def read_month_activities(context, month):
    from learner_api.builder_activity_dates import read_builder_activity_dates
    from learner_api.student_activity import CURRENT_SUBJECTS_SQL
    from learner_api.overview_week import merged_activities

    with connections['enrolment'].cursor() as cursor:
        cursor.execute(CURRENT_SUBJECTS_SQL, [context.source.pk])
        assigned = [row[0] for row in cursor.fetchall()]
        # The shared scheduler needs ordered empty weeks/holiday metadata to
        # place undated content correctly. It never loads lesson bodies or slots.
        dates = read_builder_activity_dates(cursor, assigned)
        dates = {key: value for key, value in dates.items()
                 if str(value.get('date') or '')[:7] == month and not value.get('date_needs_review')}
        if not dates:
            return [], assigned
        cursor.execute('''SELECT c.id,c.module_catalogue_id AS module_id,c.title,c.type,
            c.expected_otjh AS expected_hours,
            coalesce(nullif(c.ksb_mappings,'[]'::jsonb),
              (SELECT jsonb_agg(jsonb_build_object('code',k.ksb_code)) FROM curriculum.ksb_mappings k
               WHERE k.component_id=c.id AND (k.deleted_at IS NULL OR COALESCE(k.deleted_via_parent,'')<>'')),
              '[]'::jsonb) AS ksb_mappings,
            coalesce((SELECT q.quiz_id::text FROM curriculum.quiz_component_links q
                      WHERE q.component_id=c.id ORDER BY q.id LIMIT 1),c.settings_json->>'linkedQuizId') AS quiz_id
            FROM curriculum.components c WHERE c.id=ANY(%s) AND c.module_catalogue_id=ANY(%s)
              AND (c.deleted_at IS NULL OR COALESCE(c.deleted_via_parent,'')<>'')''', [list(dates), assigned])
        native = [{**row, **dates[str(row['id'])]} for row in rows(cursor)]
    component_ids = [str(row['id']) for row in native]
    quiz_ids = [str(row['quiz_id']) for row in native if row.get('quiz_id')]
    from django.db.models import Q
    progress = [{'kind': row['kind'], 'passed': row['passed'], 'componentId': row['component_ref'], 'quizId': row['quiz_ref']}
                for row in context.profile.progress_entries.using('enrolment')
                .filter(component_link_source__in=('direct', 'quiz_ref'))
                .filter(Q(component_ref__in=component_ids) | Q(quiz_ref__in=quiz_ids))
                .exclude(kind='activity_event').values('kind', 'passed', 'component_ref', 'quiz_ref')]
    return list(merged_activities([], native, progress, set(), {})), assigned


def read_month_lectures(context, owner, assigned, month):
    from learner_api.learning_plan import _effective_plan_ids
    ids = list(dict.fromkeys([*_effective_plan_ids(context.source, {}),
                             *canonical_learning.curriculum_module_ids_for(owner)]))
    start, end = month_bounds(month)
    with connections['enrolment'].cursor() as cursor:
        # Occurrence dates are authoritative; recurring series without an
        # occurrence must not manufacture another meeting.
        cursor.execute('''SELECT coalesce(o.id::text,s.id::text) AS id,
            coalesce(o.scheduled_start,s.start_datetime) AS start,
            coalesce(o.scheduled_end,coalesce(o.scheduled_start,s.start_datetime)
                     + s.duration_minutes * interval '1 minute') AS finish,
            s.module_catalogue_id AS module_id,s.module_title,m.title AS title,
            s.duration_minutes,m.tutor_name,
            coalesce(nullif(btrim(g.coach_name),''),m.coach_name) AS coach_name
            FROM curriculum.live_sessions s
            LEFT JOIN curriculum.live_session_occurrences o ON o.live_session_id=s.id
            LEFT JOIN curriculum.modules m ON m.module_catalogue_id=s.module_catalogue_id
            LEFT JOIN curriculum.groups g ON g.group_id=m.group_id
            WHERE s.module_catalogue_id=ANY(%s)
              AND lower(s.status) NOT IN ('cancelled','deleted','failed','superseded')
              AND (o.id IS NULL OR lower(o.status) NOT IN ('cancelled','deleted','failed','superseded'))
              AND (o.id IS NOT NULL OR coalesce(s.repeat_pattern,'none') IN ('none',''))
              AND coalesce(o.scheduled_start,s.start_datetime)>=%s
              AND coalesce(o.scheduled_start,s.start_datetime)<%s
            ORDER BY coalesce(o.scheduled_start,s.start_datetime),s.id,o.id''', [ids, start, end])
        result = rows(cursor)
    if any(not clean_text(row.get('tutor_name')) and not clean_text(row.get('coach_name')) for row in result):
        from learner_api.coach_assignment import current_coach
        coach = current_coach(context.source, context.profile, None)['coach_name']
        for row in result:
            if not clean_text(row.get('tutor_name')) and not clean_text(row.get('coach_name')):
                row['coach_name'] = coach
    return result


def project_month(month, required, actual, activities, reviews, lectures):
    selected = [row for row in activities if str(row.get('date') or '')[:7] == month
                and not row.get('date_needs_review')]
    codes = set()
    for activity in selected:
        codes.update(point_codes(activity.get('ksb_mappings')) or [])
    review_rows = []
    for row in reviews:
        # Monthly Focus's existing display precedence, not the target month.
        day = row.get('scheduledDate') or row.get('date') or row.get('targetDate') or ''
        if not str(day).startswith(month) or row.get('source') not in {'mcr', 'progress-review'} or row.get('status') == 'cancelled':
            continue
        review_rows.append({'id': row['id'], 'type': row['source'], 'title': row.get('title') or 'Review',
                            'date': str(day)[:10], 'time': str(row['scheduledTime'])[:5] if row.get('scheduledTime') else None,
                            'durationMinutes': row.get('durationMinutes'), 'status': row.get('status')})
    lecture_rows = []
    for row in lectures:
        instant = row['start']
        if instant.tzinfo is None:
            instant = instant.replace(tzinfo=timezone.utc)
        local = instant.astimezone(BUSINESS_ZONE)
        if local.strftime('%Y-%m') != month:
            continue
        authored = next((activity for activity in selected if str(activity.get('type') or '').lower().replace('-', '_').replace(' ', '_') == 'live_session'
                         and activity.get('module_id') == row['module_id']
                         and str(activity.get('date'))[:10] == local.date().isoformat()), {})
        finish = row.get('finish')
        if finish and finish.tzinfo is None:
            finish = finish.replace(tzinfo=timezone.utc)
        lecture_rows.append({'id': str(row['id']), 'date': local.date().isoformat(), 'time': local.strftime('%H:%M'),
                             'title': clean_text(authored.get('title') or row.get('title') or row.get('module_title')) or 'Live session',
                             'tutor': clean_text(row.get('tutor_name')) or clean_text(row.get('coach_name')) or 'Tutor',
                             'durationMinutes': (finish-instant).total_seconds()/60 if finish and finish > instant else row.get('duration_minutes') or 0})
    return {'month': month,
            'summary': {'requiredHours': required, 'achievedHours': actual,
                        'differenceHours': actual-required if required is not None and actual is not None else None,
                        'ksbCount': len(codes) if codes else None},
            'reviews': sorted(review_rows, key=lambda row: (row['date'], str(row['id']))),
            'assignments': [{'id': ':'.join(str(part) for part in row['key']), 'title': clean_text(row['title']) or 'Assignment',
                             'date': str(row['date'])[:10], 'status': 'completed' if row['completed'] else 'not-started'}
                            for row in sorted(selected, key=lambda row: (str(row['date']), clean_text(row['title'])))
                            if str(row.get('type') or '').lower().replace('-', '_') == 'assignment'],
            'lectures': lecture_rows}


def read_monthly_focus(context, month):
    from learner_api.calendar import coaching_events_for_learner
    if context.source is None:
        raise LookupError('Learner enrolment is unavailable.')
    owner = canonical_learning.require_profile(context.source.pk)
    activities, assigned = read_month_activities(context, month)
    targets = canonical_learning.targets_for(owner, month=month)
    required = targets.get(month)
    if required is None:
        # Same final fallback as monthMetrics when no Training Plan target exists.
        values = [canonical_learning.number(row['expected_hours']) if row.get('expected_hours') is not None else None
                  for row in activities]
        required = round(sum(values), 4) if values and all(value is not None for value in values) else None
    # Monthly Logs counts persisted accepted seconds only. No completion overlay,
    # historical rewrite, submissions, signatures or full hours history needed.
    records = query('''SELECT actual_seconds,accepted FROM "Learner".learner_progress_entries
        WHERE learner_id=%s AND reporting_month=%s AND deleted_at IS NULL''', [owner['id'], month])
    actual = sum(canonical_learning.number(row.get('actual_seconds')) / 3600
                 for row in records if canonical_learning.counts_as_actual(row))
    active_profile = context.profile if context.profile.lifecycle_status == 'active' else None
    reviews = coaching_events_for_learner(context.source, active_profile, month=month)
    lectures = read_month_lectures(context, owner, assigned, month)
    return project_month(month, required, actual, activities, reviews, lectures)
