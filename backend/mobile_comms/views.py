"""Private mobile APIs; no demo bootstrap or user-selected sender identities."""
import functools
import json
import uuid
import re
from datetime import timedelta
from django.conf import settings
from django.db import DatabaseError, transaction
from django.db.models import Q
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from . import identity
from .models import Thread, Message, ReadCursor, Preference, Device, Notification
from .policy import default_preferences, validate_preferences

def error(message, status):
    return JsonResponse({"error": message}, status=status)

def endpoint(methods):
    def decorate(fn):
        @csrf_exempt
        @functools.wraps(fn)
        def wrapped(request, *args, **kwargs):
            try:
                if not getattr(settings, "KBC_MOBILE_COMMS_ENABLED", False):
                    return error("Messaging is not enabled yet.", 503)
                if request.method not in methods:
                    return error("Method not allowed.", 405)
                if request.method != "GET":
                    if request.headers.get("X-Requested-With") != "XMLHttpRequest":
                        return error("Missing request security header.", 403)
                    origin = request.headers.get("Origin")
                    if origin and origin != request.build_absolute_uri("/").rstrip("/"):
                        return error("Origin not permitted.", 403)
                request.comms_user = identity.authenticate(request)
                response = fn(request, *args, **kwargs)
            except identity.AccessError as exc:
                response = error(exc.message, exc.status)
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                response = error("The request is invalid.", 400)
            except DatabaseError:
                response = error("Messaging is temporarily unavailable.", 503)
            response["Cache-Control"] = "private, no-store"
            return response
        return wrapped
    return decorate

def body(request, allowed):
    if len(request.body) > 20000:
        raise ValueError()
    value = json.loads(request.body)
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError()
    return value

def thread_for(request, thread_id):
    thread = Thread.objects.filter(pk=thread_id).first()
    if thread is None:
        raise identity.AccessError()
    identity.participants(thread, request.comms_user)
    return thread

def preference(account_id):
    row = Preference.objects.filter(account_id=account_id).first()
    return row.categories if row else default_preferences()

@endpoint({"GET"})
def session(request):
    p = request.comms_user
    Preference.objects.get_or_create(account_id=p.account_id)
    return JsonResponse({"accountId":str(p.account_id), "role":p.kind, "name":p.name,
                         "cohortId":p.cohort_id, "preferences":preference(p.account_id),
                         "pushConfigured":bool(getattr(settings,"KBC_MOBILE_PUSH_ENABLED",False))})

@endpoint({"GET", "POST"})
def preferences(request):
    account_id = request.comms_user.account_id
    if request.method == "POST":
        categories = validate_preferences(body(request, {"categories"})["categories"])
        Preference.objects.update_or_create(account_id=account_id, defaults={"categories":categories})
    return JsonResponse({"categories":preference(account_id)})

@endpoint({"GET"})
def directory(request):
    p = request.comms_user
    coach = None
    if p.kind == "learner":
        try:
            target = identity.coach_for(p)
            coach = {"id":str(target.subject_id), "name":target.name}
        except identity.AccessError:
            pass
    return JsonResponse({"people":identity.peer_directory(p), "coach":coach,
                         "groups":identity.cohort_directory(p)})

def thread_title(thread, viewer):
    members = identity.participants(thread, viewer)
    if thread.kind == "cohort":
        return identity.cohort_name(members)
    return next(person.name for person in members if person.account_id != viewer.account_id)

def thread_data(thread, viewer):
    cursor = ReadCursor.objects.filter(thread=thread, account_id=viewer.account_id).first()
    unread = thread.messages.filter(id__gt=cursor.message_id if cursor else 0).exclude(account_id=viewer.account_id).count()
    return {"id":str(thread.pk), "kind":thread.kind, "name":thread_title(thread,viewer),
            "unread":unread, "updatedAt":thread.updated_at.isoformat(),
            **({"cohortId":thread.cohort_id} if thread.kind == "cohort" else {})}

@endpoint({"GET", "POST"})
def threads(request):
    p = request.comms_user
    if request.method == "POST":
        data = body(request, {"kind", "recipientId", "cohortId"})
        kind = data["kind"]
        values = {"kind":kind}
        if kind != "cohort" and "cohortId" in data:
            raise ValueError()
        if kind == "cohort":
            if "recipientId" in data:
                raise ValueError()
            cohort_id = data.get("cohortId", p.cohort_id if p.kind == "learner" else "")
            members = identity.cohort_members(cohort_id)
            if p.account_id not in {person.account_id for person in members}:
                raise identity.AccessError()
            key = "cohort:" + cohort_id
            values["cohort_id"] = cohort_id
        elif kind == "peer" and p.kind == "learner":
            other = identity.active_learner(int(data["recipientId"]))
            if not p.cohort_id or p.cohort_id != other.cohort_id or other.subject_id == p.subject_id:
                raise identity.AccessError()
            a,b = sorted([p.subject_id, other.subject_id])
            key = f"peer:{p.cohort_id}:{a}:{b}"
            values.update(learner_a=a, learner_b=b, cohort_id=p.cohort_id)
        elif kind == "coach":
            learner = p if p.kind == "learner" else identity.active_learner(int(data["recipientId"]))
            coach = identity.coach_for(learner)
            if p.kind == "coach" and coach.account_id != p.account_id:
                raise identity.AccessError()
            key = f"coach:{learner.subject_id}:{coach.subject_id}"
            values.update(learner_a=learner.subject_id, coach_id=coach.subject_id)
        else:
            raise identity.AccessError()
        thread,_ = Thread.objects.get_or_create(key=key, defaults=values)
        return JsonResponse(thread_data(thread,p))
    query = (Q(kind="coach",coach_id=p.subject_id) | Q(kind="cohort",cohort_id__in=[
        group["id"] for group in identity.cohort_directory(p)])) if p.kind=="coach" else (
        Q(learner_a=p.subject_id)|Q(learner_b=p.subject_id)|
        (Q(kind="cohort",cohort_id=p.cohort_id) if p.cohort_id else Q(pk__isnull=True)))
    result = []
    for thread in Thread.objects.filter(query).order_by("-updated_at")[:200]:
        try:
            result.append(thread_data(thread,p))
        except identity.AccessError:
            continue
    return JsonResponse({"threads":result})

def serialise_message(message, user):
    return {"id":message.pk, "body":message.body, "sender":message.sender_name,
            "isMine":message.account_id==user.account_id, "createdAt":message.created_at.isoformat()}

@endpoint({"GET", "POST"})
def messages(request, thread_id):
    thread = thread_for(request, thread_id)
    p = request.comms_user
    if request.method == "POST":
        data=body(request, {"body","clientId"})
        text=data["body"]
        if not isinstance(text,str) or not text.strip() or len(text)>4000:
            raise ValueError()
        nonce=uuid.UUID(str(data["clientId"]))
        with transaction.atomic():
            Preference.objects.get_or_create(account_id=p.account_id)
            Preference.objects.select_for_update().get(account_id=p.account_id)
            if (not Message.objects.filter(account_id=p.account_id,client_id=nonce).exists()
                    and Message.objects.filter(account_id=p.account_id,
                        created_at__gt=timezone.now()-timedelta(minutes=1)).count()>=30):
                return error("Please wait a minute before sending another message.",429)
            # Serialise sends for a conversation and recheck rights inside the transaction.
            thread=Thread.objects.select_for_update().get(pk=thread.pk)
            members = identity.participants(thread,p)
            saved,created=Message.objects.get_or_create(account_id=p.account_id,client_id=nonce,
                defaults={"thread":thread,"body":text.strip(),"sender_name":p.name})
            if saved.thread_id!=thread.pk or saved.body!=text.strip():
                return error("This send reference was already used for a different message.",409)
            if created:
                thread.updated_at=saved.created_at
                thread.save(update_fields=["updated_at"])
                recipients=[person for person in members if person.account_id!=p.account_id]
                for recipient in recipients:
                    Notification.objects.get_or_create(account_id=recipient.account_id,key=f"message:{saved.pk}",
                        defaults={"category":"cohort_messages" if thread.kind=="cohort" else "private_messages",
                                  "body":"You have a new KBC message.",
                                  "target":{"screen":"messages","threadId":str(thread.pk)},
                                  "source":{"kind":"message","threadId":str(thread.pk),"messageId":saved.pk}})
        return JsonResponse(serialise_message(saved,p),status=201 if created else 200)
    before=int(request.GET.get("before","0"))
    query=thread.messages.order_by("-id")
    if before>0:query=query.filter(id__lt=before)
    rows=list(query[:51]); has_more=len(rows)>50; rows=rows[:50]
    return JsonResponse({"messages":[serialise_message(m,p) for m in reversed(rows)],
                         "before":rows[-1].pk if has_more else None})

@endpoint({"POST"})
def read_thread(request, thread_id):
    thread=thread_for(request,thread_id)
    value=int(body(request,{"messageId"})["messageId"])
    if not thread.messages.filter(pk=value).exists():raise ValueError()
    with transaction.atomic():
        cursor,_=ReadCursor.objects.get_or_create(thread=thread,account_id=request.comms_user.account_id)
        cursor=ReadCursor.objects.select_for_update().get(pk=cursor.pk)
        cursor.message_id=max(cursor.message_id,value);cursor.save(update_fields=["message_id"])
        Notification.objects.filter(account_id=request.comms_user.account_id,
            source__threadId=str(thread.pk),source__messageId__lte=value,read_at=None).update(read_at=timezone.now())
    return JsonResponse({"readThrough":cursor.message_id})

@endpoint({"GET"})
def inbox(request):
    p=request.comms_user; prefs=preference(p.account_id)
    from .worker import current_notification
    from .sources import events_for
    events = None
    enabled=[key for key,channels in prefs.items() if channels["inApp"]]
    rows=Notification.objects.filter(account_id=p.account_id,category__in=enabled,
                                     cancelled_at=None,due_at__lte=timezone.now()).order_by("-due_at")[:100]
    result=[]
    for row in rows:
        if row.source.get("kind")=="message":
            try:thread_for(request,row.source["threadId"])
            except identity.AccessError:continue
        else:
            if events is None:events=events_for(p)
            if not current_notification(row,p,timezone.now(),events=events):continue
        result.append({"id":row.pk,"category":row.category,"body":row.body,"target":row.target,
                       "read":row.read_at is not None,"createdAt":row.due_at.isoformat()})
    return JsonResponse({"notifications":result})

@endpoint({"POST"})
def read_notification(request, notification_id):
    Notification.objects.filter(pk=notification_id,account_id=request.comms_user.account_id).update(read_at=timezone.now())
    return JsonResponse({"ok":True})

@endpoint({"POST", "DELETE"})
def device(request):
    data=body(request,{"token","platform"})
    token=data["token"]
    if not isinstance(token,str) or not re.fullmatch(r"[A-Za-z0-9_:\-]{20,512}",token):
        raise ValueError()
    if request.method=="DELETE":
        Device.objects.filter(token=token,account_id=request.comms_user.account_id).update(active=False)
    else:
        if data.get("platform") != "android":raise ValueError()
        # The token belongs to the signed-in device; account switching transfers it.
        Device.objects.update_or_create(token=token,defaults={"account_id":request.comms_user.account_id,
            "session_id":str(request.login_session.pk),"platform":data["platform"],"active":True,"updated_at":timezone.now()})
    return JsonResponse({"ok":True})
