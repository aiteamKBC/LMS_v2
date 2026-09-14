"""Shared OTJ hour rules used by learner home and dashboard views."""

from math import isfinite

from .active_users import completed_hours_value_from_progress

ACCEPTED_ASSIGNMENT_STATUSES = {'accepted', 'partial'}


def _hours(value):
    try:
        value = float(value)
        return value if isfinite(value) and value >= 0 else None
    except (TypeError, ValueError):
        return None


def completed_otjh(native, progress, submissions, historical_hours=0):
    """Return recorded OTJ time, counting tutor accepted assignments once.

    Assignment progress is excluded from the ordinary progress total because
    its time is governed by the latest reflection marking decision.
    """
    assignment_ids = {str(row.get('id')) for row in native
                      if row.get('id') is not None and row.get('type') == 'assignment'}
    assignment_ids.update(str(row.get('componentId')) for row in progress
                          if row.get('componentId') and row.get('componentType') == 'assignment')
    ordinary = [row for row in progress if str(row.get('componentId') or '') not in assignment_ids]
    total = float(historical_hours or 0) + completed_hours_value_from_progress(ordinary)

    marking = {}
    for row in submissions:
        component = str(row.get('component_ref') or row.get('activity_id') or '')
        if component in assignment_ids:
            marking[component] = row
    missing = False
    for component, row in marking.items():
        if row.get('imported') or row.get('status') not in ACCEPTED_ASSIGNMENT_STATUSES:
            continue
        value = _hours(row.get('actual_time_hours'))
        if value is None:
            matching = [item for item in progress
                        if str(item.get('componentId') or '') == component
                        and (item.get('reportedTime') or item.get('claimedSeconds') is not None
                             or item.get('verifiedSeconds') is not None)]
            matching = [{key: val for key, val in item.items()
                         if key not in {'expectedOtjh', 'expected_otjh'}} for item in matching]
            value = completed_hours_value_from_progress(matching) if matching else None
        if value is None:
            missing = True
        else:
            total += value
    return None if missing else round(total, 4)
