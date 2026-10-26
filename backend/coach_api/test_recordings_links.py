"""Occurrence links: isolated SQLite projection + mocked endpoint services."""
from copy import deepcopy
from datetime import datetime,timedelta,timezone
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from django.conf import settings
from django.db import connections
from django.test import SimpleTestCase,RequestFactory
from django.test.utils import CaptureQueriesContext
from login import permissions
from . import recordings_links as links,recordings_index as index,recordings_link_api as api
from .models import CoachingCalendarIndex,CoachingCalendarMeeting

OWNER='coach@example.invalid'
START=datetime(2026,10,1,tzinfo=timezone.utc);END=datetime(2026,11,1,tzinfo=timezone.utc)
DAY=datetime(2026,10,20,tzinfo=timezone.utc);STAMP=datetime(2026,10,24,tzinfo=timezone.utc)
EVENT={'id':'event-one','subject':'Synthetic monthly coaching',
 'start':{'dateTime':'2026-10-20T09:00:00Z'},'end':{'dateTime':'2026-10-20T10:00:00Z'},
 'attendees':[{'emailAddress':{'address':'learner@example.invalid'}}]}


class LinkedIndexTests(TestCase):
    @classmethod
    def setUpClass(cls):
        assert settings.COACH_TEST_MODE and all(v['ENGINE']=='django.db.backends.sqlite3' for v in connections.databases.values())
        cls.alias='coaching_links_memory'
        config=deepcopy(connections['default'].settings_dict);config['NAME']=':memory:'
        connections.databases[cls.alias]=config
        with connections[cls.alias].schema_editor() as schema:
            schema.create_model(CoachingCalendarIndex);schema.create_model(CoachingCalendarMeeting)
    @classmethod
    def tearDownClass(cls):
        connections[cls.alias].close();del connections[cls.alias];del connections.databases[cls.alias]
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch('socket.socket',side_effect=AssertionError('Network forbidden')).start()
        patch.object(index.router,'db_for_read',return_value=self.alias).start()
        patch.object(index.router,'db_for_write',return_value=self.alias).start()
        CoachingCalendarIndex.objects.all().delete()
    def publish(self,key='month',events=None,stamp=STAMP,start=START,end=END,owner=OWNER):
        index.publish_calendar_index(key,{'owner':owner,'start':start.isoformat(),'end':end.isoformat()},[EVENT] if events is None else events,stamp)
    def test_id_is_stable_across_windows_titles_duration_and_timezone_representation(self):
        identity=links.meeting_id(OWNER,EVENT)
        changed={**EVENT,'subject':'New title','start':{'dateTime':'2026-10-20T10:00:00','timeZone':'GMT Standard Time'},'end':{'dateTime':'2026-10-20T12:00:00Z'}}
        self.assertEqual(identity,links.meeting_id(OWNER.upper(),changed))
        self.publish();self.publish(key='week',start=DAY,end=DAY+timedelta(days=7))
        self.assertEqual(links.linked_meeting(identity,[OWNER],DAY,DAY+timedelta(days=1))['event']['id'],'event-one')
        self.assertNotEqual(identity,links.meeting_id('other@example.invalid',EVENT))
        self.assertNotEqual(identity,links.meeting_id(OWNER,{**EVENT,'start':{'dateTime':'2026-10-20T11:00:00Z'},'end':{'dateTime':'2026-10-20T12:00:00Z'}}))
    def test_resolves_one_day_in_one_sql_query_without_source_jobs(self):
        self.publish()
        with CaptureQueriesContext(connections[self.alias]) as queries:
            row=links.linked_meeting(links.meeting_id(OWNER,EVENT),[OWNER],DAY,DAY+timedelta(days=1))
        self.assertIsNotNone(row);self.assertEqual(len(queries),1)
        self.assertNotIn('recording_job',queries[0]['sql'])
        self.assertIsNone(links.linked_meeting(links.meeting_id(OWNER,EVENT),['other@example.invalid'],DAY,DAY+timedelta(days=1)))
    def test_newer_empty_snapshot_cannot_resurrect_a_removed_meeting(self):
        self.publish();self.publish(key='newer',events=[],stamp=STAMP+timedelta(minutes=1))
        self.assertIsNone(links.linked_meeting(links.meeting_id(OWNER,EVENT),[OWNER],DAY,DAY+timedelta(days=1)))
    def test_newer_duration_and_metadata_are_returned_without_changing_id(self):
        self.publish()
        changed={**EVENT,'subject':'Updated meeting','end':{'dateTime':'2026-10-20T10:30:00Z'}}
        self.publish(key='newer',events=[changed],stamp=STAMP+timedelta(minutes=1))
        row=links.linked_meeting(links.meeting_id(OWNER,EVENT),[OWNER],DAY,DAY+timedelta(days=1))
        self.assertEqual(row['event']['subject'],'Updated meeting')


class LinkedEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory=RequestFactory();self.staff=SimpleNamespace(id=1,email=OWNER,username='Synthetic Coach',access='curriculum',access_extra='')
        def auth(request):request.login_account=SimpleNamespace(subject_id=1,subject_type='staff',role='staff');return request.login_account
        self.enterContext(patch.object(permissions,'authenticate_request',side_effect=auth))
        self.enterContext(patch.object(permissions,'_accesses_of',return_value=frozenset({'curriculum'})))
        self.enterContext(patch.object(api,'_staff',return_value=self.staff))
        self.enterContext(patch.object(api,'_coaches',return_value=[{'email':OWNER,'name':'Synthetic Coach'}]))
        self.enterContext(patch.object(api,'_learners',return_value=[{'id':1,'email':'learner@example.invalid','full_name':'Synthetic Learner','coach_email':OWNER,'learner_type':'apprenticeship'}]))
        self.enterContext(patch.object(api,'_bookings',return_value=[]))
        self.extra=self.enterContext(patch.object(api,'additional_attendees',return_value=[]))
        self.enterContext(patch.object(api,'lecture_occurrences',return_value=[]))
        self.enterContext(patch.object(api,'source_details',return_value=None))
        self.lookup=self.enterContext(patch.object(api,'linked_meeting',return_value={'event':EVENT,'snapshot__owner_email':OWNER,'snapshot__source_success_at':STAMP}))
        self.enterContext(patch('socket.socket',side_effect=AssertionError('Network forbidden')))
    def get(self,query='date=2026-10-20&timeZone=UTC',identity=None):
        return api.coaching_linked_meeting(self.factory.get('/linked?'+query),identity or links.meeting_id(OWNER,EVENT))
    def test_curriculum_gets_current_signed_reference_and_exact_occurrence(self):
        import json
        from .recordings_calendar_media import read_reference
        response=self.get();self.assertEqual(response.status_code,200)
        value=json.loads(response.content)
        self.assertEqual(value['meeting']['meetingId'],links.meeting_id(OWNER,EVENT))
        self.assertEqual(read_reference(value['meeting']['recordingsReference'])['event'],'event-one')
        self.assertEqual(value['learners'],[{'id':'1','name':'Synthetic Learner'}])
        self.assertEqual(self.lookup.call_args.args[1],[OWNER])
    def test_revoked_role_is_denied_and_coach_cannot_read_foreign_owner(self):
        self.staff.access='tutor';self.assertEqual(self.get().status_code,403);self.lookup.assert_not_called()
        self.staff.access='coach';self.lookup.return_value={'event':EVENT,'snapshot__owner_email':'other@example.invalid','snapshot__source_success_at':STAMP}
        self.assertEqual(self.get().status_code,404)
        self.extra.assert_not_called()
    def test_curriculum_keeps_cross_coach_invited_learners_but_coach_scope_stays_own(self):
        import json
        self.extra.return_value=[{'id':2,'email':'learner@example.invalid','full_name':'Invited Learner','coach_email':'other@example.invalid','learner_type':'apprenticeship'}]
        data=json.loads(self.get().content)
        self.assertIn('2',data['meeting']['learnerIds'])
        self.extra.reset_mock();self.staff.access='coach'
        data=json.loads(self.get().content)
        self.assertNotIn('2',data['meeting']['learnerIds']);self.extra.assert_not_called()
    def test_invalid_id_missing_and_dst_boundaries_are_explicit(self):
        self.assertEqual(self.get(identity='bad-id').status_code,400);self.lookup.assert_not_called()
        self.lookup.return_value=None
        self.assertEqual(self.get('date=2026-10-25&timeZone=Europe/London').status_code,404)
        args=self.lookup.call_args.args;self.assertEqual((args[3]-args[2]).total_seconds(),25*3600)
