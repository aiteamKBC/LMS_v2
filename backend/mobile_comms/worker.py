"""Durable reminder reconciliation and privacy-checked Android dispatch."""
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from django.conf import settings
from django.db import connections
from django.utils import timezone
from login.models import LoginAccount, LoginSession
from . import identity, sources
from .models import Device, Delivery, Notification, Preference, Thread
from .policy import default_preferences, reminder_plan, eligible_now

def principal(account_id):
    return identity.principal_for_account(LoginAccount.objects.filter(pk=account_id).first())

def reconcile(account_id, events, now):
    active = set()
    for event in events.values():
        for item in reminder_plan(event):
            if not now-timedelta(days=2) <= item["dueAt"] <= now+timedelta(days=3):
                continue
            active.add(item["key"])
            notification, _ = Notification.objects.get_or_create(account_id=account_id,key=item["key"],defaults={
                "category":item["category"],"body":item["body"],"due_at":item["dueAt"],
                "source":{"kind":"reminder","sourceKey":event["key"]},
                "target":event["target"]})
            # A cancelled/rescheduled event can be restored to its original time.
            # Keep delivery history so a previously sent stage is never resent.
            if notification.cancelled_at:
                Notification.objects.filter(pk=notification.pk).update(cancelled_at=None)
    Notification.objects.filter(account_id=account_id,source__kind="reminder",cancelled_at=None).exclude(key__in=active).update(cancelled_at=now)

def current_notification(notification, person, now, *, events=None, dispatch=False):
    if notification.cancelled_at or notification.read_at and dispatch:
        return False
    if notification.source.get("kind") == "message":
        thread = Thread.objects.filter(pk=notification.source.get("threadId")).first()
        if not thread:return False
        identity.participants(thread,person)
        return not dispatch or now < notification.due_at+timedelta(minutes=10)
    events = sources.events_for(person) if events is None else events
    event = events.get(notification.source.get("sourceKey"))
    if not event:return False
    if dispatch:return eligible_now({"key":notification.key},event,now)
    return notification.key in {x["key"] for x in reminder_plan(event)}

def dispatch_one(delivery_id, sender, now):
    # CAS claim is committed before external IO. A crash leaves an explicit
    # uncertain delivery; it is not blindly resent on the next timer tick.
    if not Delivery.objects.filter(pk=delivery_id,state__in=["pending","retry"],next_attempt_at__lte=now).update(state="sending"):
        return "claimed"
    delivery = Delivery.objects.select_related("notification","device").get(pk=delivery_id)
    n,d = delivery.notification,delivery.device
    try:
        person = principal(n.account_id)
        prefs = Preference.objects.filter(pk=n.account_id).first()
        choices = prefs.categories if prefs else default_preferences()
        session_valid = LoginSession.objects.filter(pk=d.session_id,account_id=n.account_id,revoked_at=None,expires_at__gt=now).exists()
        if not d.active or d.account_id!=n.account_id or not session_valid or not choices[n.category]["push"] or not current_notification(n,person,now,dispatch=True):
            delivery.state="suppressed"
        else:
            result=sender.send(d.token,n)
            delivery.state=result.state;delivery.provider_id=result.provider_id
            delivery.attempts+=1
            delivery.next_attempt_at=now+timedelta(seconds=result.retry_seconds)
            if result.state=="invalid-device":Device.objects.filter(pk=d.pk,token=d.token,account_id=d.account_id).update(active=False)
    except identity.AccessError:
        delivery.state="suppressed"
    except Exception:
        # Do not log credentials, tokens or source data. A safe retry can be
        # made by the next tick if failure occurred before provider dispatch.
        delivery.state="uncertain"
    delivery.save(update_fields=["state","provider_id","attempts","next_attempt_at"])
    return delivery.state

def tick(sender=None, *, now=None):
    fixed_now=now
    now=now or timezone.now();counts={"accounts":0,"sourceErrors":0,"deliveries":0}
    Delivery.objects.filter(state="sending",next_attempt_at__lt=now-timedelta(minutes=5)).update(state="uncertain")
    def refresh_account(account_id):
        try:
            person=principal(account_id)
            events=sources.events_for(person)
            reconcile(account_id,events,now)
            return "accounts"
        except identity.AccessError:
            Notification.objects.filter(account_id=account_id,cancelled_at=None).update(cancelled_at=now)
            return None
        except Exception:
            return "sourceErrors"
        finally:
            connections.close_all()
    # Bounded parallel reads prevent one large learner plan delaying a cohort's
    # reminders. Each task has its own Django connection and account boundary.
    account_ids=list(Preference.objects.values_list("account_id",flat=True))
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(refresh_account,account_ids):
            if result:counts[result]+=1
    if sender is None:return counts
    for notification in Notification.objects.filter(cancelled_at=None,read_at=None,
            due_at__range=(now-timedelta(minutes=10),now)):
        for device in Device.objects.filter(account_id=notification.account_id,active=True):
            Delivery.objects.get_or_create(notification=notification,device=device,defaults={"next_attempt_at":now})
    ids=list(Delivery.objects.filter(state__in=["pending","retry"],next_attempt_at__lte=now).order_by("next_attempt_at").values_list("pk",flat=True)[:500])
    def dispatch(pk):
        try:return dispatch_one(pk,sender,fixed_now or timezone.now())
        finally:connections.close_all()
    with ThreadPoolExecutor(max_workers=4) as pool:
        for _ in pool.map(dispatch,ids):counts["deliveries"]+=1
    return counts
