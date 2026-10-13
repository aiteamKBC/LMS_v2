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
cursor_guard.stop()
print(json.dumps({'status':'PASS','checks':['fresh PostgreSQL migration','real enrolment/profile identity bridge','apprenticeship and commercial access','cohort outsider denied','withdrawn learner denied','coach permission revoked','concurrent duplicate send','concurrent rate limit','concurrent delivery claim','bounded parallel scheduler cycle'],'externalCalls':0}))
