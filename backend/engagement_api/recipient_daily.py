"""Read-only daily MCM assignment reporting, grouped before pagination."""
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .recipient_coaches import current_coach

UK_TIME = ZoneInfo('Europe/London')


def report_date(value):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value or ''):
        raise ValueError('Dates must use YYYY-MM-DD.')
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError('Choose a valid calendar date.') from exc


def assignment_range(params, *, now=None):
    today = (now or datetime.now(timezone.utc)).astimezone(UK_TIME).date()
    period = params.get('period', '7days')
    if period == 'today':
        return today, today
    if period == 'yesterday':
        return today - timedelta(days=1), today - timedelta(days=1)
    if period == '7days':
        return today - timedelta(days=6), today
    if period != 'custom':
        raise ValueError('Choose today, yesterday, 7days or custom.')
    start, end = report_date(params.get('from')), report_date(params.get('to'))
    if start > end:
        raise ValueError('From date must be on or before To date.')
    return start, end


def daily_mcm_recipients(rows, owners, *, start, end, search='', coach_key='',
                         day='', day_page=1, page=1, page_size=25):
    """Use assignment instants, not review completion or response submission dates.

    Each learner is counted once per UK day (and once in the period total).
    Coach ownership is current, matching the existing coach view.
    """
    query = search.strip().casefold()
    dated, coaches = [], {}
    undated = 0
    for row in rows:
        owner = current_coach(owners.get(str(row['learnerId']), {}))
        matches = not query or any(query in str(value or '').casefold() for value in (
            row['learnerName'], row.get('email'), row.get('programme'), row.get('sourceTitle'),
            owner['name'], owner['email'], owner['recordedName'],
        ))
        try:
            assigned = datetime.fromisoformat(str(row.get('assignedAt') or '').replace('Z', '+00:00'))
            if assigned.tzinfo is None:
                raise ValueError('Missing timezone')
        except ValueError:
            undated += int(matches and (not coach_key or owner['key'] == coach_key))
            continue
        assigned_day = assigned.astimezone(UK_TIME).date()
        if not start <= assigned_day <= end:
            continue
        coaches[owner['key']] = {key: owner[key] for key in ('key', 'name', 'email')}
        if not matches or (coach_key and owner['key'] != coach_key):
            continue
        dated.append((assigned_day.isoformat(), assigned, {
            **row, 'coachName': owner['recordedName'] or owner['name'], 'coachEmail': owner['email'],
        }))

    grouped = {}
    for assigned_day, _, row in dated:
        grouped.setdefault(assigned_day, []).append(row)
    summaries = [{'date': value, 'learnerCount': len({str(row['learnerId']) for row in items}),
                  'assignmentCount': len(items)} for value, items in sorted(grouped.items(), reverse=True)]
    day_page_size = 14
    day_pages = max((len(summaries) + day_page_size - 1) // day_page_size, 1)
    day_page = min(max(day_page, 1), day_pages)
    visible_days = summaries[(day_page - 1) * day_page_size:day_page * day_page_size]
    # Do not return a detail page for a date outside the visible selection.
    visible_dates = {item['date'] for item in visible_days}
    selected = sorted((item for item in dated if item[0] == day and day in visible_dates),
                      key=lambda item: (item[1], item[2]['key']), reverse=True)
    pages = max((len(selected) + page_size - 1) // page_size, 1)
    page = min(max(page, 1), pages)
    return {
        'from': start.isoformat(), 'to': end.isoformat(), 'timeZone': 'Europe/London',
        'coaches': sorted(coaches.values(), key=lambda owner: (not bool(owner['email']), owner['name'].casefold(), owner['key'])),
        'days': visible_days, 'day': day, 'dayPage': day_page, 'dayPages': day_pages,
        'totalDays': len(summaries), 'totalLearners': len({str(item[2]['learnerId']) for item in dated}),
        'totalAssignments': len(dated), 'undatedCount': undated,
        'assignments': [item[2] for item in selected[(page - 1) * page_size:page * page_size]],
        'selectedTotal': len(selected), 'page': page, 'pageSize': page_size, 'pages': pages,
    }
