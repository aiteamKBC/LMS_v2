"""Mocked live-role repair checks; no Django, database, credentials or network."""
import copy
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('curriculum_api', package)
from curriculum_api.teams_presenter_rooms import (
    UnsafeRoomPromotion, apply_room_promotion, confirm_room_promotion, prepare_room_promotion,
)


class ExistingRoomPermissionsTests(unittest.TestCase):
    def setUp(self):
        self.target = {'joinUrl': 'https://teams.microsoft.com/meet/synthetic',
                       'ownerId': 'owner-id', 'organizerEmail': 'owner@example.invalid'}
        self.meeting = {
            'meetingType': 'scheduled',
            'id': 'meeting-id', 'joinWebUrl': self.target['joinUrl'], 'allowBreakoutRooms': True,
            'allowRecording': True, 'recordAutomatically': True, 'lobbyBypassSettings': {'scope': 'invited'},
            'participants': {
                'organizer': {'identity': {'user': {'id': 'owner-id'}}, 'upn': 'owner@example.invalid'},
                'attendees': [
                    {'identity': {'user': {'id': 'tutor-id'}}, 'upn': 'tutor@example.invalid', 'role': 'presenter'},
                    {'upn': 'learner@example.invalid', 'role': 'attendee'},
                    {'upn': 'co@example.invalid', 'role': 'coorganizer'},
                ],
            },
        }
        self.event = {'id': 'event-id', 'hideAttendees': True, 'isCancelled': False,
                      'onlineMeeting': {'joinUrl': self.target['joinUrl']},
                      'attendees': [{'emailAddress': {'address': email}} for email in
                                    ('tutor@example.invalid', 'learner@example.invalid', 'co@example.invalid')]}
        self.accounts = [{'id': 'tutor-id', 'email': 'tutor@example.invalid', 'userPrincipalName': 'tutor@example.invalid',
                          'userType': 'Member', 'accountEnabled': True, 'staffVerified': True}]

    def plan(self):
        return prepare_room_promotion(self.target, self.meeting, self.event, self.accounts, ['co@example.invalid'])

    def test_existing_tutor_gets_rooms_without_any_calendar_or_mail_write(self):
        original = copy.deepcopy(self.meeting)
        plan = self.plan()
        calls = []
        def graph(method, path, payload=None):
            calls.append((method, path, payload))
            self.assertEqual(path, 'users/owner-id/onlineMeetings/meeting-id')
            if method == 'PATCH':
                self.assertEqual(set(payload), {'participants'})
                self.meeting['participants']['attendees'] = copy.deepcopy(payload['participants']['attendees'])
                return copy.deepcopy(self.meeting)
            self.assertEqual(method, 'GET')
            return copy.deepcopy(self.meeting)
        apply_room_promotion(plan, 'users/owner-id/onlineMeetings/meeting-id', graph, lambda: copy.deepcopy(self.event))
        self.assertEqual([item['role'] for item in self.meeting['participants']['attendees']],
                         ['coorganizer', 'attendee', 'coorganizer'])
        self.assertEqual(self.meeting['lobbyBypassSettings'], original['lobbyBypassSettings'])
        self.assertEqual(self.meeting['joinWebUrl'], original['joinWebUrl'])
        self.assertEqual(sum(method == 'PATCH' for method, _, _ in calls), 1)
        # The next run is idempotent, with no extra write or invitation.
        self.assertIsNone(self.plan()['payload'])

    def test_limit_preserves_every_current_coorganizer(self):
        self.meeting['participants']['attendees'].extend(
            {'upn': f'co{i}@example.invalid', 'role': 'coorganizer'} for i in range(9))
        with self.assertRaisesRegex(UnsafeRoomPromotion, 'coorganizer_limit'):
            self.plan()

    def test_recurring_or_unconfirmed_meeting_type_is_skipped_before_role_writes(self):
        for meeting_type in ('recurring', 'unknownFutureValue', None):
            with self.subTest(meeting_type=meeting_type):
                self.meeting['meetingType'] = meeting_type
                original = copy.deepcopy(self.meeting)
                with self.assertRaisesRegex(UnsafeRoomPromotion, 'meeting_type_role_update_requires_review'):
                    self.plan()
                self.assertEqual(self.meeting, original)

    def test_existing_coorganizer_metadata_can_be_reconciled_without_patching_a_series(self):
        self.meeting['meetingType'] = 'recurring'
        self.meeting['participants']['attendees'][0]['role'] = 'coorganizer'
        self.assertIsNone(self.plan()['payload'])

    def test_student_external_disabled_or_unverified_accounts_are_never_promoted(self):
        for changes in ({'staffVerified': False}, {'userType': 'Guest'}, {'accountEnabled': False}):
            with self.subTest(changes=changes):
                self.accounts[0].update(changes)
                with self.assertRaisesRegex(UnsafeRoomPromotion, 'presenter_account_unconfirmed'):
                    self.plan()
                self.setUp()

    def test_privacy_identity_and_policy_uncertainty_block_before_writing(self):
        for source, key, value, reason in [
            ('event', 'hideAttendees', False, 'calendar_privacy_unconfirmed'),
            ('event', 'isCancelled', True, 'calendar_not_active'),
            ('meeting', 'joinWebUrl', 'different-link', 'meeting_identity_unconfirmed'),
            ('meeting', 'allowBreakoutRooms', False, 'breakout_rooms_not_enabled'),
        ]:
            with self.subTest(reason=reason):
                getattr(self, source)[key] = value
                with self.assertRaisesRegex(UnsafeRoomPromotion, reason):
                    self.plan()
                self.setUp()

    def test_uninvited_and_missing_presenters_are_not_silently_added(self):
        self.event['attendees'] = []
        with self.assertRaisesRegex(UnsafeRoomPromotion, 'presenter_not_already_invited'):
            self.plan()
        self.setUp()
        self.meeting['participants']['attendees'].pop(0)
        with self.assertRaisesRegex(UnsafeRoomPromotion, 'presenter_not_in_live_roster'):
            self.plan()

    def test_concurrent_change_prevents_the_write(self):
        plan = self.plan()
        self.meeting['lobbyBypassSettings']['scope'] = 'everyone'
        calls = []
        def graph(method, path, payload=None):
            calls.append(method)
            return copy.deepcopy(self.meeting)
        with self.assertRaisesRegex(UnsafeRoomPromotion, 'concurrent_meeting_change'):
            apply_room_promotion(plan, 'users/owner-id/onlineMeetings/meeting-id', graph, lambda: self.event)
        self.assertEqual(calls, ['GET'])

    def test_success_response_without_effective_roles_is_not_reported_as_success(self):
        plan = self.plan()
        with self.assertRaisesRegex(UnsafeRoomPromotion, 'microsoft_readback_unconfirmed'):
            confirm_room_promotion(plan, self.meeting, self.event)

    def test_an_unrelated_participant_identity_change_prevents_the_write(self):
        plan = self.plan()
        self.meeting['participants']['attendees'][1]['upn'] = 'changed@example.invalid'
        with self.assertRaisesRegex(UnsafeRoomPromotion, 'concurrent_meeting_change'):
            apply_room_promotion(plan, 'users/owner-id/onlineMeetings/meeting-id',
                                 lambda *args, **kwargs: copy.deepcopy(self.meeting), lambda: self.event)

    def test_event_or_mail_paths_can_never_be_written(self):
        for path in ('users/owner-id/events/event-id', 'users/owner-id/sendMail',
                     'users/owner-id/onlineMeetings/meeting-id/events/event-id'):
            with self.assertRaisesRegex(UnsafeRoomPromotion, 'invalid_meeting_path'):
                apply_room_promotion(self.plan(), path, lambda *a, **k: self.fail('No request allowed'), lambda: self.event)

    def test_a_matching_email_does_not_override_a_different_microsoft_identity(self):
        self.meeting['participants']['attendees'][0]['identity']['user']['id'] = 'different-user-id'
        with self.assertRaisesRegex(UnsafeRoomPromotion, 'presenter_identity_mismatch'):
            self.plan()


if __name__ == '__main__':
    unittest.main()
