"""Run directly with Python. No database, credentials, network or Microsoft writes.

The intermittent HTTP 403 on the onlineMeeting PATCH, end to end:

* an invitation-only save never sends the onlineMeeting PATCH, even while
  Microsoft would refuse it, and sends no forward, no invitation and no
  cancellation;
* a save that changes a setting AND people keeps the people when Microsoft
  refuses the setting, and says the setting is not applied;
* Retry re-sends only the pending option groups, writes no calendar event and
  reports "saved" only once Microsoft's read-back shows the values;
* every refusal is recorded with the meeting, organiser, operation, time and
  Microsoft's request ID, and no credential.

The save itself is the real ``curriculum_teams_meeting_schedule`` and the real
``apply_teams_meeting_options``, read out of views.py by the calendar-checks
harness; only Microsoft is fake.
"""
import ast
import copy
import importlib.util
import json
import os
import sys
import types
import unittest
from datetime import datetime, timezone
from pathlib import Path

from unittest.mock import patch
from urllib.parse import urlparse

ROOT = Path(__file__).parent
for name, attrs in {'login': {}, 'login.permissions': {'require_role': lambda *roles: (lambda view: view)}}.items():
    try:
        __import__(name)
    except ImportError:
        module = sys.modules.setdefault(name, types.ModuleType(name))
        for key, value in attrs.items():
            setattr(module, key, value)

spec = importlib.util.spec_from_file_location('calendar_checks_harness', ROOT / 'test_calendar_checks_no_db.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)

REQUEST_ID = '2b7979e0-6f5a-411b-b0fa-6a087e438bc5'
OID = '737679b4-8eac-4fe9-a491-76d8cdf65f6d'
FORBIDDEN = (f'Microsoft Graph PATCH users/{OID}/onlineMeetings/online-1 failed: HTTP 403; code=Forbidden; '
             f'message=insufficient permissions; request-id={REQUEST_ID}')
LOBBY_VALUES = {'invited': 'invited', 'organization': 'organization',
                'organization-excluding-guests': 'organizationExcludingGuests', 'everyone': 'everyone',
                'organizer': 'organizer'}


def package_module(name):
    """Import a curriculum_api module from this folder without Django's app registry."""
    package = sys.modules.get('curriculum_api')
    if package is None or not getattr(package, '__path__', None):
        package = types.ModuleType('curriculum_api')
        package.__path__ = [str(ROOT)]
        sys.modules['curriculum_api'] = package
    return __import__(f'curriculum_api.{name}', fromlist=['*'])


class SummaryAndConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.retry = package_module('teams_options_retry')
        self.policy = package_module('teams_meeting_options_policy')

    def test_no_marker_is_saved(self):
        summary = self.retry.microsoft_update_summary([])
        self.assertEqual((summary['state'], summary['pendingGroups'], summary['retryable']), ('saved', [], False))

    def test_a_refused_marker_is_failed_with_the_request_id(self):
        marker = self.policy.pending_warning({'roles'}, {'detail': FORBIDDEN})
        summary = self.retry.microsoft_update_summary(json.dumps([marker]))
        self.assertEqual(summary['state'], 'failed')
        self.assertEqual(summary['pendingGroups'], ['roles'])
        self.assertTrue(summary['retryable'])
        self.assertEqual(summary['lastError']['status'], 403)
        self.assertEqual(summary['lastError']['requestId'], REQUEST_ID)
        self.assertIn('Invitations and dates are saved', summary['message'])

    def test_a_marker_without_a_refusal_is_pending(self):
        summary = self.retry.microsoft_update_summary([self.policy.pending_warning({'settings'}, {})])
        self.assertEqual(summary['state'], 'pending')

    def test_a_week_meeting_sentence_counts_as_every_group_pending(self):
        sentence = ('The Teams meeting exists, but Microsoft Graph did not apply its lobby, recording, transcription '
                    'and presenter options. (HTTP 403)')
        self.assertEqual(self.retry.pending_state([sentence])['groups'], {'settings', 'roles'})

    def test_an_unconfirmed_save_is_failed_but_not_retried_here(self):
        summary = self.retry.microsoft_update_summary([{'code': 'teams_calendar_unverified', 'message': 'x'}])
        self.assertEqual((summary['state'], summary['retryable']), ('failed', False))

    def test_read_back_confirms_only_what_microsoft_returns(self):
        expected = self.retry.expected_options({'settings', 'roles'}, {'recording': 'record', 'lobby_bypass': 'invited'},
                                               {'presenters': ['p@example.invalid'], 'co_organizers': ['C@example.invalid']},
                                               LOBBY_VALUES)
        held = {'allowRecording': True, 'recordAutomatically': True, 'allowTranscription': False,
                'lobbyBypassSettings': {'scope': 'invited'},
                'participants': {'attendees': [{'upn': 'c@example.invalid', 'role': 'coorganizer'},
                                               {'upn': 'p@example.invalid', 'role': 'presenter'}]}}
        self.assertEqual(self.retry.confirm_options(held, expected), ({'settings', 'roles'}, []))
        # A value Microsoft did not return is unconfirmed, never assumed.
        confirmed, problems = self.retry.confirm_options({**held, 'participants': None}, expected)
        self.assertEqual(confirmed, {'settings'})
        self.assertTrue(problems)
        confirmed, problems = self.retry.confirm_options({**held, 'allowRecording': False}, expected)
        self.assertEqual(confirmed, {'roles'})

    def test_meetings_are_listed_once_each(self):
        series = {'join_url': 'J1', 'online_meeting_id': 'M1', 'graph_event_id': 'E1'}
        manifest = [{'day': 'monday', 'joinUrl': 'J1'}, {'day': 'tuesday', 'joinUrl': 'J2', 'onlineMeetingId': 'M2'}]
        rows = [{'graph_event_id': 'E1', 'join_url': 'J1'}, {'graph_event_id': 'E9', 'join_url': 'J9', 'session_number': 3},
                {'graph_event_id': 'E8', 'join_url': 'J8', 'status': 'cancelled'}]
        self.assertEqual([item['joinUrl'] for item in self.retry.meetings_of(series, manifest, rows)], ['J1', 'J2', 'J9'])


class FailureLogTests(unittest.TestCase):
    def setUp(self):
        self.log = package_module('teams_graph_failure_log')
        self.log.reset_availability()

    def test_the_record_carries_what_support_asks_for(self):
        at = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)
        record = self.log.failure_record(self.log.OPTIONS_PATCH, FORBIDDEN, live_session_id='LIVE-1',
                                         online_meeting_id='online-1', organizer='tutor@example.invalid',
                                         organizer_object_id=OID, groups={'settings'}, at=at)
        self.assertEqual(record['graphRequestId'], REQUEST_ID)
        self.assertEqual(record['httpStatus'], 403)
        self.assertEqual(record['graphCode'], 'Forbidden')
        self.assertEqual(record['organizerObjectId'], OID)
        self.assertEqual(record['onlineMeetingId'], 'online-1')
        self.assertEqual(record['operation'], 'online_meeting_options_patch')
        self.assertEqual(record['occurredAt'], at.isoformat())
        self.assertEqual(record['groups'], ['settings'])

    def test_credentials_never_reach_the_record(self):
        text = FORBIDDEN.replace('insufficient permissions', 'Bearer eyJhbGciOiJSUzI1.eyJhdWQiOiJodHRw.c2lnbmF0dXJl '
                                 'client_secret=abc123 token')
        record = self.log.failure_record(self.log.OPTIONS_PATCH, text)
        self.assertNotIn('eyJ', json.dumps(record))
        self.assertNotIn('abc123', json.dumps(record))

    def test_recording_without_the_table_logs_and_never_raises(self):
        with self.assertLogs('curriculum_api.teams_graph_failure_log', 'WARNING') as logs:
            record = self.log.record_graph_failure(self.log.OPTIONS_PATCH, FORBIDDEN, live_session_id='LIVE-1')
        self.assertFalse(record['stored'])
        self.assertIn(REQUEST_ID, logs.output[0])
        self.assertIn('2026-10-08_teams_graph_failures.sql', logs.output[0])


class Forbidden403Tests(harness.CalendarChecksTests):
    """The real save and the real options PATCH, against a Microsoft that refuses the PATCH."""

    def setUp(self):
        super().setUp()
        self.meeting_403 = True
        self.meetings = {}
        self.failures = []
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        wanted = {'apply_teams_meeting_options', 'teams_meeting_base_path', 'teams_online_meeting_owner_id'}
        nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in wanted]
        self.assertEqual(len(nodes), len(wanted))
        self.v.__dict__.update(os=os, json=json, urlparse=urlparse, TEAMS_LOBBY_VALUES=dict(LOBBY_VALUES),
                               DEFAULT_TEAMS_LOBBY_BYPASS='invited', invalidate_curriculum_cache=lambda: None,
                               teams_online_meeting_from_join_url=lambda *args: {'id': 'online-1'})
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(ROOT / 'views.py'), 'exec'), self.v.__dict__)
        os.environ.pop('MICROSOFT_TEAMS_ORGANIZER_ID', None)
        # Every refusal recorded, whichever layer records it (the options
        # PATCH itself once wired, or Retry for a failure it was not told of).
        log = package_module('teams_graph_failure_log')
        recorder = patch.object(log, 'record_graph_failure',
                                lambda *args, **kwargs: self.failures.append((args, kwargs)) or {})
        recorder.start()
        self.addCleanup(recorder.stop)

    def graph(self, method, path, payload=None, *, extra_headers=None):
        if '/onlineMeetings/' in path:
            self.calls.append((method, path, copy.deepcopy(payload)))
            meeting = self.meetings.setdefault(path, {'id': path.rsplit('/', 1)[-1]})
            if method == 'PATCH':
                if self.meeting_403:
                    raise RuntimeError(FORBIDDEN)
                meeting.update(copy.deepcopy(payload))
                return copy.deepcopy(meeting)
            if method == 'GET':
                return copy.deepcopy(meeting)
            raise AssertionError(method)
        return super().graph(method, path, payload, extra_headers=extra_headers)

    def created(self):
        # Created while Microsoft accepts the options: a new calendar whose
        # options are refused invites nobody (covered in the harness).
        self.meeting_403 = False
        self.assertEqual(self.create().status_code, 201)
        self.meeting_403 = True
        self.series[0]['online_meeting_id'] = 'online-1'
        self.series[0].setdefault('recording', 'none')
        self.series[0].setdefault('lobby_bypass', 'invited')
        self.calls.clear(); self.headers.clear(); self.forwards.clear()

    def option_calls(self):
        return [call for call in self.calls if '/onlineMeetings/' in call[1]]

    def assert_nothing_cancelled_or_announced(self):
        self.assertFalse([call for call in self.calls if call[0] == 'DELETE' or call[1].rstrip('/').endswith('/cancel')])
        self.assertFalse(self.forwards)
        # Every event write was silent: no invitation, update or cancellation mail.
        self.assertTrue(all(item[2] == harness.SILENT_INVITE for item in self.headers
                            if item[0] in {'PATCH', 'POST'} and '/onlineMeetings/' not in item[1]))

    def test_invitation_only_save_sends_no_options_patch_while_microsoft_would_refuse_it(self):
        self.created()
        result = self.save(peopleOnly=True, invitationsOnly=True,
                           attendees=['learner@example.invalid', 'added@example.invalid'])
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.option_calls(), [])
        self.assertTrue(result['optionsApplied'])
        self.assertEqual(result['optionsPending'], [])
        self.assertIn('added@example.invalid', [item['emailAddress']['address'] for item in self.events['event-1']['attendees']])
        self.assertIn('added@example.invalid', self.series[0]['attendees'])
        self.assert_nothing_cancelled_or_announced()

    def test_removing_someone_is_also_invitation_only(self):
        self.created()
        result = self.save(peopleOnly=True, invitationsOnly=True, attendees=[])
        self.assertEqual(result.status_code, 200, result)
        self.assertEqual(self.option_calls(), [])
        self.assert_nothing_cancelled_or_announced()

    def test_a_refused_setting_keeps_the_invitation_saved_in_the_same_save(self):
        self.created()
        result = self.save(peopleOnly=True, invitationsOnly=True, recording='record-transcribe',
                           attendees=['learner@example.invalid', 'added@example.invalid'])
        self.assertEqual(result.status_code, 200, result)
        # One PATCH, the settings group only: no roles, no participant list.
        patches = [call for call in self.option_calls() if call[0] == 'PATCH']
        self.assertEqual(len(patches), 1)
        self.assertNotIn('participants', patches[0][2])
        self.assertIn('allowTranscription', patches[0][2])
        # Not reported as a success...
        self.assertTrue(result['partial'])
        self.assertFalse(result['optionsApplied'])
        self.assertEqual(result['optionsPending'], ['settings'])
        self.assertEqual(result['warnings'][-1]['graphError']['requestId'], REQUEST_ID)
        # ...the setting is not saved as if Microsoft had taken it...
        self.assertEqual(self.series[0]['recording'], 'none')
        # ...and the unrelated invitation change stays saved, silently.
        self.assertIn('added@example.invalid', self.series[0]['attendees'])
        self.assertIn('added@example.invalid', [item['emailAddress']['address'] for item in self.events['event-1']['attendees']])
        self.assert_nothing_cancelled_or_announced()
        retry = package_module('teams_options_retry')
        self.assertEqual(retry.microsoft_update_summary(self.series[0]['warnings'])['state'], 'failed')

    def test_a_refused_setting_is_recorded_and_its_marker_keeps_the_requested_values(self):
        policy = package_module('teams_meeting_options_policy')
        if 'requested' not in policy.pending_warning.__code__.co_varnames:
            self.skipTest('Needs the wiring patch (pending_warning keeps the requested settings).')
        self.created()
        self.save(peopleOnly=True, recording='record-transcribe', invitationsOnly=True)
        marker = self.series[0]['warnings'][-1]
        self.assertEqual(marker['requested']['recording'], 'record-transcribe')
        self.assertEqual(self.failures[0][0][0], 'online_meeting_options_patch')
        self.assertEqual(self.failures[0][1]['live_session_id'], 'LIVE-SYNTHETIC')
        self.assertEqual(self.failures[0][1]['online_meeting_id'], 'online-1')
        self.assertEqual(self.failures[0][1]['groups'], {'settings'})

    def run_retry(self):
        retry = package_module('teams_options_retry')
        self.calls.clear(); self.headers.clear(); self.forwards.clear(); self.failures.clear()
        body, status = retry.retry_options(self.v, self.graph, 'LIVE-SYNTHETIC',
                                           record_failure=lambda *args, **kwargs: self.failures.append((args, kwargs)))
        self.assertEqual(status, 200, body)
        # Retry touches the meeting options only: no event, no mail, no cancellation.
        self.assertTrue(all('/onlineMeetings/' in call[1] for call in self.calls), self.calls)
        self.assert_nothing_cancelled_or_announced()
        return body

    def test_retry_still_refused_stays_failed_and_is_recorded(self):
        self.created()
        self.save(peopleOnly=True, recording='record-transcribe', invitationsOnly=True)
        body = self.run_retry()
        self.assertEqual(body['remaining'], ['settings'])
        self.assertEqual(body['microsoftUpdate']['state'], 'failed')
        self.assertEqual(self.failures[0][0][0], 'online_meeting_options_patch')
        self.assertEqual(self.failures[0][1]['live_session_id'], 'LIVE-SYNTHETIC')
        self.assertEqual(self.series[0]['warnings'][-1]['attempts'], 2)

    def test_retry_accepted_and_read_back_is_saved_with_the_requested_settings(self):
        self.created()
        self.save(peopleOnly=True, recording='record-transcribe', invitationsOnly=True)
        # The marker as the wiring patch saves it: with the settings asked for.
        self.series[0]['warnings'][-1]['requested'] = {'recording': 'record-transcribe', 'lobby_bypass': 'invited',
                                                       'spoken_language': 'en-GB'}
        self.meeting_403 = False
        body = self.run_retry()
        self.assertEqual(body['confirmed'], ['settings'])
        self.assertEqual(body['microsoftUpdate']['state'], 'saved')
        self.assertEqual(self.series[0]['recording'], 'record-transcribe')
        self.assertEqual(self.series[0]['warnings'], [])
        self.assertFalse(body['requestedChangeUnknown'])

    def test_retry_without_the_requested_values_says_the_change_was_not_kept(self):
        self.created()
        self.save(peopleOnly=True, recording='record-transcribe', invitationsOnly=True)
        # A marker saved before the requested settings were kept.
        self.series[0]['warnings'][-1].pop('requested', None)
        self.meeting_403 = False
        body = self.run_retry()
        self.assertTrue(body['requestedChangeUnknown'])
        self.assertIn('choose it again', body['message'])
        self.assertEqual(self.series[0]['recording'], 'none')

    def test_an_accepted_write_microsoft_does_not_read_back_is_not_saved(self):
        self.created()
        self.save(peopleOnly=True, recording='record-transcribe', invitationsOnly=True)
        self.meeting_403 = False
        original = self.graph

        def stale_read(method, path, payload=None, **kwargs):
            if method == 'GET' and '/onlineMeetings/' in path:
                self.calls.append((method, path, None))
                return {'id': 'online-1', 'allowRecording': False, 'recordAutomatically': False,
                        'allowTranscription': False, 'lobbyBypassSettings': {'scope': 'invited'}}
            return original(method, path, payload, **kwargs)
        retry = package_module('teams_options_retry')
        self.series[0]['warnings'][-1]['requested'] = {'recording': 'record-transcribe'}
        # The PATCH goes through the transport (accepted); the read-back through stale_read.
        body, _ = retry.retry_options(self.v, stale_read, 'LIVE-SYNTHETIC',
                                      record_failure=lambda *a, **k: self.failures.append((a, k)))
        self.assertEqual(body['remaining'], ['settings'])
        self.assertNotEqual(body['microsoftUpdate']['state'], 'saved')
        self.assertEqual(self.series[0]['recording'], 'none')
        self.assertEqual(self.failures[-1][0][0], 'online_meeting_options_confirm')

    def test_retry_with_nothing_pending_sends_nothing(self):
        self.created()
        body = self.run_retry()
        self.assertEqual(body['retried'], [])
        self.assertEqual(self.calls, [])


def load_tests(loader, tests, pattern):
    """Only this file's tests: the harness's own run in their own file."""
    suite = unittest.TestSuite()
    for case in (SummaryAndConfirmationTests, FailureLogTests):
        suite.addTests(loader.loadTestsFromTestCase(case))
    for name in sorted(name for name in Forbidden403Tests.__dict__ if name.startswith('test_')):
        suite.addTest(Forbidden403Tests(name))
    return suite


if __name__ == '__main__':
    unittest.main()
