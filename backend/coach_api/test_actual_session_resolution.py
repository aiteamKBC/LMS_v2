"""Offline strict Graph target checks for the imported meeting reader."""
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from .actual_session_resolution import VerifiedMeetingTarget, strict_imported_meeting_target


class StrictImportedTargetTests(SimpleTestCase):
    def setUp(self):
        self.record = SimpleNamespace(graph_event_id='event-a', graph_organizer_email='coach@example.invalid',
            owner_email='coach@example.invalid', meeting_link='https://teams.microsoft.com/meeting-a')
        self.event = {'id': 'event-a', 'organizer': {'emailAddress': {'address': 'coach@example.invalid'}},
                      'onlineMeeting': {'joinUrl': self.record.meeting_link}}
        self.meeting = {'id': 'online-a', 'joinWebUrl': self.record.meeting_link}

    def resolve(self, event=None, collection=None):
        with patch('coach_api.views.microsoft_graph_request', side_effect=[
                self.event if event is None else event,
                {'value': [self.meeting]} if collection is None else collection]) as graph, \
             patch('curriculum_api.views.teams_online_meeting_owner_id', return_value='coach@example.invalid'), \
             patch('curriculum_api.views.teams_meeting_base_path', return_value='verified-base'):
            result = strict_imported_meeting_target(self.record)
        self.assertEqual(graph.call_count, 2)
        return result

    def test_unique_exact_match_uses_calendar_provenance(self):
        self.assertEqual(self.resolve(), ('verified-base', None))

    def test_multiple_matches_or_unfinished_collection_are_rejected(self):
        for collection in ({'value': [self.meeting, {**self.meeting, 'id': 'online-b'}]},
                           {'value': [self.meeting], '@odata.nextLink': 'https://example.invalid/next'}):
            with self.subTest(collection=collection):
                base, error = self.resolve(collection=collection)
                self.assertEqual(base, '')
                self.assertEqual(error['code'], 'MEETING_TARGET_AMBIGUOUS')

    def test_calendar_join_or_organizer_mismatch_is_rejected(self):
        for event in ({**self.event, 'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/other'}},
                      {**self.event, 'organizer': {'emailAddress': {'address': 'other@example.invalid'}}}):
            with self.subTest(event=event):
                with patch('coach_api.views.microsoft_graph_request', return_value=event) as graph:
                    base, error = strict_imported_meeting_target(self.record)
                self.assertEqual(graph.call_count, 1)
                self.assertEqual(base, '')
                self.assertEqual(error['code'], 'MEETING_TARGET_UNVERIFIED')

    def test_calendar_and_online_meeting_ids_must_agree_when_graph_supplies_both(self):
        event = {**self.event, 'onlineMeeting': {**self.event['onlineMeeting'], 'id': 'other-online-id'}}
        base, error = self.resolve(event=event)
        self.assertEqual(base, '')
        self.assertEqual(error['code'], 'MEETING_TARGET_UNVERIFIED')

    def test_provider_organizer_conflict_is_rejected(self):
        self.meeting['participants'] = {'organizer': {'identity': {'user': {'id': '00000000-0000-0000-0000-000000000002'}}}}
        with patch('coach_api.views.microsoft_graph_request', side_effect=[self.event, {'value': [self.meeting]}]), \
             patch('curriculum_api.views.teams_online_meeting_owner_id',
                   return_value='00000000-0000-0000-0000-000000000001'):
            base, error = strict_imported_meeting_target(self.record)
        self.assertEqual(base, '')
        self.assertEqual(error['code'], 'MEETING_TARGET_UNVERIFIED')

    def test_provider_tenant_conflict_is_rejected_when_link_has_tenant_context(self):
        self.record.meeting_link = 'https://teams.microsoft.com/meeting-a?context=%7B%22Tid%22%3A%22tenant-one%22%7D'
        self.event['onlineMeeting']['joinUrl'] = self.record.meeting_link
        self.meeting['joinWebUrl'] = self.record.meeting_link
        self.meeting['participants'] = {'organizer': {'identity': {'user': {'tenantId': 'tenant-two'}}}}
        base, error = self.resolve()
        self.assertEqual(base, '')
        self.assertEqual(error['code'], 'MEETING_TARGET_UNVERIFIED')

    def test_target_requires_graph_tenant_and_independent_organizer_user(self):
        tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
        organizer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        self.record.pk = 71
        self.record.scheduled_date = date(2026, 10, 26)
        self.record.scheduled_time = time(14)
        self.record.duration_minutes = 60
        self.meeting['participants'] = {'organizer': {'identity': {'user': {
            'id': organizer, 'tenantId': tenant}}}}
        output = {}
        with patch('coach_api.views.microsoft_graph_request', side_effect=[
                self.event, {'value': [self.meeting]}, {'id': organizer}]) as graph, \
             patch('curriculum_api.views.teams_online_meeting_owner_id',
                   return_value='coach@example.invalid'), \
             patch('curriculum_api.views.teams_meeting_base_path', return_value='verified-base'):
            self.assertEqual(strict_imported_meeting_target(self.record, identity_out=output),
                             ('verified-base', None))
        self.assertEqual(graph.call_count, 3)
        self.assertIsInstance(output['target'], VerifiedMeetingTarget)
        self.assertEqual(output['target'].tenant_id, tenant)
        self.assertEqual(output['target'].organizer_id, organizer)
        self.assertEqual(output['target'].calendar_id, 71)

        for owner in ({'id': organizer}, {'id': organizer, 'tenantId': ''},
                      {'id': '', 'tenantId': tenant}):
            with self.subTest(owner=owner):
                meeting = {**self.meeting, 'participants': {'organizer': {'identity': {'user': owner}}}}
                output = {}
                with patch('coach_api.views.microsoft_graph_request', side_effect=[
                        self.event, {'value': [meeting]}, {'id': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'}]), \
                     patch('curriculum_api.views.teams_online_meeting_owner_id',
                           return_value='coach@example.invalid'):
                    base, error = strict_imported_meeting_target(self.record, identity_out=output)
                self.assertEqual(base, '')
                self.assertEqual(error['code'], 'MEETING_TARGET_UNVERIFIED')
                self.assertEqual(output, {})

