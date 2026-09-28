"""Run directly with Python. The create claim around the Teams create endpoint; no DB, no Graph."""
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules.setdefault('curriculum_api', package)

from django.conf import settings
if not settings.configured:
    settings.configure(SECRET_KEY='synthetic-test-key', DEFAULT_CHARSET='utf-8')
from django.http import JsonResponse

from curriculum_api import teams_create_guard as guard


class MemoryClaims:
    """The claim rules of CreateClaims.claim, in memory. `now` moves leases."""
    rows = {}

    def __init__(self, _db=None):
        self.rows = MemoryClaims.rows

    def check(self):
        pass

    def claim(self, key, token, take_over_uncertain=False):
        row = self.rows.get(key)
        free = (row is None or row['status'] == 'done'
                or (take_over_uncertain and (row['status'] == 'uncertain' or row['expired'])))
        if free:
            self.rows[key] = {'status': 'creating', 'token': token, 'outcomeStatus': None, 'outcomeCode': '',
                              'liveSessionId': '', 'claimedAt': 't', 'leaseUntil': 't', 'expired': False}
        return free

    def finish(self, key, token, status, outcome_status=None, code='', live_session_id=''):
        row = self.rows.get(key)
        if row and row['token'] == token and row['status'] == 'creating':
            row.update(status=status, outcomeStatus=outcome_status, outcomeCode=code, liveSessionId=live_session_id)

    def read(self, key):
        row = self.rows.get(key)
        return {k: v for k, v in row.items() if k != 'token'} if row else None


def request(method='POST', body=None, query=None):
    return types.SimpleNamespace(method=method, GET=query or {}, body=json.dumps(body or {}).encode())


class CreateGuardTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        MemoryClaims.rows = {}
        self.payload = {'moduleCatalogueId': 'MOD-1', 'title': 'Synthetic'}
        self.view = Mock(return_value=JsonResponse({'created': True, 'meeting': {'liveSessionId': 'LIVE-1'}}))
        self.views = types.SimpleNamespace(
            curriculum_teams_meeting=self.view, clean_str=lambda value: str(value or '').strip(),
            json_body=lambda req: json.loads(req.body), resolve_authoring_catalogue_id=lambda value: value,
            resolve_stored_module_catalogue_id=Mock(side_effect=lambda value: value),
            authoring_module_exists=lambda value: value == 'MOD-1', LIVE_SESSIONS_TABLE='live',
            parse_json_value=lambda value, default: value if value is not None else default,
            authoring_fetch_all=Mock(return_value=[]))
        modules = patch.dict(sys.modules, {'curriculum_api.views': self.views})
        modules.start()
        self.addCleanup(modules.stop)
        package.views = self.views
        claims = patch.object(guard, 'CreateClaims', MemoryClaims)
        claims.start()
        self.addCleanup(claims.stop)

    def post(self, query=None):
        return guard.teams_meeting_collection(request(body=self.payload, query=query))

    def test_a_create_records_its_outcome_and_frees_the_module(self):
        self.assertEqual(self.post().status_code, 200)
        claim = MemoryClaims.rows['module:MOD-1']
        self.assertEqual((claim['status'], claim['outcomeStatus'], claim['liveSessionId']), ('done', 200, 'LIVE-1'))
        # A finished claim does not block: the endpoint's own active-calendar check decides.
        self.post()
        self.assertEqual(self.view.call_count, 2)

    def test_second_create_while_first_is_in_flight_never_reaches_microsoft(self):
        seen = []

        def slow_first(req):
            # The browser gave up and Create was pressed again, mid-flight.
            seen.append(guard.teams_meeting_collection(request(body=self.payload)))
            return JsonResponse({'created': True, 'meeting': {'liveSessionId': 'LIVE-1'}})

        self.view.side_effect = slow_first
        self.assertEqual(self.post().status_code, 200)
        self.assertEqual(self.view.call_count, 1)
        refused = json.loads(seen[0].content)
        self.assertEqual(seen[0].status_code, 409)
        self.assertEqual(refused['code'], 'teams_calendar_create_in_progress')

    def test_a_raised_create_is_uncertain_and_needs_a_person_to_confirm(self):
        self.view.side_effect = RuntimeError('worker died mid-Graph')
        with self.assertRaises(RuntimeError):
            self.post()
        self.assertEqual(MemoryClaims.rows['module:MOD-1']['status'], 'uncertain')
        self.view.side_effect = None
        refused = self.post()
        self.assertEqual(json.loads(refused.content)['code'], 'teams_calendar_create_uncertain')
        self.assertEqual(self.view.call_count, 1)
        self.assertEqual(self.post({'confirmUncertain': '1'}).status_code, 200)
        self.assertEqual(self.view.call_count, 2)

    def test_crashed_worker_lease_reads_as_uncertain_not_in_progress(self):
        self.assertTrue(MemoryClaims().claim('module:MOD-1', 'T' * 32))
        MemoryClaims.rows['module:MOD-1']['expired'] = True
        self.assertEqual(guard.claim_state(MemoryClaims().read('module:MOD-1')), 'uncertain')
        self.assertEqual(json.loads(self.post().content)['code'], 'teams_calendar_create_uncertain')
        self.view.assert_not_called()

    def test_failed_create_is_a_known_outcome(self):
        self.view.return_value = JsonResponse({'error': 'Microsoft Teams could not create the meeting.'}, status=502)
        self.assertEqual(self.post().status_code, 502)
        self.assertEqual(MemoryClaims.rows['module:MOD-1']['status'], 'done')
        self.assertEqual(MemoryClaims.rows['module:MOD-1']['outcomeStatus'], 502)

    def test_unprovisioned_guard_fails_closed_before_microsoft(self):
        with patch.object(MemoryClaims, 'check', side_effect=RuntimeError('apply the SQL')):
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.view.assert_not_called()

    def emailing(self, role='staff'):
        """A verified 201 create, a signed-in caller, and a recording email sender."""
        self.view.return_value = JsonResponse({'created': True, 'meeting': {'liveSessionId': 'LIVE-1'}, 'warnings': []}, status=201)
        states_at_send = []

        def send(live_id):
            states_at_send.append(MemoryClaims.rows['module:MOD-1']['status'])
            return {'total': 3, 'accepted': 3, 'queued': 0, 'failed': 0, 'uncertain': 0, 'status': 'complete'}

        sender = Mock(side_effect=send)
        account = types.SimpleNamespace(role=role) if role else None
        modules = patch.dict(sys.modules, {
            'login.sessions': types.SimpleNamespace(authenticate_request=lambda _req: account),
            'curriculum_api.teams_schedule_delivery': types.SimpleNamespace(send_creation_emails=sender),
        })
        modules.start()
        self.addCleanup(modules.stop)
        return sender, states_at_send

    def test_verified_create_sends_its_emails_before_the_claim_finishes(self):
        sender, states_at_send = self.emailing()
        response = self.post()
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 201)
        sender.assert_called_once_with('LIVE-1')
        self.assertEqual(body['scheduleEmail']['accepted'], 3)
        self.assertEqual(body['meeting']['liveSessionId'], 'LIVE-1')
        # A browser reading the claim sees 'done' only once the emails are out.
        self.assertEqual(states_at_send, ['creating'])
        claim = MemoryClaims.rows['module:MOD-1']
        self.assertEqual((claim['status'], claim['outcomeStatus'], claim['liveSessionId']), ('done', 201, 'LIVE-1'))

    def test_failed_or_unverified_creates_email_nobody(self):
        sender, _states = self.emailing()
        self.view.return_value = JsonResponse({'error': 'Verification incomplete.', 'liveSessionId': 'LIVE-1'}, status=502)
        self.assertNotIn('scheduleEmail', json.loads(self.post().content))
        self.view.return_value = JsonResponse({'created': True, 'meeting': {'liveSessionId': 'LIVE-1'}, 'warnings': ['Options not applied.']}, status=201)
        self.assertNotIn('scheduleEmail', json.loads(self.post().content))
        sender.assert_not_called()

    def test_only_the_schedule_email_roles_have_the_create_send_mail(self):
        for role in ('learner', 'employer', None):
            with self.subTest(role=role):
                MemoryClaims.rows = {}
                sender, _states = self.emailing(role)
                response = self.post()
                self.assertEqual(response.status_code, 201)
                self.assertNotIn('scheduleEmail', json.loads(response.content))
                sender.assert_not_called()

    def test_an_email_step_that_breaks_still_finishes_the_claim(self):
        sender, _states = self.emailing()
        sender.side_effect = RuntimeError('unexpected')
        self.assertEqual(self.post().status_code, 201)
        self.assertEqual(MemoryClaims.rows['module:MOD-1']['status'], 'done')

    def test_reads_and_calls_without_a_module_pass_straight_through(self):
        guard.teams_meeting_collection(request('GET'))
        self.payload = {'title': 'No module'}
        self.post()
        self.assertEqual(self.view.call_count, 2)
        self.assertFalse(MemoryClaims.rows)

    def test_status_reports_the_claim_and_the_saved_calendar(self):
        status = json.loads(guard.teams_create_status(request('GET', query={'moduleCatalogueId': 'MOD-1'})).content)
        self.assertEqual((status['state'], status['calendar']), ('none', None))
        self.post()
        self.views.authoring_fetch_all.return_value = [{'id': 'LIVE-1', 'join_url': 'https://teams.microsoft.com/meet/x',
                                                        'organizer_email': 'o@example.invalid', 'warnings': []}]
        status = json.loads(guard.teams_create_status(request('GET', query={'moduleCatalogueId': 'MOD-1'})).content)
        self.assertEqual(status['state'], 'done')
        self.assertEqual(status['claim']['outcomeStatus'], 200)
        self.assertEqual(status['calendar']['liveSessionId'], 'LIVE-1')
        self.assertTrue(status['calendar']['settingsApplied'])
        self.assertEqual(guard.teams_create_status(request('POST')).status_code, 405)

    def test_status_counts_the_calendars_emails_without_naming_anyone(self):
        states = {'a@example.invalid': 'accepted', 'b@example.invalid': 'accepted', 'c@example.invalid': 'queued',
                  'd@example.invalid': 'failed', 'e@example.invalid': 'sending'}
        ledger = Mock()
        ledger.states.return_value = states
        self.views.authoring_fetch_all.return_value = [{'id': 'LIVE-1', 'join_url': 'https://teams.microsoft.com/meet/x',
                                                        'organizer_email': 'o@example.invalid', 'warnings': []}]
        with patch.dict(sys.modules, {'curriculum_api.teams_schedule_delivery': types.SimpleNamespace(DeliveryLedger=lambda _db: ledger)}):
            response = guard.teams_create_status(request('GET', query={'moduleCatalogueId': 'MOD-1'}))
        body = json.loads(response.content)
        self.assertEqual(body['emails'], {'total': 5, 'accepted': 2, 'queued': 1, 'failed': 1, 'uncertain': 1})
        ledger.states.assert_called_once_with('LIVE-1')
        self.assertNotIn('example.invalid', json.dumps(body['emails']))
        # An unreadable ledger hides the count; it never fails the status read.
        ledger.check.side_effect = RuntimeError('not provisioned')
        with patch.dict(sys.modules, {'curriculum_api.teams_schedule_delivery': types.SimpleNamespace(DeliveryLedger=lambda _db: ledger)}):
            body = json.loads(guard.teams_create_status(request('GET', query={'moduleCatalogueId': 'MOD-1'})).content)
        self.assertIsNone(body['emails'])
        self.assertEqual(body['calendar']['liveSessionId'], 'LIVE-1')

    def test_module_identity_uses_the_indexed_lookup_not_the_whole_catalogue(self):
        self.views.resolve_authoring_catalogue_id = Mock(side_effect=AssertionError('whole-catalogue resolver'))
        self.assertEqual(guard.module_key(self.views, {'moduleCatalogueId': 'MOD-1'}), 'module:MOD-1')
        self.views.resolve_stored_module_catalogue_id.assert_called_with('MOD-1')

    def test_claim_sql_is_one_conditional_statement_and_never_provisions(self):
        source = (ROOT / 'teams_create_guard.py').read_text(encoding='utf-8')
        self.assertIn('ON CONFLICT (module_key) DO UPDATE', source)
        self.assertIn("WHERE module_key = %s AND token = %s AND status = 'creating'", source)
        self.assertNotIn('CREATE TABLE', source)


if __name__ == '__main__':
    unittest.main()
