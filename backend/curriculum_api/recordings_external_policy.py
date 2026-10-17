"""Identity and occurrence boundaries for recordings without an LMS link."""
import html
import re
from .recordings_calendar_policy import meeting_key
from .session_results_policy import instant


def event_join_url(event):
    direct = (event.get('onlineMeeting') or {}).get('joinUrl') or event.get('onlineMeetingUrl')
    if meeting_key(direct):
        return direct
    links = re.findall(r'https://teams\.microsoft\.com/(?:l/meetup-join|meet)/[^\s<>"\']+',
                       html.unescape((event.get('body') or {}).get('content') or ''))
    unique = {meeting_key(link): link for link in links if meeting_key(link)}
    return next(iter(unique.values())) if len(unique) == 1 else None


def occurrence_recordings(rows, start, end):
    """Recurring meeting APIs return the whole series: retain overlapping recordings only."""
    start, end = instant(start), instant(end)
    if not start or not end or end <= start:
        raise ValueError('Invalid event interval.')
    found, seen = [], set()
    for row in rows:
        first, last = instant(row.get('createdDateTime')), instant(row.get('endDateTime'))
        if not row.get('id') or not first or not last or not first < last or not (first < end and last > start):
            continue
        identity = (row.get('contentCorrelationId') or row['id'], first, last)
        if identity not in seen:
            seen.add(identity)
            found.append(row)
    return sorted(found, key=lambda row: row['createdDateTime'])
