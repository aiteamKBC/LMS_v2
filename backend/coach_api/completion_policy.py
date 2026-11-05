"""Pure Aptem completion reminder rules; no IO or inference from missing AI."""
from datetime import timedelta
from hashlib import sha256
from urllib.parse import urlencode

FAMILIES = {'monthly_coaching': 'MCM', 'progress_review': 'PR'}
ACTION_STATUSES = {'scheduled', 'in progress'}


def completion_state(status):
    value = str(status or '').strip().casefold()
    if value == 'completed':
        return 'completed'
    if value == 'awaiting signature':
        return 'awaiting-signature'
    return 'action-required' if value in ACTION_STATUSES else 'unverified'


def session_key(component_id, meeting_id, owner):
    return sha256(f'{int(component_id)}\0{meeting_id}\0{owner.strip().lower()}'.encode()).hexdigest()


def stage_for(ends_at, now):
    elapsed = now - ends_at
    return 72 if elapsed >= timedelta(hours=72) else 24 if elapsed >= timedelta(hours=24) else None


def calendar_link(session, *, workspace='coach', zone='Europe/London'):
    from zoneinfo import ZoneInfo
    from .recordings_links import occurrence_id
    identity = occurrence_id({'owner': session.owner_email, 'event': session.event_id,
        'start': session.starts_at.isoformat(), 'end': session.ends_at.isoformat()})
    day = session.starts_at.astimezone(ZoneInfo(zone)).date().isoformat()
    path = '/coach/recordings' if workspace == 'coach' else f'/{workspace}/coaching-recordings'
    return path + '?' + urlencode({
        'date': day, 'view': 'day', 'zone': zone, 'status': 'all', 'meeting': identity, 'on': day})
