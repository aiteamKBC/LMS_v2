"""Calendar validation with no database, Django or transport side effects."""
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlencode, urlparse
from zoneinfo import ZoneInfo


class CalendarMismatch(RuntimeError):
    """Microsoft answered, but its calendar differs from the reviewed plan."""


def utc_datetime(value):
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)


def graph_calendar_time(value, zone_name, graph_zone):
    instant = utc_datetime(value)
    local = instant.astimezone(ZoneInfo(zone_name))
    # A repeated autumn clock has two instants. UTC keeps that choice explicit.
    if local.replace(fold=0).utcoffset() != local.replace(fold=1).utcoffset():
        return {'dateTime': instant.replace(tzinfo=None).isoformat(timespec='seconds'), 'timeZone': 'UTC'}
    return {'dateTime': local.replace(tzinfo=None).isoformat(timespec='seconds'), 'timeZone': graph_zone}


def calendar_targets(payload, start, duration, repeat, count, zone_name):
    supplied = payload.get('scheduledOccurrences')
    if supplied is not None and (not isinstance(supplied, list) or not supplied):
        raise ValueError('Supply at least one session to review.')
    targets = []
    if supplied:
        for item in supplied:
            number = int(item['sessionNumber'])
            minutes = int(item.get('durationMinutes') or duration)
            instant = utc_datetime(item['startDateTimeUtc'])
            if number < 1 or not 15 <= minutes <= 1440:
                raise ValueError('Each session needs a positive number and a duration from 15 to 1440 minutes.')
            targets.append({'session_number': number, 'start': instant, 'end': instant + timedelta(minutes=minutes)})
    else:
        local = utc_datetime(start).astimezone(ZoneInfo(zone_name))
        for index in range(count if repeat != 'none' else 1):
            instant = local.astimezone(timezone.utc)
            targets.append({'session_number': index + 1, 'start': instant, 'end': instant + timedelta(minutes=duration)})
            local += timedelta(days=7 if repeat == 'weekly' else 1)
            while repeat == 'weekdays' and local.weekday() > 4:
                local += timedelta(days=1)
    if not targets or len(targets) > 52 or (repeat == 'none' and len(targets) != 1):
        raise ValueError('Review a maximum of 52 sessions, with one session for a non-repeating meeting.')
    if len({t['session_number'] for t in targets}) != len(targets):
        raise ValueError('Session numbers must be unique.')
    targets.sort(key=lambda t: t['start'])
    if targets[0]['start'] != utc_datetime(start):
        raise ValueError('The meeting start must match the first reviewed session.')
    for previous, current in zip(targets, targets[1:]):
        if current['start'] < previous['end']:
            raise ValueError('Reviewed sessions must not overlap or repeat the same time.')
    return targets


def local_calendar_recurrence(targets, repeat, zone_name, graph_zone):
    """Derive weekdays in the business zone, separately for every DST offset."""
    if repeat == 'none':
        return None
    zone = ZoneInfo(zone_name)
    local = [target['start'].astimezone(zone) for target in targets]
    first, last = local[0].date(), local[-1].date()
    names = list(dict.fromkeys(item.strftime('%A').lower() for item in local))
    if repeat == 'daily':
        pattern = {'type': 'daily', 'interval': 1}
    else:
        if repeat == 'weekdays':
            names = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
        pattern = {'type': 'weekly', 'interval': 1, 'daysOfWeek': names}
    slots = sum(1 for day in range((last - first).days + 1)
                if repeat == 'daily' or (first + timedelta(days=day)).strftime('%A').lower() in names)
    if slots > 52:
        raise ValueError('The reviewed calendar spans more than 52 recurrence slots. Shorten the calendar before sending.')
    return {'pattern': pattern, 'range': {'type': 'numbered', 'startDate': first.isoformat(),
            'numberOfOccurrences': slots, 'recurrenceTimeZone': graph_zone}}


def safe_teams_join_url(value):
    try:
        parsed = urlparse(str(value or ''))
        return (parsed.scheme == 'https' and not parsed.username and not parsed.password
                and parsed.hostname in {'teams.microsoft.com', 'teams.live.com', 'teams.cloud.microsoft'}
                and parsed.port in (None, 443) and bool(parsed.path.strip('/')))
    except ValueError:
        return False


def event_instant(event, field):
    value = event.get(field) or {}
    try:
        raw = datetime.fromisoformat(str(value.get('dateTime', '')).replace('Z', '+00:00'))
    except (ValueError, TypeError) as exc:
        raise CalendarMismatch('Microsoft returned an invalid session time.') from exc
    if raw.tzinfo is None:
        name = value.get('timeZone') or 'UTC'
        aliases = {'GMT Standard Time': 'Europe/London', 'Egypt Standard Time': 'Africa/Cairo',
                   'W. Europe Standard Time': 'Europe/Berlin', 'Romance Standard Time': 'Europe/Paris',
                   'Arabian Standard Time': 'Asia/Dubai'}
        try:
            raw = raw.replace(tzinfo=ZoneInfo(aliases.get(name, name)))
        except KeyError as exc:
            raise CalendarMismatch('Microsoft returned an unsupported calendar time zone.') from exc
    return raw.astimezone(timezone.utc)


def verify_calendar(request, owner, event_id, targets, expected_join_url='', recurring=True):
    """Read Microsoft before publishing invitations or confirming local dates."""
    path = f'users/{owner}/events/{quote(event_id, safe="")}'
    event = request('GET', path)
    join_url = (event.get('onlineMeeting') or {}).get('joinUrl') or ''
    if event.get('isCancelled') or not safe_teams_join_url(join_url):
        raise CalendarMismatch('The Teams meeting is cancelled or its join link could not be verified.')
    if expected_join_url and expected_join_url != join_url:
        raise CalendarMismatch('Microsoft returned a different join link. Invitations were not updated.')
    if event.get('hideAttendees') is not True:
        raise CalendarMismatch('Microsoft has not confirmed attendee privacy. Invitations were not updated.')
    if recurring:
        query = urlencode({'startDateTime': (targets[0]['start'] - timedelta(days=7)).isoformat(),
                           'endDateTime': (targets[-1]['end'] + timedelta(days=7)).isoformat(), '$top': 200})
        response = request('GET', path + '/instances?' + query)
        if response.get('@odata.nextLink'):
            raise CalendarMismatch('Microsoft returned an incomplete calendar. Review it before sending invitations.')
        instances = response.get('value') or []
    else:
        instances = [event]
    available = list(instances)
    for target in targets:
        matches = [item for item in available if event_instant(item, 'start') == target['start']]
        if len(matches) != 1:
            raise CalendarMismatch(f"Session {target['session_number']} is missing or duplicated on Microsoft. Invitations were not updated.")
        match = matches[0]
        if event_instant(match, 'end') != target['end']:
            raise CalendarMismatch(f"Session {target['session_number']} has a different end time on Microsoft.")
        if match.get('isCancelled') or (match.get('onlineMeeting') or {}).get('joinUrl') != join_url:
            raise CalendarMismatch(f"Session {target['session_number']} does not have the reviewed Teams join link.")
        if match.get('hideAttendees') is False:
            raise CalendarMismatch(f"Session {target['session_number']} exposes its attendee list.")
        available.remove(match)
    if available:
        raise CalendarMismatch('Microsoft still contains extra sessions. Invitations were not updated.')
    return event


def publish_attendees(request, owner, event, attendees):
    """An attendee-only patch avoids reapplying the recurrence on people saves."""
    def addresses(items):
        return {str((item.get('emailAddress') or {}).get('address') or '').strip().lower() for item in items}
    if addresses(event.get('attendees') or []) == addresses(attendees):
        return
    path = f'users/{owner}/events/{quote(event["id"], safe="")}'
    request('PATCH', path, payload={'attendees': attendees})
    confirmed = request('GET', path)
    if addresses(confirmed.get('attendees') or []) != addresses(attendees):
        raise RuntimeError('Microsoft did not confirm the full invitation list. Check the calendar before retrying.')
