"""Small, atomically published calendar read model. No Microsoft calls or caches."""
from hashlib import sha256

from django.db import router, transaction
from django.db.models import FilteredRelation, Q

from curriculum_api.recordings_external_policy import event_join_url
from .models import CoachingCalendarIndex, CoachingCalendarMeeting
from .recordings_calendar import _instant, _email
from .recordings_calendar_media import event_context


def thin_event(owner, event):
    """Keep only fields used by calendar matching; preserve UTC occurrence identity."""
    context = event_context(owner, event)
    def address(person):
        return {'emailAddress': {'address': _email((person.get('emailAddress') or {}).get('address'))}}
    result = {
        'id': context['event'], 'subject': str(event.get('subject') or '')[:1000],
        'start': {'dateTime': context['start'], 'timeZone': 'UTC'},
        'end': {'dateTime': context['end'], 'timeZone': 'UTC'},
        'isCancelled': bool(event.get('isCancelled')),
        'organizer': address(event.get('organizer') or {}),
        'attendees': [address(person) for person in event.get('attendees') or []],
    }
    link = event_join_url(event)
    if link:
        result['onlineMeeting'] = {'joinUrl': link}
    return context, result


def publish_calendar_index(key, context, events, source_success_at, *, using=None):
    """Replace one complete projection; a bad page never publishes a partial view."""
    owner = _email(context['owner'])
    start, end = _instant(context['start']), _instant(context['end'])
    stamp = _instant(source_success_at)
    if not owner or not start or not end or end <= start or not stamp or not isinstance(events, list):
        raise ValueError('Invalid complete calendar index source.')
    rows, seen = [], set()
    for event in events:
        occurrence, projected = thin_event(owner, event)
        # Match the calendar comparator's existing first-occurrence semantics.
        identity = (occurrence['event'], occurrence['start'])
        if identity in seen:
            continue
        seen.add(identity)
        row_key = sha256((key + '\0' + '\0'.join(identity)).encode()).hexdigest()
        rows.append(CoachingCalendarMeeting(key=row_key, snapshot_id=key,
            starts_at=_instant(occurrence['start']), ends_at=_instant(occurrence['end']), event=projected))
    database = using or router.db_for_write(CoachingCalendarIndex) or 'default'
    with transaction.atomic(using=database):
        CoachingCalendarIndex.objects.using(database).update_or_create(key=key, defaults={
            'owner_email': owner, 'starts_at': start, 'ends_at': end,
            'source_success_at': stamp, 'event_count': len(rows)})
        CoachingCalendarMeeting.objects.using(database).filter(snapshot_id=key).delete()
        CoachingCalendarMeeting.objects.using(database).bulk_create(rows, batch_size=500)
    return len(rows)


def indexed_calendars(jobs, start, end):
    """One SQL snapshot, including empty calendars; missing generations fall back."""
    selected = Q()
    for job in jobs:
        if job.last_success_at:
            selected |= Q(key=job.key, owner_email=job.owner_email, source_success_at=job.last_success_at,
                          starts_at__lte=start, ends_at__gte=end)
    if not selected:
        return {}
    database = router.db_for_read(CoachingCalendarIndex) or 'default'
    # The LEFT JOIN keeps successful empty calendars distinct from absent indexes.
    # Both the version and its filtered events are read in the same SQL statement.
    rows = (CoachingCalendarIndex.objects.using(database).filter(selected)
        .annotate(visible=FilteredRelation('meetings', condition=Q(meetings__starts_at__lt=end, meetings__ends_at__gt=start)))
        .order_by('key', 'visible__starts_at', 'visible__key').values('key', 'visible__event'))
    result = {}
    for row in rows:
        events = result.setdefault(row['key'], [])
        if row['visible__event'] is not None:
            events.append(row['visible__event'])
    return result
