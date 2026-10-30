"""Calendar clock conversion without machine-local defaults or DST guesses."""
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


WINDOWS_TO_IANA = {
    'GMT Standard Time': 'Europe/London',
    'Egypt Standard Time': 'Africa/Cairo',
    'UTC': 'UTC',
    'W. Europe Standard Time': 'Europe/Berlin',
    'Romance Standard Time': 'Europe/Paris',
    'Arabian Standard Time': 'Asia/Dubai',
    'Eastern Standard Time': 'America/New_York',
    'Pacific Standard Time': 'America/Los_Angeles',
}


def calendar_zone(name):
    """Accept saved Microsoft or IANA IDs; never replace an unknown zone."""
    try:
        return ZoneInfo(WINDOWS_TO_IANA.get(name, name))
    except (ZoneInfoNotFoundError, ValueError, TypeError) as exc:
        raise ValueError('The calendar time zone is unavailable. Check its saved time zone.') from exc


def local_clock_to_utc(value: datetime, zone_name: str):
    """Resolve a civil clock only when it names exactly one instant.

    Explicit offsets already select an instant (including either autumn fold).
    A naive gap/fold must be corrected or supplied with an explicit offset.
    """
    zone = calendar_zone(zone_name)
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc)
    candidates = set()
    for fold in (0, 1):
        instant = value.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
        if instant.astimezone(zone).replace(tzinfo=None) == value:
            candidates.add(instant)
    if not candidates:
        raise ValueError('This local time does not exist because the clocks move forward. Choose another time.')
    if len(candidates) > 1:
        raise ValueError('This local time occurs twice because the clocks move back. Choose another time or supply an explicit offset.')
    return candidates.pop()
