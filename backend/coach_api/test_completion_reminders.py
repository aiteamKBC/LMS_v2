"""Synthetic Aptem rows, isolated SQLite stores, mocked email and no network."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch,Mock
import json
from pathlib import Path
from urllib.parse import urlsplit,parse_qs
import re

from django.conf import settings
from django.db import connections,IntegrityError,transaction
from django.test import SimpleTestCase,RequestFactory,override_settings
from django.test.utils import CaptureQueriesContext
from login import permissions
from . import completion_policy as policy,completion_source as source,completion_reminders as worker,completion_api as api
from .models import CoachingCompletionSession as Session,CoachingCompletionReminder as Reminder,CoachingCompletionDigest as Digest

NOW=datetime(2026,10,24,12,tzinfo=timezone.utc)
SINCE=NOW-timedelta(days=7)
OWNER='coach@example.invalid';OTHER='other@example.invalid'


def session(component=1,owner=OWNER,age=25,state='action-required',**changes):
    end=NOW-timedelta(hours=age)
    return {'key':policy.session_key(component,f'meeting-{component}',owner),'component_id':component,
        'source_meeting_id':f'meeting-{component}','owner_email':owner,'learner_name':'Synthetic Learner',
        'learner_email':f'learner-{component}@example.invalid','family':'MCM','event_id':f'event-{component}',
        'starts_at':end-timedelta(hours=1),'ends_at':end,'state':state,'source_status':'In Progress',
        'source_updated_at':NOW,'checked_at':NOW,**changes}


class CompletionPolicyTests(SimpleTestCase):
    def test_exact_elapsed_hours_not_calendar_days_or_machine_timezone(self):
        for hours,stage in ((23.999,None),(24,24),(71.999,24),(72,72),(100,72)):
            self.assertEqual(policy.stage_for(NOW-timedelta(hours=hours),NOW),stage)
    def test_status_not_completion_date_ai_status_or_fuzzy_wording(self):
        for status,state in (('Completed','completed'),('Awaiting Signature','awaiting-signature'),
            ('Scheduled','action-required'),('In Progress','action-required'),('Not Scheduled','unverified'),
            ('Archived','unverified'),('matching_failed','unverified'),('','unverified')):
            self.assertEqual(policy.completion_state(status),state)
    def test_occurrence_link_contains_no_token_and_keeps_final_pr_spelling(self):
        value=SimpleNamespace(**session(family='PR'))
        link=policy.calendar_link(value)
        self.assertTrue(link.startswith('/coach/recordings?'))
        self.assertIn('status=all',link);self.assertNotIn('reference',link)
        self.assertNotEqual(policy.session_key(1,'first',OWNER),policy.session_key(1,'second',OWNER))
    def test_reminder_links_resolve_to_registered_workspaces_and_keep_occurrence(self):
        routes=(Path(__file__).resolve().parents[2]/'frontend/src/router/config.tsx').read_text(encoding='utf-8')
        value=SimpleNamespace(**session(family='PR'))
        links=[]
        for workspace in ('coach','curriculum'):
            link=urlsplit(policy.calendar_link(value,workspace=workspace,zone='Africa/Cairo'))
            self.assertTrue(re.search(r'\bpath:\s*[\"\']'+re.escape(link.path)+r'[\"\']',routes),
                f'Reminder destination is not registered: {link.path}')
            query=parse_qs(link.query)
            self.assertEqual(query['status'],['all'])
            self.assertEqual(query['zone'],['Africa/Cairo'])
            self.assertEqual(query['date'],query['on'])
            self.assertNotIn('reference',query)
            links.append(query['meeting'])
        self.assertEqual(*links)


class CompletionSourceTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))
        self.enterContext(patch.object(source,'source_dsn',return_value='synthetic'))
        self.connect=self.enterContext(patch('psycopg.connect'))
        self.cursor=self.connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        self.row={'component_id':1,'component_type':'monthly_coaching','status':'In Progress','component_updated_at':NOW,
            'learner_id':3,'cache_learner_id':3,'learner_name':'Synthetic Learner','learner_email':'learner@example.invalid',
            'meeting_id':'meeting','coach_email':OWNER,'meeting_coach_email':OWNER,'event_id':'event',
            'start_at':NOW-timedelta(hours=26),'end_at':NOW-timedelta(hours=25),
            'actual_start_at':NOW-timedelta(hours=26),'actual_end_at':NOW-timedelta(hours=25),
            'is_cancelled':False,'learner_attended':True}
        self.cursor.fetchone.return_value={'unlinked':8}
    def read(self,rows=None):
        self.cursor.fetchall.return_value=[self.row] if rows is None else rows
        return source.read_source(SINCE,NOW,{OWNER})
    def test_bounded_read_only_metadata_queries_never_load_transcript_pdf_or_ai(self):
        result=self.read()
        self.assertEqual(result['sessions'][0]['state'],'action-required');self.assertEqual(result['unlinked'],8)
        self.assertEqual(self.connect.call_args.kwargs['options'],'-c default_transaction_read_only=on')
        queries=' '.join(c.args[0] for c in self.cursor.execute.call_args_list)
        self.assertNotIn('report_ai',queries);self.assertNotIn('transcript',queries);self.assertIn('LIMIT 5001',queries)
    def test_unlinked_ambiguous_cancelled_wrong_owner_or_learner_never_nudges(self):
        for change in ({'meeting_id':None},{'is_cancelled':True},{'coach_email':OTHER},{'meeting_coach_email':OTHER},
            {'cache_learner_id':4},{'actual_start_at':NOW-timedelta(days=2)}, {'end_at':NOW+timedelta(hours=1)}):
            self.assertEqual(self.read([{**self.row,**change}])['sessions'],[])
        self.assertEqual(self.read([self.row,self.row])['sessions'],[])
    def test_stale_status_or_unconfirmed_attendance_is_not_a_coach_failure(self):
        for change in ({'component_updated_at':NOW-timedelta(hours=25)},{'learner_attended':False},
            {'component_updated_at':NOW+timedelta(hours=1)}):
            self.assertEqual(self.read([{**self.row,**change}])['sessions'][0]['state'],'unverified')
        self.assertEqual(self.read([{**self.row,'status':'Awaiting Signature'}])['sessions'][0]['state'],'awaiting-signature')
    def test_excess_rows_are_an_explicit_error_not_partial_success(self):
        with patch.object(source,'MAX_ROWS',1):
            with self.assertRaises(ValueError):self.read([self.row,self.row])


class CompletionStoreTests(TestCase):
    @classmethod
    def setUpClass(cls):
        assert settings.COACH_TEST_MODE and all(v['ENGINE']=='django.db.backends.sqlite3' for v in connections.databases.values())
        cls.alias='completion_memory';cfg=deepcopy(connections['default'].settings_dict);cfg['NAME']=':memory:'
        connections.databases[cls.alias]=cfg
        with connections[cls.alias].schema_editor() as schema:
            for model in (Session,Digest,Reminder):schema.create_model(model)
    @classmethod
    def tearDownClass(cls):
        connections[cls.alias].close();del connections[cls.alias];del connections.databases[cls.alias]
    def setUp(self):
        zone=override_settings(TIME_ZONE='Europe/London');zone.enable();self.addCleanup(zone.disable)
        self.addCleanup(patch.stopall)
        patch('socket.socket',side_effect=AssertionError('Network forbidden')).start()
        patch('django.db.router.db_for_read',return_value=self.alias).start()
        patch('django.db.router.db_for_write',return_value=self.alias).start()
        self.owners=patch.object(worker,'coach_owners',return_value={OWNER,OTHER}).start()
        self.profile=patch.object(worker.LearnerProfile.objects,'annotate').start()
        self.profile.return_value.filter.return_value.values.return_value=[
            {'address':f'learner-{i}@example.invalid','coach':OWNER if i<10 else OTHER} for i in range(1,20)]
        self.profile.return_value.filter.return_value.values_list.return_value=[f'learner-{i}@example.invalid' for i in range(1,10)]
        Reminder.objects.all().delete();Digest.objects.all().delete();Session.objects.all().delete()
        self.sender=Mock(return_value=(True,None))
    def reconcile(self,rows,now=NOW):
        return worker.reconcile({'sessions':rows,'unlinked':0},{OWNER,OTHER},SINCE,now)
    def send(self,rows,now=NOW):
        return worker.dispatch(SINCE,now,'https://lms.example.invalid',
            source_reader=Mock(return_value={'sessions':rows,'unlinked':0}),sender=self.sender)
    def test_24_hour_once_then_final_at_72_and_no_further_stage(self):
        value=session();self.reconcile([value]);self.reconcile([value]);self.assertEqual(Reminder.objects.count(),1)
        self.reconcile([value],NOW+timedelta(hours=47));self.assertEqual(Reminder.objects.count(),2)
        self.assertEqual(list(Reminder.objects.filter(cancelled_at=None).values_list('stage',flat=True)),[72])
        self.reconcile([value],NOW+timedelta(days=5));self.assertEqual(Reminder.objects.count(),2)
    def test_first_discovery_after_72_hours_only_creates_final_reminder(self):
        self.reconcile([session(age=80)])
        self.assertEqual(list(Reminder.objects.values_list('stage',flat=True)),[72])
    def test_completed_signature_cancelled_missing_or_transferred_caseload_suppresses(self):
        for state in ('completed','awaiting-signature','unverified'):
            self.reconcile([session()]);self.reconcile([session(state=state)])
            self.assertFalse(Reminder.objects.filter(cancelled_at=None).exists())
        self.reconcile([session()]);self.reconcile([])
        self.assertFalse(Reminder.objects.filter(cancelled_at=None).exists())
        self.reconcile([session()]);self.profile.return_value.filter.return_value.values.return_value=[]
        self.reconcile([session()]);self.assertFalse(Reminder.objects.filter(cancelled_at=None).exists())
    def test_current_source_status_is_rechecked_before_email(self):
        self.reconcile([session()]);result=self.send([session(state='completed')])
        self.sender.assert_not_called();self.assertEqual(result['accepted'],0)
    def test_daily_digest_groups_sessions_and_never_repeats_same_day(self):
        rows=[session(),session(2,family='PR')]
        self.reconcile(rows);self.assertEqual(self.send(rows)['accepted'],1)
        self.assertEqual(self.send(rows)['accepted'],0);self.sender.assert_called_once()
        kwargs=self.sender.call_args.kwargs
        self.assertEqual(kwargs['to'],OWNER);self.assertIn('PR',kwargs['text_body']);self.assertIn('MCM',kwargs['text_body'])
        self.assertNotIn('http://',kwargs['html_body']);self.assertEqual(Reminder.objects.filter(digest__state='accepted').count(),2)
    def test_timeout_is_uncertain_and_not_retried_or_resent_next_day(self):
        value=session();self.reconcile([value]);self.sender.side_effect=TimeoutError('private transport detail')
        self.assertEqual(self.send([value])['uncertain'],1)
        self.send([value]);self.send([value],NOW+timedelta(days=1))
        self.sender.assert_called_once();self.assertEqual(Digest.objects.get().state,'uncertain')
    def test_source_outage_or_before_business_hours_never_sends(self):
        self.reconcile([session()])
        with self.assertRaises(RuntimeError):
            worker.dispatch(SINCE,NOW,'https://lms.example.invalid',source_reader=Mock(side_effect=RuntimeError()),sender=self.sender)
        self.assertFalse(Digest.objects.exists());self.sender.assert_not_called()
        self.send([session()],NOW.replace(hour=6));self.sender.assert_not_called()
    def test_revoked_coach_is_not_dispatched(self):
        self.reconcile([session()]);self.owners.return_value={OTHER};self.send([session()]);self.sender.assert_not_called()
    def test_duplicate_digest_claim_is_database_protected(self):
        Digest.objects.create(owner_email=OWNER,day=NOW.date(),created_at=NOW)
        with self.assertRaises(IntegrityError):
            with transaction.atomic(using=self.alias):Digest.objects.create(owner_email=OWNER,day=NOW.date(),created_at=NOW)
    def test_dry_run_writes_nothing_and_rollout_cutoff_does_not_expire_after_month(self):
        result=worker.run(NOW-timedelta(days=60),now=NOW,source_reader=Mock(return_value={'sessions':[session()],'unlinked':3}))
        self.assertTrue(result['dryRun']);self.assertFalse(Session.objects.exists());self.assertFalse(Digest.objects.exists())
    def test_completion_summary_is_exact_occurrence_scoped_and_explicit_when_stale(self):
        from .completion_status import completion_summary
        value=session();self.reconcile([value])
        record=SimpleNamespace(owner_email=OWNER,graph_event_id=value['event_id'],calendar_window=(value['starts_at'],value['ends_at']))
        with patch('coach_api.completion_status.timezone.now',return_value=NOW):
            self.assertEqual(completion_summary(record)['state'],'action-required')
            record.owner_email=OTHER
            self.assertEqual(completion_summary(record)['state'],'unverified')
            record.owner_email=OWNER;record.calendar_window=(value['starts_at']+timedelta(days=1),value['ends_at']+timedelta(days=1))
            self.assertEqual(completion_summary(record)['state'],'unverified')
            record.calendar_window=(value['starts_at'],value['ends_at'])
            Session.objects.update(checked_at=NOW-timedelta(hours=2))
            self.assertEqual(completion_summary(record)['state'],'unverified')
    def test_source_error_prevents_writes_and_digest_html_escapes_source_labels(self):
        with self.assertRaises(RuntimeError):
            worker.run(SINCE,write=True,send=True,site_url='https://lms.example.invalid',now=NOW,
                source_reader=Mock(side_effect=RuntimeError()),sender=self.sender)
        self.assertFalse(Session.objects.exists());self.sender.assert_not_called()
        value=session(learner_name='<script>synthetic</script>');self.reconcile([value]);self.send([value])
        self.assertNotIn('<script>',self.sender.call_args.kwargs['html_body'])
        self.assertIn('&lt;script&gt;',self.sender.call_args.kwargs['html_body'])
    def test_one_hundred_sessions_use_batched_queries_and_unchanged_rows_are_not_rewritten(self):
        values=[session(i) for i in range(1,101)]
        self.profile.return_value.filter.return_value.values.return_value=[
            {'address':row['learner_email'],'coach':OWNER} for row in values]
        with CaptureQueriesContext(connections[self.alias]) as first:
            self.reconcile(values)
        self.assertEqual(Reminder.objects.count(),100)
        self.assertLessEqual(len(first),20,'Reminder reconciliation must not issue queries per meeting.')
        with CaptureQueriesContext(connections[self.alias]) as repeat:
            self.reconcile(values)
        self.assertFalse(any('INSERT INTO "coach_test_completion_session"' in row['sql'] for row in repeat))
        self.assertEqual(Reminder.objects.count(),100)
    def test_inbox_is_personal_and_read_dismiss_does_not_complete_or_cancel_email(self):
        self.reconcile([session(),session(10,owner=OTHER)])
        factory=RequestFactory()
        staff=SimpleNamespace(id=1,email=OWNER,access='coach',access_extra='')
        def authenticate(request):
            request.login_account=SimpleNamespace(subject_id=1,subject_type='staff',role='staff');return request.login_account
        with patch.object(permissions,'authenticate_request',side_effect=authenticate), \
             patch.object(permissions,'_accesses_of',return_value=frozenset({'coach'})),patch.object(api,'_staff',return_value=staff), \
             patch.object(api.timezone,'now',return_value=NOW):
            def get(query=''):
                return api.completion_notifications(factory.get('/inbox'+query))
            response=get();self.assertEqual(response.status_code,200)
            items=json.loads(response.content)['items'];self.assertEqual(len(items),1)
            own=items[0]['reminderId'];foreign=Reminder.objects.get(session__owner_email=OTHER).pk
            def post(action,ids):
                request=factory.post('/inbox',json.dumps({'action':action,'ids':ids}),content_type='application/json')
                request._dont_enforce_csrf_checks=True
                return api.completion_notifications(request)
            self.assertEqual(json.loads(post('read',[own,foreign]).content)['updated'],1)
            self.assertIsNotNone(Reminder.objects.get(pk=own).read_at)
            self.assertIsNone(Reminder.objects.get(pk=foreign).read_at)
            post('dismiss',[own]);self.assertEqual(json.loads(get().content)['items'],[])
            self.assertEqual(Session.objects.get(owner_email=OWNER).state,'action-required')
            self.assertEqual(get('?viewAsCoach='+OTHER).status_code,403)
            no_csrf=factory.post('/inbox','{}',content_type='application/json')
            self.assertEqual(api.completion_notifications(no_csrf).status_code,403)
            staff.access='curriculum';self.assertEqual(get().status_code,403)
            self.sender.assert_not_called()
