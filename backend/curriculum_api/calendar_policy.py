"""Delivery calendar choices. No I/O and no changes to legacy England rules."""
import hashlib
import json
from datetime import date

DAYS = ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')
COUNTRIES = (
    ('GB', 'England (existing default)', ('Saturday', 'Sunday')),
    ('EG', 'Egypt', ('Friday', 'Saturday')),
    ('SA', 'Saudi Arabia', ('Friday', 'Saturday')),
    ('AE', 'United Arab Emirates', ('Saturday', 'Sunday')),
    ('QA', 'Qatar', ('Friday', 'Saturday')),
    ('KW', 'Kuwait', ('Friday', 'Saturday')),
    ('BH', 'Bahrain', ('Friday', 'Saturday')),
    ('OM', 'Oman', ('Friday', 'Saturday')),
    ('US', 'United States (federal holidays)', ('Saturday', 'Sunday')),
    ('CA', 'Canada (national holidays)', ('Saturday', 'Sunday')),
    ('AU', 'Australia (national holidays)', ('Saturday', 'Sunday')),
)


def read_policy(row):
    row = row or {}
    value = row.get('calendarPolicy') if 'calendarPolicy' in row else row.get('calendar_policy')
    if isinstance(value, str):
        value = json.loads(value) if value else None
    return normalise_policy(value)


def normalise_policy(value):
    """None inherits; an empty list explicitly permits all seven weekdays."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('Calendar settings must be an object, or null to inherit.')
    country = str(value.get('country', 'GB')).upper()
    preset = next((item for item in COUNTRIES if item[0] == country), None)
    if not preset:
        raise ValueError('Choose a supported delivery calendar country.')
    weekend = value.get('weekendDays', list(preset[2]))
    if not isinstance(weekend, list) or any(day not in DAYS for day in weekend):
        raise ValueError('Choose valid weekly rest days.')
    public = value.get('observePublicHolidays', True)
    if not isinstance(public, bool):
        raise ValueError('Observe public holidays must be true or false.')
    excluded = value.get('excludedHolidayIds', [])
    if not isinstance(excluded, list) or len(excluded) > 2000:
        raise ValueError('Invalid holiday exclusions.')
    manual = value.get('manualHolidays', [])
    if not isinstance(manual, list) or len(manual) > 366:
        raise ValueError('Invalid manual closure list.')
    cleaned = []
    for item in manual:
        if not isinstance(item, dict):
            raise ValueError('Each manual closure needs a name and dates.')
        label = str(item.get('label', '')).strip()
        try:
            start = date.fromisoformat(str(item.get('startDate', '')))
            end = date.fromisoformat(str(item.get('endDate') or start.isoformat()))
        except ValueError as exc:
            raise ValueError('Manual closures need valid dates.') from exc
        if not label or len(label) > 200 or end < start or (end - start).days > 730:
            raise ValueError('Check the manual closure name and date range.')
        identity = str(item.get('id') or hashlib.sha256(f'{label}:{start}:{end}'.encode()).hexdigest()[:24])
        if not identity.startswith('manual:'):
            identity = 'manual:' + identity
        cleaned.append(dict(id=identity, label=label, startDate=start.isoformat(), endDate=end.isoformat(), source='authored'))
    return dict(country=country, weekendDays=[day for day in DAYS if day in weekend],
                observePublicHolidays=public, excludedHolidayIds=list(dict.fromkeys(str(x) for x in excluded)),
                manualHolidays=cleaned)


def merge_policy(payload, stored=None):
    """Omitted keeps the saved policy; explicit null restores inheritance."""
    if 'calendarPolicy' in payload or 'calendar_policy' in payload:
        return read_policy(payload)
    return read_policy(stored)


def apply_holiday_choices(policy, holidays):
    """Preserve manual closures even with public holidays switched off."""
    if policy is None:
        return list(holidays or [])
    excluded = set(policy['excludedHolidayIds'])
    return [item for item in [*(holidays or []), *policy['manualHolidays']]
            if str(item.get('id')) not in excluded and
            (policy['observePublicHolidays'] or item.get('source') == 'authored')]


def non_delivery_reason(day, policy, holidays):
    """Custom policy only. The caller retains the original England function."""
    if DAYS[day.weekday()] in policy['weekendDays']:
        return f'{DAYS[day.weekday()]} is a weekly rest day for this delivery calendar.'
    for item in holidays:
        if str(item.get('startDate', '')) <= day.isoformat() <= str(item.get('endDate') or item.get('startDate', '')):
            kind = 'Manual closure' if item.get('source') == 'authored' else 'Public holiday'
            return f"{kind}: {item.get('label') or 'non-delivery date'}."
    return ''
