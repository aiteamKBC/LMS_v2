"""Read-only totals for the learner home card, scoped to its enrolment.

The chart covers the whole assigned plan. Period counts use the recorded
programme start through Sunday of the current UK week, not just this week.
"""
import logging
from math import isfinite

import psycopg
from django.db import DatabaseError, connections

from .active_users import completed_hours_value_from_progress
from .apprenticeship_agreement import _group_dates
from .attendance_lectures import lecture_register
from .subject_dates import as_date
from .student_activity_access import student_activity_available
from .training_plan_dashboard import rows
from .otjh_totals import completed_otjh

log = logging.getLogger(__name__)
ACCEPTED = {'accepted', 'partial'}
SUBMITTED = {'submitted_for_tutor_review', 'submitted', 'pending_review'}


def hours(value):
    try:
        value = float(value)
        return value if isfinite(value) and value >= 0 else None
    except (ValueError, TypeError):
        return None


def counts(items, predicate):
    return {'completed': sum(bool(predicate(item)) for item in items), 'total': len(items)}


def summarise_home(activities, native, progress, submissions, assigned, start, end,
                   lectures, historical_hours=0):
    """Aggregate explicit activity identities; never infer identity from titles."""
    activities = [dict(row) for row in activities]
    by_component = {str(row['id']): row for row in native}
    assignment_ids = {key for key, row in by_component.items() if row.get('type') == 'assignment'}
    assignment_ids.update(str(row['componentId']) for row in progress
                          if row.get('componentId') and row.get('componentType') == 'assignment')
    # Reflections can have a different activity id; component_ref is canonical.
    marking = {}
    for row in submissions:
        component = str(row.get('component_ref') or row.get('activity_id') or '')
        if component in assignment_ids:
            marking[component] = row
    for row in activities:
        component_ids = row.get('component_ids') or ([str(row['id'])] if row.get('id') else [])
        decisions = [marking[key] for key in component_ids if key in marking]
        if decisions:
            # Submission is separate from completion until the tutor accepts it.
            row['completed'] = any(decision['status'] in ACCEPTED for decision in decisions)

    # An exported activity's hours belong to the activity, not each group it
    # appears in. Prefer the currently authored hours over the imported value.
    planned = {}
    for row in activities:
        key = ('legacy', str(row['activity_id'])) if row.get('activity_id') is not None else row['key']
        value = hours(row.get('expected_hours'))
        priority = int(row.get('expected_source') == 'native' or row['key'][0] == 'native')
        previous = planned.get(key)
        if previous is None or value is not None and (previous[0] is None or priority >= previous[1]):
            planned[key] = (value, priority)
    missing_hours = sum(value is None for value, _ in planned.values())
    total_hours = None if missing_hours else round(sum(value for value, _ in planned.values()), 4)

    # A saved assignment also creates a progress entry. Count its declared
    # hours once, in the bucket matching its latest tutor decision.
    # These records are already scoped to this learner. Retain earned time
    # when an activity is archived or replaced in the current curriculum, just
    # as the historical ledger retains previously completed learning.
    actual = completed_otjh(native, progress, submissions, historical_hours)
    submitted, missing_submitted = 0, 0
    for component, row in marking.items():
        if row.get('imported'):
            continue  # Already represented by the accepted historical ledger.
        value = hours(row.get('actual_time_hours'))
        if value is None:
            matching = [item for item in progress if str(item.get('componentId') or '') == component]
            # Use only recorded time here, never authored planned hours as actual.
            matching = [item for item in matching if item.get('reportedTime')
                        or item.get('claimedSeconds') is not None or item.get('verifiedSeconds') is not None]
            matching = [{key: value for key, value in item.items() if key not in {'expectedOtjh', 'expected_otjh'}}
                        for item in matching]
            value = completed_hours_value_from_progress(matching) if matching else None
        if row['status'] in SUBMITTED and component in assignment_ids:
            missing_submitted += value is None
            submitted += value or 0
    submitted = None if missing_submitted else round(submitted, 4)

    undated = sum(not as_date(row.get('date')) or bool(row.get('date_needs_review')) for row in activities)
    period = [row for row in activities if start and not row.get('date_needs_review')
              and (day := as_date(row.get('date'))) and start <= day <= end]
    assignments = [row for row in period if str(row.get('type') or '').lower() == 'assignment']
    attendance = None if lectures is None or not start else counts(
        [row for row in lectures if (day := as_date(row.get('session_date'))) and start <= day <= end],
        lambda row: row.get('attendance_status') in {'present', 'late'},
    )

    # Unite historical and current module identities only through explicit
    # component export links. Include assigned modules that have no activities.
    parents = {}

    def root(key):
        parents.setdefault(key, key)
        while parents[key] != key:
            key = parents[key]
        return key

    for row in activities:
        subject = root(row['subject'])
        if row.get('module_id'):
            parents[root(f"current:{row['module_id']}")] = subject
    module_rows = {}
    for module_id, _ in assigned:
        module_rows.setdefault(root(f'current:{module_id}'), [])
    for row in activities:
        module_rows.setdefault(root(row['subject']), []).append(row)
    modules = counts(list(module_rows.values()), lambda items: bool(items) and all(row['completed'] for row in items))
    return {
        'period': {'start': start.isoformat() if start else None, 'end': end.isoformat(), 'timezone': 'Europe/London'},
        'otjh': {'actual': actual, 'submitted': submitted, 'planned': total_hours,
                 'percent': round(actual / total_hours * 100, 2) if actual is not None and total_hours else None,
                 'missingPlannedActivities': missing_hours},
        'activities': counts(period, lambda row: row['completed']) if start else None,
        'assignments': counts(assignments, lambda row: row['completed']) if start else None,
        'lectures': attendance, 'modules': modules, 'undatedActivities': undated,
    }


def read_home_progress(source, kind, activities, native, progress, assigned, end):
    start, _, _ = _group_dates(source)
    with connections['enrolment'].cursor() as cur:
        cur.execute('''SELECT activity_id, component_ref, status, actual_time_hours,
            full_submission->>'submissionOrigin' = 'imported_legacy' AS imported
            FROM "Learner".learning_reflection_submissions
            WHERE learner_kind=%s AND learner_id=%s AND activity_type='assignment'
            ORDER BY submitted_at NULLS FIRST,id''', [kind, str(source.pk)])
        submissions = rows(cur)
        historical_hours = 0
        if student_activity_available(source.aptem_id):
            # read_week has already verified the Aptem/email identity.
            cur.execute('''SELECT coalesce(sum(actual_hours),0)
                FROM structured_manual_activities.manual_learner_activities
                WHERE aptem_id=%s AND accepted IS TRUE AND deleted_at IS NULL''', [source.aptem_id])
            historical_hours = cur.fetchone()[0]
    try:
        lectures = lecture_register(source)
    except (DatabaseError, psycopg.Error):
        log.warning('Home attendance unavailable for enrolment %s', source.pk, exc_info=True)
        lectures = None
    return summarise_home(activities, native, progress, submissions, assigned, start, end, lectures, historical_hours)
