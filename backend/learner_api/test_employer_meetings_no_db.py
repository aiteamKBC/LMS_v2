"""Real invitation projection/permission decisions with synthetic Graph/ORM."""
from copy import deepcopy
from datetime import datetime, timezone
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import employer_meetings as meetings


class EmployerTeamsMeetingsTests(SimpleTestCase):
    def setUp(self):
        self.now = datetime(2026, 11, 25, 10, tzinfo=timezone.utc)
        self.employer = SimpleNamespace(pk=9, email='employer@example.test')
        self.owner = {'id': '101', 'kind': 'commercial', 'name': 'Example Learner',
                      'emails': ['learner@example.test'], 'coachName': 'Example Coach'}
        self.event = {'id': 'graph-1', 'iCalUId': 'uid-1', 'subject': 'Progress discussion',
                      'start': {'dateTime': '2026-12-07T10:00:00', 'timeZone': 'UTC'},
                      'end': {'dateTime': '2026-12-07T11:00:00', 'timeZone': 'UTC'},
                      'sensitivity': 'normal', 'isCancelled': False,
                      'attendees': [{'emailAddress': {'address': address}} for address in
                                    ('employer@example.test', 'learner@example.test')],
                      'onlineMeeting': {'joinUrl': 'https://teams.microsoft.com/meet/synthetic'}}
        self.roster_patcher = patch.object(meetings, 'owned_calendar_roster', return_value=({'coach@example.test': [self.owner]}, 0))
        self.roster = self.roster_patcher.start()
        self.addCleanup(self.roster_patcher.stop)
        for name, patcher in (
            ('calendar', patch.object(meetings, 'load_coach_calendar', return_value=[self.event])),
            ('cache', patch.object(meetings, 'cache')),
        ):
            setattr(self, name, patcher.start())
            self.addCleanup(patcher.stop)
        self.cache.get.return_value = None

    def read(self):
        return meetings.read_employer_meetings(self.employer, now=self.now)

    def test_live_only_invitation_appears_without_creating_a_booking_or_form(self):
        result = self.read()
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(len(result['meetings']), 1)
        invitation = result['meetings'][0]
        self.assertEqual(invitation['scheduledDate'], '2026-12-07')
        self.assertEqual(invitation['scheduledTime'], '10:00')
        self.assertEqual(invitation['learners'], [{key: self.owner[key] for key in ('id', 'kind', 'name')}])
        self.assertNotIn('reviewInstanceId', invitation)
        self.assertNotIn('emails', invitation['learners'][0])
        self.assertEqual(self.calendar.call_count, 3)
        for _owner, start, end in (call.args for call in self.calendar.call_args_list):
            self.assertLessEqual((end - start).days, 31)

    def test_requires_employer_invitation_and_an_owned_learner(self):
        for address in ('employer@example.test', 'learner@example.test'):
            event = deepcopy(self.event)
            event['attendees'] = [party for party in event['attendees'] if party['emailAddress']['address'] != address]
            self.calendar.return_value = [event]
            self.assertEqual(self.read()['meetings'], [])

    def test_cancelled_declined_private_and_invalid_links_are_not_exposed(self):
        variants = [{'isCancelled': True}, {'sensitivity': 'private'}, {'sensitivity': None},
                    {'isAllDay': True}, {'onlineMeeting': {'joinUrl': 'javascript:alert(1)'}},
                    {'onlineMeeting': {'joinUrl': 'https://user:password@example.test/'}},
                    {'attendees': [{'emailAddress': {'address': 'employer@example.test'}, 'status': {'response': 'declined'}},
                                   {'emailAddress': {'address': 'learner@example.test'}}]}]
        for variant in variants:
            with self.subTest(variant=variant):
                self.calendar.return_value = [{**self.event, **variant}]
                self.assertEqual(self.read()['meetings'], [])

    def test_ended_and_out_of_window_events_stay_excluded(self):
        for day in ('2026-11-01', '2027-11-01'):
            self.calendar.return_value = [{**self.event,
                'start': {'dateTime': day + 'T10:00:00Z'}, 'end': {'dateTime': day + 'T11:00:00Z'}}]
            self.assertEqual(self.read()['meetings'], [])

    def test_utc_instants_display_with_uk_dst(self):
        start = datetime(2026, 3, 28, tzinfo=timezone.utc)
        end = datetime(2026, 3, 31, tzinfo=timezone.utc)
        event = {**self.event, 'start': {'dateTime': '2026-03-29T09:00:00Z'}, 'end': {'dateTime': '2026-03-29T10:00:00Z'}}
        row = meetings.project_invitations([event], [self.owner], self.employer.email, start, end)[0]
        self.assertEqual((row['scheduledTime'], row['endTime']), ('10:00', '11:00'))

    def test_recurrence_and_multiple_calendar_copies_do_not_duplicate_invitation(self):
        self.roster.return_value = ({'coach@example.test': [self.owner], 'second@example.test': [self.owner]}, 0)
        self.assertEqual(len(self.read()['meetings']), 1)
        next_occurrence = deepcopy(self.event)
        next_occurrence['start']['dateTime'] = '2026-12-14T10:00:00Z'
        next_occurrence['end']['dateTime'] = '2026-12-14T11:00:00Z'
        self.calendar.return_value = [self.event, next_occurrence]
        self.assertEqual(len(self.read()['meetings']), 2)

    def test_graph_failure_is_an_error_and_is_not_cached_as_empty(self):
        self.calendar.side_effect = RuntimeError('synthetic transport failure')
        result = self.read()
        self.assertEqual(result['status'], 'error')
        self.assertEqual(result['meetings'], [])
        self.cache.set.assert_not_called()

    def test_partial_graph_failure_preserves_successful_calendars(self):
        self.roster.return_value = ({'coach@example.test': [self.owner], 'failed@example.test': [self.owner]}, 0)
        self.calendar.side_effect = lambda owner, *_: [self.event] if owner.startswith('coach@') else (_ for _ in ()).throw(RuntimeError())
        result = self.read()
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(len(result['meetings']), 1)
        self.cache.set.assert_not_called()

    def test_cache_scope_changes_when_employer_address_or_roster_changes(self):
        self.read()
        first = self.cache.get.call_args.args[0]
        self.employer.email = 'other@example.test'
        self.read()
        self.assertNotEqual(self.cache.get.call_args.args[0], first)

    def test_owned_roster_resolves_identity_without_healing_or_trusting_client_mailboxes(self):
        self.roster_patcher.stop()
        model = MagicMock()
        source = SimpleNamespace(pk=101, email='learner@example.test', username='Example Learner', learner_type='commercial')
        model.all_learners.filter.return_value.only.return_value = [source]
        with patch.object(meetings.portal, 'SOURCE_MODELS', {'apprenticeship': model}), \
                patch.object(meetings, 'learner_profile_for_source', return_value=SimpleNamespace(email=source.email)) as profile, \
                patch.object(meetings, 'current_coach', return_value={'coach_email': 'coach@example.test', 'coach_name': 'Coach'}):
            roster, missing = meetings.owned_calendar_roster(self.employer)
        model.all_learners.filter.assert_called_once_with(employer_id=9)
        self.assertFalse(profile.call_args.kwargs['heal'])
        self.assertEqual(missing, 0)
        self.assertEqual(roster['coach@example.test'][0]['kind'], 'commercial')

    def test_endpoint_enforces_account_role_and_ownership_before_calendar_reads(self):
        for role, subject, employer_id, expected in (
            ('employer', 9, 10, 404), ('learner', 101, 9, 403), ('staff', 88, 9, 200), ('employer', 9, 9, 200),
        ):
            with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                    patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role, subject_id=subject)), \
                    patch.object(meetings.portal, '_employer_or_404', return_value=(self.employer, None)), \
                    patch.object(meetings, 'read_employer_meetings', return_value={'meetings': [], 'status': 'ready'}) as reader:
                response = meetings.employer_meetings(RequestFactory().get('/meetings/'), employer_id=employer_id)
                self.assertEqual(response.status_code, expected)
                self.assertEqual(reader.call_count, int(expected == 200))
                if expected == 200:
                    self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_post_cannot_create_or_modify_meetings(self):
        response = meetings.employer_meetings(RequestFactory().post('/meetings/'), employer_id=9)
        self.assertEqual(response.status_code, 405)
        self.calendar.assert_not_called()
