"""Small current projection for the existing evidence response; no new requests."""
from datetime import timedelta
from django.db import DatabaseError
from django.utils import timezone
from .models import CoachingCompletionSession
from .recordings_media import session_window


def completion_summary(record):
    start,end=session_window(record)
    if not start or not end or not getattr(record,'graph_event_id',None):
        return {'state':'unverified','source':'aptem'}
    try:
        rows=list(CoachingCompletionSession.objects.filter(
            owner_email=str(record.owner_email).strip().lower(),event_id=record.graph_event_id,
            starts_at=start,ends_at=end).values('state','checked_at')[:101])
    except DatabaseError:
        return {'state':'unavailable','source':'aptem'}
    if not rows or len(rows)>100 or any(row['checked_at']<timezone.now()-timedelta(hours=1) for row in rows):
        return {'state':'unverified','source':'aptem'}
    states={row['state'] for row in rows}
    state=(next(iter(states)) if len(states)==1 else 'mixed')
    return {'state':state,'source':'aptem','checkedAt':min(row['checked_at'] for row in rows).isoformat()}
