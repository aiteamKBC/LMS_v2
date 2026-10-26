"""Resolve one saved calendar occurrence with current role/owner checks."""
from datetime import date,datetime,time,timedelta,timezone
import re
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
from django.core import signing
from django.db import DatabaseError
from django.db.models.functions import Lower,Trim
from django.views.decorators.http import require_GET
from learner_api.constants import ACCESS_COACH,ACCESS_CURRICULUM,ACCESS_SUPER_ADMIN
from learner_api.models import LearnerProfile
from login.identity import accesses_for_staff
from login.permissions import require_access
from .recordings_api import _staff,_coaches,_learners,_bookings,_response
from .recordings_links import linked_meeting,meeting_id
from .recordings_calendar import compare_coach_calendar
from .recordings_calendar_media import calendar_reference,event_context,calendar_record
from .recordings_categories import category,lecture_occurrences
from .recordings_jobs import source_details,source_summary


def additional_attendees(event,known):
    """Curriculum may see invited learners beyond this coach's caseload.

    Match only addresses in the server-saved event, and fetch those profiles
    rather than downloading the entire institution's learner directory.
    """
    emails={str((person.get('emailAddress') or {}).get('address') or '').strip().lower()
      for person in event.get('attendees') or []}
    emails-={str(row.get('email') or '').strip().lower() for row in known}
    emails.discard('')
    if not emails:
        return []
    return list(LearnerProfile.objects.annotate(address=Lower(Trim('email'))).filter(address__in=emails)
      .values('id','email','full_name','coach_email','learner_type'))


@require_GET
@require_access(ACCESS_CURRICULUM,ACCESS_COACH)
def coaching_linked_meeting(request,identity):
    try:
        if not re.fullmatch(r'[a-f0-9]{32}',identity):
            raise ValueError()
        zone=ZoneInfo(request.GET.get('timeZone','Europe/London'))
        day=date.fromisoformat(request.GET.get('date',''))
        start=datetime.combine(day,time.min,zone).astimezone(timezone.utc)
        end=datetime.combine(day+timedelta(days=1),time.min,zone).astimezone(timezone.utc)
    except (ValueError,TypeError,OverflowError,ZoneInfoNotFoundError):
        return _response({'error':'This meeting link has an invalid date, time zone or ID.','code':'invalid_meeting_link'},400)
    try:
        staff=_staff(request.login_account)
        grants=accesses_for_staff(staff) if staff else frozenset()
        all_access=bool(grants & {ACCESS_CURRICULUM,ACCESS_SUPER_ADMIN})
        if not all_access and ACCESS_COACH not in grants:
            return _response({'error':'Access denied.','code':'forbidden'},403)
        coaches=_coaches() if all_access else [{'email':str(staff.email or '').strip().lower(),'name':staff.username or staff.email}]
        saved=linked_meeting(identity,[row['email'] for row in coaches],start,end)
        if not saved:
            return _response({'error':'This meeting is not in the latest saved calendar for this date, or you do not have access. It may have moved.','code':'meeting_link_not_found'},404)
        owner=saved['snapshot__owner_email'];event=saved['event']
        if owner not in {coach['email'] for coach in coaches} or meeting_id(owner,event)!=identity:
            return _response({'error':'This saved meeting identity could not be verified.','code':'meeting_link_not_found'},404)
        learners=_learners(owner)
        if all_access:
            learners=list({str(person['id']):person for person in [*learners,*additional_attendees(event,learners)]}.values())
        bookings=_bookings(owner,start,end)
        compared=compare_coach_calendar([event],bookings,learners,coach_email=owner,start=start,end=end,now=datetime.now(timezone.utc))
        if not compared['complete'] or len(compared['meetings'])!=1:
            return _response({'error':'This saved meeting could not be verified.','code':'meeting_link_not_found'},404)
        row=compared['meetings'][0]
        context=event_context(owner,event)
        row['meetingId']=identity
        row['recordingsReference']=calendar_reference(context)
        row['category'],row['categorySource']=category(row,event,lecture_occurrences(start,end))
        row['media']=source_summary(source_details(calendar_record(context)))
        row['readyToAction']=row['phase']=='ended' and row['media']['readyCount']>0
        if row['eventKey'] and row['match']=='matched' and row['phase']!='cancelled':
            row['analysisContext']=signing.dumps({**{key:row[key] for key in ('eventKey','startsAt','endsAt','title')},
              'graphEventId':event['id']},salt='coaching-quality-title',compress=True)
        return _response({'meeting':row,'coach':next(coach for coach in coaches if coach['email']==owner),
          'learners':[{'id':str(person['id']),'name':person['full_name']} for person in learners if str(person['id']) in row['learnerIds']],
          'syncedAt':saved['snapshot__source_success_at'].isoformat()})
    except DatabaseError:
        return _response({'error':'The saved meeting could not be loaded. Please retry.','code':'meeting_link_unavailable'},503)
