"""Match the learner's Required badge and displayed delivery dates."""
from math import isfinite

from .subject_dates import as_date


def has_required_hours(value):
    # Same rule as frontend/utils/activityPlan. Quiz type or media duration
    # alone does not put a Required badge on an activity.
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value) and value > 0


def required_activity_fact(card, *, component=None, legacy=None, schedule=None):
    if legacy is not None:
        hours = legacy.get('planned') if legacy.get('planned_hours_mapped') else None
        schedule = legacy
    else:
        hours = (component or {}).get('expectedOtjh')
    if not has_required_hours(hours):
        return None
    schedule = schedule or {}
    deadline = card.get('date')
    if str(schedule.get('due_timing') or '').strip().casefold() == 'end of week':
        deadline = schedule.get('week_end')
    due = None if card.get('needsReview') or schedule.get('date_needs_review') else as_date(deadline)
    return {'completed': bool(card.get('completed')), 'dueDate': due.isoformat() if due else None}
