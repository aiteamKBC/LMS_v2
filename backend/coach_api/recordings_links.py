"""Stable public occurrence IDs over the existing calendar projection.

IDs are locators, never credentials. No schema changes or network requests.
"""
from hashlib import md5
from django.db import router
from django.db.models import F, OuterRef, Subquery, TextField, Value
from django.db.models.fields.json import KeyTextTransform, KeyTransform
from django.db.models.functions import Cast, Concat, Length, MD5
from .models import CoachingCalendarIndex, CoachingCalendarMeeting
from .recordings_calendar_media import event_context,calendar_context


def meeting_id(owner, event):
    return occurrence_id(event_context(owner,event))


def occurrence_id(context):
    context=calendar_context(context['owner'],context['event'],context['start'],context['end'])
    owner,event_id,start=context['owner'],context['event'],context['start']
    # Length-prefixed values avoid delimiter ambiguity. Duration/title changes
    # keep the locator; a different recurrence start is a different occurrence.
    value=f'{len(owner)}:{owner}{len(event_id)}:{event_id}{start}'
    return md5(value.encode(),usedforsecurity=False).hexdigest()


def linked_meeting(identity, owners, start, end):
    database=router.db_for_read(CoachingCalendarIndex) or 'default'
    latest=(CoachingCalendarIndex.objects.using(database).filter(owner_email=OuterRef('snapshot__owner_email'),
      starts_at__lte=start,ends_at__gte=end).order_by('-source_success_at','-key').values('key')[:1])
    event_id=KeyTextTransform('id','event')
    stamp=KeyTextTransform('dateTime',KeyTransform('start','event'))
    value=Concat(Cast(Length('snapshot__owner_email'),TextField()),Value(':'),F('snapshot__owner_email'),
      Cast(Length(event_id),TextField()),Value(':'),event_id,stamp,output_field=TextField())
    # The date and current owner scope bound this SQL lookup. Pick only the
    # newest complete snapshot covering that day, so an older overlapping cache
    # cannot resurrect an occurrence removed from the current calendar.
    return (CoachingCalendarMeeting.objects.using(database).filter(snapshot__owner_email__in=owners,
      snapshot_id=Subquery(latest),starts_at__lt=end,ends_at__gt=start)
      .annotate(public_id=MD5(value)).filter(public_id=identity)
      .values('event','snapshot__owner_email','snapshot__source_success_at').first())
