"""Display categories only: never change a booking, review type or meeting."""
import re

from django.db import connections, router
from curriculum_api.models import LiveSessionOccurrence
from curriculum_api.recordings_calendar_policy import meeting_key, event_meeting_key
from curriculum_api.session_results_policy import instant as curriculum_instant

from .recordings_calendar import _event_instant, _instant
from .recordings_cache import recent_read


def lecture_occurrences(start, end):
    def read():
        database = router.db_for_read(LiveSessionOccurrence) or 'default'
        with connections[database].cursor() as cursor:
            cursor.execute('''SELECT o.graph_event_id,COALESCE(NULLIF(o.join_url,''),s.join_url),
                o.scheduled_start,o.scheduled_end
                FROM curriculum.live_session_occurrences o
                JOIN curriculum.live_sessions s ON s.id=o.live_session_id
                WHERE s.status NOT IN ('deleted','superseded','failed')
                AND o.scheduled_start<%s AND o.scheduled_end>%s
                ORDER BY o.scheduled_start,o.id''', [end.replace(tzinfo=None), start.replace(tzinfo=None)])
            return [{'event': row[0], 'link': meeting_key(row[1]), 'start': curriculum_instant(row[2]), 'end': curriculum_instant(row[3])}
                    for row in cursor.fetchall()]
    return recent_read('lecture-identities', [start, end], read)


def category(row, event, lectures):
    if row.get('family') in ('MCM', 'PR', 'SUPPORT'):
        return row['family'], 'lms-booking'
    start = _instant(row.get('startsAt')) or _event_instant(event.get('start'))
    end = _instant(row.get('endsAt')) or _event_instant(event.get('end'))
    link = event_meeting_key(event)
    if any(item['start'] == start and item['end'] == end
           and (bool(item['event'] and item['event'] == event.get('id'))
                or bool(link and item['link'] == link)) for item in lectures):
        return 'LECTURE', 'curriculum'
    title = row.get('title') or ''
    kinds = [kind for kind, pattern in (
        ('MCM', r'\b(?:monthly\s+coaching(?:\s+(?:meeting|review))?|MCM|MCR|MSM)\b'),
        ('PR', r'\b(?:progress\s+review|PR|BR)\b'),
        ('SUPPORT', r'\b(?:(?:student|learner)\s+support|support\s+(?:session|meeting))\b'),
    ) if re.search(pattern, title, re.IGNORECASE)]
    return (kinds[0], 'calendar-title') if len(kinds) == 1 else ('OTHER', 'calendar-title' if kinds else 'other')
