"""Run directly with Python. No Django setup, database, credentials or network.

Covers which onlineMeeting options a save sends (teams_meeting_options_policy)
and the read-only Microsoft permission check (teams_permission_check).
"""
import base64
import json
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
for name, attrs in {'django': {}, 'django.http': {'JsonResponse': dict},
                    'django.views': {}, 'django.views.decorators': {},
                    'django.views.decorators.http': {'require_GET': lambda view: view},
                    'login': {}, 'login.permissions': {'require_role': lambda *roles: (lambda view: view)}}.items():
    module = sys.modules.setdefault(name, types.ModuleType(name))
    for key, value in attrs.items():
        setattr(module, key, value)
from curriculum_api.teams_meeting_options_policy import (  # noqa: E402
    changed_option_groups, graph_error_details, meeting_options_patch, option_groups_to_apply, pending_option_groups,
    pending_warning, remaining_pending, reported_failure, stored_options)
from curriculum_api.teams_permission_check import permission_report, read_only, token_claims  # noqa: E402

FORBIDDEN = ('Microsoft Graph PATCH users/737679b4-8eac-4fe9-a491-76d8cdf65f6d/onlineMeetings/M failed: HTTP 403; '
             'code=Forbidden; message=insufficient permissions; request-id=2b7979e0-6f5a-411b-b0fa-6a087e438bc5')
STORED = {'recording': 'record', 'lobby_bypass': 'invited', 'spoken_language': 'en-GB',
          'presenters': ['tutor@example.invalid'], 'co_organizers': []}


class GroupTests(unittest.TestCase):
    def test_attendee_changes_are_not_a_meeting_option_change(self):
        self.assertEqual(changed_option_groups(STORED, dict(STORED)), set())
        self.assertEqual(option_groups_to_apply(STORED, dict(STORED)), set())

    def test_each_kind_of_change_maps_to_its_own_group(self):
        self.assertEqual(changed_option_groups(STORED, {**STORED, 'lobby_bypass': 'organizer'}), {'settings'})
        self.assertEqual(changed_option_groups(STORED, {**STORED, 'recording': 'record-transcribe'}), {'settings'})
        self.assertEqual(changed_option_groups(STORED, {**STORED, 'co_organizers': ['co@example.invalid']}), {'roles'})
        self.assertEqual(changed_option_groups(STORED, {**STORED, 'presenters': ['TUTOR@example.invalid ']}), set())
        self.assertEqual(changed_option_groups(STORED, {**STORED, 'presenters': []}), {'roles'})

    def test_promoting_a_presenter_to_co_organiser_is_a_role_change(self):
        promoted = {**STORED, 'presenters': [], 'co_organizers': ['tutor@example.invalid']}
        self.assertEqual(changed_option_groups(STORED, promoted), {'roles'})

    def test_a_new_meeting_gets_everything(self):
        self.assertEqual(option_groups_to_apply(STORED, dict(STORED), new_meeting=True), {'settings', 'roles'})

    def test_pending_groups_retry_only_when_allowed(self):
        self.assertEqual(option_groups_to_apply(STORED, dict(STORED), {'roles'}), {'roles'})
        self.assertEqual(option_groups_to_apply(STORED, dict(STORED), {'roles'}, retry_pending=False), set())

    def test_pending_survives_saves_that_did_not_retry_it(self):
        self.assertEqual(remaining_pending({'roles'}, set(), set()), {'roles'})
        self.assertEqual(remaining_pending({'roles'}, {'roles'}, set()), set())
        self.assertEqual(remaining_pending(set(), {'settings'}, {'settings'}), {'settings'})

    def test_pending_is_read_back_from_saved_warnings(self):
        marker = pending_warning({'roles'}, {'detail': FORBIDDEN})
        self.assertEqual(pending_option_groups([marker, {'code': 'other'}]), {'roles'})
        # An older warning without groups means everything is unapplied.
        self.assertEqual(pending_option_groups([{'code': 'teams_meeting_options_not_applied'}]), {'settings', 'roles'})
        self.assertEqual(marker['graphError']['requestId'], '2b7979e0-6f5a-411b-b0fa-6a087e438bc5')

    def test_stored_options_read_json_text_columns(self):
        series = {'recording': 'RECORD', 'presenters': '["Tutor@Example.invalid", {"email": "x@example.invalid"}]',
                  'co_organizers': None}
        self.assertEqual(stored_options(series), {'recording': 'record', 'lobby_bypass': 'invited', 'spoken_language': 'en-GB',
                                                  'presenters': ['tutor@example.invalid', 'x@example.invalid'],
                                                  'co_organizers': []})


class PatchBodyTests(unittest.TestCase):
    PEOPLE = dict(attendees=['learner@example.invalid'], presenters=['tutor@example.invalid'],
                  co_organizers=['co@example.invalid'])

    def body(self, groups, **extra):
        return meeting_options_patch(groups, recording='record-transcribe', lobby_scope='invited',
                                     spoken_language='en-GB', **{**self.PEOPLE, **extra})

    def test_no_groups_no_body(self):
        self.assertEqual(self.body(set()), {})

    def test_settings_alone_never_touch_participants(self):
        body = self.body({'settings'})
        self.assertEqual(set(body), {'lobbyBypassSettings', 'allowRecording', 'recordAutomatically',
                                     'allowTranscription', 'meetingSpokenLanguageTag'})
        self.assertTrue(body['allowRecording'] and body['recordAutomatically'] and body['allowTranscription'])

    def test_roles_send_the_full_roster_with_role_is_presenter(self):
        body = self.body({'roles'})
        self.assertEqual(set(body), {'participants', 'allowedPresenters'})
        self.assertEqual(body['allowedPresenters'], 'roleIsPresenter')
        self.assertEqual(body['participants']['attendees'], [
            {'upn': 'co@example.invalid', 'role': 'coorganizer'},
            {'upn': 'tutor@example.invalid', 'role': 'presenter'},
            {'upn': 'learner@example.invalid', 'role': 'attendee'}])

    def test_nobody_presenting_leaves_allowed_presenters_alone(self):
        body = self.body({'roles'}, presenters=[], co_organizers=[])
        self.assertNotIn('allowedPresenters', body)

    def test_all_groups_match_the_previous_full_body(self):
        body = self.body({'settings', 'roles'})
        self.assertEqual(set(body), {'lobbyBypassSettings', 'allowRecording', 'recordAutomatically', 'allowTranscription',
                                     'meetingSpokenLanguageTag', 'participants', 'allowedPresenters'})


class ErrorTests(unittest.TestCase):
    def test_graph_error_fields(self):
        error = graph_error_details(FORBIDDEN, at='2026-10-08T12:00:00+00:00')
        self.assertEqual((error['status'], error['code'], error['message'], error['requestId'], error['method']),
                         (403, 'Forbidden', 'insufficient permissions', '2b7979e0-6f5a-411b-b0fa-6a087e438bc5', 'PATCH'))

    def test_unrecognised_text_is_kept_as_the_message(self):
        self.assertEqual(graph_error_details('network down')['message'], 'network down')

    def test_reported_failure_says_what_was_saved(self):
        item = reported_failure({'code': 'teams_meeting_options_not_applied', 'groups': ['roles'], 'detail': FORBIDDEN})
        self.assertIn('Invitations and dates were saved', item['message'])
        self.assertIn('presenter and co-organiser roles', item['message'])
        self.assertIn('HTTP 403 Forbidden insufficient permissions', item['message'])


def token(roles):
    payload = base64.urlsafe_b64encode(json.dumps({'roles': roles, 'appid': 'APP', 'tid': 'TEN'}).encode()).decode().rstrip('=')
    return f'header.{payload}.signature'


class PermissionCheckTests(unittest.TestCase):
    SETTINGS = {'client_id': 'APP', 'tenant_id': 'TEN', 'base_url': 'https://graph.microsoft.com/v1.0',
                'client_secret': 'never-shown'}
    OID = '737679b4-8eac-4fe9-a491-76d8cdf65f6d'

    def run_check(self, responses, *, roles=('OnlineMeetings.ReadWrite.All',), series=None):
        self.calls = []

        def graph(method, path, **kwargs):
            self.calls.append((method, path, kwargs))
            for prefix, answer in responses.items():
                if path.startswith(prefix):
                    if isinstance(answer, Exception):
                        raise answer
                    return answer
            raise RuntimeError(f'Microsoft Graph GET {path} failed: HTTP 404; code=NotFound')

        return permission_report(series or {}, graph_request=graph, graph_settings=self.SETTINGS, token=token(list(roles)),
                                 owner_id=self.OID, organizer='tutor@example.invalid', online_meeting_id='M',
                                 join_url='https://teams.example.invalid/x',
                                 now=datetime(2026, 10, 8, 12, tzinfo=timezone.utc))

    def by_key(self, report):
        return {item['key']: item for item in report['checks']}

    def test_only_reads_and_never_returns_secrets(self):
        report = self.run_check({'users/tutor': {'id': self.OID}, f'users/{self.OID}/onlineMeetings/': {
            'participants': {'organizer': {'identity': {'user': {'id': self.OID}}}}}})
        self.assertEqual({method for method, _path, _kw in self.calls}, {'GET'})
        self.assertFalse(any(kwargs for _m, _p, kwargs in self.calls))
        text = json.dumps(report)
        self.assertNotIn('never-shown', text)
        self.assertNotIn('signature', text)
        self.assertEqual(report['verdict'], 'pass')
        self.assertTrue(report['readOnly'])

    def test_read_only_refuses_any_write(self):
        with self.assertRaises(PermissionError):
            read_only(lambda *a, **k: {})('PATCH', 'users/x/onlineMeetings/y', payload={})

    def test_missing_permission_in_token(self):
        report = self.run_check({'users/tutor': {'id': self.OID}}, roles=['Calendars.ReadWrite'])
        self.assertEqual(self.by_key(report)['app_permission']['status'], 'fail')
        self.assertTrue(any('admin consent' in action for action in report['actions']))

    def test_meeting_read_refused_points_at_the_access_policy(self):
        report = self.run_check({'users/tutor': {'id': self.OID}, f'users/{self.OID}/onlineMeetings/': RuntimeError(
            'Microsoft Graph GET x failed: HTTP 403; code=Forbidden; message=No application access policy found for this app')})
        access = self.by_key(report)['meeting_access']
        self.assertEqual(access['status'], 'fail')
        self.assertEqual(access['graphError']['status'], 403)
        self.assertIn('application access policy', access['summary'])
        self.assertTrue(any(self.OID in command for command in report['adminCommands']))
        self.assertTrue(all(line.startswith('#') or 'Grant-' not in line for line in report['adminCommands']))

    def test_readable_meeting_with_refused_write_points_elsewhere(self):
        series = {'warnings': json.dumps([pending_warning({'roles'}, {'detail': FORBIDDEN})])}
        report = self.run_check({'users/tutor': {'id': self.OID}, f'users/{self.OID}/onlineMeetings/': {
            'participants': {'organizer': {'identity': {'user': {'id': self.OID}}}}}}, series=series)
        checks = self.by_key(report)
        self.assertEqual(checks['meeting_access']['status'], 'pass')
        self.assertEqual(checks['last_options_write']['graphError']['requestId'], '2b7979e0-6f5a-411b-b0fa-6a087e438bc5')
        self.assertTrue(any('access policy is in place' in action for action in report['actions']))

    def test_organiser_mismatch_is_reported_not_granted(self):
        report = self.run_check({'users/tutor': {'id': 'someone-else'}})
        self.assertEqual(self.by_key(report)['organizer_identity']['status'], 'fail')

    def test_token_claims_ignore_garbage(self):
        self.assertFalse(token_claims('not-a-token')['readable'])
        self.assertEqual(token_claims(token(['A']))['roles'], ['A'])


if __name__ == '__main__':
    with patch('socket.socket', side_effect=AssertionError('Network forbidden')):
        unittest.main(verbosity=2)
