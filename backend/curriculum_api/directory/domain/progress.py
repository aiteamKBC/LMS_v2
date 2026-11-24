"""Due/available activity denominators; missing dates remain unknown rather than fabricated zeroes."""


from datetime import datetime


def activity_summary(items, today, *, UK):
    """Count completed work within each denominator; future work cannot hide arrears."""
    due = []
    undated = 0
    for item in items:
        schedule = item.get('schedule') or {}
        if schedule.get('date_source') in {'introduction', 'extra_activity'}:
            continue
        delivery = schedule.get('delivery_week') or {}
        date = ((delivery.get('end') or schedule.get('week_end'))
                if str(schedule.get('due_timing') or '').casefold() == 'end of week'
                else schedule.get('date') or delivery.get('start'))
        try:
            day = datetime.strptime(str(date)[:10], '%Y-%m-%d').date()
        except ValueError:
            day = None
        if day is None or schedule.get('date_needs_review'):
            undated += 1
        elif day.isoformat() <= today:
            due.append(item)

    def metric(rows):
        completed = sum(bool(row['completed']) for row in rows)
        return {'completed': completed, 'total': len(rows),
                'percent': round(completed / len(rows) * 100, 1) if rows else None}

    return {'due': None if undated else metric(due), 'available': metric(items),
            'undatedActivities': undated, 'asOfDate': today, 'timeZone': str(UK)}
