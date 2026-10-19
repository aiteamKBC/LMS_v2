"""Focused read-only imported participant checks; no Django setup, DB or network.

Run only when Teams tests are explicitly requested by the local user.
"""
import copy
import functools
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest
from contextlib import contextmanager
from unittest.mock import patch
from urllib.parse import urlencode


class Response(dict):
    def __init__(self, data, status=200):
        super().__init__(data)
        self.status_code = status
        self.headers = {}

    def __setitem__(self, key, value):
        if key == 'Cache-Control':
            self.headers[key] = value
        else:
            super().__setitem__(key, value)


class DatabaseError(Exception):
    pass


class TransportError(Exception):
    pass


class GraphError(RuntimeError):
    def __init__(self, status):
        self.status_code = status
        super().__init__('Private Microsoft diagnostic must not escape')


def require_role(*roles):
    def decorate(view):
        @functools.wraps(view)
        def wrapped(request, *args, **kwargs):
            if request.role not in roles:
                return Response({'error': 'Forbidden'}, 403)
            return view(request, *args, **kwargs)
        return wrapped
    return decorate


def require_get(view):
    @functools.wraps(view)
    def wrapped(request, *args, **kwargs):
        if request.method != 'GET':
            return Response({'error': 'Method not allowed'}, 405)
        return view(request, *args, **kwargs)
    return wrapped


def never_cache(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        result = view(*args, **kwargs)
        result['Cache-Control'] = 'private, no-store'
        return result
    return wrapped


def load_report():
    root = Path(__file__).parent
    package = types.ModuleType('curriculum_api')
    package.__path__ = [str(root)]
    stubs = {'curriculum_api': package}
    for name, attributes in {
        'httpx': {'HTTPError': TransportError}, 'django': {},
        'django.db': {'DatabaseError': DatabaseError}, 'django.http': {'JsonResponse': Response},
        'django.views': {}, 'django.views.decorators': {},
        'django.views.decorators.cache': {'never_cache': never_cache},
        'django.views.decorators.http': {'require_GET': require_get},
        'login': {}, 'login.permissions': {'require_role': require_role},
    }.items():
        module = types.ModuleType(name)
        for key, value in attributes.items():
            setattr(module, key, value)
        stubs[name] = module
    spec = importlib.util.spec_from_file_location('curriculum_api.teams_imported_participants',
                                                root / 'teams_imported_participants.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, stubs):
        spec.loader.exec_module(module)
    return module


report = load_report()
OWNER = '11111111-2222-3333-4444-555555555555'
LINK = 'https://teams.microsoft.com/l/meetup-join/example?' + urlencode({'context': json.dumps({'Oid': OWNER})})


class ImportedParticipantTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start()
        self.addCleanup(network.stop)
        self.series = {'id': 'LIVE-1', 'meeting_type': 'linked-external', 'module_title': "Teacher's weekly series",
                       'organizer_email': 'organizer@example.invalid', 'online_meeting_id': 'ONLINE-1', 'join_url': LINK}
        self.event = {'id': 'MASTER-1', 'iCalUId': 'ICAL-1', 'type': 'seriesMaster',
                      'subject': self.series['module_title'], 'isCancelled': False, 'isOrganizer': False,
                      'hideAttendees': False, 'recurrence': {'pattern': {'type': 'weekly'}},
                      'organizer': {'emailAddress': {'name': 'Organizer', 'address': self.series['organizer_email']}},
                      'attendees': [{'emailAddress': {'name': 'Learner', 'address': 'learner@example.invalid'}}],
                      'onlineMeeting': {'joinUrl': LINK}}
        self.meeting = {'id': 'ONLINE-1', 'joinWebUrl': LINK, 'allowedPresenters': 'roleIsPresenter',
                        'participants': {'organizer': {'upn': self.series['organizer_email'],
                                                      'identity': {'user': {'id': OWNER, 'displayName': 'Organizer'}}},
                                         'attendees': [{'upn': 'presenter@example.invalid', 'role': 'presenter'},
                                                       {'upn': 'co@example.invalid', 'role': 'coorganizer'}]}}
        self.calls = []
        self.calendar_error = GraphError(404)
        self.roles_error = None

    def read(self, path, **kwargs):
        self.calls.append((path, kwargs))
        if '/onlineMeetings/' in path:
            self.assertEqual(kwargs, {'prefer': 'include-unknown-enum-members'})
            if self.roles_error:
                raise self.roles_error
            return copy.deepcopy(self.meeting)
        self.assertEqual(kwargs, {})
        self.assertIn('/events?', path)
        self.assertIn('%24filter=subject+eq+', path)
        if path.startswith('users/organizer%40') and self.calendar_error:
            raise self.calendar_error
        return {'value': [copy.deepcopy(self.event)]}

    @contextmanager
    def reader(self):
        yield self.read

    def test_attendee_copy_and_online_roles_are_separate_and_do_not_change_saved_rows(self):
        before = copy.deepcopy(self.series)
        result = report.imported_participant_report(self.series, self.reader)
        self.assertEqual(result['calendar']['status'], 'available')
        self.assertEqual(result['calendar']['source'], 'attendee_calendar')
        self.assertEqual(result['calendar']['attendees'][0]['email'], 'learner@example.invalid')
        self.assertEqual(result['roles']['presenters'][0]['email'], 'presenter@example.invalid')
        self.assertEqual(result['roles']['coOrganizers'][0]['email'], 'co@example.invalid')
        self.assertEqual(before, self.series)
        self.assertEqual(len(self.calls), 3)

    def test_roles_denial_does_not_hide_readable_calendar_invites_or_claim_empty_roles(self):
        self.roles_error = GraphError(403)
        result = report.imported_participant_report(self.series, self.reader)
        self.assertEqual(result['calendar']['status'], 'available')
        self.assertEqual(result['roles']['status'], 'access_denied')
        self.assertNotIn('presenters', result['roles'])
        self.assertNotIn('Private Microsoft', json.dumps(result))

    def test_fresh_online_organizer_precedes_calendar_mailbox_and_needs_no_saved_lookup(self):
        self.event['organizer']['emailAddress'] = {'name': 'Channel calendar', 'address': 'channel@example.invalid'}
        def forbidden_saved_lookup(*args):
            raise AssertionError('Saved evidence should not be read when Microsoft verified the organiser')
        result = report.imported_participant_report(self.series, self.reader, forbidden_saved_lookup)
        self.assertEqual(result['organizer']['source'], 'online_meeting')
        self.assertEqual(result['organizer']['person']['email'], self.series['organizer_email'])
        self.assertEqual(result['calendar']['organizer']['email'], 'channel@example.invalid')
        self.assertIn('verifiedAt', result['organizer'])
        self.assertNotIn('evidenceAt', result['organizer'])

    def test_calendar_mailbox_is_never_used_as_unknown_meeting_owner(self):
        self.roles_error = GraphError(403)
        result = report.imported_participant_report(self.series, self.reader)
        self.assertEqual(result['organizer']['status'], 'access_denied')
        self.assertNotIn('person', result['organizer'])
        self.assertIn('organizer', result['calendar'])

    def test_hidden_attendee_copy_is_partial(self):
        self.event['hideAttendees'] = True
        result = report.calendar_report(self.series, self.read)
        self.assertEqual(result['status'], 'partial')
        self.assertEqual(len(result['attendees']), 1)

    def test_missing_invitation_property_is_unknown_not_empty(self):
        del self.event['attendees']
        result = report.calendar_report(self.series, self.read)
        self.assertEqual(result['status'], 'partial')
        self.assertNotIn('attendees', result)

    def test_exact_link_required_even_when_title_matches(self):
        self.calendar_error = None
        self.event['onlineMeeting']['joinUrl'] = LINK + 'different'
        self.assertEqual(report.calendar_report(self.series, self.read)['status'], 'not_connected')

    def test_multiple_matching_masters_are_ambiguous(self):
        def read(path):
            return {'value': [self.event, {**self.event, 'id': 'MASTER-2'}]}
        self.assertEqual(report.calendar_report(self.series, read)['status'], 'ambiguous')

    def test_incomplete_or_cross_mailbox_pagination_never_publishes_partial_search(self):
        for next_link in ('https://other.invalid/v1.0/users/other/events',
                          'https://graph.microsoft.com/v1.0/users/other/events'):
            with self.subTest(next_link=next_link):
                result = report.calendar_report(self.series, lambda path: {'value': [self.event], '@odata.nextLink': next_link})
                self.assertEqual(result['status'], 'unavailable')
                self.assertNotIn('attendees', result)

    def test_different_series_across_candidate_mailboxes_are_ambiguous(self):
        def read(path):
            identity = 'ICAL-1' if path.startswith('users/organizer%40') else 'ICAL-2'
            return {'value': [{**self.event, 'iCalUId': identity}]}
        self.assertEqual(report.calendar_report(self.series, read)['status'], 'ambiguous')

    def test_failure_after_first_page_cannot_fall_back_to_a_different_mailbox(self):
        calls = []
        def read(path):
            calls.append(path)
            if len(calls) > 1:
                raise GraphError(403)
            return {'value': [self.event], '@odata.nextLink':
                    'https://graph.microsoft.com/v1.0/users/organizer%40example.invalid/events?$skip=100'}
        result = report.calendar_report(self.series, read)
        self.assertEqual(result['status'], 'unavailable')
        self.assertNotIn('attendees', result)
        self.assertEqual(len(calls), 2)

    def test_organizer_copy_is_preferred_when_two_copies_have_same_identity(self):
        def read(path):
            return {'value': [{**self.event, 'isOrganizer': path.startswith('users/organizer%40')}]}
        self.assertEqual(report.calendar_report(self.series, read)['source'], 'organizer_calendar')

    def test_online_meeting_identity_must_match_all_three_saved_identities(self):
        for mismatch in ('id', 'joinWebUrl', 'owner'):
            with self.subTest(mismatch=mismatch):
                changed = copy.deepcopy(self.meeting)
                if mismatch == 'owner':
                    changed['participants']['organizer']['identity']['user']['id'] = 'wrong-owner'
                else:
                    changed[mismatch] = 'wrong-identity'
                result = report.roles_report(self.series, lambda *args, **kwargs: changed)
                self.assertEqual(result['status'], 'unavailable')
                self.assertNotIn('presenters', result)

    def test_missing_or_unknown_roles_do_not_become_confirmed_empty_lists(self):
        for rows in (None, [{'role': 'unknownFutureValue', 'upn': 'co@example.invalid'}]):
            with self.subTest(rows=rows):
                self.meeting['participants']['attendees'] = rows
                result = report.roles_report(self.series, self.read)
                self.assertEqual(result['status'], 'partial')
                self.assertNotIn('coOrganizers', result)

    def test_channel_link_context_does_not_accept_an_arbitrary_host_or_malformed_oid(self):
        self.assertEqual(report.join_context_oid(LINK), OWNER)
        self.assertEqual(report.join_context_oid(LINK.replace('teams.microsoft.com', 'evil.invalid')), '')
        self.assertEqual(report.join_context_oid(LINK.replace(OWNER, 'not-a-guid')), '')

    def test_endpoint_staff_get_no_store_and_no_schema_ensure(self):
        package = types.ModuleType('curriculum_api')
        package.__path__ = [str(Path(__file__).parent)]
        views = types.ModuleType('curriculum_api.views')
        views.LIVE_SESSIONS_TABLE = 'live_sessions'
        fetches = []
        def fetch(*args, **kwargs):
            fetches.append((args, kwargs))
            return [self.series]
        views.authoring_fetch_all = fetch
        package.views = views
        state = types.ModuleType('curriculum_api.teams_calendar_state')
        state.calendar_reader = self.reader
        with patch.dict(sys.modules, {'curriculum_api': package, 'curriculum_api.views': views,
                                     'curriculum_api.teams_calendar_state': state}):
            for role, method, status in [('learner', 'GET', 403), ('staff', 'POST', 405), ('staff', 'GET', 200)]:
                result = report.imported_meeting_participants(types.SimpleNamespace(role=role, method=method), 'LIVE-1')
                self.assertEqual(result.status_code, status)
                self.assertIn('no-store', result.headers['Cache-Control'])
            self.assertEqual(len(fetches), 1)
            self.assertEqual(fetches[0][1], {'ensure_tables': False})
            self.series['meeting_type'] = 'live'
            result = report.imported_meeting_participants(types.SimpleNamespace(role='admin', method='GET'), 'LIVE-1')
            self.assertEqual(result.status_code, 409)


if __name__ == '__main__':
    unittest.main()
