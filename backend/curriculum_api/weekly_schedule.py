"""The weekly pattern for one module, independent of its group's defaults."""
import json
import re
from datetime import date, datetime, timedelta

WEEKDAYS = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')


def normalise_week_starts_on(value):
    """None keeps the historical week boundary; supplied days must be explicit."""
    if value is None or value == '':
        return None
    for day in WEEKDAYS:
        if isinstance(value, str) and value.strip().lower() == day.lower():
            return day
    raise ValueError('Choose a valid day for the start of the week.')


def module_week_starts_on(module):
    module = module or {}
    value = module.get('weekStartsOn') if 'weekStartsOn' in module else module.get('week_starts_on')
    return normalise_week_starts_on(value)


def merged_week_starts_on(payload, current):
    if 'weekStartsOn' in payload or 'week_starts_on' in payload:
        return module_week_starts_on(payload)
    return module_week_starts_on(current)


def first_weekly_session_day(start, weekly):
    """The first live slot on/after the module start, independent of locale."""
    if isinstance(start, datetime):
        start = start.date()
    if not isinstance(start, date):
        try:
            start = date.fromisoformat(str(start or ''))
        except ValueError:
            return None
    days = {slot['day'] for slot in weekly}
    return next((WEEKDAYS[(start + timedelta(days=offset)).weekday()] for offset in range(7)
                 if WEEKDAYS[(start + timedelta(days=offset)).weekday()] in days), None)


def normalise_weekly_schedule(value):
    if value is None or value == '':
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError) as exc:
            raise ValueError('Weekly schedule must be a list of days and times.') from exc
    if not isinstance(value, list) or len(value) > 7:
        raise ValueError('Weekly schedule must contain at most seven days.')
    slots = {}
    for item in value:
        if not isinstance(item, dict):
            raise ValueError('Each weekly session needs a day, start time and end time.')
        day = next((name for name in WEEKDAYS if str(item.get('day', '')).strip().lower() in (name.lower(), name[:3].lower())), '')
        if not day or day in slots:
            raise ValueError('Choose a different weekday for each weekly session.')
        times = []
        for key in ('startTime', 'endTime'):
            raw = str(item.get(key, '')).strip()
            if not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d(?::00)?', raw):
                raise ValueError(f'Set a valid {key} for {day}.')
            times.append(raw[:5])
        if times[1] <= times[0]:
            raise ValueError(f'The end time on {day} must be after the start time.')
        slots[day] = {'day': day, 'startTime': times[0], 'endTime': times[1]}
    return [slots[day] for day in WEEKDAYS if day in slots]


def weekly_schedule_value(module):
    module = module or {}
    for key in ('weeklySchedule', 'weekly_schedule'):
        if key in module:
            return module[key]
    return (module.get('deliveryMetadata') or {}).get('weeklySchedule')


def module_weekly_schedule(module):
    return normalise_weekly_schedule(weekly_schedule_value(module))


def merged_weekly_schedule(payload, current):
    """Explicit slots win; an older client changing a shared clock resets them."""
    if weekly_schedule_value(payload) is not None:
        return module_weekly_schedule(payload)
    for camel, snake in (('weekDays', 'session_week_day'), ('startTime', 'session_start_time'), ('endTime', 'session_end_time')):
        if camel in payload or snake in payload:
            requested = payload.get(camel, payload.get(snake))
            existing = current.get(camel, current.get(snake))
            if requested and str(requested).strip() != str(existing or '').strip():
                return []
    return module_weekly_schedule(current)
