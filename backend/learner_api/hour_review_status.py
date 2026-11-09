"""Separate submitted work from recorded hours that still need verification."""
from collections import defaultdict


def review_hour_totals(records, allocations):
    months = defaultdict(lambda: {'submitted_hours': 0.0, 'verification_hours': 0.0})
    for record in records:
        for part in allocations(record):
            month = part.get('reporting_month')
            if not month or part.get('accepted') is True:
                continue
            status = str(part.get('activity_status') or '').strip().casefold()
            key = 'submitted_hours' if status in {
                'submitted_for_tutor_review', 'submitted', 'pending_review',
            } else 'verification_hours'
            months[month][key] += float(part.get('actual_seconds') or 0) / 3600
    return dict(months)
