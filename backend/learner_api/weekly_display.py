"""Explicit source/cohort display choices, separate from delivery and evidence.

The source-course metadata is opt-in. Dates affect navigation labels only;
the Weekly reader keeps the original rows for attendance and hours calculations.
"""
import json
from datetime import date, timedelta


def display_policies(modules, cohort_id):
    result = {}
    for module in modules:
        candidates = module.get('source_weekly_display')
        if isinstance(candidates, str):
            candidates = json.loads(candidates)
        if not candidates:
            continue
        if not isinstance(candidates, list) or len(candidates) != 1:
            raise ValueError('The source weekly display configuration is ambiguous.')
        policy = candidates[0]
        if not isinstance(policy, dict) or policy.get('cohortId') != cohort_id or not cohort_id:
            continue
        if (policy.get('version') != 1 or policy.get('mode') != 'available-content'
                or policy.get('moduleId') != module['id']):
            raise ValueError('The source weekly display configuration is invalid.')
        dates = policy.get('weekDates')
        if not isinstance(dates, dict):
            raise ValueError('The source week dates are invalid.')
        for week_id, day in dates.items():
            if not isinstance(week_id, str) or not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
                raise ValueError('The source week date is invalid.')
        result[module['id']] = policy
    return result


def display_weeks(weeks, policies, today):
    """Copy visible rows; preserve IDs, order, evidence and the caller's rows.

Periods use all verified source dates, including on a selected-week-only read.
Two source sections on the same day retain separate identities and share a
valid date window. Gaps do not stretch one week's content across several weeks.
"""
    available_ids = {(week['moduleId'], week.get('weekId')) for week in weeks}
    dates_by_module = {
        mid: sorted({day for wid, day in policy['weekDates'].items() if (mid, wid) in available_ids})
        for mid, policy in policies.items()
    }
    result = []
    for original in weeks:
        policy = policies.get(original['moduleId'])
        if policy is None:
            result.append(original)
            continue
        if not original.get('totalActivities'):
            continue
        week = dict(original)
        start = policy['weekDates'].get(week.get('weekId'))
        if start:
            end = date.fromisoformat(start) + timedelta(days=6)
            following = next((day for day in dates_by_module[week['moduleId']] if day > start), None)
            if following:
                end = min(end, date.fromisoformat(following) - timedelta(days=1))
            week.update(startDate=start, endDate=end.isoformat(),
                        status='upcoming' if start > today else 'past' if end.isoformat() < today else 'current')
        result.append(week)
    return result


def default_week(weeks, *, latest_available=False, today=None):
    if latest_available:
        available = [week for week in weeks if week['startDate'] <= today]
        if available:
            return max(available, key=lambda week: (week['startDate'], week['slotNumber']))
        return min(weeks, key=lambda week: (week['startDate'], week['slotNumber'])) if weeks else None
    return (next((week for week in weeks if week['status'] == 'current'), None)
            or next((week for week in weeks if week['status'] == 'upcoming'), None)
            or (weeks[-1] if weeks else None))
