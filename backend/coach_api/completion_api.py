"""Current-user completion inbox. Local reads only; no Graph/source scans."""
import json
from datetime import timedelta
from django.db import DatabaseError
from django.db.models.functions import Lower,Trim
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_protect
from learner_api.constants import ACCESS_COACH
from learner_api.models import LearnerProfile
from login.permissions import require_access
from .recordings_api import _staff
from login.identity import accesses_for_staff
from .models import CoachingCompletionReminder as Reminder
from .completion_policy import calendar_link


def response(data,status=200):
    result=JsonResponse(data,status=status);result['Cache-Control']='private, no-store';return result


@require_http_methods(['GET','POST'])
@require_access(ACCESS_COACH)
@csrf_protect
def completion_notifications(request):
    try:
        staff=_staff(request.login_account)
        if not staff or ACCESS_COACH not in accesses_for_staff(staff):
            return response({'error':'Coach access is required.'},403)
        # This is the actual user's personal inbox, including during view-as.
        # Never trust ownerEmail or let viewAsCoach mutate another inbox.
        if request.GET.get('viewAsCoach') or request.GET.get('view_as_coach'):
            return response({'error':'Completion notifications belong to the signed-in coach.'},403)
        owner=str(staff.email or '').strip().lower()
        now=timezone.now()
        roster=LearnerProfile.objects.annotate(coach=Lower(Trim('coach_email')),address=Lower(Trim('email'))).filter(
            coach=owner).values_list('address',flat=True)
        rows=Reminder.objects.filter(session__owner_email=owner,cancelled_at=None,dismissed_at=None,
            session__learner_email__in=roster,
            session__state='action-required',session__checked_at__gte=now-timedelta(hours=1),due_at__lte=now)
        if request.method=='POST':
            try:
                payload=json.loads(request.body)
                ids=payload['ids'];action=payload['action']
                if action not in ('read','dismiss') or not isinstance(ids,list) or not 1<=len(ids)<=100 or any(type(x)!=int or x<1 for x in ids):
                    raise ValueError()
            except (ValueError,TypeError,KeyError):
                return response({'error':'Choose up to 100 reminders and a valid action.'},400)
            count=rows.filter(pk__in=ids).update(**{'read_at' if action=='read' else 'dismissed_at':now})
            return response({'updated':count})
        items=[]
        for row in rows.select_related('session').order_by('-due_at','-id')[:100]:
            session=row.session
            items.append({'id':f'completion:{row.pk}','reminderId':row.pk,
                'text':f'{session.family}: {session.learner_name} — complete this session in Aptem.'
                    + (' Final reminder.' if row.stage==72 else ''),
                'createdAt':row.due_at.isoformat(),'unread':row.read_at is None,
                'type':'review','category':'Aptem completion','link':calendar_link(session)})
        return response({'items':items})
    except DatabaseError:
        return response({'error':'Completion reminders are temporarily unavailable.'},503)
