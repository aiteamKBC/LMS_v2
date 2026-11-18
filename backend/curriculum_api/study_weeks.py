"""Calendar study weeks for explicitly opted-in modules only (no database I/O)."""
from datetime import date, timedelta
from .weekly_schedule import WEEKDAYS, normalise_week_starts_on


def study_week_anchor(start, weekday):
    if not isinstance(start, date):
        start = date.fromisoformat(str(start))
    day = normalise_week_starts_on(weekday)
    if not day:
        raise ValueError('Choose the first day of the study week.')
    return start - timedelta(days=(start.weekday() - WEEKDAYS.index(day)) % 7)


def study_week_end_date(start, weeks, weekday):
    if not start or not weeks:
        return ''
    if not 1 <= int(weeks) <= 104:
        raise ValueError('Choose between 1 and 104 study weeks.')
    return (study_week_anchor(start, weekday) + timedelta(days=int(weeks) * 7 - 1)).isoformat()


def build_study_week_plan(start, weeks, days, holidays_by_date, weekday, end=None):
    """A partial opening week counts as week 1, even without a live slot.

    Public/manual closures pause automatic live delivery for their whole week.
    Rest days are not holiday rows, so do not close whole study weeks.
    """
    if not 1 <= weeks <= 104:
        raise ValueError('Choose between 1 and 104 study weeks.')
    anchor = study_week_anchor(start, weekday)
    if end and end > anchor + timedelta(days=weeks * 7 - 1):
        raise ValueError('The end date must fall within the final study week. Adjust the number of weeks or the end date.')
    if end and end < max(start, anchor + timedelta(days=(weeks - 1) * 7)):
        raise ValueError('The end date must fall within the final study week. Adjust the number of weeks or the end date.')
    end = min(end, anchor + timedelta(days=weeks * 7 - 1)) if end else anchor + timedelta(days=weeks * 7 - 1)
    sessions, slots, windows, skipped = [], [], [], []
    for index in range(weeks):
        window_start = max(start, anchor + timedelta(days=index * 7))
        window_end = min(end, anchor + timedelta(days=index * 7 + 6))
        holidays = []
        seen = set()
        for day, rows in sorted(holidays_by_date.items()):
            if window_start <= day <= window_end:
                skipped.append(day.isoformat())
                for row in rows:
                    identity = (row.get('id'), row.get('label'), row.get('startDate'), row.get('endDate'))
                    if identity not in seen:
                        seen.add(identity)
                        holidays.append(row)
        windows.append({'weekNumber': index + 1, 'startDate': window_start.isoformat(),
                        'endDate': window_end.isoformat(), 'holidays': holidays, 'holidayWeek': bool(holidays)})
        cursor = window_start
        while cursor <= window_end:
            if cursor.weekday() in days:
                session_number = None
                if not holidays:
                    session_number = len(sessions) + 1
                    sessions.append({'sessionNumber': session_number, 'weekNumber': index + 1,
                                     'date': cursor.isoformat(), 'day': WEEKDAYS[cursor.weekday()],
                                     'slotDate': cursor.isoformat(), 'slotDay': WEEKDAYS[cursor.weekday()],
                                     'skippedHolidays': []})
                slots.append({'slotNumber': len(slots) + 1, 'weekNumber': index + 1,
                              'date': cursor.isoformat(), 'day': WEEKDAYS[cursor.weekday()],
                              'type': 'reading-week' if holidays else 'live-session',
                              'cause': 'holiday' if holidays else '', 'sessionNumber': session_number,
                              'holidays': holidays})
            cursor += timedelta(days=1)
    last_live = sessions[-1]['date'] if sessions else ''
    return {'sessions': sessions, 'slots': slots, 'weeks': windows, 'skippedHolidays': sorted(set(skipped)),
            'finalEndDate': last_live, 'originalEndDate': last_live, 'calendarEndDate': end.isoformat(), 'warnings': []}
