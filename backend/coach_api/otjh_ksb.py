"""Read-only Case File projection; no dashboard, reviews or evidence hydration."""
from datetime import date
import logging
import re

from django.db import connections
from django.utils import timezone
from learner_api import canonical_learning as canonical

log = logging.getLogger(__name__)


def read_hour_totals(owner):
    # Same stored-row/number predicate as canonical.otjh_summary_bulk. Group
    # once for both programme actual and Monthly Logs; source snapshots and
    # reporting segments are lineage, never additional hours.
    return canonical.query('''SELECT reporting_month AS month,
        SUM(CASE WHEN accepted IS TRUE THEN seconds ELSE 0 END)/3600.0 AS completed,
        SUM(CASE WHEN accepted IS NOT TRUE THEN seconds ELSE 0 END)/3600.0 AS submitted
        FROM (SELECT reporting_month,accepted,
            CASE WHEN actual_seconds::text IN ('NaN','Infinity','-Infinity')
                 THEN 0 ELSE GREATEST(COALESCE(actual_seconds,0),0) END AS seconds
            FROM "Learner".learner_progress_entries
            WHERE learner_id=%s AND deleted_at IS NULL) p
        GROUP BY reporting_month''', [owner['id']])


def read_chart_plan(context):
    """Only activity dates/hours needed by the established monthly fallback."""
    from learner_api.overview_week import (
        CURRENT_SUBJECTS_SQL, _direct_progress_records, read_builder_activity_dates,
        activity_schedule, merged_activities, monthly_otjh_summary, rows,
    )
    progress = _direct_progress_records(context.profile.enrolment_id, profile=context.profile)
    with connections['enrolment'].cursor() as cursor:
        cursor.execute(CURRENT_SUBJECTS_SQL, [context.profile.enrolment_id])
        module_ids = [row[0] for row in cursor.fetchall()]
        cursor.execute('''SELECT c.id,c.module_catalogue_id AS module_id,
            c.title,c.expected_otjh AS expected_hours,w.title AS section_title
            FROM curriculum.components c
            JOIN curriculum.modules m ON m.module_catalogue_id=c.module_catalogue_id
            LEFT JOIN curriculum.weeks w ON w.id=c.week_id AND w.module_catalogue_id=c.module_catalogue_id
            WHERE c.module_catalogue_id=ANY(%s)
              AND (c.deleted_at IS NULL OR COALESCE(c.deleted_via_parent, '') <> '')
              AND (w.id IS NULL OR w.deleted_at IS NULL OR COALESCE(w.deleted_via_parent, '') <> '')''', [module_ids])
        native = rows(cursor)
        dates = read_builder_activity_dates(cursor, module_ids)
        for row in native:
            row.update(dates.get(str(row['id'])) or activity_schedule(row['title'], section_title=row['section_title']))
    return monthly_otjh_summary(merged_activities([], native, [], set(), {}), progress)


def project_months(totals, targets, signed_months, fallback, *, today):
    """Monthly Logs wins through this month; retain weekly future fallback."""
    current = today.strftime('%Y-%m')
    def valid_month(month):
        return isinstance(month, str) and bool(re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month)) and not month.startswith('0000-')
    recorded = {row['month']: row for row in totals if valid_month(row['month'])}
    log_months = {month for month in {*recorded, *targets, *signed_months} if valid_month(month) and month <= current}
    keys = sorted(log_months | set(recorded) | {month for month in fallback if valid_month(month)})
    if not keys:
        return []
    first, last = date.fromisoformat(keys[0] + '-01'), keys[-1]
    months = []
    while first.strftime('%Y-%m') <= last:
        month = first.strftime('%Y-%m')
        saved, planned = recorded.get(month, {}), fallback.get(month, {})
        months.append({'month': month,
            'targetHours': max(0, targets[month]) if month in log_months and month in targets else planned.get('planned'),
            'submittedHours': float(saved.get('submitted') or 0) if month in log_months else planned.get('submitted', 0),
            'completedHours': float(saved.get('completed') or 0) if month in log_months else round(float(saved.get('completed') or 0), 4)})
        if month == last:
            break
        first = date(first.year + (first.month == 12), first.month % 12 + 1, 1)
    return months


def read_ksb_rows(learner_id):
    return canonical.read_ksb_point_counts(learner_id)


def project_ksbs(records):
    rows = [{'code': row['code'], 'description': row['description'] or row['code'],
             'category': {'K': 'Knowledge', 'S': 'Skills', 'B': 'Behaviours'}.get(row['code'][:1], 'Other'),
             'status': 'Achieved' if row['pointsAchieved'] else 'Not Achieved',
             'pointsAchieved': int(row['pointsAchieved']),
             'totalPoints': int(row['evidenceCount']),
             'progressPercent': canonical.point_ratio(row['pointsAchieved'], row['evidenceCount'])['percent'],
             'evidenceCount': int(row['evidenceCount']), 'completed': int(row['completed'])}
            for row in records]
    achieved = sum(row['status'] == 'Achieved' for row in rows)
    categories = []
    for category in dict.fromkeys(['Knowledge', 'Skills', 'Behaviours', *(row['category'] for row in rows)]):
        items = [row for row in rows if row['category'] == category]
        done = sum(row['status'] == 'Achieved' for row in items)
        categories.append({'category': category, 'achieved': done, 'total': len(items),
                           'percent': round(done / len(items) * 100, 2) if items else 0})
    return {'summary': {'total': len(rows), 'achieved': achieved, 'remaining': len(rows) - achieved},
            'categories': categories, 'rows': rows}


def search_ksb_activities(learner_id, search):
    # Literal substring search, matching the browser's former includes().
    return {'codes': [row['code'] for row in canonical.query('''SELECT DISTINCT k.ksb_code AS code
        FROM "Learner".learner_progress_entries p
        JOIN "Learner".learner_progress_ksbs k ON k.progress_id=p.id
        WHERE p.learner_id=%s AND p.deleted_at IS NULL AND k.ksb_code IS NOT NULL
          AND strpos(lower(coalesce(nullif(p.component_title,''),'Learning activity ' || p.id::text)),%s)>0''',
        [learner_id, search.strip().lower()])]} if search.strip() else {'codes': []}


def read_otjh(context, owner):
    from .selectors.otjh import learner_programme_window
    from .views import apply_otjh_to_date_metrics
    totals = read_hour_totals(owner)
    actual = round(sum(float(row['completed'] or 0) for row in totals), 4)
    planned = canonical.programme_planned_hours(context.profile.enrolment_id, owner=owner)
    start, end = learner_programme_window(context.profile, context.source)
    today = timezone.localdate()
    paced = apply_otjh_to_date_metrics({'otjhCompleted': actual, 'otjhPlanned': planned,
        'otjhProgrammeStartDate': start, 'plannedEndDate': end}, today=today)
    target = paced['otjhTargetAsOfToday']
    targets = canonical.targets_for(owner)
    signed_months = [row['report_month'] for row in canonical.query(
        'SELECT DISTINCT report_month FROM "Learner".learner_monthly_signatures WHERE learner_id=%s AND review_confirmed IS TRUE', [owner['id']])]
    return {'actualHours': actual, 'targetToDateHours': target, 'plannedHours': planned,
        'remainingHours': max(0, target - actual) if target is not None else None,
        'progressPercent': paced['otjhProgressAsOfToday'],
        'months': project_months(totals, targets, signed_months, read_chart_plan(context), today=today)}


def read_otjh_ksb(context):
    owner = canonical.require_profile(context.profile.enrolment_id)
    if owner['id'] != context.profile.id:
        raise ValueError('Learner identity is unavailable.')
    result = {'ksb': project_ksbs(read_ksb_rows(owner['id']))}
    try:
        result['otjh'] = read_otjh(context, owner)
    except Exception:
        log.exception('case_file_otjh_failed learner_id=%s', context.learner_id)
        result['otjh'] = {field: None for field in ('actualHours', 'targetToDateHours', 'plannedHours',
                         'remainingHours', 'progressPercent')}
        result['otjh']['months'] = []
        result['errors'] = {'otjh': 'Learning hours are unavailable. Please reload to try again.'}
    return result
