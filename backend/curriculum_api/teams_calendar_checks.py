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


def attendee_addresses(items):
    """The email addresses on an invitation list, however each entry is written."""
    found = set()
    for item in items or []:
        raw = (item.get('emailAddress') or {}).get('address') if isinstance(item, dict) else item
        address = str(raw or '').strip().lower()
        if address:
            found.add(address)
    return found


def event_organizer_address(event):
    """The mailbox that owns an event, as Microsoft reports it."""
    organizer = (event or {}).get('organizer') or {}
    return str((organizer.get('emailAddress') or {}).get('address') or '').strip().lower()


def attendees_already_match(requested, confirmed, organizer=''):
    """Whether an event already holds exactly the people a save wants on it.

    Strict, because this decides whether to write at all: swapping one invitee
    for another is a real change to make, and only the organizer -- who is
    never an attendee of their own event -- is left out of the comparison.
    """
    owner = {str(organizer or '').strip().lower()} - {''}
    return attendee_addresses(requested) - owner == attendee_addresses(confirmed) - owner


def attendee_differences(requested, confirmed, organizer=''):
    """What is really missing from, or extra on, Microsoft's copy of a list.

    Microsoft does not always store an address exactly as it was sent. An
    internal alias comes back as that mailbox's primary address, and a
    meeting's own organizer is never listed among its attendees. Neither means
    an invitation was lost, yet a character-by-character comparison read both
    as a failed publish -- so one pasted alias could block every later people
    save on that module, including removing somebody.

    So the organizer is not expected back, and each requested address
    Microsoft answered with an address of its own is paired with it: one
    mailbox under the spelling Microsoft chose, not a lost learner and not a
    gate-crasher. Whatever is still unaccounted for is returned, and it is
    genuinely wrong.
    """
    owner = {str(organizer or '').strip().lower()} - {''}
    wanted = attendee_addresses(requested) - owner
    held = attendee_addresses(confirmed) - owner
    missing, extra = sorted(wanted - held), sorted(held - wanted)
    paired = min(len(missing), len(extra))
    return missing[paired:], extra[paired:]


def unconfirmed_attendee_detail(missing, extra):
    """Name the addresses, so a real failure can be acted on from the message."""
    parts = []
    if missing:
        parts.append('not invited: ' + ', '.join(missing))
    if extra:
        parts.append('invited but not requested: ' + ', '.join(extra))
    return '; '.join(parts)


def publish_attendees(request, owner, event, attendees, *, extra_headers=None, always=False):
    """An attendee-only patch avoids reapplying the recurrence on people saves.

    Returns whether the invitation list was actually written. A caller that
    re-verifies the calendar afterwards only has to do so when something was
    sent; an unchanged list leaves the calendar exactly as the verification
    before this call found it -- and, because nothing is written, Microsoft has
    nothing to mail either.

    ``extra_headers`` carries the caller's invitation preference, so that
    correcting who belongs to a meeting and deciding whether Microsoft announces
    it stay two separate decisions. Membership is never traded for silence.

    ``always`` writes even when the list already matches. A session created
    silently already has its people on it, and skipping the write there would
    leave a meeting whose attendees are correct and whose attendees were never
    told -- Microsoft only delivers a meeting to someone when something is sent.
    """
    organizer = event_organizer_address(event)
    if not always and attendees_already_match(attendees, event.get('attendees'), organizer):
        return False
    path = f'users/{owner}/events/{quote(event["id"], safe="")}'
    request('PATCH', path, payload={'attendees': attendees}, extra_headers=extra_headers)
    confirmed = request('GET', path)
    missing, extra = attendee_differences(
        attendees, confirmed.get('attendees'), organizer or event_organizer_address(confirmed),
    )
    if missing or extra:
        raise RuntimeError(
            'Microsoft did not confirm the full invitation list '
            f'({unconfirmed_attendee_detail(missing, extra)}). Check the calendar before retrying.'
        )
    return True
