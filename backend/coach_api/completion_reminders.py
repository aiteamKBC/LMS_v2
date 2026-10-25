"""Durable 24h/72h reminders and one daily coach email; no page-load work."""
from collections import defaultdict
from datetime import timedelta
from html import escape
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction, router
from django.db.models.functions import Lower,Trim
from django.utils import timezone
from learner_api.constants import ACCESS_COACH
from learner_api.models import StaffUser,LearnerProfile
from login.identity import accesses_for_staff
from login import email_azure
from .models import CoachingCompletionSession as Session, CoachingCompletionReminder as Reminder, CoachingCompletionDigest as Digest
from .completion_policy import stage_for, calendar_link
from .completion_source import read_source, MAX_ROWS


def coach_owners():
    owners = set()
    for staff in StaffUser.objects.only('email', 'access', 'access_extra'):
        if ACCESS_COACH in accesses_for_staff(staff) and staff.email:
            owners.add(staff.email.strip().lower())
    return owners


def reconcile(data, owners, since, now):
    # Source learner IDs are Aptem IDs, not LMS profile IDs. Revalidate the
    # current caseload by server-owned email; never trust a numeric coincidence.
    emails={row['learner_email'] for row in data['sessions'] if row.get('learner_email')}
    ownership={}
    for profile in LearnerProfile.objects.annotate(address=Lower(Trim('email')),coach=Lower(Trim('coach_email'))).filter(
            address__in=emails).values('address','coach'):
        ownership.setdefault(profile['address'],set()).add(profile['coach'])
    database = router.db_for_write(Session) or 'default'
    with transaction.atomic(using=database):
        # Read/write batches, never a query loop per meeting. Keep delivery and
        # read history separate from this refreshable metadata projection.
        existing={row.key:row for row in Session.objects.select_for_update().filter(key__in=[r['key'] for r in data['sessions']])}
        valid=[];writes=[]
        for row in data['sessions']:
            if row['owner_email'] not in owners or row['ends_at'] < since:
                continue
            if ownership.get(row['learner_email'])!={row['owner_email']}:
                continue
            previous=existing.get(row['key'])
            if previous and previous.source_updated_at>row['source_updated_at']:
                valid.append({field:getattr(previous,field) for field in row})
                continue
            row={**row,'checked_at':now};valid.append(row)
            if (not previous or previous.checked_at<now-timedelta(minutes=30)
                    or any(getattr(previous,key)!=value for key,value in row.items() if key!='checked_at')):
                writes.append(Session(**row))
        if writes:
            Session.objects.bulk_create(writes,update_conflicts=True,unique_fields=['key'],
                update_fields=[field.name for field in Session._meta.fields if not field.primary_key],batch_size=500)
        # A missing/deleted/ambiguous or transferred association cannot leave a
        # cached action-required reminder eligible for dispatch.
        Session.objects.exclude(key__in=[row['key'] for row in valid]).exclude(state__in=['completed','unverified']).update(state='unverified',checked_at=now)
        staged={24:[],72:[]};new=[]
        for row in valid:
            stage=stage_for(row['ends_at'],now) if row['state']=='action-required' else None
            if stage:
                staged[stage].append(row['key'])
                new.append(Reminder(session_id=row['key'],stage=stage,due_at=row['ends_at']+timedelta(hours=stage)))
        Reminder.objects.bulk_create(new,ignore_conflicts=True,batch_size=500)
        for stage,keys in staged.items():
            # Restoring an association never clears email/read/dismiss history.
            Reminder.objects.filter(session_id__in=keys,stage=stage,cancelled_at__isnull=False).update(cancelled_at=None)
        Reminder.objects.filter(session_id__in=staged[72],stage=24,cancelled_at=None).update(cancelled_at=now)
        Reminder.objects.filter(cancelled_at=None).exclude(session__state='action-required').update(cancelled_at=now)
    return Reminder.objects.filter(cancelled_at=None, session__state='action-required').count()


def public_origin(value):
    parsed = urlsplit(value)
    if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('Use the public HTTPS site origin without credentials, query or fragment.')
    if parsed.path not in ('', '/'):
        raise ValueError('Use the public site origin without a path.')
    return value.rstrip('/')


def digest_body(rows, site_url, zone):
    lines = ['You have MCM / PR sessions that still need completion in Aptem.',
        'Please review each session and complete the required steps to document your work.', '']
    entries = []
    for reminder in rows[:20]:
        session=reminder.session
        stamp=session.starts_at.astimezone(zone).strftime('%d %b %Y %H:%M')
        label=f'{session.family} · {session.learner_name} · {stamp} ({zone.key})'
        url=site_url+calendar_link(session, zone=zone.key)
        final='Final reminder (72 hours).' if reminder.stage==72 else '24-hour reminder.'
        lines.extend([label, final, url, ''])
        entries.append(f'<li><strong>{escape(label)}</strong><br>{final} '
            f'<a href="{escape(url,quote=True)}">Review meeting</a></li>')
    if len(rows)>20:
        lines.append(f'{len(rows)-20} additional sessions are listed in your LMS notifications.')
    lines.append('Reading or dismissing a reminder does not complete the session in Aptem.')
    html='<p>'+escape(lines[0])+'</p><p>'+escape(lines[1])+'</p><ul>'+''.join(entries)+'</ul>'
    if len(rows)>20:
        html+=f'<p>{len(rows)-20} additional sessions are listed in your LMS notifications.</p>'
    html+='<p>Reading or dismissing a reminder does not complete the session in Aptem.</p>'
    return '\n'.join(lines), html


def dispatch(since, now, site_url, *, source_reader=read_source, sender=None):
    zone=ZoneInfo(settings.TIME_ZONE)
    local=now.astimezone(zone)
    if local.hour<9:
        return {'accepted':0, 'uncertain':0}
    site_url=public_origin(site_url)
    if sender is None and not email_azure.is_configured():
        raise RuntimeError('completion_email_not_configured')
    # Recheck all pending source states in one bounded batch immediately before
    # claiming deliveries. A source error never authorizes using stale tasks.
    owners=coach_owners()
    tracked=list(Session.objects.exclude(state='completed').filter(ends_at__gte=now-timedelta(days=31))
        .values_list('component_id',flat=True).distinct()[:MAX_ROWS+1])
    fresh=source_reader(since,now,owners,tracked)
    reconcile(fresh,owners,since,now)
    Digest.objects.filter(state='sending',created_at__lt=now-timedelta(minutes=10)).update(state='uncertain')
    pending=Reminder.objects.select_related('session').filter(cancelled_at=None,digest=None,
        due_at__lte=now,session__state='action-required',session__owner_email__in=owners,
        session__checked_at__gte=now-timedelta(hours=1),session__ends_at__gte=since).order_by('session__owner_email','due_at','id')
    grouped=defaultdict(list)
    for row in pending:
        grouped[row.session.owner_email].append(row)
    result={'accepted':0,'uncertain':0}
    database=router.db_for_write(Digest) or 'default'
    for owner, rows in grouped.items():
        # Unique owner/day + committed claim prevents double sends by concurrent
        # schedulers. Provider timeouts remain uncertain; never blindly resend.
        with transaction.atomic(using=database):
            digest,created=Digest.objects.get_or_create(owner_email=owner,day=local.date(),defaults={'created_at':now})
            if not created:
                continue
            ids=[row.pk for row in rows]
            claimed=Reminder.objects.filter(pk__in=ids,cancelled_at=None,digest=None,
                session__state='action-required').update(digest=digest)
            if not claimed:
                digest.state='suppressed';digest.save(update_fields=['state']);continue
            rows=list(Reminder.objects.select_related('session').filter(digest=digest).order_by('due_at','id'))
        text,html=digest_body(rows,site_url,zone)
        try:
            accepted,_=(sender or email_azure.send_mail)(to=owner,subject='Complete your MCM / PR sessions in Aptem',
                html_body=html,text_body=text,sender_name='KBC LMS')
        except Exception:
            accepted=False
        digest.state='accepted' if accepted else 'uncertain'
        digest.sent_at=now if accepted else None
        digest.save(update_fields=['state','sent_at'])
        result[digest.state]+=1
    return result


def run(since, *, write=False, send=False, site_url='', now=None, source_reader=read_source, sender=None):
    now=now or timezone.now()
    if since.tzinfo is None or since>now:
        raise ValueError('Choose an explicit rollout start that is not in the future.')
    owners=coach_owners()
    tracked=list(Session.objects.exclude(state='completed').filter(ends_at__gte=now-timedelta(days=31))
        .values_list('component_id',flat=True).distinct()[:MAX_ROWS+1]) if write else []
    data=source_reader(since,now,owners,tracked)
    result={'verified':len(data['sessions']),'unlinked':data['unlinked'],
        'withheld':data.get('withheld',0),
        'actionRequired':sum(row['state']=='action-required' and stage_for(row['ends_at'],now) is not None for row in data['sessions']),
        'accepted':0,'uncertain':0,'dryRun':not write}
    if write:
        result['activeReminders']=reconcile(data,owners,since,now)
        if send:
            result.update(dispatch(since,now,site_url,source_reader=source_reader,sender=sender))
    elif send:
        raise ValueError('Email dispatch requires reconciliation.')
    return result
