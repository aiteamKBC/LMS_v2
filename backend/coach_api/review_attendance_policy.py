"""Attendance display threshold for required Review participants."""
from datetime import datetime


REVIEW_ATTENDED_SECONDS = 10 * 60
REVIEW_EVENT_TYPES = frozenset({'mcr', 'progress-review', 'review'})


def is_review_event(record):
    return str(getattr(record, 'event_type', '') or '').lower() in REVIEW_EVENT_TYPES


def attended_seconds(records):
    """Union complete join intervals, or use provider totals when unavailable."""
    intervals = []
    for record in records:
        spans = record.get('intervals') or []
        if not spans:
            return sum(max(int(row.get('totalAttendanceSeconds') or 0), 0) for row in records)
        for span in spans:
            try:
                start = datetime.fromisoformat(span['joinDateTime'].replace('Z', '+00:00'))
                end = datetime.fromisoformat(span['leaveDateTime'].replace('Z', '+00:00'))
                if start.utcoffset() is None or end.utcoffset() is None or end <= start:
                    raise ValueError()
            except (KeyError, TypeError, ValueError, AttributeError):
                return sum(max(int(row.get('totalAttendanceSeconds') or 0), 0) for row in records)
            intervals.append((start.timestamp(), end.timestamp()))
    total = 0
    current_start = current_end = None
    for start, end in sorted(intervals):
        if current_end is None or start > current_end:
            if current_end is not None:
                total += current_end - current_start
            current_start, current_end = start, end
        else:
            current_end = max(current_end, end)
    if current_end is not None:
        total += current_end - current_start
    return int(total)


def qualifies(seconds):
    return seconds >= REVIEW_ATTENDED_SECONDS
