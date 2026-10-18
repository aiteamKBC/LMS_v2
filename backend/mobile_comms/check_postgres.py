"""Explicit opt-in integration checks on a fresh, verified loopback test DB only.

Run: python -m mobile_comms.check_postgres PRIVATE_CONNECTION_FILE
Never imports production settings or calls external providers.
"""
import json, sys, uuid
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch, Mock
from datetime import timedelta
from django.conf import settings

cfg=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
assert cfg['host']=='127.0.0.1' and cfg['dbname'].startswith('kbc_rewards_test_')
db={'ENGINE':'django.db.backends.postgresql','NAME':cfg['dbname'],'USER':cfg['user'],
    'PASSWORD':cfg['password'],'HOST':cfg['host'],'PORT':cfg['port'],'OPTIONS':{'connect_timeout':5}}
settings.configure(SECRET_KEY='synthetic-only',USE_TZ=True,DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
    INSTALLED_APPS=['mobile_comms.test_settings.LearnerTestConfig','mobile_comms.test_settings.LoginTestConfig','mobile_comms'],
    DATABASES={'default':db},DATABASE_ROUTERS=[],KBC_MOBILE_COMMS_ENABLED=True,ALLOWED_HOSTS=['testserver'])
cfg.clear();db={}
import django
django.setup()
from django.db import connection,connections
from django.db.migrations.executor import MigrationExecutor
from django.test import RequestFactory
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from learner_api.models import EnrolmentUser,LearnerProfile,StaffUser
from login.models import LoginAccount,LoginSession
from . import identity,views,worker
from .models import Thread,Message,Notification,Delivery,Device,Preference
from .policy import default_preferences
from .push import SendResult

with connection.cursor() as cur:
    cur.execute("SELECT current_database(),host(inet_server_addr()),current_setting('listen_addresses')")
    assert cur.fetchone()==(settings.DATABASES['default']['NAME'],'127.0.0.1','127.0.0.1')
    cur.execute("SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
    assert cur.fetchone()[0]==0,'Refusing a non-empty database'
    for schema in ['login','Learner','enrolment']:cur.execute('CREATE SCHEMA "'+schema+'"')
MigrationExecutor(connection).migrate([('mobile_comms','0001_initial')])
with connection.schema_editor() as editor:
    for model in [EnrolmentUser,LearnerProfile,StaffUser,LoginAccount,LoginSession]:editor.create_model(model)

def learner(source_id,profile_id,cohort,kind='apprenticeship'):
    EnrolmentUser.all_learners.create(id=source_id,learner_type=kind,email=f'synthetic{source_id}@example.test')
    LearnerProfile.objects.create(id=profile_id,enrolment_id=source_id,lifecycle_status='active',
        full_name=f'Synthetic {source_id}',email=f'synthetic{source_id}@example.test',cohort_id=cohort,
        learner_type=kind,coach_email='coach@example.test')
    return LoginAccount.objects.create(subject_type='learner',subject_id=source_id,role='learner',email=f'synthetic{source_id}@example.test')
a=learner(101,5001,'c1');b=learner(102,5002,'c1','commercial');other=learner(103,101,'c2')
# Production uses transaction pooling; a named cursor cannot survive across
# requests. Fail this integration check if any communications path opens one.
cursor_guard=patch.object(connection,'chunked_cursor',side_effect=AssertionError('Named server cursors are incompatible with transaction pooling'))
cursor_guard.start()
pa=identity.principal_for_account(a);pb=identity.principal_for_account(b)
assert pa.subject_id==101 and pa.cohort_id=='c1' and pb.kind=='learner'
assert {x['id'] for x in identity.peer_directory(pa)}=={'102'}
staff=StaffUser.objects.create(id=201,email='coach@example.test',access='coach')
coach=LoginAccount.objects.create(subject_type='staff',subject_id=201,role='staff',email='coach@example.test')
pc=identity.principal_for_account(coach);assert identity.coach_for(pa).account_id==coach.pk
t=Thread.objects.create(key='peer',kind='peer',learner_a=101,learner_b=102,cohort_id='c1')
assert len(identity.participants(t,pb))==2
try:identity.participants(t,identity.principal_for_account(other));raise AssertionError('Outsider allowed')
except identity.AccessError:pass
LearnerProfile.objects.filter(enrolment_id=102).update(lifecycle_status='withdrawn')
try:identity.participants(t,pa);raise AssertionError('Withdrawn learner allowed')
except identity.AccessError:pass
LearnerProfile.objects.filter(enrolment_id=102).update(lifecycle_status='active')
coach_thread=Thread.objects.create(key='coach',kind='coach',learner_a=101,coach_id=201)
assert len(identity.participants(coach_thread,pc))==2
StaffUser.objects.filter(pk=201).update(access='tutor')
try:identity.participants(coach_thread,pc);raise AssertionError('Former coach allowed')
except identity.AccessError:pass
StaffUser.objects.filter(pk=201).update(access='coach')

def concurrent_send(nonce,text='Synthetic concurrency check'):
    barrier=Barrier(2)
    def send(_):
        try:
            request=RequestFactory().post('/',json.dumps({'body':text,'clientId':nonce}),content_type='application/json',HTTP_X_REQUESTED_WITH='XMLHttpRequest')
            barrier.wait(timeout=10)
            return views.messages(request,t.pk).status_code
        finally:connections.close_all()
    with patch.object(identity,'authenticate',return_value=pa),ThreadPoolExecutor(max_workers=2) as pool:
        return sorted(pool.map(send,range(2)))
assert concurrent_send(str(uuid.uuid4()))==[200,201]
assert Message.objects.count()==1 and Notification.objects.count()==1
for index in range(28):Message.objects.create(thread=t,account_id=a.pk,sender_name='Synthetic',body=str(index),client_id=uuid.uuid4())
barrier=Barrier(2)
def send_limited(_):
    try:
        request=RequestFactory().post('/',json.dumps({'body':'Rate check','clientId':str(uuid.uuid4())}),content_type='application/json',HTTP_X_REQUESTED_WITH='XMLHttpRequest')
        barrier.wait(timeout=10)
        return views.messages(request,t.pk).status_code
    finally:connections.close_all()
with patch.object(identity,'authenticate',return_value=pa),ThreadPoolExecutor(max_workers=2) as pool:
    assert sorted(pool.map(send_limited,range(2)))==[201,429]
assert Message.objects.filter(account_id=a.pk).count()==30
prefs=default_preferences();prefs['private_messages']['push']=True
Preference.objects.update_or_create(account_id=b.pk,defaults={'categories':prefs})
session=LoginSession.objects.create(account=b,token_hash='a'*64,expires_at=timezone.now()+timedelta(hours=1))
device=Device.objects.create(account_id=b.pk,session_id=str(session.pk),token='synthetic-token-for-integration-only')
notice=Notification.objects.filter(account_id=b.pk).first()
delivery=Delivery.objects.create(notification=notice,device=device)
sender=Mock();sender.send.return_value=SendResult('sent','synthetic-provider')
barrier=Barrier(2)
def dispatch(_):
    try:barrier.wait(timeout=10);return worker.dispatch_one(delivery.pk,sender,timezone.now())
    finally:connections.close_all()
with ThreadPoolExecutor(max_workers=2) as pool:assert sorted(pool.map(dispatch,range(2)))==['claimed','sent']
sender.send.assert_called_once()
with patch('mobile_comms.sources.events_for',return_value={}):
    result=worker.tick(sender)
assert result['sourceErrors']==0 and result['accounts']==2
assert sender.send.call_count==2,'Only the remaining unread message is dispatched'

# Class participation is shared by the class, while direct messages remain
# limited to each coach's own assignments. Exercise the real identity queries.
staff_b=StaffUser.objects.create(id=202,email='other-coach@example.test',access='coach')
coach_b=LoginAccount.objects.create(subject_type='staff',subject_id=202,role='staff',email=staff_b.email)
pcb=identity.principal_for_account(coach_b)
StaffUser.objects.filter(pk=201).update(email=' Coach@Example.Test ')
LearnerProfile.objects.filter(enrolment_id=101).update(coach_email=' COACH@EXAMPLE.TEST ',cohort='Class One')
LearnerProfile.objects.filter(enrolment_id=102).update(coach_email=staff_b.email,cohort_id=' c1 ',cohort='Class One')
LearnerProfile.objects.filter(enrolment_id=103).update(cohort='Class Two')
assert {x['id'] for x in identity.peer_directory(pc)}=={'101','103'}
assert {x['id'] for x in identity.cohort_directory(pc)}=={'c1','c2'}
assert {x['id'] for x in identity.cohort_directory(pcb)}=={'c1'}
assert {x.account_id for x in identity.cohort_members('c1')}=={a.pk,b.pk,coach.pk,coach_b.pk}

def call_as(person,view,data=None,**kwargs):
    request=(RequestFactory().get('/') if data is None else RequestFactory().post('/',json.dumps(data),
        content_type='application/json',HTTP_X_REQUESTED_WITH='XMLHttpRequest'))
    with patch.object(identity,'authenticate',return_value=person):return view(request,**kwargs)

joined=call_as(pc,views.threads,{'kind':'cohort','cohortId':'c1'})
assert joined.status_code==200
group=Thread.objects.get(pk=json.loads(joined.content)['id'])
assert json.loads(joined.content)['cohortId']=='c1'
assert call_as(pcb,views.threads,{'kind':'cohort','cohortId':'c2'}).status_code==403
assert call_as(pc,views.threads,{'kind':'coach','recipientId':'102'}).status_code==403
assert call_as(pc,views.messages,thread_id=t.pk).status_code==403
assert call_as(pc,views.messages,{'body':'Synthetic class update','clientId':str(uuid.uuid4())},thread_id=group.pk).status_code==201
assert set(Notification.objects.filter(source__threadId=str(group.pk)).values_list('account_id',flat=True))=={a.pk,b.pk,coach_b.pk}
assert call_as(pb,views.messages,{'body':'Synthetic class question','clientId':str(uuid.uuid4())},thread_id=group.pk).status_code==201
assert len(json.loads(call_as(pc,views.messages,thread_id=group.pk).content)['messages'])==2
notice=Notification.objects.get(account_id=coach.pk,source__threadId=str(group.pk))
prefs=default_preferences();prefs['cohort_messages']['push']=True
Preference.objects.update_or_create(account_id=coach.pk,defaults={'categories':prefs})
coach_session=LoginSession.objects.create(account=coach,token_hash='b'*64,expires_at=timezone.now()+timedelta(hours=1))
coach_device=Device.objects.create(account_id=coach.pk,session_id=str(coach_session.pk),token='synthetic-coach-device-token')
pending=Delivery.objects.create(notification=notice,device=coach_device)
LearnerProfile.objects.filter(enrolment_id=101).update(coach_email=staff_b.email)
assert {x['id'] for x in identity.cohort_directory(pc)}=={'c2'}
assert call_as(pc,views.messages,thread_id=group.pk).status_code==403
assert call_as(pc,views.messages,{'body':'Must not save','clientId':str(uuid.uuid4())},thread_id=group.pk).status_code==403
assert group.messages.count()==2
assert not json.loads(call_as(pc,views.threads).content)['threads']
assert not json.loads(call_as(pc,views.inbox).content)['notifications']
blocked_sender=Mock()
assert worker.dispatch_one(pending.pk,blocked_sender,timezone.now())=='suppressed'
blocked_sender.send.assert_not_called()
# An ambiguous source/profile link must not grant class access.
duplicate=LearnerProfile.objects.create(id=5004,enrolment_id=103,lifecycle_status='active',cohort_id='c2',coach_email='coach@example.test')
assert identity.cohort_directory(pc)==[]
LearnerProfile.objects.filter(pk=duplicate.pk).update(lifecycle_status='withdrawn')
# An expired/removed coach permission must be rechecked even for a stale principal.
StaffUser.objects.filter(pk=202).update(access='tutor')
try:identity.participants(group,pcb);raise AssertionError('Revoked class coach allowed')
except identity.AccessError:pass
# Query growth is explicit: each learner's live three-way identity check stays
# authoritative, but the shared coach is resolved only once within this roster.
for offset in range(30):learner(10000+offset,20000+offset,'scale-class')
with CaptureQueriesContext(connection) as captured:
    scale_members=identity.cohort_members('scale-class')
assert len(scale_members)==31
roster_query_count=len(captured)
assert roster_query_count==94,(roster_query_count,'Expected 1 candidate query + 3 per learner + 3 for one coach')
cursor_guard.stop()
print(json.dumps({'status':'PASS','checks':['fresh PostgreSQL migration','real enrolment/profile identity bridge','apprenticeship and commercial access','cohort outsider denied','withdrawn learner denied','coach permission revoked','concurrent duplicate send','concurrent rate limit','concurrent delivery claim','bounded parallel scheduler cycle','coach class access through one assigned learner','exact class recipients across multiple caseload cohorts','unassigned direct and private peer chat denied','last assignment removal revokes history and sending','queued class delivery suppressed after revocation','ambiguous learner identity excluded','normalised coach and exact cohort queries','per-roster coach lookup reuse'],'queryScale':{'learners':30,'distinctCoaches':1,'queries':roster_query_count},'externalCalls':0}))
