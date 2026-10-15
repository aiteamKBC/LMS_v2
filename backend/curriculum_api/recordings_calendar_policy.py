"""Read-only calendar comparison; titles never establish meeting identity."""
import html
import re
from urllib.parse import unquote, urlsplit
from zoneinfo import ZoneInfo
from .session_results_policy import instant


def meeting_key(value):
    try:
        url = urlsplit(value or '')
        path = unquote(url.path).rstrip('/')
        if url.scheme == 'https' and url.hostname == 'teams.microsoft.com' and path.startswith(('/l/meetup-join/', '/meet/')):
            return path
    except ValueError:
        pass
    return None


def event_meeting_key(event):
    direct = (event.get('onlineMeeting') or {}).get('joinUrl') or event.get('onlineMeetingUrl')
    if meeting_key(direct):
        return meeting_key(direct)
    # Attendee calendar copies commonly omit onlineMeeting; the invitation keeps its link.
    body = html.unescape((event.get('body') or {}).get('content') or '')
    keys = set()
    for value in re.findall(r'https://teams\.microsoft\.com/(?:l/meetup-join|meet)/[^\s<>"\']+', body):
        key = meeting_key(value)
        if key:
            keys.add(key)
    return next(iter(keys)) if len(keys) == 1 else None


def compare_calendar(events, occurrences, series, start, end, zone):
    zone = ZoneInfo(zone)
    linked_keys = {meeting_key(row.get('join_url')) for row in series} - {None}
    matched, unmatched, seen = [], [], set()
    for event in events:
        when = instant((event.get('start') or {}).get('dateTime'))
        until = instant((event.get('end') or {}).get('dateTime'))
        if not when or not until or not start <= when < end:
            continue
        key = event_meeting_key(event)
        matches = [row for row in occurrences if key and meeting_key(row.get('join_url')) == key
                   and instant(row.get('scheduled_start')) == when and instant(row.get('scheduled_end')) == until
                   and (row.get('status') == 'cancelled') == bool(event.get('isCancelled'))]
        identity = (key or event.get('id'), when, until)
        if identity in seen:
            continue
        seen.add(identity)
        if len(matches) == 1:
            matched.append({'occurrenceId': matches[0]['id'], 'moduleId': matches[0]['module_catalogue_id'],
                            'title': str(event.get('subject') or 'Untitled meeting')})
        else:
            reason = ('More than one LMS session uses this meeting and time; review the duplicate links.' if len(matches) > 1
                      else 'This calendar event has no Teams meeting link.' if not key
                      else 'The meeting is linked, but its date, time or cancellation state does not match the LMS.' if key in linked_keys
                      else 'This Teams meeting is not linked to an LMS module.')
            unmatched.append({'eventId': event.get('id'), 'startsAt': when.isoformat(), 'endsAt': until.isoformat(),
                              'title': str(event.get('subject') or 'Untitled event'),
                              'date': when.astimezone(zone).date().isoformat(),
                              'startTime': when.astimezone(zone).strftime('%H:%M'),
                              'endTime': until.astimezone(zone).strftime('%H:%M'),
                              'cancelled': bool(event.get('isCancelled')), 'reason': reason})
    return {'matched': matched, 'unmatched': sorted(unmatched, key=lambda row: (row['date'], row['startTime'], row['title']))}
